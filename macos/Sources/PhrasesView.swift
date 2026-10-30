import SwiftUI

/// Left-to-right rows that wrap, for word tiles.
struct FlowLayout: Layout {
  var spacing: CGFloat = 6

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, widest: CGFloat = 0
    for v in subviews {
      let s = v.sizeThatFits(.unspecified)
      if x > 0 && x + s.width > width { y += row + spacing; x = 0; row = 0 }
      x += s.width + spacing
      row = max(row, s.height)
      widest = max(widest, x - spacing)
    }
    return CGSize(width: proposal.width ?? widest, height: y + row)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
    for v in subviews {
      let s = v.sizeThatFits(.unspecified)
      if x > bounds.minX && x + s.width > bounds.maxX { y += row + spacing; x = bounds.minX; row = 0 }
      v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
      x += s.width + spacing
      row = max(row, s.height)
    }
  }
}

struct PhrasesView: View {
  @Environment(\.panelScale) var scale
  @Environment(\.colorScheme) var scheme
  @EnvironmentObject var session: Session
  @ObservedObject var model: PhraseModel

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if model.view == .topics {
        topics
      } else {
        bar
        switch model.view {
        case .intro: intro
        case .quiz:
          switch model.mode {
          case "listen": listen
          case "say": say
          default: quiz
          }
        case .drillDone: drillDone
        default: empty
        }
      }
    }
    .padding(.top, 12 * scale)
  }

  // MARK: topics

  private var topics: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        mono("\(model.introduced)/\(model.total) met")
        mono("\(model.mastered) mastered")
        if model.saying > 0 { mono("\(model.saying) speaking") }
        Spacer()
        mono("\(model.newLeft) new left today")
      }
      .padding(.bottom, 8 * scale)
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          if model.dueAll > 0 {
            topicRow("review what's due", due: model.dueAll, meter: nil, gold: true) { model.start(nil) }
          }
          if model.shaky > 0 {
            topicRow("drill the shaky ones  \(model.shaky)", due: 0, meter: nil, gold: true) { model.startDrill("shaky", topic: nil) }
          }
          ForEach(Array(model.topics.enumerated()), id: \.element.id) { i, t in
            if !t.group.isEmpty && (i == 0 || model.topics[i - 1].group != t.group) {
              Text(t.group)
                .font(.system(size: 10 * scale, weight: .semibold))
                .tracking(1.2 * scale)
                .textCase(.uppercase)
                .foregroundColor(Ink.mute(scheme))
                .padding(.top, (i == 0 ? 6 : 16) * scale)
                .padding(.bottom, 2 * scale)
            }
            topicRow(t.label, due: t.due, meter: (t.introduced, t.count), gold: false) { model.start(t.id) }
          }
          Text("Phrases: \(model.source.replacingOccurrences(of: " — ", with: ". ")) Family phrases: written for Kanthropic.")
            .font(.system(size: 10 * scale))
            .foregroundColor(Ink.mute(scheme))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 12 * scale)
        }
      }
    }
  }

  private func topicRow(_ label: String, due: Int, meter: (Int, Int)?, gold: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      VStack(spacing: 0) {
        HStack(spacing: 10 * scale) {
          Text(label)
            .font(gold ? Ink.ui(scale) : .system(size: 13 * scale))
            .tracking(gold ? 1.0 * scale : 0)
            .textCase(gold ? .uppercase : nil)
            .foregroundColor(gold ? Ink.gold : Ink.glyph(scheme))
          Spacer()
          if due > 0 {
            Text("\(due)")
              .font(.system(size: 10 * scale, weight: .semibold, design: .monospaced))
              .foregroundColor(Ink.bg(scheme))
              .padding(.horizontal, 5 * scale)
              .padding(.vertical, 1 * scale)
              .background(Capsule().fill(Ink.miss))
          }
          if let (met, count) = meter {
            GeometryReader { g in
              ZStack(alignment: .leading) {
                Capsule().fill(Ink.hair(scheme))
                Capsule().fill(Ink.gold).frame(width: g.size.width * CGFloat(met) / CGFloat(max(1, count)))
              }
            }
            .frame(width: 44 * scale, height: 3 * scale)
            mono("\(met)/\(count)").frame(width: 40 * scale, alignment: .trailing)
          }
        }
        .padding(.vertical, 8 * scale)
        Rectangle().fill(Ink.hair(scheme)).frame(height: 1 * scale)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  // MARK: card screens

  private var bar: some View {
    HStack(spacing: 10 * scale) {
      Button { model.showTopics() } label: {
        Text("‹ topics").font(Ink.ui(scale)).tracking(1.0 * scale).textCase(.uppercase).foregroundColor(Ink.gold)
      }
      .buttonStyle(.plain)
      Text(model.topicLabel).font(Ink.ui(scale)).tracking(1.0 * scale).textCase(.uppercase)
        .foregroundColor(model.drill != nil ? Ink.gold : Ink.mute(scheme))
      Spacer()
      if model.drill != nil {
        if model.view != .drillDone { mono("\(model.drillLeft) left") }
        if model.result == nil && model.view != .drillDone {
          smallLink("end") { model.endDrill() }
        }
      } else {
        if model.seen > 0 { mono("\(model.right)/\(model.seen)") }
        if model.view != .empty && model.result == nil && model.scopeMet > 0 {
          Menu {
            Button("drill now (\(model.scopeMet) met)") { model.startDrill("topic", topic: model.topic) }
            if model.scopeShaky > 0 {
              Button("drill the shaky ones (\(model.scopeShaky))") { model.startDrill("shaky", topic: model.topic) }
            }
          } label: {
            Text("drill").font(Ink.ui(scale)).tracking(1.0 * scale).textCase(.uppercase).foregroundColor(Ink.gold)
          }
          .menuStyle(.borderlessButton)
          .menuIndicator(.hidden)
          .fixedSize()
        }
      }
    }
  }

  private func smallLink(_ title: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title).font(Ink.ui(scale)).tracking(1.0 * scale).textCase(.uppercase).foregroundColor(Ink.gold)
    }
    .buttonStyle(.plain)
  }

  private var drillDone: some View {
    VStack(alignment: .leading, spacing: 12 * scale) {
      Spacer(minLength: 0)
      label("drill done", color: Ink.gold)
      Text("\(model.drillFirstTry)/\(model.drillSize) first try")
        .font(.system(size: 19 * scale, weight: .medium)).foregroundColor(Ink.glyph(scheme))
      Text((model.drillMissed > 0 ? "\(model.drillMissed) needed another go — they're the ones to watch" : "clean round")
           + " · drills are extra practice and don't move your review schedule")
        .font(.system(size: 11 * scale)).foregroundColor(Ink.mute(scheme))
        .fixedSize(horizontal: false, vertical: true)
      Spacer(minLength: 0)
      link("another round  ⏎", detail: Engine.string(model.drill?["kind"]) == "shaky" ? "next shaky ones" : "next phrases") { model.drillAgain() }
      link(model.topic != nil ? "back to the topic" : "back to reviews") { model.endDrill() }
      link("topics") { model.showTopics() }
      Spacer(minLength: 0)
    }
  }

  private var intro: some View {
    VStack(alignment: .leading, spacing: 10 * scale) {
      Spacer(minLength: 0)
      label("new phrase", color: Ink.gold)
      prompt
      if let p = model.phrase { answer(p, tone: nil) }
      Spacer(minLength: 0)
      bigButton("try it  ⏎", color: Ink.gold) { model.quiz() }
    }
  }

  private var quiz: some View {
    VStack(alignment: .leading, spacing: 10 * scale) {
      Spacer(minLength: 0)
      label(model.isNew ? "now build it" : "translate", color: Ink.mute(scheme))
      prompt
      VStack(alignment: .leading, spacing: 0) {
        FlowLayout(spacing: 6 * scale) {
          ForEach(model.picked, id: \.self) { id in
            if let t = model.tiles.first(where: { $0.id == id }) {
              tile(t.text, style: .picked) { model.unpick(id) }
            }
          }
        }
        .frame(minHeight: 34 * scale, alignment: .topLeading)
        .padding(.vertical, 6 * scale)
        Rectangle().fill(lineColor).frame(height: 1 * scale)
      }
      if let ok = model.result, let p = model.phrase {
        label(ok ? "correct" : "the answer", color: ok ? Ink.ok : Ink.miss)
        answer(p, tone: ok ? Ink.ok : Ink.miss)
      }
      Spacer(minLength: 0)
      if model.result == nil {
        FlowLayout(spacing: 6 * scale) {
          ForEach(Array(model.tiles.enumerated()), id: \.element.id) { _, t in
            let used = model.picked.contains(t.id)
            tile(t.text, style: used ? .used : .bank, hint: used ? nil : bankIndex(t)) { model.pick(t.id) }
              .disabled(used)
          }
        }
        .frame(maxWidth: .infinity)
        bigButton("check  ⏎", color: Ink.gold, disabled: model.picked.isEmpty) { model.check() }
      } else {
        bigButton("continue  ⏎", color: model.result == true ? Ink.ok : Ink.miss) { model.deal() }
      }
    }
  }

  /// Hear it with no text, pick the meaning.
  private var listen: some View {
    VStack(alignment: .leading, spacing: 10 * scale) {
      Spacer(minLength: 0)
      label("listen", color: Ink.mute(scheme))
      Button { if let p = model.phrase { model.speak(p) } } label: {
        HStack(spacing: 10 * scale) {
          Image(systemName: "speaker.wave.2.fill").font(.system(size: 22 * scale))
          Text(model.result == nil ? "what does it mean?  ␣ replays" : "play again")
            .font(Ink.ui(scale)).tracking(1.0 * scale).textCase(.uppercase)
        }
        .foregroundColor(Ink.gold)
      }
      .buttonStyle(.plain)
      VStack(spacing: 6 * scale) {
        ForEach(Array(model.choices.enumerated()), id: \.element.id) { i, c in
          choiceRow(c, index: i + 1)
        }
      }
      if model.result != nil, let p = model.phrase {
        answer(p, tone: model.result == true ? Ink.ok : Ink.miss)
      }
      Spacer(minLength: 0)
      if let ok = model.result {
        bigButton("continue  ⏎", color: ok ? Ink.ok : Ink.miss) { model.deal() }
      }
    }
  }

  private func choiceRow(_ c: PhraseChoice, index: Int) -> some View {
    let decided = model.result != nil
    let fill: Color = !decided ? Ink.hair(scheme).opacity(0.9)
      : c.id == model.answerKey ? Ink.ok.opacity(0.35)
      : c.id == model.chosen ? Ink.miss.opacity(0.35) : Ink.hair(scheme).opacity(0.4)
    return Button { model.choose(c.id) } label: {
      HStack(alignment: .top, spacing: 8 * scale) {
        VStack(alignment: .leading, spacing: 2 * scale) {
          Text(c.en).font(.system(size: 13 * scale, weight: .medium)).foregroundColor(Ink.glyph(scheme))
            .fixedSize(horizontal: false, vertical: true)
          if !c.note.isEmpty { Text(c.note).font(.system(size: 10 * scale)).foregroundColor(Ink.mute(scheme)) }
        }
        Spacer(minLength: 0)
        if !decided { mono("\(index)") }
      }
      .padding(.horizontal, 10 * scale)
      .padding(.vertical, 7 * scale)
      .background(RoundedRectangle(cornerRadius: 7 * scale).fill(fill))
      .opacity(decided && c.id != model.answerKey && c.id != model.chosen ? 0.5 : 1)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(decided)
  }

  /// Say it aloud from the English, reveal, grade yourself.
  private var say: some View {
    VStack(alignment: .leading, spacing: 10 * scale) {
      Spacer(minLength: 0)
      label("say it out loud", color: Ink.gold)
      prompt
      if model.revealed, let p = model.phrase {
        answer(p, tone: model.result.map { $0 ? Ink.ok : Ink.miss })
      } else {
        Text("say the whole sentence, then check")
          .font(.system(size: 11 * scale)).foregroundColor(Ink.mute(scheme))
      }
      Spacer(minLength: 0)
      if !model.revealed {
        bigButton("show answer  ␣", color: Ink.gold) { model.reveal() }
      } else if model.result == nil {
        HStack(spacing: 5 * scale) {
          rateButton("again", "missed it", 1, Ink.miss)
          rateButton("hard", "with effort", 2, Ink.gold.opacity(0.7))
          rateButton("good", "got it", 3, Ink.gold)
          rateButton("easy", "instant", 4, Ink.ok)
        }
      } else {
        bigButton("continue  ⏎", color: model.result == true ? Ink.ok : Ink.miss) { model.deal() }
      }
    }
  }

  private func rateButton(_ rating: String, _ detail: String, _ key: Int, _ color: Color) -> some View {
    Button { model.rate(rating) } label: {
      VStack(spacing: 2 * scale) {
        Text("\(rating) \(key)").font(.system(size: 11 * scale, weight: .semibold)).tracking(0.8 * scale).textCase(.uppercase)
        Text(detail).font(.system(size: 9 * scale)).opacity(0.75)
      }
      .foregroundColor(Color(red: 0.118, green: 0.102, blue: 0.090))
      .frame(maxWidth: .infinity)
      .frame(height: 40 * scale)
      .background(RoundedRectangle(cornerRadius: 8 * scale).fill(color))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private var empty: some View {
    VStack(alignment: .leading, spacing: 12 * scale) {
      Spacer(minLength: 0)
      Text(emptyMessage)
        .font(.system(size: 15 * scale))
        .foregroundColor(Ink.mute(scheme))
        .fixedSize(horizontal: false, vertical: true)
      if model.reason == "limit" { link("learn 5 more", detail: "today only") { model.learnMore() } }
      if model.dueAll > 0 && model.topic != nil { link("review what's due", detail: "\(model.dueAll)") { model.start(nil) } }
      if model.scopeMet > 0 { link("drill now", detail: "extra practice") { model.startDrill("topic", topic: model.topic) } }
      if model.scopeShaky > 0 { link("drill the shaky ones", detail: "\(model.scopeShaky)") { model.startDrill("shaky", topic: model.topic) } }
      link("topics") { model.showTopics() }
      Spacer(minLength: 0)
    }
  }

  private var emptyMessage: String {
    switch model.reason {
    case "caught-up": return "nothing due — pick a topic to meet new phrases"
    case "limit": return "that's today's \(model.newPerDay) new phrases"
    default: return "you've met every phrase in this topic"
    }
  }

  // MARK: pieces

  private var prompt: some View {
    VStack(alignment: .leading, spacing: 4 * scale) {
      Text(model.phrase?.en ?? "")
        .font(.system(size: 19 * scale, weight: .medium))
        .foregroundColor(Ink.glyph(scheme))
        .fixedSize(horizontal: false, vertical: true)
      if let note = model.phrase?.note, !note.isEmpty {
        Text(note).font(.system(size: 11 * scale)).foregroundColor(Ink.mute(scheme))
      }
    }
  }

  private func answer(_ p: PhraseCard, tone: Color?) -> some View {
    let plain = p.ja.filter { !"。、？！?! ".contains($0) }
    return VStack(alignment: .leading, spacing: 4 * scale) {
      HStack(spacing: 8 * scale) {
        Text(p.ja)
          .font(.kana(session.glyphFontID, size: 24 * scale))
          .foregroundColor(tone ?? Ink.glyph(scheme))
          .fixedSize(horizontal: false, vertical: true)
        Button { model.speak(p) } label: {
          Image(systemName: "speaker.wave.2.fill")
            .font(.system(size: 12 * scale))
            .foregroundColor(Ink.gold)
        }
        .buttonStyle(.plain)
        .help("Play")
      }
      if p.kana != plain {
        Text(p.kana).font(.kana(session.glyphFontID, size: 14 * scale)).foregroundColor(Ink.mute(scheme))
      }
      Text(p.romaji).font(Ink.romaji(scale * 0.85)).foregroundColor(Ink.gold)
    }
  }

  private enum TileStyle { case bank, picked, used }

  private func tile(_ text: String, style: TileStyle, hint: Int? = nil, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      HStack(alignment: .top, spacing: 3 * scale) {
        Text(text)
          .font(.kana(session.glyphFontID, size: 15 * scale))
          .foregroundColor(Ink.glyph(scheme))
        if let hint, hint <= 9 {
          Text("\(hint)")
            .font(.system(size: 8 * scale, weight: .medium, design: .monospaced))
            .foregroundColor(Ink.mute(scheme))
        }
      }
      .padding(.horizontal, 10 * scale)
      .padding(.vertical, 7 * scale)
      .background(
        RoundedRectangle(cornerRadius: 7 * scale)
          .fill(style == .picked ? Color.clear : Ink.hair(scheme).opacity(style == .used ? 0.3 : 0.9))
      )
      .overlay(
        RoundedRectangle(cornerRadius: 7 * scale)
          .stroke(style == .picked ? Ink.hair(scheme) : Color.clear, lineWidth: 1 * scale)
      )
      .opacity(style == .used ? 0.3 : 1)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  /// 1-based position among tiles still in the bank — the key that picks it.
  private func bankIndex(_ t: PhraseTile) -> Int? {
    let bank = model.tiles.filter { !model.picked.contains($0.id) }
    return bank.firstIndex(of: t).map { $0 + 1 }
  }

  private var lineColor: Color {
    switch model.result {
    case .some(true): return Ink.ok
    case .some(false): return Ink.miss
    case .none: return Ink.gold.opacity(0.6)
    }
  }

  private func bigButton(_ title: String, color: Color, disabled: Bool = false, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title)
        .font(.system(size: 12 * scale, weight: .semibold))
        .tracking(1.2 * scale)
        .textCase(.uppercase)
        .foregroundColor(Color(red: 0.118, green: 0.102, blue: 0.090))
        .frame(maxWidth: .infinity)
        .frame(height: 36 * scale)
        .background(RoundedRectangle(cornerRadius: 8 * scale).fill(color.opacity(disabled ? 0.4 : 1)))
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(disabled)
  }

  private func link(_ title: String, detail: String? = nil, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      HStack {
        Text(title).font(Ink.ui(scale)).tracking(1.0 * scale).textCase(.uppercase).foregroundColor(Ink.gold)
        Spacer()
        if let detail { Text(detail).font(Ink.ui(scale)).foregroundColor(Ink.mute(scheme)) }
      }
    }
    .buttonStyle(.plain)
  }

  private func label(_ text: String, color: Color) -> some View {
    Text(text).font(Ink.ui(scale)).tracking(1.2 * scale).textCase(.uppercase).foregroundColor(color)
  }

  private func mono(_ text: String) -> some View {
    Text(text).font(.system(size: 10 * scale, weight: .medium, design: .monospaced)).foregroundColor(Ink.mute(scheme))
  }
}
