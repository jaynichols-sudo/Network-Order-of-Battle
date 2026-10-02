import WidgetKit
import SwiftUI

struct GlanceEntry: TimelineEntry {
    let date: Date
    let glance: Glance
    var day: String { Day.fmt.string(from: date) }
    var waiting: Int { glance.waiting }
    var due: Int { glance.dueNow(on: day) }
}

struct GlanceProvider: TimelineProvider {
    func placeholder(in context: Context) -> GlanceEntry {
        GlanceEntry(date: Date(), glance: Glance(gen: "", waiting: 3, cold: 2, dues: [Day.today, Day.today], nextName: "Alex Morgan", nextWhy: "wrote 2 days ago", sample: false))
    }

    func getSnapshot(in context: Context, completion: @escaping (GlanceEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : GlanceEntry(date: Date(), glance: GlanceStore.load() ?? .empty))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<GlanceEntry>) -> Void) {
        let g = GlanceStore.load() ?? .empty
        let now = Date()
        var entries = [GlanceEntry(date: now, glance: g)]
        // follow-ups come due at midnight, so add an entry for each of the next few days
        let cal = Calendar.current
        var day = cal.startOfDay(for: now)
        for _ in 0..<3 {
            day = cal.date(byAdding: .day, value: 1, to: day) ?? day
            entries.append(GlanceEntry(date: day, glance: g))
        }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(3 * 3600))))
    }
}

struct GlanceView: View {
    @Environment(\.widgetFamily) private var family
    let entry: GlanceEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "location.north.fill").font(.system(size: 11, weight: .bold))
                    Text("\(entry.waiting + entry.due)").font(.system(size: 20, weight: .semibold, design: .rounded))
                }
            }
            .widgetAccentable()
        case .accessoryCorner:
            Image(systemName: "arrowshape.turn.up.left.fill")
                .font(.system(size: 20, weight: .semibold))
                .widgetLabel { Text("\(entry.waiting) to reply, \(entry.due) due") }
        case .accessoryInline:
            Text(entry.waiting + entry.due == 0 ? "Bearings: all caught up" : "\(entry.waiting) to reply · \(entry.due) to follow up")
        default:
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Image(systemName: "location.north.circle.fill")
                    Text("Bearings").fontWeight(.semibold)
                }
                .font(.headline)
                .widgetAccentable()
                if entry.waiting + entry.due == 0 {
                    Text("All caught up").font(.body)
                } else {
                    Text("\(entry.waiting) to reply · \(entry.due) due").font(.body)
                    if let n = entry.glance.nextName {
                        Text("\(n), \(entry.glance.nextWhy ?? "")").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

@main
struct BearingsWidgets: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BearingsGlance", provider: GlanceProvider()) { entry in
            GlanceView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Bearings")
        .description("Who’s waiting on a reply and which follow-ups are due.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
}
