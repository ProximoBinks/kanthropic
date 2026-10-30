import SwiftUI

/// Progress tab: practice time, streaks, a month calendar and where kana and
/// phrases stand. Numbers come from engine.js (progressView in
/// src/core/engine.mjs), the same as the PWA.
struct ProgressDay: Identifiable {
  let id: String  // date
  let day: Int
  let inMonth: Bool
  let today: Bool
  let future: Bool
  let ms: Double
  let level: Int
}

@MainActor
final class ProgressModel: ObservableObject {
  @Published var view: [String: Any] = [:]
  @Published var days: [ProgressDay] = []
  @Published var picked: [String: Any]?
  private var at: (year: Int, month: Int)?

  private func now() -> Double { Date().timeIntervalSince1970 * 1000 }

  func refresh(_ store: [String: Any] = Store.load()) {
    var args: [String: Any] = ["store": store, "now": now()]
    if let at { args["year"] = at.year; args["month"] = at.month }
    guard let v = Engine.dict(Engine.shared.invoke("progressView", args)) else { return }
    view = v
    let month = v["month"] as? [String: Any] ?? [:]
    let weeks = month["weeks"] as? [[[String: Any]]] ?? []
    days = weeks.flatMap { $0 }.compactMap { d in
      guard let date = Engine.string(d["date"]) else { return nil }
      return ProgressDay(
        id: date,
        day: (d["day"] as? NSNumber)?.intValue ?? 0,
        inMonth: Engine.bool(d["inMonth"]),
        today: Engine.bool(d["today"]),
        future: Engine.bool(d["future"]),
        ms: (d["ms"] as? NSNumber)?.doubleValue ?? 0,
        level: (d["level"] as? NSNumber)?.intValue ?? 0
      )
    }
  }

  func open() {
    at = nil
    picked = nil
    refresh()
  }

  var month: [String: Any] { view["month"] as? [String: Any] ?? [:] }
  var summary: [String: Any] { view["summary"] as? [String: Any] ?? [:] }

  var atThisMonth: Bool {
    let c = Calendar.current.dateComponents([.year, .month], from: Date())
    return num(month["year"]) == Double(c.year ?? 0) && num(month["month"]) == Double(c.month ?? 0)
  }

  func shift(_ delta: Int) {
    var y = Int(num(month["year"])), m = Int(num(month["month"])) + delta
    if m < 1 { m = 12; y -= 1 } else if m > 12 { m = 1; y += 1 }
    let c = Calendar.current.dateComponents([.year, .month], from: Date())
    if y > (c.year ?? 0) || (y == c.year && m > (c.month ?? 0)) { return }
    at = (y, m)
    picked = nil
    refresh()
  }

  func pick(_ date: String) {
    if Engine.string(picked?["date"]) == date { picked = nil; return }
    picked = Engine.dict(Engine.shared.invoke("activityDay", ["store": Store.load(), "date": date]))
  }
}

func num(_ v: Any?) -> Double { (v as? NSNumber)?.doubleValue ?? 0 }

/// "12m", "1h 05m", "<1m".
func minutes(_ ms: Double) -> String {
  if ms <= 0 { return "0m" }
  let m = Int((ms / 60_000).rounded())
  if m < 1 { return "<1m" }
  return m < 60 ? "\(m)m" : "\(m / 60)h \(String(format: "%02d", m % 60))m"
}

struct ProgressPanel: View {
  @Environment(\.panelScale) var scale
  @Environment(\.colorScheme) var scheme
  @ObservedObject var model: ProgressModel

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18 * scale) {
        today
        stats
        calendar
        standing
      }
      .padding(.top, 12 * scale)
      .padding(.bottom, 6 * scale)
    }
  }

  // MARK: today

  private var today: some View {
    let t = model.summary["today"] as? [String: Any] ?? [:]
    let ms = num(t["ms"]), goal = max(1, num(t["goalMs"]))
    let met = Engine.bool(t["goalMet"])
    let answers = Int(num(t["answers"])), correct = Int(num(t["correct"]))
    return HStack(spacing: 14 * scale) {
      ZStack {
        Circle().stroke(Ink.hair(scheme), lineWidth: 4 * scale)
        Circle().trim(from: 0, to: min(1, ms / goal))
          .stroke(met ? Ink.ok : Ink.gold, style: StrokeStyle(lineWidth: 4 * scale, lineCap: .round))
          .rotationEffect(.degrees(-90))
      }
      .frame(width: 48 * scale, height: 48 * scale)
      VStack(alignment: .leading, spacing: 2 * scale) {
        label("today")
        HStack(alignment: .firstTextBaseline, spacing: 3 * scale) {
          Text(minutes(ms)).font(.system(size: 22 * scale, weight: .medium)).foregroundColor(Ink.glyph(scheme))
          Text("/ \(Int(num(model.summary["goalMin"])))m").font(.system(size: 12 * scale)).foregroundColor(Ink.mute(scheme))
        }
        note(answers > 0 ? "\(answers) answers · \(Int((Double(correct) / Double(answers) * 100).rounded()))% right" : "nothing yet today")
      }
      Spacer()
      VStack(spacing: 2 * scale) {
        Text("\(Int(num(model.summary["streak"])))")
          .font(.system(size: 26 * scale, weight: .semibold, design: .monospaced)).foregroundColor(Ink.gold)
        note("day streak")
      }
    }
  }

  private var stats: some View {
    let week = model.summary["week"] as? [String: Any] ?? [:]
    let all = model.summary["all"] as? [String: Any] ?? [:]
    return HStack(spacing: 6 * scale) {
      stat(minutes(num(week["ms"])), "last 7 days", "\(Int(num(week["days"])))/7 days")
      stat(minutes(num(all["ms"])), "all time", "\(Int(num(all["days"]))) days")
      stat("\(Int(num(model.summary["best"])))", "best streak", "days")
    }
  }

  private func stat(_ n: String, _ title: String, _ detail: String) -> some View {
    VStack(alignment: .leading, spacing: 2 * scale) {
      Text(n).font(.system(size: 15 * scale, weight: .semibold, design: .monospaced)).foregroundColor(Ink.glyph(scheme))
      Text(title).font(.system(size: 9 * scale, weight: .medium)).tracking(0.6 * scale).textCase(.uppercase).foregroundColor(Ink.mute(scheme))
      note(detail)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(8 * scale)
    .background(RoundedRectangle(cornerRadius: 7 * scale).fill(Ink.hair(scheme).opacity(0.6)))
  }

  // MARK: calendar

  private var calendar: some View {
    let total = model.month["total"] as? [String: Any] ?? [:]
    let cols = Array(repeating: GridItem(.flexible(), spacing: 4 * scale), count: 7)
    return VStack(alignment: .leading, spacing: 7 * scale) {
      HStack {
        navButton("‹") { model.shift(-1) }
        Spacer()
        Text(Engine.string(model.month["label"]) ?? "")
          .font(Ink.ui(scale)).tracking(0.8 * scale).textCase(.uppercase).foregroundColor(Ink.glyph(scheme))
        Spacer()
        navButton("›", disabled: model.atThisMonth) { model.shift(1) }
      }
      LazyVGrid(columns: cols, spacing: 4 * scale) {
        ForEach(Array(["M", "T", "W", "T", "F", "S", "S"].enumerated()), id: \.offset) { _, d in
          Text(d).font(.system(size: 9 * scale, weight: .medium)).foregroundColor(Ink.mute(scheme))
        }
        ForEach(model.days) { d in dayCell(d) }
      }
      HStack {
        note(num(total["days"]) > 0 ? "\(Int(num(total["days"]))) days · \(minutes(num(total["ms"]))) this month" : "no practice this month")
        Spacer()
        HStack(spacing: 2 * scale) {
          note("less")
          ForEach(0..<5) { l in RoundedRectangle(cornerRadius: 2 * scale).fill(fill(l)).frame(width: 8 * scale, height: 8 * scale) }
          note("goal")
        }
      }
      if let p = model.picked { dayDetail(p) }
    }
  }

  private func dayCell(_ d: ProgressDay) -> some View {
    let picked = Engine.string(model.picked?["date"]) == d.id
    return Button { model.pick(d.id) } label: {
      Text("\(d.day)")
        .font(.system(size: 10 * scale, weight: .medium, design: .monospaced))
        .foregroundColor(d.level >= 3 ? Color(red: 0.118, green: 0.102, blue: 0.090) : d.level > 0 ? Ink.glyph(scheme) : Ink.mute(scheme))
        .frame(maxWidth: .infinity)
        .frame(height: 26 * scale)
        .background(RoundedRectangle(cornerRadius: 5 * scale).fill(fill(d.level)))
        .overlay(
          RoundedRectangle(cornerRadius: 5 * scale)
            .stroke(picked ? Ink.glyph(scheme) : d.today ? Ink.gold : .clear, lineWidth: (picked ? 1.5 : 1.2) * scale)
        )
        .opacity(d.future ? 0.35 : 1)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(d.future || !d.inMonth)
    .opacity(d.inMonth ? 1 : 0)
    .help(d.ms > 0 ? "\(d.id): \(minutes(d.ms))" : d.id)
  }

  private func fill(_ level: Int) -> Color {
    switch level {
    case 1: return Ink.gold.opacity(0.25)
    case 2: return Ink.gold.opacity(0.5)
    case 3: return Ink.gold.opacity(0.8)
    case 4: return Ink.ok
    default: return Ink.hair(scheme).opacity(0.6)
    }
  }

  private func dayDetail(_ p: [String: Any]) -> some View {
    let answers = Int(num(p["answers"]))
    let phrases = Int(num(p["phrases"]))
    return VStack(alignment: .leading, spacing: 6 * scale) {
      label(longDate(Engine.string(p["date"]) ?? ""))
      if answers == 0 {
        note("no practice")
      } else {
        row("time", minutes(num(p["ms"])))
        row("answers", "\(answers) · \(Int((num(p["correct"]) / Double(answers) * 100).rounded()))% right")
        if num(p["kana"]) > 0 { row("kana", "\(Int(num(p["kana"])))") }
        if phrases > 0 {
          let new = Int(num(p["newPhrases"]))
          row("phrases", "\(phrases)" + (new > 0 ? " · \(new) new" : ""))
          row("modes", "\(Int(num(p["built"]))) built · \(Int(num(p["listened"]))) heard · \(Int(num(p["said"]))) said")
        }
      }
    }
    .padding(10 * scale)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: 7 * scale).stroke(Ink.hair(scheme), lineWidth: 1 * scale))
  }

  private func row(_ k: String, _ v: String) -> some View {
    HStack(alignment: .top) {
      Text(k).font(.system(size: 11 * scale)).foregroundColor(Ink.mute(scheme)).frame(width: 60 * scale, alignment: .leading)
      Text(v).font(.system(size: 11 * scale, weight: .medium)).foregroundColor(Ink.glyph(scheme))
    }
  }

  private func longDate(_ date: String) -> String {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    guard let d = f.date(from: date) else { return date }
    f.dateFormat = "EEEE d MMMM"
    return f.string(from: d)
  }

  // MARK: standing

  private var standing: some View {
    let kana = model.view["kana"] as? [String: Any] ?? [:]
    let h = kana["hiragana"] as? [String: Any] ?? [:]
    let k = kana["katakana"] as? [String: Any] ?? [:]
    let ph = model.view["phrases"] as? [String: Any] ?? [:]
    return VStack(alignment: .leading, spacing: 10 * scale) {
      label("where you are")
      bar("hiragana", num(h["mastered"]), num(h["total"]), "\(Int(num(h["learned"]))) learned")
      bar("katakana", num(k["mastered"]), num(k["total"]), "\(Int(num(k["learned"]))) learned")
      bar("phrases", num(ph["mastered"]), num(ph["total"]), "\(Int(num(ph["met"]))) met · \(Int(num(ph["speaking"]))) speaking")
      note("bars show mastered: right on separate days and on a long interval")
    }
  }

  private func bar(_ title: String, _ n: Double, _ of: Double, _ detail: String) -> some View {
    VStack(alignment: .leading, spacing: 3 * scale) {
      HStack {
        Text(title).font(.system(size: 12 * scale)).foregroundColor(Ink.glyph(scheme))
        Spacer()
        Text("\(Int(n))/\(Int(of))").font(.system(size: 10 * scale, weight: .medium, design: .monospaced)).foregroundColor(Ink.mute(scheme))
      }
      GeometryReader { g in
        ZStack(alignment: .leading) {
          Capsule().fill(Ink.hair(scheme))
          Capsule().fill(Ink.ok).frame(width: of > 0 ? g.size.width * n / of : 0)
        }
      }
      .frame(height: 4 * scale)
      note(detail)
    }
  }

  // MARK: pieces

  private func navButton(_ t: String, disabled: Bool = false, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(t).font(.system(size: 16 * scale)).foregroundColor(Ink.gold).frame(width: 26 * scale, height: 20 * scale).contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(disabled)
    .opacity(disabled ? 0.25 : 1)
  }

  private func label(_ text: String) -> some View {
    Text(text).font(Ink.ui(scale)).tracking(1.2 * scale).textCase(.uppercase).foregroundColor(Ink.mute(scheme))
  }

  private func note(_ text: String) -> some View {
    Text(text).font(.system(size: 10 * scale)).foregroundColor(Ink.mute(scheme))
  }
}
