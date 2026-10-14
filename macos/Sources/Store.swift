import Foundation
import Darwin

/// ~/.kanthropic/progress.json — same file the CLI uses.
enum Store {
  static var dir: String { NSHomeDirectory() + "/.kanthropic" }
  static var progressPath: String { dir + "/progress.json" }
  static var stateDir: String { dir + "/state" }
  static var grokHookScript: String { dir + "/grok-hook.sh" }
  static var grokHookSpec: String { NSHomeDirectory() + "/.grok/hooks/kanthropic.json" }

  static func empty() -> [String: Any] {
    [
      "version": 1,
      "config": [
        "script": "hiragana",
        "frontMs": 2600,
        "backMs": 1700,
        "image": "auto",
        "autoAdvance": true,
        "continuous": false,
        "checkinEvery": 3,
        "popOnThink": true,
        "glyphFont": GlyphTypeface.fallback,
      ] as [String: Any],
      "cards": [:] as [String: Any],
      "learned": [] as [String],
      "learnedMigrated": true,
      "rote": [] as [String],
      "roteKind": "",
      "dakutenStreaks": [:] as [String: Any],
    ]
  }

  static func load() -> [String: Any] {
    let url = URL(fileURLWithPath: progressPath)
    guard let data = try? Data(contentsOf: url),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return empty() }
    var store = empty()
    for (k, v) in obj { store[k] = v }
    return store
  }

  static func save(_ store: [String: Any]) {
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    guard let data = try? JSONSerialization.data(withJSONObject: store, options: [.prettyPrinted, .sortedKeys])
    else { return }
    let tmp = progressPath + ".tmp-\(ProcessInfo.processInfo.processIdentifier)-\(Int(Date().timeIntervalSince1970 * 1000))"
    do {
      try data.write(to: URL(fileURLWithPath: tmp), options: .atomic)
      if rename(tmp, progressPath) != 0 {
        try? FileManager.default.removeItem(atPath: tmp)
      }
    } catch {
      try? FileManager.default.removeItem(atPath: tmp)
    }
  }

  @discardableResult
  static func update(_ mutate: (inout [String: Any]) -> Void) -> [String: Any] {
    let lock = progressPath + ".lock"
    let deadline = Date().timeIntervalSince1970 + 0.5
    var held = false
    while !held && Date().timeIntervalSince1970 <= deadline {
      if mkdir(lock, 0o755) == 0 {
        held = true
      } else {
        var st = stat()
        if stat(lock, &st) == 0 {
          let age = Date().timeIntervalSince1970 - Double(st.st_mtimespec.tv_sec)
          if age > 2 {
            rmdir(lock)
            continue
          }
        }
        usleep(25_000)
      }
    }
    defer { if held { rmdir(lock) } }
    var store = load()
    mutate(&store)
    save(store)
    return store
  }

  static func popOnThink() -> Bool {
    let cfg = load()["config"] as? [String: Any] ?? [:]
    if let b = cfg["popOnThink"] as? Bool { return b }
    if let n = cfg["popOnThink"] as? NSNumber { return n.boolValue }
    return true
  }

  static func setPopOnThink(_ on: Bool) {
    update { store in
      var cfg = store["config"] as? [String: Any] ?? [:]
      cfg["popOnThink"] = on
      store["config"] = cfg
    }
  }

  static func setScript(_ script: String) {
    update { store in
      var cfg = store["config"] as? [String: Any] ?? [:]
      cfg["script"] = script
      store["config"] = cfg
    }
  }

  static func glyphFont() -> String {
    let cfg = load()["config"] as? [String: Any] ?? [:]
    return GlyphTypeface.resolved(cfg["glyphFont"] as? String)
  }

  static func setGlyphFont(_ id: String) {
    update { store in
      var cfg = store["config"] as? [String: Any] ?? [:]
      cfg["glyphFont"] = id
      store["config"] = cfg
    }
  }
}
