import SwiftUI

private struct PanelScaleKey: EnvironmentKey {
  static let defaultValue: CGFloat = 1
}

extension EnvironmentValues {
  var panelScale: CGFloat {
    get { self[PanelScaleKey.self] }
    set { self[PanelScaleKey.self] = newValue }
  }
}

enum Ink {
  static func bg(_ s: ColorScheme) -> Color {
    s == .dark
      ? Color(red: 0.086, green: 0.082, blue: 0.075)
      : Color(red: 0.957, green: 0.941, blue: 0.910)
  }
  static func glyph(_ s: ColorScheme) -> Color {
    s == .dark
      ? Color(red: 0.949, green: 0.922, blue: 0.878)
      : Color(red: 0.118, green: 0.102, blue: 0.090)
  }
  static let gold = Color(red: 0.769, green: 0.639, blue: 0.353)
  static let ok = Color(red: 0.490, green: 0.604, blue: 0.435)
  static let miss = Color(red: 0.816, green: 0.416, blue: 0.333)
  static func mute(_ s: ColorScheme) -> Color {
    s == .dark
      ? Color(red: 0.541, green: 0.518, blue: 0.478)
      : Color(red: 0.478, green: 0.435, blue: 0.388)
  }
  static func hair(_ s: ColorScheme) -> Color {
    s == .dark
      ? Color(red: 0.165, green: 0.153, blue: 0.141)
      : Color(red: 0.863, green: 0.827, blue: 0.769)
  }
  static func ui(_ scale: CGFloat) -> Font { .system(size: 12 * scale, weight: .medium) }
  static func romaji(_ scale: CGFloat) -> Font { .system(size: 18 * scale, weight: .medium, design: .monospaced) }
}

struct PopoverView: View {
  @EnvironmentObject var session: Session
  @Environment(\.colorScheme) var scheme
  var body: some View {
    GeometryReader { geometry in
      let base = AppDelegate.defaultPanelSize
      let scale = min(geometry.size.width / base.width, geometry.size.height / base.height)
      ScaledPopoverContent()
        .environmentObject(session)
        .environment(\.panelScale, scale)
        .frame(width: base.width * scale, height: base.height * scale)
        .position(x: geometry.size.width / 2, y: geometry.size.height / 2)
    }
    .frame(minWidth: AppDelegate.defaultPanelSize.width, maxWidth: .infinity,
           minHeight: AppDelegate.defaultPanelSize.height, maxHeight: .infinity)
    .background(Ink.bg(scheme))
  }
}

private struct ScaledPopoverContent: View {
  @EnvironmentObject var session: Session
  @Environment(\.colorScheme) var scheme
  @Environment(\.panelScale) var scale
  @FocusState private var focused: Bool

  var body: some View {
    Group {
      if session.showSettings { SettingsView() }
      else { drill }
    }
  }

  private var drill: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      if session.mode == .phrases {
        PhrasesView(model: session.phrases)
      } else if session.mode == .chart {
        ChartView()
          .padding(.top, 12 * scale)
      } else if session.mode == .progress {
        ProgressPanel(model: session.progress)
      } else {
        Spacer(minLength: 4 * scale)
        card
        Spacer(minLength: 4 * scale)
        input
        footer
      }
    }
    .padding(.horizontal, 18 * scale)
    .padding(.top, 18 * scale)
    .padding(.bottom, 16 * scale)
    .onAppear { focused = true }
    .onChange(of: session.glyph) { _ in focused = true }
    .onChange(of: session.focusNonce) { _ in focused = true }
  }

  private var header: some View {
    HStack(alignment: .center, spacing: 9 * scale) {
      modeTab("learn", .learn)
      modeTab("study", .study)
      modeTab("phrases", .phrases)
      Button { session.setMode(.dakuten) } label: {
        Text("゛")
          .font(.system(size: 15 * scale, weight: .semibold))
          .foregroundColor(session.headerMode == .dakuten ? Ink.gold : Ink.mute(scheme))
      }
      .buttonStyle(.plain)
      .help("Dakuten")
      Button { session.setMode(.chart) } label: {
        Image(systemName: "square.grid.3x3")
          .font(.system(size: 12 * scale, weight: .medium))
          .foregroundColor(session.headerMode == .chart ? Ink.gold : Ink.mute(scheme))
      }
      .buttonStyle(.plain)
      .help("Chart")
      Button { session.setMode(.progress) } label: {
        Image(systemName: "calendar")
          .font(.system(size: 12 * scale, weight: .medium))
          .foregroundColor(session.headerMode == .progress ? Ink.gold : Ink.mute(scheme))
      }
      .buttonStyle(.plain)
      .help("Progress")
      Spacer()
      scriptToggle
      Button(action: { session.openSettings() }) {
        Image(systemName: "gearshape")
          .font(.system(size: 12 * scale, weight: .medium))
          .foregroundColor(Ink.mute(scheme))
      }
      .buttonStyle(.plain)
      .help("Settings")
      Circle()
        .fill(session.thinking ? Ink.gold : Ink.mute(scheme).opacity(0.35))
        .frame(width: 6 * scale, height: 6 * scale)
        .help(session.thinking ? "Grok is thinking" : "Grok is idle")
    }
  }

  private func modeTab(_ label: String, _ mode: DrillMode) -> some View {
    Button {
      session.setMode(mode)
    } label: {
      Text(label)
        .font(Ink.ui(scale))
        .tracking(0.9 * scale)
        .textCase(.uppercase)
        .foregroundColor(session.headerMode == mode ? Ink.gold : Ink.mute(scheme))
        .fixedSize()
    }
    .buttonStyle(.plain)
  }

  private var scriptToggle: some View {
    HStack(spacing: 8 * scale) {
      scriptBtn("あ", "hiragana")
      Text("/")
        .font(Ink.ui(scale))
        .foregroundColor(Ink.mute(scheme).opacity(0.5))
      scriptBtn("ア", "katakana")
    }
  }

  private func scriptBtn(_ label: String, _ script: String) -> some View {
    Button {
      session.setScript(script)
    } label: {
      Text(label)
        .font(.kana(session.glyphFontID, size: 14 * scale))
        .foregroundColor(session.script == script ? Ink.glyph(scheme) : Ink.mute(scheme))
    }
    .buttonStyle(.plain)
  }

  private var card: some View {
    HStack(alignment: .center, spacing: 18 * scale) {
      RoundedRectangle(cornerRadius: 1 * scale)
        .fill(spineColor)
        .frame(width: 2 * scale, height: 128 * scale)

      VStack(alignment: .leading, spacing: 10 * scale) {
        if let empty = session.emptyMessage {
          Text(empty)
            .font(.system(size: 15 * scale))
            .foregroundColor(Ink.mute(scheme))
            .fixedSize(horizontal: false, vertical: true)
        } else if session.mode == .dakuten {
          dakutenFamily
        } else {
          Text(session.glyph)
            .font(.kana(session.glyphFontID, size: 92 * scale))
            .foregroundColor(Ink.glyph(scheme))
            .minimumScaleFactor(0.5)
            .lineLimit(1)
            .id(session.glyph + session.glyphFontID)
            .transition(.opacity)

          if session.mode == .learn {
            HStack(alignment: .firstTextBaseline, spacing: 10 * scale) {
              Text(session.romaji)
                .font(Ink.romaji(scale))
                .foregroundColor(Ink.gold)
              Text(session.partner)
                .font(.kana(session.glyphFontID, size: 18 * scale))
                .foregroundColor(Ink.mute(scheme))
            }
            Text(session.mnemonic)
              .font(.system(size: 13 * scale))
              .foregroundColor(Ink.mute(scheme))
              .fixedSize(horizontal: false, vertical: true)
              .frame(maxWidth: 240 * scale, alignment: .leading)
          } else if let revealed = session.revealed {
            Text(revealed)
              .font(Ink.romaji(scale))
              .foregroundColor(Ink.miss)
          }
        }
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, minHeight: 210 * scale, alignment: .leading)
    .animation(.easeInOut(duration: 0.18), value: session.glyph)
  }

  private var dakutenFamily: some View {
    let revealColor = session.flash == .ok ? Ink.ok : Ink.miss
    return VStack(alignment: .leading, spacing: 14 * scale) {
      if session.dakutenKind == "exception" {
        Text("exception")
          .font(Ink.ui(scale))
          .tracking(1.4 * scale)
          .textCase(.uppercase)
          .foregroundColor(Ink.gold)
      }
      HStack(alignment: .center, spacing: 20 * scale) {
        ZStack(alignment: .topTrailing) {
          Text(session.glyph)
            .font(session.dakutenPromptIsKana
                  ? .kana(session.glyphFontID, size: 88 * scale)
                  : .system(size: 84 * scale, weight: .medium, design: .serif))
            .foregroundColor(Ink.glyph(scheme))
            .id(session.glyph + session.dakutenMark)
          Text(session.dakutenMark)
            .font(.system(size: 40 * scale, weight: .medium))
            .foregroundColor(Ink.gold)
            .offset(x: 22 * scale, y: -6 * scale)
        }
        Text("→")
          .font(.system(size: 22 * scale, weight: .medium))
          .foregroundColor(Ink.mute(scheme))
        if session.revealed != nil {
          Text(session.dakutenVoicedRomaji)
            .font(.system(size: 64 * scale, weight: .medium, design: .serif))
            .foregroundColor(revealColor)
        } else {
          Text("?")
            .font(.system(size: 56 * scale, weight: .medium))
            .foregroundColor(Ink.mute(scheme).opacity(0.55))
        }
      }
      if session.dakutenPromptIsKana, !session.romaji.isEmpty {
        Text(session.romaji)
          .font(Ink.romaji(scale))
          .foregroundColor(Ink.gold)
      }
      if session.revealed != nil {
        HStack(spacing: 8 * scale) {
          Text(session.dakutenExampleFrom)
            .font(.kana(session.glyphFontID, size: 22 * scale))
          Text("→")
            .foregroundColor(Ink.mute(scheme))
          Text(session.dakutenVoiced)
            .font(.kana(session.glyphFontID, size: 22 * scale))
            .foregroundColor(revealColor)
          if !session.dakutenCaption.isEmpty {
            Text(session.dakutenCaption)
              .font(.system(size: 12 * scale))
              .foregroundColor(Ink.mute(scheme))
          }
        }
      }
    }
  }

  private var spineColor: Color {
    switch session.flash {
    case .ok: return Ink.ok
    case .miss: return Ink.miss
    case .none: return Ink.gold.opacity(0.85)
    }
  }

  private var input: some View {
    VStack(alignment: .leading, spacing: 8 * scale) {
      if session.drillPicker {
        drillPicker
      } else if (session.mode == .study || session.mode == .rote || session.mode == .dakuten) && session.emptyMessage == nil {
        TextField("", text: $session.answer)
          .textFieldStyle(.plain)
          .font(Ink.romaji(scale))
          .foregroundColor(Ink.glyph(scheme))
          .focused($focused)
          .disableAutocorrection(true)
          .onSubmit { session.submit() }
        Rectangle()
          .fill(session.flash == .miss ? Ink.miss : Ink.gold.opacity(0.7))
          .frame(height: 1 * scale)
        if session.mode == .rote || session.mode == .dakuten {
          actionRow(
            session.roteTotal > 0
              ? "i'm confident  \(session.roteDone)/\(session.roteTotal)"
              : "i'm confident",
            detail: session.mode == .dakuten ? "got the marks" : "schedule reviews"
          ) {
            if session.mode == .dakuten { session.confirmDakuten() }
            else { session.confirmConfident() }
          }
          .padding(.top, 8 * scale)
        }
        if session.mode == .study {
          actionRow("drill all", detail: "pick a set") { session.openDrillPicker() }
            .padding(.top, 8 * scale)
        } else if session.mode == .dakuten {
          actionRow("drill all", detail: "start over") { session.drillAllDakuten() }
        }
      } else if session.mode == .learn && session.emptyMessage == nil {
        actionRow(
          session.learnTotal > 0
            ? "continue  \(session.learnIndex + 1)/\(session.learnTotal)"
            : "continue",
          detail: "return"
        ) { session.continueLearn() }
        .keyboardShortcut(.defaultAction)
        Rectangle()
          .fill(Ink.gold.opacity(0.4))
          .frame(height: 1 * scale)
      } else {
        emptyActions
      }
    }
    .padding(.top, 8 * scale)
  }

  private var drillPicker: some View {
    VStack(alignment: .leading, spacing: 10 * scale) {
      Text("Saved today · resets at midnight")
        .font(.system(size: 11 * scale))
        .foregroundColor(Ink.mute(scheme))
      ForEach(session.drillSets) { set in
        actionRow(set.label, detail: "\(set.done)/\(set.count) today") { session.pickDrillSet(set.id) }
      }
      Button(action: { session.cancelDrillPicker() }) {
        Text("back")
          .font(Ink.ui(scale))
          .tracking(1.0 * scale)
          .textCase(.uppercase)
          .foregroundColor(Ink.mute(scheme))
      }
      .buttonStyle(.plain)
      .padding(.top, 4 * scale)
    }
  }

  private var emptyActions: some View {
    VStack(alignment: .leading, spacing: 10 * scale) {
      if session.emptyMessage == "set complete for today" {
        actionRow("drill now", detail: "another round") { session.restartDrill() }
        actionRow("choose another set") { session.openDrillPicker() }
        actionRow("scheduled reviews") { session.setMode(.study) }
      } else if session.mode == .dakuten && session.emptyMessage == "these marks are sticking" {
        Text("three in a row on each rule — the marks are sticking")
          .font(.system(size: 12 * scale))
          .foregroundColor(Ink.mute(scheme))
        actionRow("drill all", detail: "the whole set") { session.drillAllDakuten() }
      } else if session.mode == .study && session.emptyMessage == "nothing due" {
        Text("reviews come back when they’re due — that’s the point")
          .font(.system(size: 12 * scale))
          .foregroundColor(Ink.mute(scheme))
        if session.learned > 0 {
          actionRow("drill all", detail: "pick a set") { session.openDrillPicker() }
        }
        actionRow("learn next row") { session.setMode(.learn) }
        if session.learning > 0 {
          actionRow("rote the shaky ones") { session.roteShaky() }
        }
        actionRow("i've been away") { session.markAway() }
      } else {
        if session.learned > 0 {
          actionRow("drill all", detail: "pick a set") { session.openDrillPicker() }
        }
        actionRow("learn the next row") { session.setMode(.learn) }
      }
    }
  }

  private func actionRow(_ title: String, detail: String? = nil, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      HStack {
        Text(title)
          .font(Ink.ui(scale))
          .tracking(1.0 * scale)
          .textCase(.uppercase)
          .foregroundColor(Ink.gold)
        Spacer()
        if let detail {
          Text(detail)
            .font(Ink.ui(scale))
            .foregroundColor(Ink.mute(scheme))
        }
      }
    }
    .buttonStyle(.plain)
  }

  private var footer: some View {
    VStack(alignment: .leading, spacing: 8 * scale) {
      GeometryReader { geo in
        ZStack(alignment: .leading) {
          Rectangle().fill(Ink.hair(scheme))
          Rectangle()
            .fill(Ink.gold.opacity(0.85))
            .frame(width: geo.size.width * progress)
        }
      }
      .frame(height: 1 * scale)

      HStack {
        Text("\(session.learned)/\(session.total)")
          .font(.system(size: 11 * scale, weight: .medium, design: .monospaced))
          .foregroundColor(Ink.mute(scheme))
        if session.scoreSeen > 0 {
          Text("\(session.scoreCorrect)/\(session.scoreSeen)")
            .font(.system(size: 11 * scale, weight: .medium, design: .monospaced))
            .foregroundColor(Ink.mute(scheme))
        }
        Spacer()
        if session.mode == .rote || session.mode == .dakuten {
          Text("\(session.roteDone)/\(session.roteTotal) sticking")
            .font(.system(size: 11 * scale, weight: .medium, design: .monospaced))
            .foregroundColor(Ink.gold)
        } else if session.mode == .dakuten, let hint = session.hint {
          Text(hint)
            .font(.system(size: 11 * scale))
            .foregroundColor(Ink.mute(scheme))
        } else if session.mode != .learn && session.mode != .dakuten, let hint = session.hint {
          Button(action: { session.setMode(.learn) }) {
            Text(hint)
              .font(.system(size: 11 * scale))
              .foregroundColor(Ink.mute(scheme))
              .lineLimit(1)
          }
          .buttonStyle(.plain)
        } else if session.thinking {
          Text("grok thinking")
            .font(.system(size: 11 * scale))
            .foregroundColor(Ink.gold)
        }
      }
      if let err = session.engineError {
        Text(err)
          .font(.system(size: 10 * scale, design: .monospaced))
          .foregroundColor(Ink.miss)
      }
    }
    .padding(.top, 16 * scale)
  }

  private var progress: CGFloat {
    guard session.total > 0 else { return 0 }
    return min(1, CGFloat(session.learned) / CGFloat(session.total))
  }
}

struct SettingsView: View {
  @Environment(\.panelScale) var scale
  @EnvironmentObject var session: Session
  @Environment(\.colorScheme) var scheme
  @State private var confirm: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Button(action: { session.closeSettings() }) {
          HStack(spacing: 6 * scale) {
            Image(systemName: "chevron.left")
              .font(.system(size: 11 * scale, weight: .semibold))
            Text("drill")
              .font(Ink.ui(scale))
              .tracking(1.2 * scale)
              .textCase(.uppercase)
          }
          .foregroundColor(Ink.gold)
        }
        .buttonStyle(.plain)
        Spacer()
        Text("settings")
          .font(Ink.ui(scale))
          .tracking(1.2 * scale)
          .textCase(.uppercase)
          .foregroundColor(Ink.mute(scheme))
      }
      .padding(.bottom, 14 * scale)

      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          AccountSection()

          Rectangle()
            .fill(Ink.hair(scheme))
            .frame(height: 1 * scale)
            .padding(.vertical, 12 * scale)

          sectionLabel("Font")
          ForEach(GlyphTypeface.available) { face in
            fontRow(face)
          }

          Rectangle()
            .fill(Ink.hair(scheme))
            .frame(height: 1 * scale)
            .padding(.vertical, 12 * scale)

          toggleRow("Read phrases aloud", isOn: session.phrases.speakOn) {
            session.phrases.setSpeak($0)
          }
          HStack {
            Text("Voice")
              .font(.system(size: 13 * scale))
              .foregroundColor(Ink.glyph(scheme))
            Spacer()
            Picker("", selection: Binding(get: { session.phrases.voice }, set: { session.phrases.setVoice($0) })) {
              Text("Mix").tag("mix")
              ForEach(session.phrases.voices, id: \.self) { Text($0).tag($0) }
            }
            .labelsHidden()
            .frame(width: 130 * scale)
          }
          .padding(.vertical, 4 * scale)
          toggleRow("Pop up while Grok thinks", isOn: session.popOnThink) {
            session.setPopOnThink($0)
          }
          toggleRow("Open at login", isOn: session.launchAtLogin) {
            session.setLaunchAtLogin($0)
          }

          Rectangle()
            .fill(Ink.hair(scheme))
            .frame(height: 1 * scale)
            .padding(.vertical, 12 * scale)

          sectionLabel("Deck")
          deckAction("I've been away", detail: "Every introduced card is due today. A miss sends it back to learning.") {
            confirm = "away"
          }
          deckAction("Reset learning…", detail: "Un-mastered characters go back to new. Walk the mnemonics again.") {
            confirm = "learning"
          }
          deckAction("Reset studying…", detail: "Wipe review history. Keep which characters you've met.") {
            confirm = "studying"
          }
          deckAction("Reset everything…", detail: "Forget this script entirely.", destructive: true) {
            confirm = "all"
          }
        }
      }
    }
    .padding(.horizontal, 22 * scale)
    .padding(.top, 18 * scale)
    .padding(.bottom, 16 * scale)
    .alert(confirmTitle, isPresented: Binding(
      get: { confirm != nil },
      set: { if !$0 { confirm = nil } }
    )) {
      Button(confirmButton, role: confirm == "away" ? nil : .destructive) {
        switch confirm {
        case "away": session.markAway()
        case "learning": session.resetLearning()
        case "studying": session.resetStudying()
        case "all": session.resetCurrentScript()
        default: break
        }
        confirm = nil
      }
      Button("Cancel", role: .cancel) { confirm = nil }
    } message: {
      Text(confirmMessage)
    }
  }

  private var confirmTitle: String {
    switch confirm {
    case "away": return "I've been away?"
    case "learning": return "Reset learning?"
    case "studying": return "Reset studying?"
    default: return "Reset \(session.script)?"
    }
  }

  private var confirmMessage: String {
    switch confirm {
    case "away": return "Puts every introduced \(session.script) card due today. History stays."
    case "learning": return "Characters you haven't mastered go back to new. Mastered ones stay."
    case "studying": return "Wipes FSRS review history for \(session.script). Introductions stay."
    default: return "Forgets every card in this script. The other script is left alone."
    }
  }

  private var confirmButton: String {
    confirm == "away" ? "Due today" : "Reset"
  }

  private func sectionLabel(_ t: String) -> some View {
    Text(t)
      .font(Ink.ui(scale))
      .tracking(1.2 * scale)
      .textCase(.uppercase)
      .foregroundColor(Ink.mute(scheme))
      .padding(.bottom, 8 * scale)
  }

  private func deckAction(_ title: String, detail: String, destructive: Bool = false, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      VStack(alignment: .leading, spacing: 3 * scale) {
        Text(title)
          .font(.system(size: 13 * scale, weight: .medium))
          .foregroundColor(destructive ? Ink.miss : Ink.glyph(scheme))
        Text(detail)
          .font(.system(size: 11 * scale))
          .foregroundColor(Ink.mute(scheme))
          .fixedSize(horizontal: false, vertical: true)
      }
      .padding(.vertical, 8 * scale)
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private func fontRow(_ face: GlyphTypeface) -> some View {
    let selected = session.glyphFontID == face.id
    return Button(action: { session.setGlyphFont(face.id) }) {
      HStack(spacing: 12 * scale) {
        Text("ふ")
          .font(.kana(face.id, size: 28 * scale))
          .foregroundColor(Ink.glyph(scheme))
          .frame(width: 36 * scale, alignment: .center)
        VStack(alignment: .leading, spacing: 2 * scale) {
          Text(face.label)
            .font(.system(size: 13 * scale, weight: .medium))
            .foregroundColor(Ink.glyph(scheme))
          Text(face.detail)
            .font(.system(size: 11 * scale))
            .foregroundColor(Ink.mute(scheme))
        }
        Spacer()
        if selected {
          Image(systemName: "checkmark")
            .font(.system(size: 11 * scale, weight: .semibold))
            .foregroundColor(Ink.gold)
        }
      }
      .padding(.vertical, 8 * scale)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private func toggleRow(_ title: String, isOn: Bool, set: @escaping (Bool) -> Void) -> some View {
    Toggle(isOn: Binding(get: { isOn }, set: set)) {
      Text(title)
        .font(.system(size: 13 * scale))
        .foregroundColor(Ink.glyph(scheme))
    }
    .toggleStyle(.switch)
    .controlSize(.small)
    .padding(.vertical, 6 * scale)
  }
}

/// Who this Mac syncs as. Signing in here writes the same ~/.kanthropic/sync.json
/// the CLI uses, so `kanthropic account` and this panel always agree.
struct AccountSection: View {
  @Environment(\.panelScale) var scale
  @Environment(\.colorScheme) var scheme
  @EnvironmentObject var session: Session
  @ObservedObject var cloud = Cloud.shared
  @State private var email = ""
  @State private var password = ""
  @State private var working = false
  @State private var error: String?
  @State private var confirmSignOut = false

  var body: some View {
    VStack(alignment: .leading, spacing: 8 * scale) {
      Text("Account")
        .font(Ink.ui(scale))
        .tracking(1.2 * scale)
        .textCase(.uppercase)
        .foregroundColor(Ink.mute(scheme))
      if cloud.enabled { signedIn } else { signInForm }
    }
    .onAppear { cloud.refresh() }
  }

  private var status: String {
    if cloud.syncing { return "syncing…" }
    if let e = cloud.lastError { return "sync error: \(e)" }
    guard let at = cloud.lastSync else { return "syncs when you open and close this panel" }
    let f = RelativeDateTimeFormatter()
    f.unitsStyle = .short
    return "synced \(f.localizedString(for: at, relativeTo: Date()))"
  }

  private var signedIn: some View {
    VStack(alignment: .leading, spacing: 8 * scale) {
      Text(cloud.email ?? "synced with a pairing key")
        .font(.system(size: 13 * scale, weight: .medium))
        .foregroundColor(Ink.glyph(scheme))
      Text(status)
        .font(.system(size: 11 * scale))
        .foregroundColor(cloud.lastError == nil ? Ink.mute(scheme) : Ink.miss)
      HStack(spacing: 16 * scale) {
        link("sync now") { cloud.sync() }
        link(cloud.email == nil ? "stop syncing" : "sign out") { confirmSignOut = true }
      }
      .padding(.top, 2 * scale)
    }
    .alert("Sign out on this Mac?", isPresented: $confirmSignOut) {
      Button("Sign out", role: .destructive) { cloud.signOut() }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Progress on this Mac is kept. It just stops syncing.")
    }
  }

  private var signInForm: some View {
    VStack(alignment: .leading, spacing: 8 * scale) {
      Text("Sign in to sync with your phone. Creating an account brings this Mac's progress with it.")
        .font(.system(size: 11 * scale))
        .foregroundColor(Ink.mute(scheme))
        .fixedSize(horizontal: false, vertical: true)
      field { TextField("email", text: $email).textContentType(.username) }
      field { SecureField("password", text: $password).onSubmit { go(signup: false) } }
      if let error {
        Text(error)
          .font(.system(size: 11 * scale))
          .foregroundColor(Ink.miss)
          .fixedSize(horizontal: false, vertical: true)
      }
      HStack(spacing: 16 * scale) {
        link(working ? "…" : "sign in") { go(signup: false) }
        link("create account") { go(signup: true) }
      }
      .padding(.top, 2 * scale)
    }
  }

  private func field<F: View>(@ViewBuilder _ content: () -> F) -> some View {
    VStack(spacing: 4 * scale) {
      content()
        .textFieldStyle(.plain)
        .font(.system(size: 13 * scale))
        .foregroundColor(Ink.glyph(scheme))
        .disableAutocorrection(true)
      Rectangle().fill(Ink.gold.opacity(0.5)).frame(height: 1 * scale)
    }
  }

  private func link(_ title: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title)
        .font(Ink.ui(scale))
        .tracking(1.0 * scale)
        .textCase(.uppercase)
        .foregroundColor(Ink.gold)
    }
    .buttonStyle(.plain)
    .disabled(working)
  }

  private func go(signup: Bool) {
    guard !working else { return }
    let e = email.trimmingCharacters(in: .whitespaces)
    guard !e.isEmpty, !password.isEmpty else { error = "enter your email and password"; return }
    working = true
    error = nil
    cloud.authenticate(signup: signup, email: e, password: password) { err in
      working = false
      error = err
      if err == nil { password = "" }
    }
  }
}
