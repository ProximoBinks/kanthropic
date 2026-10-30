import Foundation
import Combine

/// Cloud sync + account for the menu bar app. Same protocol as `kanthropic sync`
/// and the PWA: the diff/merge runs in engine.js (src/core/sync.mjs); this file
/// moves bytes and owns ~/.kanthropic/sync.json (shared with the CLI).
@MainActor
final class Cloud: ObservableObject {
  static let shared = Cloud()

  /// The hosted backend; matches DEFAULT_CONVEX_URL / DEFAULT_WEB_URL in src/core/cloud.mjs.
  static let defaultConvexURL = "https://impressive-ptarmigan-803.convex.cloud"
  static let defaultWebURL = "https://kanthropic.vercel.app"

  @Published private(set) var email: String?
  @Published private(set) var enabled = false
  @Published private(set) var syncing = false
  @Published private(set) var lastSync: Date?
  @Published private(set) var lastError: String?

  private var again = false
  private var timer: Timer?
  /// Called on the main actor when a sync pulled in another device's changes.
  var onRemoteChange: (() -> Void)?

  static var configPath: String { Store.dir + "/sync.json" }
  static var basePath: String { Store.dir + "/sync-base.json" }

  private static func readJSON(_ path: String) -> [String: Any]? {
    guard let data = FileManager.default.contents(atPath: path) else { return nil }
    return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  }

  private static func config() -> (url: String, key: String, email: String?)? {
    guard let c = readJSON(configPath),
          let url = c["convexUrl"] as? String, let key = c["key"] as? String
    else { return nil }
    return (url, key, c["email"] as? String)
  }

  /// Re-read sync.json — the CLI may have signed in or out since we last looked.
  func refresh() {
    let cfg = Self.config()
    enabled = cfg != nil
    email = cfg?.email
  }

  /// Sync now and every few minutes while the app runs.
  func start() {
    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: 180, repeats: true) { _ in
      Task { @MainActor in Cloud.shared.sync() }
    }
    sync()
  }

  func sync() {
    refresh()
    guard let cfg = Self.config() else { return }
    if syncing { again = true; return }
    syncing = true
    let base: Any = Self.readJSON(Self.basePath) ?? ["rev": 0, "flat": [:] as [String: Any]]
    guard let prep = Engine.dict(Engine.shared.invoke("syncPrepare", ["base": base, "store": Store.load()])),
          prep["error"] == nil
    else { syncing = false; return }
    let sent = prep["sent"] ?? [:]
    let args: [String: Any] = ["key": cfg.key, "since": prep["since"] ?? 0, "changes": prep["changes"] ?? []]

    Self.call(cfg.url, kind: "mutation", path: "sync:sync", args: args) { value, error in
      defer {
        self.syncing = false
        if self.again { self.again = false; self.sync() }
      }
      guard let value else {
        self.lastError = error ?? "couldn't reach the sync server"
        return
      }
      var changed = false
      var nextBase: Any?
      Store.update { s in
        guard let r = Engine.dict(Engine.shared.invoke("syncFinish", [
          "base": base, "sent": sent, "reply": value, "store": s,
        ])), let store = r["store"] as? [String: Any] else { return }
        s = store
        changed = Engine.bool(r["changed"])
        nextBase = r["base"]
      }
      if let nextBase, let data = try? JSONSerialization.data(withJSONObject: nextBase) {
        try? data.write(to: URL(fileURLWithPath: Self.basePath), options: .atomic)
      }
      self.lastSync = Date()
      self.lastError = nil
      if changed { self.onRemoteChange?() }
    }
  }

  /// Sign in, or create an account that keeps this Mac's current progress.
  /// `done` gets nil on success or a readable error.
  func authenticate(signup: Bool, email: String, password: String, done: @escaping (String?) -> Void) {
    let prev = Self.config()
    let url = prev?.url ?? Self.defaultConvexURL
    var args: [String: Any] = ["email": email, "password": password]
    if signup, let key = prev?.key { args["key"] = key }
    Self.call(url, kind: "action", path: signup ? "accountsNode:signup" : "accountsNode:login", args: args) { value, error in
      guard let r = value as? [String: Any], let key = r["key"] as? String else {
        done(error ?? "sign in failed")
        return
      }
      let previous = Self.readJSON(Self.configPath) ?? [:]
      if prev?.key != key {
        // A different space: our base describes someone else's data.
        try? #"{"rev":0,"flat":{}}"#.write(toFile: Self.basePath, atomically: true, encoding: .utf8)
      }
      let cfg: [String: Any] = [
        "convexUrl": url,
        "key": key,
        "email": r["email"] as? String ?? email,
        "webUrl": previous["webUrl"] as? String ?? Self.defaultWebURL,
      ]
      if let data = try? JSONSerialization.data(withJSONObject: cfg, options: [.prettyPrinted, .sortedKeys]) {
        try? FileManager.default.createDirectory(atPath: Store.dir, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: Self.configPath, contents: data, attributes: [.posixPermissions: 0o600])
      }
      done(nil)
      self.sync()
    }
  }

  /// Stop syncing this Mac. Local progress stays.
  func signOut() {
    try? FileManager.default.removeItem(atPath: Self.configPath)
    try? FileManager.default.removeItem(atPath: Self.basePath)
    lastSync = nil
    lastError = nil
    refresh()
  }

  /// POST a Convex function call; completes on the main actor with the value or an error message.
  private static func call(_ base: String, kind: String, path: String, args: [String: Any],
                           done: @escaping @MainActor (Any?, String?) -> Void) {
    guard let url = URL(string: base + "/api/" + kind) else { done(nil, "bad sync URL"); return }
    var req = URLRequest(url: url, timeoutInterval: 20)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: ["path": path, "args": args, "format": "json"])
    URLSession.shared.dataTask(with: req) { data, _, err in
      let reply = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
      Task { @MainActor in
        if let reply, reply["status"] as? String == "success" {
          done(reply["value"] ?? NSNull(), nil)
          return
        }
        // Convex wraps thrown errors as "…Uncaught Error: <ours>\n    at …".
        var msg = reply?["errorMessage"] as? String ?? err?.localizedDescription ?? "request failed"
        if let r = msg.range(of: "Uncaught Error: ") {
          msg = String(msg[r.upperBound...].prefix { $0 != "\n" })
        }
        NSLog("kanthropic sync: \(msg)")
        done(nil, msg)
      }
    }.resume()
  }
}
