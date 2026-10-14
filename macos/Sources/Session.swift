import Foundation
import Combine
import ServiceManagement

enum DrillMode: String {
  case learn, rote, study, dakuten, chart
}

enum GradeFlash {
  case none, ok, miss
}

struct DrillSet: Identifiable {
  let id: String
  let label: String
  let count: Int
  let done: Int
}

@MainActor
final class Session: ObservableObject {
  @Published var mode: DrillMode = .study
  @Published var script: String = "hiragana"
  @Published var glyph: String = ""
  @Published var romaji: String = ""
  @Published var mnemonic: String = ""
  @Published var partner: String = ""
  @Published var answer: String = ""
  @Published var flash: GradeFlash = .none
  @Published var revealed: String?
  @Published var thinking = false
  @Published var popOnThink = true
  @Published var learned = 0
  @Published var total = 104
  @Published var mastered = 0
  @Published var learning = 0
  @Published var due = 0
  @Published var reason = "due"
  @Published var learnIndex = 0
  @Published var learnTotal = 0
  @Published var roteDone = 0
  @Published var roteTotal = 0
  @Published var hint: String?
  @Published var emptyMessage: String?
  @Published var scoreCorrect = 0
  @Published var scoreSeen = 0
  @Published var engineError: String?
  @Published var focusNonce = 0
  @Published var showSettings = false
  @Published var glyphFontID = GlyphTypeface.fallback
  @Published var launchAtLogin = false
  @Published var chart: [ChartSection] = []
  @Published var dakutenMark = "゛"
  @Published var dakutenKind = "rule"
  @Published var dakutenVoiced = ""
  @Published var dakutenVoicedRomaji = ""
  @Published var dakutenCaption = ""
  @Published var dakutenPromptIsKana = false
  @Published var dakutenExampleFrom = ""
  @Published var dakutenLessonId = ""
  @Published var dakutenGroupIndex = 0
  @Published var dakutenGroupSize = 0
  @Published var drillPicker = false
  @Published var drillSets: [DrillSet] = []
  @Published var cram = false

  private var learnGlyphs: [String] = []
  private var pendingRote: [String] = []
  private var returnToChart = false
  private var lastGlyph: String?
  private var busy = false
  private var activeDrill: String?
  private var practiceDay = ""
  private var sessionGood: [String: Int] = [:]
  private var flashWork: DispatchWorkItem?
  private let roteStreak = 3

  var headerMode: DrillMode {
    if mode == .rote { return cram ? .study : .learn }
    return mode
  }

  func requestFocus() {
    focusNonce += 1
    if mode == .rote, activeDrill != nil, !busy {
      let store = Store.load()
      if restoreDrillProgress(store) { dealRote(store) }
    }
  }

  // A pending grade must never route back to an old mode after navigation.
  private func cancelFeedback() {
    flashWork?.cancel()
    flashWork = nil
    busy = false
    flash = .none
    revealed = nil
    answer = ""
  }

  @discardableResult
  private func restoreDrillProgress(_ store: [String: Any]) -> Bool {
    guard let key = activeDrill,
          let progress = Engine.dict(Engine.shared.invoke("drillProgress", [
            "store": store, "key": key, "now": Date().timeIntervalSince1970 * 1000,
          ])) else { return false }
    let date = Engine.string(progress["date"]) ?? ""
    let changed = date != practiceDay
    practiceDay = date
    let streaks = progress["streaks"] as? [String: NSNumber] ?? [:]
    sessionGood = streaks.mapValues { $0.intValue }
    scoreCorrect = (progress["correct"] as? NSNumber)?.intValue ?? 0
    scoreSeen = (progress["seen"] as? NSNumber)?.intValue ?? 0
    return changed
  }


  func appear() {
    popOnThink = Store.popOnThink()
    glyphFontID = Store.glyphFont()
    if #available(macOS 13.0, *) {
      launchAtLogin = SMAppService.mainApp.status == .enabled
    }
    var store = Store.load()
    if let prepared = Engine.shared.invoke("prepare", ["store": store]) as? [String: Any] {
      if Engine.bool(prepared["changed"]), let next = prepared["store"] as? [String: Any] {
        Store.save(next)
        store = next
      } else if let next = prepared["store"] as? [String: Any] {
        store = next
      }
    }
    if let err = Engine.shared.loadError { engineError = err }
    script = Engine.string(Engine.shared.invoke("resolveScript", ["store": store])) ?? script
    refreshSummary(store)
    if learned == 0 {
      mode = .learn
      startLearn(store)
    } else if roteCount(store) > 0 {
      mode = .rote
      cram = Engine.string(store["roteKind"]) == "cram"
      activeDrill = Engine.string(store["activeDrill"])
      restoreDrillProgress(store)
      dealRote(store)
    } else {
      mode = .study
      dealStudy(store)
    }
  }

  func setMode(_ next: DrillMode) {
    cancelFeedback()
    activeDrill = nil
    sessionGood.removeAll()
    let target: DrillMode = next == .rote ? .learn : next
    answer = ""
    flash = .none
    revealed = nil
    hint = nil
    lastGlyph = nil
    emptyMessage = nil
    drillPicker = false
    pendingRote = []
    returnToChart = false
    let store = Store.load()
    switch target {
    case .learn:
      let kind = Engine.string(store["roteKind"])
      if roteCount(store) > 0 && kind != "cram" {
        cram = false
        mode = .rote
        dealRote(store)
      } else {
        if kind == "cram" {
          Store.update { s in
            s["rote"] = [] as [String]
            s["roteKind"] = ""
            s["activeDrill"] = NSNull()
          }
        }
        cram = false
        mode = .learn
        startLearn(Store.load())
      }
    case .study:
      mode = .study
      dealStudy(store)
    case .dakuten:
      mode = .dakuten
      dakutenGroupIndex = 0
      dealDakuten()
    case .chart:
      mode = .chart
      refreshChart(store)
    case .rote:
      break
    }
  }

  func setGlyphFont(_ id: String) {
    glyphFontID = GlyphTypeface.resolved(id)
    Store.setGlyphFont(glyphFontID)
  }

  func setPopOnThink(_ on: Bool) {
    popOnThink = on
    Store.setPopOnThink(on)
  }

  func setLaunchAtLogin(_ on: Bool) {
    if #available(macOS 13.0, *) {
      do {
        if on { try SMAppService.mainApp.register() }
        else { try SMAppService.mainApp.unregister() }
        launchAtLogin = SMAppService.mainApp.status == .enabled
      } catch {
        NSLog("kanthropic login item: \(error.localizedDescription)")
      }
    }
  }

  func openSettings() { showSettings = true }
  func closeSettings() { showSettings = false }

  func setScript(_ next: String) {
    guard next != script else { return }
    script = next
    Store.setScript(next)
    lastGlyph = nil
    learnGlyphs = []
    sessionGood.removeAll()
    setMode(headerMode)
  }

  func submit() {
    if mode == .learn {
      continueLearn()
      return
    }
    if mode == .dakuten {
      submitDakuten()
      return
    }
    guard !busy else { return }
    let typed = answer.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !typed.isEmpty, !glyph.isEmpty else { return }
    let store = Store.load()
    let ok = Engine.bool(Engine.shared.invoke("check", [
      "script": script, "glyph": glyph, "input": typed,
    ]))

    // Rote: local streaks only. FSRS writes on hits would fake long-term memory.
    if mode == .rote {
      // Refresh at answer time too: the panel may stay open across midnight.
      restoreDrillProgress(store)
      scoreSeen += 1
      busy = true
      if ok {
        scoreCorrect += 1
        sessionGood[glyph] = (sessionGood[glyph] ?? 0) + 1
        flash = .ok
        revealed = nil
      } else {
        sessionGood[glyph] = 0
        flash = .miss
        revealed = romaji
      }
      if let key = activeDrill {
        let saved = Store.update { s in
          if let result = Engine.dict(Engine.shared.invoke("gradeDrill", [
            "store": s, "key": key, "glyph": self.glyph, "correct": ok,
            "now": Date().timeIntervalSince1970 * 1000,
          ])), let next = result["store"] as? [String: Any] { s = next }
        }
        restoreDrillProgress(saved)
      }
      let delay: Double = ok ? 0.4 : 1.2
      let work = DispatchWorkItem { [weak self] in
        guard let self else { return }
        self.flash = .none
        self.revealed = nil
        self.answer = ""
        self.busy = false
        if self.allRoteSticking() {
          self.confirmConfident()
        } else {
          self.dealRote(Store.load())
        }
      }
      flashWork?.cancel()
      flashWork = work
      DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
      refreshRoteCounts(store)
      return
    }

    if let card = Engine.shared.invoke("grade", [
      "script": script,
      "glyph": glyph,
      "store": store,
      "correct": ok,
      "now": Date().timeIntervalSince1970 * 1000,
    ]) {
      Store.update { s in
        var cards = s["cards"] as? [String: Any] ?? [:]
        cards[self.glyph] = card
        s["cards"] = cards
      }
    }
    scoreSeen += 1
    busy = true
    if ok {
      scoreCorrect += 1
      flash = .ok
      revealed = nil
    } else {
      flash = .miss
      revealed = romaji
    }
    let delay: Double = ok ? 0.45 : 1.25
    let work = DispatchWorkItem { [weak self] in
      self?.flash = .none
      self?.revealed = nil
      self?.answer = ""
      self?.busy = false
      self?.dealStudy(Store.load())
    }
    flashWork?.cancel()
    flashWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
  }

  func continueLearn() {
    guard !learnGlyphs.isEmpty else { return }
    if learnIndex + 1 < learnGlyphs.count {
      learnIndex += 1
      showLearn()
      return
    }
    let rote = pendingRote.isEmpty ? learnGlyphs : pendingRote
    let kind = pendingRote.isEmpty ? "row" : "cram"
    pendingRote = []
    Store.update { s in
      let learned = s["learned"] as? [String] ?? []
      var set = Set(learned)
      for g in rote { set.insert(g) }
      s["learned"] = Array(set)
      s["rote"] = rote
      s["roteKind"] = kind
      s["activeDrill"] = NSNull()
    }
    learnGlyphs = []
    sessionGood.removeAll()
    activeDrill = nil
    cram = kind == "cram"
    mode = .rote
    hint = "rote until they stick"
    dealRote(Store.load())
  }

  /// Graduate the rote set onto the FSRS schedule (one Good each, first time).
  func confirmConfident() {
    cancelFeedback()
    let store = Store.load()
    let rote = (store["rote"] as? [String]) ?? []
    let now = Date().timeIntervalSince1970 * 1000
    Store.update { s in
      var cards = s["cards"] as? [String: Any] ?? [:]
      for g in rote {
        let seen = (cards[g] as? [String: Any])?["seen"] as? NSNumber
        if seen == nil || seen?.intValue == 0 {
          if let card = Engine.shared.invoke("grade", [
            "script": self.script, "glyph": g, "store": s, "correct": true, "now": now,
          ]) {
            cards[g] = card
          }
        }
      }
      s["cards"] = cards
      s["rote"] = [] as [String]
      s["roteKind"] = ""
      s["activeDrill"] = NSNull()
    }
    activeDrill = nil
    sessionGood.removeAll()
    cram = false
    let back = returnToChart
    returnToChart = false
    if back {
      mode = .chart
      hint = nil
      emptyMessage = nil
      glyph = ""
      refreshChart(Store.load())
    } else {
      mode = .study
      hint = "on the schedule"
      dealStudy(Store.load())
    }
  }

  func roteShaky() {
    cancelFeedback()
    activeDrill = nil
    Store.update { s in
      s["rote"] = [] as [String]
      s["roteKind"] = "cram"
      s["activeDrill"] = NSNull()
    }
    sessionGood.removeAll()
    cram = true
    mode = .rote
    showSettings = false
    dealRote(Store.load())
  }

  func drillAll() {
    if mode == .dakuten || headerMode == .dakuten {
      drillAllDakuten()
      return
    }
    openDrillPicker()
  }

  func openDrillPicker() {
    cancelFeedback()
    let store = Store.load()
    let raw = Engine.shared.invoke("drillSets", ["store": store, "script": script])
    let rows = (raw as? [Any]) ?? []
    drillSets = rows.compactMap { item -> DrillSet? in
      guard let d = item as? [String: Any], let id = Engine.string(d["id"]) else { return nil }
      return DrillSet(
        id: id,
        label: Engine.string(d["label"]) ?? id,
        count: (d["count"] as? NSNumber)?.intValue ?? 0,
        done: (d["done"] as? NSNumber)?.intValue ?? 0
      )
    }
    answer = ""
    flash = .none
    revealed = nil
    hint = nil
    glyph = ""
    if drillSets.isEmpty {
      drillPicker = false
      emptyMessage = "learn a row first"
      return
    }
    drillPicker = true
    emptyMessage = "drill which set?"
  }

  func pickDrillSet(_ id: String) {
    cancelFeedback()
    returnToChart = false
    let store = Store.load()
    guard let result = Engine.dict(Engine.shared.invoke("beginDrill", [
      "store": store, "script": script, "id": id,
    ])), let next = result["store"] as? [String: Any] else { return }
    Store.save(next)
    activeDrill = Engine.string(next["activeDrill"])
    restoreDrillProgress(next)
    drillPicker = false
    emptyMessage = nil
    cram = true
    mode = .rote
    hint = "rote until they stick"
    lastGlyph = nil
    dealRote(Store.load())
  }

  func cancelDrillPicker() {
    drillPicker = false
    emptyMessage = nil
    setMode(.study)
  }

  func restartDrill() {
    guard mode == .rote, let key = activeDrill else { return }
    cancelFeedback()
    let store = Store.update { s in
      // Restart only this set's streaks; keep today's score and other sets.
      var saved = s["drillProgress"] as? [String: Any] ?? [:]
      var progress = saved[key] as? [String: Any] ?? [:]
      progress["streaks"] = [:] as [String: Int]
      saved[key] = progress
      s["drillProgress"] = saved
    }
    sessionGood.removeAll()
    lastGlyph = nil
    drillPicker = false
    emptyMessage = nil
    dealRote(store)
    requestFocus()
  }

  func drillChartGlyphs(_ glyphs: [String]) {
    cancelFeedback()
    activeDrill = nil
    let list = glyphs.filter { !$0.isEmpty }
    guard !list.isEmpty else { return }
    let learned = Set(Store.load()["learned"] as? [String] ?? [])
    let fresh = list.filter { !learned.contains($0) }
    answer = ""
    flash = .none
    revealed = nil
    hint = nil
    lastGlyph = nil
    emptyMessage = nil
    drillPicker = false
    sessionGood.removeAll()
    returnToChart = true
    if fresh.isEmpty {
      startCram(list)
      return
    }
    pendingRote = list
    cram = true
    learnGlyphs = fresh
    learnIndex = 0
    learnTotal = fresh.count
    mode = .learn
    showLearn()
  }

  private func startCram(_ glyphs: [String]) {
    let store = Store.load()
    guard let result = Engine.dict(Engine.shared.invoke("beginDrill", [
      "store": store, "script": script, "glyphs": glyphs,
    ])), let next = result["store"] as? [String: Any] else { return }
    Store.save(next)
    activeDrill = Engine.string(next["activeDrill"])
    restoreDrillProgress(next)
    cram = true
    mode = .rote
    hint = "rote until they stick"
    lastGlyph = nil
    dealRote(Store.load())
  }

  func markAway() {
    cancelFeedback()
    activeDrill = nil
    applyMutate("markDueNow")
    mode = .study
    showSettings = false
    dealStudy(Store.load())
  }

  func resetLearning() {
    cancelFeedback()
    activeDrill = nil
    applyMutate("resetLearning")
    sessionGood.removeAll()
    mode = .learn
    showSettings = false
    appear()
  }

  func resetStudying() {
    cancelFeedback()
    activeDrill = nil
    applyMutate("resetStudying")
    sessionGood.removeAll()
    mode = .study
    showSettings = false
    appear()
  }

  func resetCurrentScript() {
    cancelFeedback()
    activeDrill = nil
    Store.update { store in
      var cards = store["cards"] as? [String: Any] ?? [:]
      var learned = store["learned"] as? [String] ?? []
      if let rows = Engine.shared.invoke("rows", ["script": self.script]) as? [[String: Any]] {
        for row in rows {
          if let glyphs = row["glyphs"] as? [String] {
            for g in glyphs {
              cards.removeValue(forKey: g)
              learned.removeAll { $0 == g }
            }
          }
        }
      }
      store["cards"] = cards
      store["learned"] = learned
      store["rote"] = [] as [String]
      store["roteKind"] = ""
      store["activeDrill"] = NSNull()
      let saved = store["drillProgress"] as? [String: Any] ?? [:]
      store["drillProgress"] = saved.filter { !$0.key.hasPrefix(self.script + ":") }
      store["dakutenStreaks"] = [:] as [String: Any]
    }
    sessionGood.removeAll()
    appear()
  }

  private func applyMutate(_ op: String) {
    let store = Store.load()
    if let result = Engine.dict(Engine.shared.invoke(op, [
      "store": store, "script": script, "now": Date().timeIntervalSince1970 * 1000,
    ])), let next = result["store"] as? [String: Any] {
      Store.save(next)
    }
  }

  private func startLearn(_ store: [String: Any]) {
    emptyMessage = nil
    let row = Engine.shared.invoke("nextLearnRow", ["store": store, "script": script])
    guard let dict = Engine.dict(row), let glyphs = dict["glyphs"] as? [String], !glyphs.isEmpty else {
      emptyMessage = "every \(script) character is in your deck"
      glyph = ""
      mnemonic = ""
      romaji = ""
      partner = ""
      learnGlyphs = []
      return
    }
    learnGlyphs = glyphs
    learnIndex = 0
    learnTotal = glyphs.count
    showLearn()
  }

  private func showLearn() {
    guard learnIndex < learnGlyphs.count else { return }
    let ch = learnGlyphs[learnIndex]
    glyph = ch
    if let view = Engine.dict(Engine.shared.invoke("learnView", ["script": script, "glyph": ch])) {
      romaji = Engine.string(view["romaji"]) ?? ""
      partner = Engine.string(view["partner"]) ?? ""
      mnemonic = Engine.string(view["mnemonic"]) ?? ""
    }
    emptyMessage = nil
    answer = ""
  }

  private func dealRote(_ store: [String: Any]) {
    restoreDrillProgress(store)
    refreshSummary(store)
    refreshRoteCounts(store)
    if roteTotal > 0 && roteDone == roteTotal {
      glyph = ""
      emptyMessage = "set complete for today"
      hint = "daily practice resets at midnight"
      return
    }
    var rotePayload: [String: Any] = ["store": store, "script": script, "streaks": sessionGood]
    if let lastGlyph { rotePayload["lastGlyph"] = lastGlyph }
    let card = Engine.shared.invoke("nextRote", rotePayload)
    guard let dict = Engine.dict(card), let ch = Engine.string(dict["glyph"]), !ch.isEmpty else {
      mode = .study
      dealStudy(store)
      return
    }
    glyph = ch
    lastGlyph = ch
    romaji = Engine.string(dict["romaji"]) ?? ""
    reason = "rote"
    mnemonic = ""
    partner = ""
    emptyMessage = nil
    hint = "\(roteStreak) right in a row to stick"
  }

  private func dealStudy(_ store: [String: Any]) {
    refreshSummary(store)
    var payload: [String: Any] = [
      "store": store,
      "script": script,
      "now": Date().timeIntervalSince1970 * 1000,
    ]
    if let lastGlyph { payload["lastGlyph"] = lastGlyph }
    let card = Engine.shared.invoke("nextRevise", payload)
    let dict = Engine.dict(card)
    let reason = Engine.string(dict?["reason"]) ?? "caught-up"
    self.reason = reason
    mnemonic = ""
    partner = ""
    guard let ch = Engine.string(dict?["glyph"]), !ch.isEmpty else {
      glyph = ""
      romaji = ""
      if reason == "empty" || learned == 0 {
        mode = .learn
        startLearn(store)
      } else {
        emptyMessage = "nothing due"
        hint = "reviews come back on the schedule"
      }
      return
    }
    emptyMessage = nil
    glyph = ch
    lastGlyph = ch
    romaji = Engine.string(dict?["romaji"]) ?? ""
    hint = nil
  }

  private func roteCount(_ store: [String: Any]) -> Int {
    (store["rote"] as? [String])?.count ?? 0
  }

  private func refreshRoteCounts(_ store: [String: Any]) {
    let rote = store["rote"] as? [String] ?? []
    roteTotal = rote.count
    roteDone = rote.filter { (sessionGood[$0] ?? 0) >= roteStreak }.count
  }

  private func allRoteSticking() -> Bool {
    let rote = Store.load()["rote"] as? [String] ?? []
    guard !rote.isEmpty else { return false }
    return rote.allSatisfy { (sessionGood[$0] ?? 0) >= roteStreak }
  }

  private func submitDakuten() {
    guard !busy else { return }
    let typed = answer.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !typed.isEmpty, !glyph.isEmpty else { return }
    let ok = Engine.bool(Engine.shared.invoke("checkDakuten", [
      "id": dakutenLessonId, "input": typed,
    ]))
    let store = Store.load()
    let streaks = store["dakutenStreaks"] as? [String: Any] ?? [:]
    if let next = Engine.dict(Engine.shared.invoke("gradeDakuten", [
      "streaks": streaks, "id": dakutenLessonId, "correct": ok,
    ])) {
      Store.update { $0["dakutenStreaks"] = next }
    }
    scoreSeen += 1
    busy = true
    if ok {
      scoreCorrect += 1
      flash = .ok
      revealed = dakutenVoicedRomaji
    } else {
      flash = .miss
      revealed = dakutenVoicedRomaji
    }
    let delay: Double = ok ? 0.5 : 1.35
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      self.flash = .none
      self.revealed = nil
      self.answer = ""
      self.busy = false
      self.dealDakuten()
    }
    flashWork?.cancel()
    flashWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
  }

  func confirmDakuten() {
    cancelFeedback()
    if let done = Engine.shared.invoke("completeDakuten") as? [String: Any] {
      Store.update { $0["dakutenStreaks"] = done }
    }
    emptyMessage = "these marks are sticking"
    glyph = ""
    hint = nil
    roteDone = dakutenGroupSize
    roteTotal = dakutenGroupSize
  }

  func keepDrillingDakuten() {
    drillAllDakuten()
  }

  func drillAllDakuten() {
    cancelFeedback()
    Store.update { $0["dakutenStreaks"] = [:] as [String: Any] }
    dakutenLessonId = ""
    emptyMessage = nil
    drillPicker = false
    hint = "\(roteStreak) right in a row to stick"
    dealDakuten()
  }

  private func dealDakuten(force: Bool = false) {
    let store = Store.load()
    let streaks = store["dakutenStreaks"] as? [String: Any] ?? [:]
    var payload: [String: Any] = ["streaks": streaks, "force": force]
    if !dakutenLessonId.isEmpty { payload["lastId"] = dakutenLessonId }
    guard let card = Engine.dict(Engine.shared.invoke("nextDakuten", payload)) else { return }
    dakutenGroupSize = (card["size"] as? NSNumber)?.intValue ?? 0
    roteDone = (card["sticking"] as? NSNumber)?.intValue ?? 0
    roteTotal = dakutenGroupSize
    if Engine.bool(card["done"]), !force {
      emptyMessage = "these marks are sticking"
      glyph = ""
      hint = nil
      return
    }
    emptyMessage = nil
    dakutenLessonId = Engine.string(card["id"]) ?? ""
    dakutenKind = Engine.string(card["kind"]) ?? "rule"
    dakutenMark = Engine.string(card["mark"]) ?? "゛"
    glyph = Engine.string(card["prompt"]) ?? ""
    romaji = Engine.string(card["promptRomaji"]) ?? ""
    dakutenVoicedRomaji = Engine.string(card["reveal"]) ?? ""
    dakutenVoiced = Engine.string(card["exampleTo"]) ?? ""
    dakutenExampleFrom = Engine.string(card["exampleFrom"]) ?? ""
    dakutenCaption = Engine.string(card["caption"]) ?? ""
    dakutenPromptIsKana = Engine.bool(card["promptIsKana"])
    partner = dakutenVoiced
    mnemonic = ""
    hint = "\(roteStreak) right in a row to stick"
  }

  func refreshChart(_ store: [String: Any]? = nil) {
    let st = store ?? Store.load()
    let raw = Engine.shared.invoke("chart", [
      "store": st, "script": script, "now": Date().timeIntervalSince1970 * 1000,
    ])
    let sections = (raw as? [Any]) ?? []
    chart = sections.compactMap { ChartSection.parse($0 as? [String: Any] ?? [:]) }
  }

  private func refreshSummary(_ store: [String: Any]) {
    guard let s = Engine.dict(Engine.shared.invoke("summary", [
      "store": store, "script": script, "now": Date().timeIntervalSince1970 * 1000,
    ])) else { return }
    learned = (s["learned"] as? NSNumber)?.intValue ?? 0
    total = (s["total"] as? NSNumber)?.intValue ?? 104
    mastered = (s["mastered"] as? NSNumber)?.intValue ?? 0
    learning = (s["learning"] as? NSNumber)?.intValue ?? 0
    due = (s["due"] as? NSNumber)?.intValue ?? 0
  }
}
