import AppKit
import SwiftUI
import CoreText

/// PostScript names for faces that can draw kana. Default is gothic — Mincho
/// is the brushy one that reads as cursive at flashcard size.
struct GlyphTypeface: Identifiable, Equatable {
  let id: String
  let label: String
  let detail: String

  var installed: Bool { NSFont(name: id, size: 12) != nil }

  static let fallback = "HiraginoSans-W5"

  static let catalog: [GlyphTypeface] = [
    GlyphTypeface(id: "HiraginoSans-W5", label: "Gothic", detail: "Hiragino Sans — print, easy to read"),
    GlyphTypeface(id: "HiraKakuProN-W3", label: "Textbook", detail: "Kaku Gothic — schoolbook"),
    GlyphTypeface(id: "HiraMaruProN-W4", label: "Rounded", detail: "Maru Gothic"),
    GlyphTypeface(id: "HiraMinProN-W3", label: "Mincho", detail: "serif — the brushy one"),
    GlyphTypeface(id: "NotoSansJP-Thin_Regular", label: "Noto Sans", detail: "Noto Sans JP"),
    GlyphTypeface(id: "NotoSansJP-Thin", label: "Noto Sans (bundled)", detail: "ships with kanthropic"),
  ]

  static var available: [GlyphTypeface] { catalog.filter(\.installed) }

  static func resolved(_ id: String?) -> String {
    if let id, NSFont(name: id, size: 12) != nil { return id }
    if NSFont(name: fallback, size: 12) != nil { return fallback }
    return available.first?.id ?? fallback
  }

  static func registerBundled() {
    guard let url = Bundle.main.url(forResource: "kana", withExtension: "ttf") else { return }
    CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
  }
}

extension Font {
  static func kana(_ postScript: String, size: CGFloat) -> Font {
    Font.custom(GlyphTypeface.resolved(postScript), size: size)
  }
}
