import AppKit
import SwiftUI
import ServiceManagement

@main
@MainActor
enum Kanthropic {
  static func main() {
    // Dev aid: `Kanthropic --snapshot out.png [mode] [dark|light] [width]`
    // renders the panel to a PNG and exits, for checking layout without
    // clicking through the menu bar. Doesn't touch the running app.
    let args = CommandLine.arguments
    if let i = args.firstIndex(of: "--snapshot"), i + 1 < args.count {
      Snapshot.render(to: args[i + 1], mode: args.count > i + 2 ? args[i + 2] : "study",
                      dark: args.count > i + 3 ? args[i + 3] != "light" : true,
                      width: args.count > i + 4 ? Double(args[i + 4]) ?? 360 : 360)
      return
    }
    // A double-click after moving the .app must take over, not activate a
    // ghost process whose menu extra died with the old path.
    let selfPid = ProcessInfo.processInfo.processIdentifier
    for other in NSRunningApplication.runningApplications(withBundleIdentifier: "app.kanthropic.menu")
    where other.processIdentifier != selfPid {
      other.forceTerminate()
    }
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.delegate = AppDelegate.shared
    app.run()
  }
}

@MainActor
enum Snapshot {
  static func render(to path: String, mode: String, dark: Bool, width: Double) {
    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited)
    GlyphTypeface.registerBundled()
    let session = AppDelegate.shared.session
    session.appear()
    if let m = DrillMode(rawValue: mode) { session.setMode(m) }
    let base = AppDelegate.defaultPanelSize
    let size = NSSize(width: width, height: base.height * width / base.width)
    let root = PopoverView().environmentObject(session)
      .environment(\.colorScheme, dark ? .dark : .light)
    let host = NSHostingView(rootView: root)
    host.frame = NSRect(origin: .zero, size: size)
    let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
    window.contentView = host
    host.layoutSubtreeIfNeeded()
    RunLoop.main.run(until: Date().addingTimeInterval(0.5))
    guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return }
    host.cacheDisplay(in: host.bounds, to: rep)
    try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
  static let shared = AppDelegate()
  static let defaultPanelSize = NSSize(width: 360, height: 540)

  let session = Session()
  private var statusItem: NSStatusItem?
  private var panel: NSPanel?
  private var grok: GrokWatch?
  private var clickMonitor: Any?
  private var keyMonitor: Any?
  private var ignoreReopen = true


  func applicationDidFinishLaunching(_ notification: Notification) {
    GlyphTypeface.registerBundled()
    GrokHooks.installIfNeeded()
    session.appear()
    session.popOnThink = Store.popOnThink()
    Cloud.shared.onRemoteChange = { [weak self] in self?.session.remoteChanged() }
    Cloud.shared.start()

    // Sit to the right of Hidden Bar's separator (~518–550) and left of
    // system items (~150–240). Smaller number = further right.
    UserDefaults.standard.set(400, forKey: "NSStatusItem Preferred Position kanthropic")
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    item.autosaveName = "kanthropic"
    item.isVisible = true
    if let button = item.button {
      if let img = NSImage(systemSymbolName: "character.ja", accessibilityDescription: "kanthropic") {
        img.isTemplate = true
        button.image = img
        button.imagePosition = .imageLeading
      }
      button.font = NSFont(name: GlyphTypeface.resolved(session.glyphFontID), size: 13)
        ?? NSFont(name: "HiraginoSans-W5", size: 13)
        ?? .menuBarFont(ofSize: 13)
      button.title = "あ"
      button.toolTip = "kanthropic"
      button.setAccessibilityTitle("kanthropic")
      button.target = self
      button.action = #selector(statusClicked)
      button.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }
    statusItem = item

    let hosting = NSHostingController(rootView: PopoverView().environmentObject(session))
    hosting.view.frame = NSRect(origin: .zero, size: Self.defaultPanelSize)

    let p = NSPanel(
      contentRect: hosting.view.frame,
      styleMask: [.titled, .fullSizeContentView, .resizable],
      backing: .buffered,
      defer: false
    )
    p.title = "kanthropic"
    p.titleVisibility = .hidden
    p.titlebarAppearsTransparent = true
    p.isFloatingPanel = false
    p.level = .popUpMenu
    p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    p.isMovableByWindowBackground = true
    p.hidesOnDeactivate = false
    p.isReleasedWhenClosed = false
    p.backgroundColor = .clear
    p.isOpaque = false
    p.hasShadow = true
    p.contentViewController = hosting
    p.contentMinSize = Self.defaultPanelSize
    p.contentAspectRatio = Self.defaultPanelSize
    p.delegate = self
    p.standardWindowButton(.closeButton)?.isHidden = true
    p.standardWindowButton(.miniaturizeButton)?.isHidden = true
    p.standardWindowButton(.zoomButton)?.isHidden = true
    panel = p

    grok = GrokWatch { [weak self] thinking in
      guard let self else { return }
      self.session.thinking = thinking
      if thinking && self.session.popOnThink {
        self.show(fromGrok: true)
      }
    }
    session.thinking = GrokWatch.anyThinking()

    clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
      self?.hideIfClickOutside()
    }
    keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
      if event.keyCode == 53 { // escape
        self?.hide()
        return nil
      }
      // Phrases have no text field: digits pick tiles, ⌫ undoes, return checks.
      if let s = self?.session, s.mode == .phrases, !s.showSettings, s.phrases.handleKey(event) {
        return nil
      }
      return event
    }

    panel?.orderOut(nil)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
      self?.ignoreReopen = false
      self?.warnIfExtraHidden()
    }
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    if ignoreReopen { return false }
    show(fromGrok: false)
    return true
  }

  func applicationWillTerminate(_ notification: Notification) {
    if let clickMonitor { NSEvent.removeMonitor(clickMonitor) }
    if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
  }

  @objc private func statusClicked(_ sender: Any?) {
    if NSApp.currentEvent?.type == .rightMouseUp {
      showMenu()
      return
    }
    if panel?.isVisible == true { hide() } else { show(fromGrok: false) }
  }

  private func show(fromGrok: Bool) {
    guard let panel, let button = statusItem?.button else { return }
    if panel.isVisible && fromGrok { return } // already up — don't yank focus again
    position(panel, from: button)
    NSApp.activate(ignoringOtherApps: true)
    panel.makeKeyAndOrderFront(nil)
    session.requestFocus()
    Cloud.shared.sync() // pull what the phone did; refreshes the card if you haven't started typing
  }

  private func hide() {
    guard let panel else { return }
    panel.orderOut(nil)
    // Resizing lasts only for this presentation, never across dismissals.
    panel.setContentSize(Self.defaultPanelSize)
    Cloud.shared.sync() // push this sitting's answers
  }

  private func hideIfClickOutside() {
    guard let panel, panel.isVisible else { return }
    let mouse = NSEvent.mouseLocation
    if panel.frame.contains(mouse) { return }
    if let button = statusItem?.button, let win = button.window {
      let frame = win.convertToScreen(button.convert(button.bounds, to: nil))
      if frame.contains(mouse) { return }
    }
    hide()
  }

  private func position(_ panel: NSPanel, from button: NSStatusBarButton) {
    let screen = button.window?.screen ?? NSScreen.main ?? NSScreen.screens.first
    let vis = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    var buttonRect = NSRect.zero
    if let win = button.window {
      buttonRect = win.convertToScreen(button.convert(button.bounds, to: nil))
      if buttonRect.width < 4 { buttonRect = win.frame }
    }
    let onscreen = buttonRect.width >= 4
      && buttonRect.maxX > vis.minX
      && buttonRect.minX < vis.maxX
    var x: CGFloat
    var y: CGFloat
    if onscreen {
      x = buttonRect.midX - panel.frame.width / 2
      y = buttonRect.minY - panel.frame.height - 6
      if y < vis.minY + 8 { y = min(buttonRect.maxY + 6, vis.maxY - panel.frame.height) }
    } else {
      x = vis.maxX - panel.frame.width - 12
      y = vis.maxY - panel.frame.height
    }
    x = min(max(x, vis.minX + 8), vis.maxX - panel.frame.width - 8)
    y = min(max(y, vis.minY + 8), vis.maxY - panel.frame.height)
    panel.setFrameOrigin(NSPoint(x: x, y: y))
  }

  /// Hidden Bar (running on this machine) parks new extras to the left of its
  /// chevron. If our item isn't on the visible menu bar, say so once.
  private func warnIfExtraHidden() {
    guard let button = statusItem?.button else { return }
    let vis = NSScreen.main?.visibleFrame ?? .zero
    var rect = NSRect.zero
    if let win = button.window {
      rect = win.convertToScreen(button.convert(button.bounds, to: nil))
    }
    let onscreen = rect.width >= 4 && rect.maxX > vis.minX && rect.minX < vis.maxX && rect.minX > 0
    if onscreen { return }
    if UserDefaults.standard.bool(forKey: "didExplainHiddenBar") { return }
    UserDefaults.standard.set(true, forKey: "didExplainHiddenBar")
    panel?.orderOut(nil)
    let alert = NSAlert()
    alert.messageText = "kanthropic is in the menu bar"
    alert.informativeText = "Hidden Bar is collapsing it behind the « chevron.\n\nClick « in the menu bar, then drag あ to the right of the dotted separator so it stays visible."
    alert.addButton(withTitle: "OK")
    NSApp.activate(ignoringOtherApps: true)
    alert.runModal()
  }

  private func showMenu() {
    let menu = NSMenu()

    Cloud.shared.refresh()
    let account = NSMenuItem(
      title: Cloud.shared.email.map { "Signed in as \($0)" } ?? (Cloud.shared.enabled ? "Syncing with a pairing key" : "Not signed in — Settings to sync"),
      action: nil,
      keyEquivalent: ""
    )
    account.isEnabled = false
    menu.addItem(account)
    menu.addItem(.separator())

    let settings = NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
    settings.target = self
    menu.addItem(settings)
    menu.addItem(.separator())

    let pop = NSMenuItem(
      title: "Pop up while Grok thinks",
      action: #selector(togglePop),
      keyEquivalent: ""
    )
    pop.state = session.popOnThink ? .on : .off
    pop.target = self
    menu.addItem(pop)

    let login = NSMenuItem(
      title: "Open at login",
      action: #selector(toggleLogin),
      keyEquivalent: ""
    )
    login.state = Self.loginEnabled ? .on : .off
    login.target = self
    menu.addItem(login)

    let hooks = NSMenuItem(
      title: GrokHooks.installed() ? "Grok hooks installed" : "Install Grok hooks",
      action: #selector(reinstallHooks),
      keyEquivalent: ""
    )
    hooks.target = self
    menu.addItem(hooks)

    let allow = NSMenuItem(
      title: "Allow in Menu Bar…",
      action: #selector(openMenuBarSettings),
      keyEquivalent: ""
    )
    allow.target = self
    menu.addItem(allow)

    menu.addItem(.separator())

    let reset = NSMenuItem(title: "Reset this script…", action: #selector(resetScript), keyEquivalent: "")
    reset.target = self
    menu.addItem(reset)

    menu.addItem(.separator())
    menu.addItem(NSMenuItem(title: "Quit kanthropic", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

    statusItem?.menu = menu
    statusItem?.button?.performClick(nil)
    statusItem?.menu = nil
  }

  @objc private func openSettings() {
    session.openSettings()
    show(fromGrok: false)
  }

  @objc private func togglePop() {
    session.setPopOnThink(!session.popOnThink)
  }

  @objc private func toggleLogin() {
    if #available(macOS 13.0, *) {
      let service = SMAppService.mainApp
      do {
        if service.status == .enabled {
          try service.unregister()
        } else {
          try service.register()
        }
      } catch {
        NSLog("kanthropic login item: \(error.localizedDescription)")
      }
    }
  }

  @objc private func reinstallHooks() {
    GrokHooks.installIfNeeded()
  }

  @objc private func openMenuBarSettings() {
    let urls = [
      "x-apple.systempreferences:com.apple.MenuBar-Settings.extension",
      "x-apple.systempreferences:com.apple.ControlCenter-Settings.extension",
    ]
    for s in urls {
      if let url = URL(string: s), NSWorkspace.shared.open(url) { return }
    }
  }

  @objc private func resetScript() {
    let alert = NSAlert()
    alert.messageText = "Reset \(session.script)?"
    alert.informativeText = "Forgets every card in this script. Katakana and hiragana are independent."
    alert.addButton(withTitle: "Reset")
    alert.addButton(withTitle: "Cancel")
    alert.alertStyle = .warning
    NSApp.activate(ignoringOtherApps: true)
    guard alert.runModal() == .alertFirstButtonReturn else { return }
    session.resetCurrentScript()
  }

  private static var loginEnabled: Bool {
    if #available(macOS 13.0, *) {
      return SMAppService.mainApp.status == .enabled
    }
    return false
  }
}
