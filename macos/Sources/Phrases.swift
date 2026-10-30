import Foundation
import AVFoundation
import AppKit

struct PhraseTopic: Identifiable {
  let id: String
  let label: String
  let group: String
  let count: Int
  let introduced: Int
  let due: Int
  let shaky: Int
}

struct PhraseTile: Identifiable, Equatable {
  let id: String
  let text: String
}

struct PhraseChoice: Identifiable, Equatable {
  let id: String
  let en: String
  let note: String
}

struct PhraseCard {
  let id: String
  let en: String
  let note: String
  let ja: String
  let kana: String
  let romaji: String

  @MainActor
  static func parse(_ v: Any?) -> PhraseCard? {
    guard let d = Engine.dict(v), let id = Engine.string(d["id"]) else { return nil }
    return PhraseCard(
      id: id,
      en: Engine.string(d["en"]) ?? "",
      note: Engine.string(d["note"]) ?? "",
      ja: Engine.string(d["ja"]) ?? "",
      kana: Engine.string(d["kana"]) ?? "",
      romaji: Engine.string(d["romaji"]) ?? ""
    )
  }
}

/// Phrases tab — the same flow as the PWA (web/src/phrase-session.js), with
/// decisions in engine.js (src/core/phrases.mjs):
/// topic picker → (new phrase) → quiz → result → next. The quiz is tiles,
/// listening or "say it", as engine.js's phraseCard picks for the card.
@MainActor
final class PhraseModel: ObservableObject {
  enum View { case topics, intro, quiz, empty, drillDone }

  @Published var view: View = .topics
  @Published var topic: String?
  @Published var topics: [PhraseTopic] = []
  @Published var total = 0
  @Published var introduced = 0
  @Published var mastered = 0
  @Published var dueAll = 0
  @Published var newLeft = 0
  @Published var newPerDay = 10
  @Published var phrase: PhraseCard?
  @Published var isNew = false
  /// "build" (tiles), "listen" (pick the meaning) or "say" (say it, self-grade).
  @Published var mode = "build"
  @Published var tiles: [PhraseTile] = []
  @Published var choices: [PhraseChoice] = []
  @Published var answerKey: String?
  @Published var chosen: String?
  @Published var revealed = false
  @Published var saying = 0
  @Published var shaky = 0
  /// A drill round (engine.js phraseDrillStart state), or nil for normal reviews.
  @Published var drill: [String: Any]?
  /// Phrases drilled this sitting, so "another round" moves on.
  private var drilled: [String] = []
  @Published var picked: [String] = []
  @Published var result: Bool?
  @Published var reason = ""
  @Published var right = 0
  @Published var seen = 0
  @Published var speakOn = UserDefaults.standard.object(forKey: "speakPhrases") as? Bool ?? true
  /// "mix" (a random speaker each time) or one voice name.
  @Published var voice = UserDefaults.standard.string(forKey: "phraseVoice") ?? "mix"
  lazy var voices: [String] = Engine.shared.invoke("phraseVoices") as? [String] ?? []

  private var lastId: String?
  private var extraNew = 0
  private let synth = AVSpeechSynthesizer()
  private var player: AVAudioPlayer?
  private static let topicKey = "phraseTopic"

  lazy var source: String = Engine.string(Engine.shared.invoke("phraseSource")) ?? ""

  var topicLabel: String {
    let label = topic.map { t in topics.first { $0.id == t }?.label ?? t }
    if let drill {
      let kind = Engine.string(drill["kind"]) == "shaky" ? "shaky" : "all"
      return "drill · \(kind)" + (label.map { " · \($0)" } ?? "")
    }
    return label ?? "review"
  }

  var drillLeft: Int { (drill?["pending"] as? [Any])?.count ?? 0 }
  var drillFirstTry: Int { (drill?["firstTry"] as? NSNumber)?.intValue ?? 0 }
  var drillSize: Int { (drill?["ids"] as? [Any])?.count ?? 0 }
  var drillMissed: Int { (drill?["missed"] as? [Any])?.count ?? 0 }

  /// Met / shaky phrases in the current topic (or everywhere).
  var scopeMet: Int { topic.flatMap { t in topics.first { $0.id == t }?.introduced } ?? introduced }
  var scopeShaky: Int { topic.flatMap { t in topics.first { $0.id == t }?.shaky } ?? shaky }

  /// Drill: a round of phrases you've met, outside the schedule (no FSRS).
  /// "shaky" = not mastered yet, worst first; "topic" = everything met in the topic.
  func startDrill(_ kind: String, topic: String?, again: Bool = false) {
    if !again { drilled = [] }
    var args: [String: Any] = ["store": Store.load(), "kind": kind, "exclude": drilled]
    if let topic { args["topic"] = topic }
    var d = Engine.dict(Engine.shared.invoke("phraseDrillStart", args))
    if d == nil && !drilled.isEmpty {
      drilled = []
      args["exclude"] = [String]()
      d = Engine.dict(Engine.shared.invoke("phraseDrillStart", args))
    }
    guard let d else { return }
    drilled += d["ids"] as? [String] ?? []
    self.topic = topic
    drill = d
    lastId = nil
    right = 0
    seen = 0
    deal()
  }

  func drillAgain() {
    guard let d = drill else { return }
    startDrill(Engine.string(d["kind"]) ?? "shaky", topic: Engine.string(d["topic"]), again: true)
  }

  func endDrill() {
    drill = nil
    deal()
  }

  private func now() -> Double { Date().timeIntervalSince1970 * 1000 }

  func refreshStats(_ store: [String: Any] = Store.load()) {
    guard let s = Engine.dict(Engine.shared.invoke("phraseTopics", ["store": store, "now": now()])) else { return }
    topics = (s["topics"] as? [[String: Any]] ?? []).compactMap { t in
      guard let id = Engine.string(t["id"]) else { return nil }
      return PhraseTopic(
        id: id,
        label: Engine.string(t["label"]) ?? id,
        group: Engine.string(t["group"]) ?? "",
        count: (t["count"] as? NSNumber)?.intValue ?? 0,
        introduced: (t["introduced"] as? NSNumber)?.intValue ?? 0,
        due: (t["due"] as? NSNumber)?.intValue ?? 0,
        shaky: (t["shaky"] as? NSNumber)?.intValue ?? 0
      )
    }
    total = (s["total"] as? NSNumber)?.intValue ?? 0
    introduced = (s["introduced"] as? NSNumber)?.intValue ?? 0
    mastered = (s["mastered"] as? NSNumber)?.intValue ?? 0
    saying = (s["saying"] as? NSNumber)?.intValue ?? 0
    shaky = (s["shaky"] as? NSNumber)?.intValue ?? 0
    dueAll = (s["due"] as? NSNumber)?.intValue ?? 0
    newPerDay = (s["newPerDay"] as? NSNumber)?.intValue ?? 10
    newLeft = max(0, newPerDay - ((s["newToday"] as? NSNumber)?.intValue ?? 0))
  }

  /// Entering the tab: resume the last topic, or show the picker.
  func open() {
    refreshStats()
    let saved = UserDefaults.standard.string(forKey: Self.topicKey)
    if saved == "all" { start(nil) }
    else if let saved, topics.contains(where: { $0.id == saved }) { start(saved) }
    else { showTopics() }
  }

  func showTopics() {
    UserDefaults.standard.removeObject(forKey: Self.topicKey)
    refreshStats()
    phrase = nil
    drill = nil
    view = .topics
  }

  func start(_ id: String?) {
    UserDefaults.standard.set(id ?? "all", forKey: Self.topicKey)
    topic = id
    drill = nil
    lastId = nil
    right = 0
    seen = 0
    deal()
  }

  func deal() {
    let store = Store.load()
    refreshStats(store)
    if let d = drill {
      var args: [String: Any] = ["drill": d]
      if let lastId { args["lastId"] = lastId }
      guard let n = Engine.dict(Engine.shared.invoke("phraseDrillNext", args)),
            let id = Engine.string(n["id"]),
            let card = PhraseCard.parse(Engine.shared.invoke("phrase", ["id": id]))
      else {
        phrase = nil
        view = .drillDone
        return
      }
      lastId = id
      phrase = card
      result = nil
      isNew = false
      quiz(kind: Engine.string(n["kind"]) ?? "review")
      return
    }
    var payload: [String: Any] = ["store": store, "now": now(), "extraNew": extraNew]
    if let topic { payload["topic"] = topic }
    if let lastId { payload["lastId"] = lastId }
    let next = Engine.dict(Engine.shared.invoke("nextPhrase", payload))
    guard let id = Engine.string(next?["id"]), let card = PhraseCard.parse(Engine.shared.invoke("phrase", ["id": id])) else {
      reason = Engine.string(next?["reason"]) ?? "done"
      phrase = nil
      view = .empty
      return
    }
    lastId = id
    phrase = card
    result = nil
    if Engine.string(next?["kind"]) == "new" {
      isNew = true
      view = .intro
      speakIfOn(card)
    } else {
      isNew = false
      quiz()
    }
  }

  func quiz(kind: String? = nil) {
    guard let phrase,
          let q = Engine.dict(Engine.shared.invoke("phraseCard", ["store": Store.load(), "id": phrase.id, "kind": kind ?? (isNew ? "new" : "review")]))
    else { return }
    mode = Engine.string(q["mode"]) ?? "build"
    tiles = (q["tiles"] as? [[String: Any]] ?? []).compactMap { t in
      guard let key = Engine.string(t["key"]), let text = Engine.string(t["text"]) else { return nil }
      return PhraseTile(id: key, text: text)
    }
    choices = (q["choices"] as? [[String: Any]] ?? []).compactMap { c in
      guard let key = Engine.string(c["key"]) else { return nil }
      return PhraseChoice(id: key, en: Engine.string(c["en"]) ?? "", note: Engine.string(c["note"]) ?? "")
    }
    answerKey = Engine.string(q["answer"])
    chosen = nil
    revealed = false
    picked = []
    result = nil
    view = .quiz
    // Listening starts with the sound; it's the whole question.
    if mode == "listen" { speak(phrase) }
  }

  /// Store a grade (with the mode, and the self-rating for "say it").
  private func grade(_ ok: Bool, rating: String? = nil) {
    guard let phrase else { return }
    if let d = drill {
      // Drilling never touches the schedule; it only counts as practice.
      let m = mode
      Store.update { Store.logAnswer(&$0, kind: "phrase", correct: ok, mode: m) }
      drill = Engine.dict(Engine.shared.invoke("phraseDrillGrade", ["drill": d, "id": phrase.id, "correct": ok])) ?? d
      seen += 1
      if ok { right += 1 }
      result = ok
      return
    }
    let t = now()
    var args: [String: Any] = ["id": phrase.id, "correct": ok, "now": t, "mode": mode]
    if let rating { args["rating"] = rating }
    let wasNew = isNew
    let m = mode
    Store.update { s in
      args["store"] = s
      if let r = Engine.dict(Engine.shared.invoke("gradePhrase", args)),
         let next = r["store"] as? [String: Any] {
        s = next
      }
      Store.logAnswer(&s, kind: "phrase", correct: ok, mode: m, isNew: wasNew)
    }
    seen += 1
    if ok { right += 1 }
    result = ok
  }

  /// Listening: pick a meaning.
  func choose(_ key: String) {
    guard mode == "listen", result == nil else { return }
    chosen = key
    grade(key == answerKey)
  }

  /// Say it: show the answer (and play it) once you've said it aloud.
  func reveal() {
    guard mode == "say", !revealed, let phrase else { return }
    revealed = true
    speak(phrase)
  }

  /// Say it: grade yourself — again, hard, good or easy.
  func rate(_ rating: String) {
    guard mode == "say", revealed, result == nil else { return }
    grade(rating != "again", rating: rating)
  }

  func pick(_ id: String) {
    guard result == nil, !picked.contains(id) else { return }
    picked.append(id)
  }

  func unpick(_ id: String) {
    guard result == nil else { return }
    picked.removeAll { $0 == id }
  }

  func check() {
    guard let phrase, result == nil, !picked.isEmpty else { return }
    let texts = picked.compactMap { id in tiles.first { $0.id == id }?.text }
    let ok = Engine.bool(Engine.shared.invoke("checkPhrase", ["id": phrase.id, "picked": texts]))
    grade(ok)
    speakIfOn(phrase)
  }

  func learnMore() {
    extraNew += 5
    deal()
  }

  /// Return / Enter: the one obvious next step for the current screen.
  func primary() {
    switch view {
    case .intro: quiz()
    case .drillDone: drillAgain()
    case .quiz:
      if result != nil { deal() }
      else if mode == "build" { check() }
      else if mode == "say" && !revealed { reveal() }
    default: break
    }
  }

  /// Keyboard: 1–9 pick the nth tile still in the bank, ⌫ takes the last one back,
  /// return checks / continues. Listening: 1–4 pick a meaning, space replays.
  /// Say it: space or return shows the answer, 1–4 grade it. Returns true when used.
  func handleKey(_ event: NSEvent) -> Bool {
    if view == .quiz, mode != "build", result == nil {
      if event.keyCode == 49 {  // space
        if mode == "say" && !revealed { reveal() } else if let phrase { speak(phrase) }
        return true
      }
      if let ch = event.charactersIgnoringModifiers, let n = Int(ch), (1...4).contains(n) {
        if mode == "listen", n <= choices.count { choose(choices[n - 1].id) }
        if mode == "say", revealed { rate(["again", "hard", "good", "easy"][n - 1]) }
        return true
      }
    }
    switch event.keyCode {
    case 36, 76: primary(); return view != .topics && view != .empty
    case 51:
      if view == .quiz, result == nil, let last = picked.last { unpick(last); return true }
      return false
    default: break
    }
    guard view == .quiz, mode == "build", result == nil,
          let ch = event.charactersIgnoringModifiers, let n = Int(ch), n >= 1 else { return false }
    let bank = tiles.filter { !picked.contains($0.id) }
    guard n <= bank.count else { return true }
    pick(bank[n - 1].id)
    return true
  }

  func setVoice(_ v: String) {
    voice = v
    UserDefaults.standard.set(v, forKey: "phraseVoice")
  }

  func setSpeak(_ on: Bool) {
    speakOn = on
    UserDefaults.standard.set(on, forKey: "speakPhrases")
  }

  /// The phrase's recorded clip (bundled from web/public/audio), or the system voice.
  func speak(_ phrase: PhraseCard) {
    synth.stopSpeaking(at: .immediate)
    player?.stop()
    var args: [String: Any] = ["id": phrase.id]
    if voice != "mix" { args["voice"] = voice }
    if let file = Engine.string(Engine.shared.invoke("phraseAudio", args)),
       let url = Bundle.main.resourceURL?.appendingPathComponent("audio/" + file),
       let p = try? AVAudioPlayer(contentsOf: url) {
      player = p
      p.play()
      return
    }
    speakSystem(phrase.ja)
  }

  /// Best installed Japanese system voice: Premium, then Enhanced, then default.
  private func speakSystem(_ text: String) {
    let u = AVSpeechUtterance(string: text)
    let ja = AVSpeechSynthesisVoice.speechVoices().filter { $0.language == "ja-JP" }
    u.voice = ja.first { $0.quality == .premium } ?? ja.first { $0.quality == .enhanced } ?? AVSpeechSynthesisVoice(language: "ja-JP")
    u.rate = AVSpeechUtteranceDefaultSpeechRate * 0.9
    synth.speak(u)
  }

  private func speakIfOn(_ phrase: PhraseCard) {
    if speakOn { speak(phrase) }
  }

  /// Another device's answers arrived. Only refresh when nothing is mid-card.
  func remoteChanged() {
    if view == .topics { refreshStats() }
    else if view == .empty && drill == nil { deal() }
  }
}
