import Foundation
import AppKit
import Darwin

/// Install ~/.grok/hooks/kanthropic.json so Grok Build pings us while it thinks.
enum GrokHooks {
  static func installIfNeeded() {
    let fm = FileManager.default
    try? fm.createDirectory(atPath: Store.dir, withIntermediateDirectories: true)
    try? fm.createDirectory(atPath: (Store.grokHookSpec as NSString).deletingLastPathComponent, withIntermediateDirectories: true)

    if let src = Bundle.main.url(forResource: "grok-hook", withExtension: "sh") {
      let dest = URL(fileURLWithPath: Store.grokHookScript)
      try? fm.removeItem(at: dest)
      try? fm.copyItem(at: src, to: dest)
      try? fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: dest.path)
    }

    let command = "sh \(Self.jsonString(Store.grokHookScript))"
    let run: [String: Any] = ["type": "command", "command": command, "timeout": 5]
    let group: [String: Any] = ["hooks": [run]]
    let spec: [String: Any] = [
      "kanthropic": "kanthropic",
      "hooks": [
        "UserPromptSubmit": [group],
        "Stop": [group],
        "StopFailure": [group],
        "StopCancelled": [group],
        "SessionEnd": [group],
        "Notification": [["matcher": "idle_prompt", "hooks": [run]]],
      ] as [String: Any],
    ]
    if let data = try? JSONSerialization.data(withJSONObject: spec, options: [.prettyPrinted]),
       let text = String(data: data, encoding: .utf8) {
      try? (text + "\n").write(toFile: Store.grokHookSpec, atomically: true, encoding: .utf8)
    }
  }

  static func uninstall() {
    try? FileManager.default.removeItem(atPath: Store.grokHookSpec)
  }

  static func installed() -> Bool {
    guard let raw = try? String(contentsOfFile: Store.grokHookSpec, encoding: .utf8) else { return false }
    return raw.contains("kanthropic") && raw.contains("grok-hook.sh")
  }

  private static func jsonString(_ s: String) -> String {
    let escaped = s
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")
    return "\"\(escaped)\""
  }
}

/// Watch ~/.kanthropic/state and fire on idle → thinking edges only
/// (never re-pop on every tool call — that was the Claude tmux flake).
final class GrokWatch {
  private var source: DispatchSourceFileSystemObject?
  private var timer: DispatchSourceTimer?
  private var dirFD: Int32 = -1
  private var lastThinking = false
  private let onChange: (Bool) -> Void

  init(onChange: @escaping (Bool) -> Void) {
    self.onChange = onChange
    try? FileManager.default.createDirectory(atPath: Store.stateDir, withIntermediateDirectories: true)
    lastThinking = Self.anyThinking()
    start()
  }

  deinit {
    source?.cancel()
    timer?.cancel()
    if dirFD >= 0 { close(dirFD) }
  }

  private func start() {
    dirFD = open(Store.stateDir, O_EVTONLY)
    if dirFD >= 0 {
      let src = DispatchSource.makeFileSystemObjectSource(
        fileDescriptor: dirFD,
        eventMask: [.write, .extend, .rename, .delete, .attrib],
        queue: DispatchQueue.global(qos: .utility)
      )
      src.setEventHandler { [weak self] in self?.rescan() }
      src.setCancelHandler { [weak self] in
        if let fd = self?.dirFD, fd >= 0 { close(fd) }
        self?.dirFD = -1
      }
      src.resume()
      source = src
    }
    let t = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
    t.schedule(deadline: .now() + 0.35, repeating: 0.35)
    t.setEventHandler { [weak self] in self?.rescan() }
    t.resume()
    timer = t
  }

  private func rescan() {
    let thinking = Self.anyThinking()
    guard thinking != lastThinking else { return }
    lastThinking = thinking
    DispatchQueue.main.async { self.onChange(thinking) }
  }

  static func anyThinking() -> Bool {
    let now = Date().timeIntervalSince1970
    guard let files = try? FileManager.default.contentsOfDirectory(atPath: Store.stateDir) else { return false }
    for f in files where f.hasSuffix(".json") {
      let path = (Store.stateDir as NSString).appendingPathComponent(f)
      guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            obj["state"] as? String == "thinking"
      else { continue }
      let at: Double
      if let n = obj["at"] as? NSNumber { at = n.doubleValue }
      else if let d = obj["at"] as? Double { at = d }
      else { at = now }
      // Same 10-minute stale window as the CLI.
      if now - at < 600 { return true }
    }
    return false
  }
}
