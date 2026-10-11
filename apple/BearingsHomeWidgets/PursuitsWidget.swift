import WidgetKit
import SwiftUI

// "Pursuits due": the next one to three open pursuits, when each is due and how many of
// its seats you know. The app writes a small snapshot (PursuitGlanceStore) whenever
// pursuits change; the widget never runs the engine.

struct PursuitsEntry: TimelineEntry {
    let date: Date
    let glance: PursuitGlance
}

struct PursuitsProvider: TimelineProvider {
    static let sample = PursuitGlance(gen: "preview", open: 3, items: [
        .init(id: "a", name: "DISA OT gateway pilot", agency: "DISA", due: Day.plus(12), stage: "Pursuing", filled: 4, roles: 6),
        .init(id: "b", name: "NAVFAC SE BAA", agency: "NAVFAC Southeast", due: Day.plus(30), stage: "Proposal", filled: 2, roles: 6),
        .init(id: "c", name: "TVA substation pilot", agency: "Tennessee Valley Authority", due: "", stage: "Tracking", filled: 1, roles: 6),
    ])

    func placeholder(in context: Context) -> PursuitsEntry { PursuitsEntry(date: Date(), glance: Self.sample) }

    func getSnapshot(in context: Context, completion: @escaping (PursuitsEntry) -> Void) {
        let g = PursuitGlanceStore.load()
        completion(PursuitsEntry(date: Date(), glance: context.isPreview && (g?.items.isEmpty ?? true) ? Self.sample : (g ?? .empty)))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PursuitsEntry>) -> Void) {
        // "due in N days" changes at midnight, so add an entry for each of the next few days
        let g = PursuitGlanceStore.load() ?? .empty
        let now = Date()
        var entries = [PursuitsEntry(date: now, glance: g)]
        var day = Calendar.current.startOfDay(for: now)
        for _ in 0..<3 {
            day = Calendar.current.date(byAdding: .day, value: 1, to: day) ?? day
            entries.append(PursuitsEntry(date: day, glance: g))
        }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

private func pursuitURL(_ id: String?) -> URL {
    guard let id else { return URL(string: "bearings://pursuit")! }
    return URL(string: "bearings://pursuit/" + (id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id)) ?? URL(string: "bearings://pursuit")!
}

struct PursuitsWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    let entry: PursuitsEntry

    private var t: Calm.Tokens { Calm.tokens(scheme) }
    private var items: [PursuitGlance.Item] { entry.glance.items }

    var body: some View {
        switch family {
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                if let p = items.first {
                    Text(p.name).font(.headline).lineLimit(1).widgetAccentable()
                    Text(PursuitGlance.dueText(p.due, from: entry.date)).lineLimit(1)
                    Text("\(p.filled) of \(p.roles) seats known").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                } else {
                    Text("Pursuits").font(.headline).widgetAccentable()
                    Text("None open").foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(pursuitURL(items.first?.id))
        case .systemSmall:
            small
        default:
            medium
        }
    }

    private var header: some View {
        HStack(spacing: 5) {
            Image(systemName: "scope")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(t.primary)
                .widgetAccentable()
                .accessibilityHidden(true)
            Text("Pursuits due")
                .font(Calm.font(12, .medium, relativeTo: .caption))
                .foregroundStyle(t.text2)
                .lineLimit(1)
            Spacer(minLength: 0)
            if entry.glance.open > items.count {
                Text("\(entry.glance.open) open")
                    .font(Calm.font(11, .medium, relativeTo: .caption2))
                    .foregroundStyle(t.text3)
            }
        }
    }

    private var emptyText: String {
        entry.glance.gen.isEmpty ? "Open Bearings to load your pursuits." : "No open pursuits. Add one from the You tab."
    }

    private func dueColor(_ p: PursuitGlance.Item) -> Color {
        guard let d = Day.date(p.due) else { return t.text2 }
        let n = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: entry.date), to: d).day ?? 0
        return n <= 7 ? t.needs : t.text2
    }

    /// Seats as a row of small dots: filled for a known seat.
    private func seats(_ p: PursuitGlance.Item, size: CGFloat) -> some View {
        HStack(spacing: 3) {
            ForEach(0..<max(0, min(p.roles, 8)), id: \.self) { i in
                Circle()
                    .fill(i < p.filled ? t.good : t.soft)
                    .frame(width: size, height: size)
            }
        }
        .accessibilityHidden(true)
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if let p = items.first {
                Text(p.name)
                    .font(Calm.font(16, .bold, relativeTo: .headline))
                    .foregroundStyle(t.text)
                    .lineLimit(3)
                    .minimumScaleFactor(0.85)
                    .padding(.top, 6)
                if !p.agency.isEmpty {
                    Text(p.agency)
                        .font(Calm.font(11, .medium, relativeTo: .caption2))
                        .foregroundStyle(t.text2)
                        .lineLimit(1)
                        .padding(.top, 1)
                }
                Spacer(minLength: 4)
                Text(PursuitGlance.dueText(p.due, from: entry.date))
                    .font(Calm.font(13, .semibold, relativeTo: .footnote))
                    .foregroundStyle(dueColor(p))
                    .lineLimit(1)
                HStack(spacing: 6) {
                    seats(p, size: 6)
                    Text("\(p.filled)/\(p.roles) seats")
                        .font(Calm.font(11, .medium, relativeTo: .caption2))
                        .foregroundStyle(t.text2)
                        .lineLimit(1)
                }
                .padding(.top, 3)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(p.filled) of \(p.roles) seats known")
            } else {
                Spacer(minLength: 4)
                Text(emptyText)
                    .font(Calm.font(13, .medium, relativeTo: .footnote))
                    .foregroundStyle(t.text2)
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(pursuitURL(items.first?.id))
    }

    private var medium: some View {
        VStack(alignment: .leading, spacing: 6) {
            header
            VStack(alignment: .leading, spacing: 0) {
                if items.isEmpty {
                    Spacer(minLength: 0)
                    Text(emptyText)
                        .font(Calm.font(13, .medium, relativeTo: .footnote))
                        .foregroundStyle(t.text2)
                    Spacer(minLength: 0)
                } else {
                    ForEach(Array(items.prefix(3).enumerated()), id: \.element) { i, p in
                        if i > 0 { t.line.frame(height: 1) }
                        Link(destination: pursuitURL(p.id)) { row(p) }
                    }
                    Spacer(minLength: 0)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 2)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .calmCard(t)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(pursuitURL(nil))
    }

    private func row(_ p: PursuitGlance.Item) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                Text(p.name)
                    .font(Calm.font(13, .semibold, relativeTo: .subheadline))
                    .foregroundStyle(t.text)
                    .lineLimit(1)
                Text([PursuitGlance.dueText(p.due, from: entry.date), p.agency].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(Calm.font(11, relativeTo: .footnote))
                    .foregroundStyle(dueColor(p))
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(p.filled)/\(p.roles)")
                    .font(Calm.mono(12, relativeTo: .caption))
                    .foregroundStyle(p.filled >= 3 ? t.good : t.text)
                Text("seats")
                    .font(Calm.font(10, .medium, relativeTo: .caption2))
                    .foregroundStyle(t.text3)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(p.filled) of \(p.roles) seats known")
        }
        .padding(.vertical, 5)
    }
}

struct PursuitsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BearingsPursuits", provider: PursuitsProvider()) { entry in
            PursuitsWidgetView(entry: entry)
                .containerBackground(for: .widget) { CalmWidgetBackground() }
        }
        .configurationDisplayName("Pursuits due")
        .description("Your next pursuits, when each is due, and how many seats you know.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}
