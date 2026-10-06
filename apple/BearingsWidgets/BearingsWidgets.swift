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

/// Calm cards on the watch face: amber for people waiting on you, night purple behind,
/// and the same "N people to get back to" headline as the phone widgets.
private enum Face {
    static let amber = Color(.sRGB, red: 1, green: 0.69, blue: 0.125, opacity: 1)
    static let violet = Color(.sRGB, red: 0.66, green: 0.57, blue: 1, opacity: 1)
}

struct GlanceView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var mode
    let entry: GlanceEntry

    private var total: Int { entry.waiting + entry.due }
    private var headline: String { total == 0 ? "All caught up" : "\(total) \(total == 1 ? "person" : "people") to get back to" }
    private var tint: Color { mode == .fullColor ? Face.amber : .primary }

    var body: some View {
        switch family {
        case .accessoryCircular:
            Gauge(value: Double(min(total, 10)), in: 0...10) {
                Image(systemName: "location.north.fill")
            } currentValueLabel: {
                Text("\(total)").font(.system(.title3, design: .rounded).weight(.semibold))
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .tint(tint)
            .widgetAccentable()
            .accessibilityLabel(headline)
        case .accessoryCorner:
            Text("\(total)")
                .font(.system(size: 22, weight: .semibold, design: .rounded))
                .foregroundStyle(tint)
                .widgetAccentable()
                .widgetLabel {
                    Gauge(value: Double(min(entry.waiting, 10)), in: 0...10) { Text("") }
                        .tint(tint)
                }
                .accessibilityLabel(headline)
        case .accessoryInline:
            Label(total == 0 ? "All caught up" : "\(total) to get back to", systemImage: "location.north.fill")
        default:
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Image(systemName: "location.north.fill").foregroundStyle(tint)
                    Text("BEARINGS").font(.system(.caption2, design: .rounded).weight(.bold)).tracking(0.6)
                }
                .widgetAccentable()
                Text(headline)
                    .font(.system(.headline, design: .rounded).weight(.semibold))
                    .lineLimit(2).minimumScaleFactor(0.8)
                if total > 0 {
                    if let n = entry.glance.nextName {
                        Text("\(n), \(entry.glance.nextWhy ?? "")")
                            .font(.system(.caption, design: .rounded)).foregroundStyle(.secondary).lineLimit(1)
                    } else {
                        Text("\(entry.waiting) waiting · \(entry.due) due")
                            .font(.system(.caption, design: .rounded)).foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
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
        .description("How many people to get back to, and who’s next.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
}
