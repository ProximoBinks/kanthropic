import SwiftUI

struct ChartCell: Identifiable {
  let id: String
  let empty: Bool
  let glyph: String
  let romaji: String
  let status: String
}

struct ChartSection: Identifiable {
  let id: String
  let label: String
  let rows: [[ChartCell]]

  @MainActor
  static func parse(_ d: [String: Any]) -> ChartSection? {
    guard let id = Engine.string(d["id"]), let label = Engine.string(d["label"]) else { return nil }
    let rowsRaw = d["rows"] as? [[Any]] ?? []
    var rows: [[ChartCell]] = []
    for (r, row) in rowsRaw.enumerated() {
      var cells: [ChartCell] = []
      for (c, item) in row.enumerated() {
        let dict = item as? [String: Any] ?? [:]
        let empty = Engine.bool(dict["empty"])
        let glyph = Engine.string(dict["glyph"]) ?? ""
        cells.append(ChartCell(
          id: empty ? "\(id)-\(r)-\(c)" : "\(id)-\(glyph)-\(c)",
          empty: empty,
          glyph: glyph,
          romaji: Engine.string(dict["romaji"]) ?? "",
          status: Engine.string(dict["status"]) ?? "new"
        ))
      }
      rows.append(cells)
    }
    return ChartSection(id: id, label: label, rows: rows)
  }
}

struct ChartView: View {
  @Environment(\.panelScale) var scale
  @EnvironmentObject var session: Session
  @Environment(\.colorScheme) var scheme
  @State private var hoverId: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      legend
        .padding(.bottom, 6 * scale)
      Text("tap a row to drill it")
        .font(.system(size: 10 * scale))
        .foregroundColor(Ink.mute(scheme))
        .padding(.bottom, 10 * scale)
      ScrollView {
        VStack(alignment: .leading, spacing: 18 * scale) {
          ForEach(session.chart) { section in
            VStack(alignment: .leading, spacing: 6 * scale) {
              let family = glyphs(in: section.rows)
              rowButton(id: "s-\(section.id)", glyphs: family, help: "drill \(section.label)") {
                HStack {
                  Text(section.label)
                    .font(Ink.ui(scale))
                    .tracking(1.2 * scale)
                    .textCase(.uppercase)
                    .foregroundColor(hoverId == "s-\(section.id)" ? Ink.gold : Ink.mute(scheme))
                  Spacer(minLength: 0)
                  Image(systemName: "play.fill")
                    .font(.system(size: 7 * scale, weight: .semibold))
                    .foregroundColor(Ink.gold.opacity(hoverId == "s-\(section.id)" ? 0.9 : 0.45))
                }
              }
              ForEach(Array(section.rows.enumerated()), id: \.offset) { idx, row in
                let id = "\(section.id)-\(idx)"
                let rowGlyphs = glyphs(in: [row])
                rowButton(id: id, glyphs: rowGlyphs, help: "drill this row") {
                  HStack(spacing: 4 * scale) {
                    ForEach(row) { cell in
                      chartCell(cell)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "play.fill")
                      .font(.system(size: 7 * scale, weight: .semibold))
                      .foregroundColor(Ink.gold.opacity(hoverId == id ? 0.9 : 0.4))
                      .frame(width: 10 * scale)
                  }
                }
              }
            }
          }
        }
        .padding(.bottom, 8 * scale)
      }
    }
    .onAppear { session.refreshChart() }
  }

  private func glyphs(in rows: [[ChartCell]]) -> [String] {
    rows.flatMap { $0.compactMap { $0.empty ? nil : $0.glyph } }
  }

  private func rowButton<L: View>(id: String, glyphs: [String], help: String, @ViewBuilder label: () -> L) -> some View {
    Button {
      session.drillChartGlyphs(glyphs)
    } label: {
      label()
        .padding(.vertical, 2 * scale)
        .padding(.horizontal, 2 * scale)
        .background(
          RoundedRectangle(cornerRadius: 5 * scale)
            .fill(hoverId == id ? Ink.gold.opacity(0.08) : Color.clear)
        )
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .help(glyphs.isEmpty ? "" : help)
    .disabled(glyphs.isEmpty)
    .onHover { hoverId = $0 ? id : (hoverId == id ? nil : hoverId) }
  }

  private var legend: some View {
    HStack(spacing: 10 * scale) {
      legendDot("new", Ink.mute(scheme).opacity(0.45))
      legendDot("learning", Ink.gold)
      legendDot("due", Ink.miss)
      legendDot("mastered", Ink.ok)
      Spacer()
      Text("\(session.mastered)/\(session.total)")
        .font(.system(size: 11 * scale, weight: .medium, design: .monospaced))
        .foregroundColor(Ink.mute(scheme))
    }
  }

  private func legendDot(_ label: String, _ color: Color) -> some View {
    HStack(spacing: 4 * scale) {
      Circle().fill(color).frame(width: 6 * scale, height: 6 * scale)
      Text(label)
        .font(.system(size: 10 * scale))
        .foregroundColor(Ink.mute(scheme))
    }
  }

  private func chartCell(_ cell: ChartCell) -> some View {
    let color = statusColor(cell.status)
    return ZStack {
      RoundedRectangle(cornerRadius: 4 * scale)
        .stroke(cell.empty ? Color.clear : color.opacity(cell.status == "new" ? 0.25 : 0.85), lineWidth: 1 * scale)
        .background(
          RoundedRectangle(cornerRadius: 4 * scale)
            .fill(cell.empty ? Color.clear : color.opacity(cell.status == "mastered" ? 0.16 : 0.06))
        )
      if !cell.empty {
        Text(cell.glyph)
          .font(.kana(session.glyphFontID, size: 18 * scale))
          .foregroundColor(cell.status == "new" ? Ink.mute(scheme).opacity(0.55) : Ink.glyph(scheme))
      }
    }
    .frame(width: 56 * scale, height: 36 * scale)
    .help(cell.empty ? "" : "\(cell.glyph)  \(cell.romaji)  ·  \(cell.status)")
  }

  private func statusColor(_ status: String) -> Color {
    switch status {
    case "mastered": return Ink.ok
    case "due": return Ink.miss
    case "learning": return Ink.gold
    default: return Ink.mute(scheme)
    }
  }
}
