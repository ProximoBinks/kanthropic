import Foundation
import JavaScriptCore

/// Thin JSContext wrapper around the bundled `engine.js` (the same FSRS /
/// kana / flow code the CLI uses). Persistence stays in Swift.
@MainActor
final class Engine {
  static let shared = Engine()

  private let ctx = JSContext()!
  private(set) var loadError: String?

  private init() {
    ctx.exceptionHandler = { [weak self] _, err in
      self?.loadError = err?.toString()
    }
    let url = Bundle.main.url(forResource: "engine", withExtension: "js")
    guard let url else {
      loadError = "engine.js missing from app bundle"
      return
    }
    do {
      let src = try String(contentsOf: url, encoding: .utf8)
      ctx.evaluateScript(src)
    } catch {
      loadError = error.localizedDescription
    }
  }

  /// JSON-round-trip invoke. Returns nil on JS exception / missing engine.
  @discardableResult
  func invoke(_ op: String, _ payload: [String: Any] = [:]) -> Any? {
    if let loadError { return ["error": loadError] }
    let script = "JSON.stringify(Kanthropic.invoke(\(Self.jsonLit(op)), \(Self.jsonLit(payload))))"
    guard let raw = ctx.evaluateScript(script)?.toString(),
          raw != "undefined",
          let data = raw.data(using: .utf8)
    else { return nil }
    return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
  }

  static func jsonLit(_ value: Any?) -> String {
    guard let value else { return "null" }
    if value is NSNull { return "null" }
    let wrapped = [value]
    if JSONSerialization.isValidJSONObject(wrapped),
       let data = try? JSONSerialization.data(withJSONObject: wrapped, options: []),
       let s = String(data: data, encoding: .utf8),
       s.count >= 2 {
      return String(s.dropFirst().dropLast())
    }
    return "null"
  }

  static func bool(_ v: Any?) -> Bool {
    if let b = v as? Bool { return b }
    if let n = v as? NSNumber { return n.boolValue }
    return false
  }

  static func dict(_ v: Any?) -> [String: Any]? {
    v as? [String: Any]
  }

  static func string(_ v: Any?) -> String? {
    v as? String
  }
}
