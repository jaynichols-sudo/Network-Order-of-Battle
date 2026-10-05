import WidgetKit
import SwiftUI

struct HomeEntry: TimelineEntry {
    let date: Date
    let glance: Glance
    var day: String { Day.fmt.string(from: date) }
    var waiting: Int { glance.waiting }
    var due: Int { glance.dueNow(on: day) }
}

struct HomeProvider: TimelineProvider {
    func placeholder(in context: Context) -> HomeEntry {
        HomeEntry(date: Date(), glance: Glance(gen: "", waiting: 3, cold: 2, dues: [Day.today], nextName: "Alex Morgan", nextWhy: "wrote 2 days ago", sample: false,
                                               next: [Glance.Item(k: "a", n: "Alex Morgan", why: "Wrote 2 days ago", kind: "reply"),
                                                      Glance.Item(k: "b", n: "Dana Flynn", why: "Wrote 5 days ago", kind: "reply"),
                                                      Glance.Item(k: "c", n: "Rebecca Holt", why: "Follow up today", kind: "due")]))
    }

    func getSnapshot(in context: Context, completion: @escaping (HomeEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : HomeEntry(date: Date(), glance: GlanceStore.load() ?? .empty))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HomeEntry>) -> Void) {
        let g = GlanceStore.load() ?? .empty
        let now = Date()
        var entries = [HomeEntry(date: now, glance: g)]
        var day = Calendar.current.startOfDay(for: now)
        for _ in 0..<3 {
            day = Calendar.current.date(byAdding: .day, value: 1, to: day) ?? day
            entries.append(HomeEntry(date: day, glance: g))
        }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(3 * 3600))))
    }
}

private func personURL(_ k: String) -> URL {
    URL(string: "bearings://person/" + (k.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? k)) ?? URL(string: "bearings://home")!
}

struct HomeWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: HomeEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "location.north.fill").font(.system(size: 10, weight: .bold))
                    Text("\(entry.waiting + entry.due)").font(.system(size: 20, weight: .semibold, design: .rounded))
                }
            }
            .widgetAccentable()
        case .accessoryInline:
            Text(entry.waiting + entry.due == 0 ? "Bearings: all caught up" : "\(entry.waiting) to reply · \(entry.due) to follow up")
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text("Bearings").font(.headline).widgetAccentable()
                Text(entry.waiting + entry.due == 0 ? "All caught up" : "\(entry.waiting) to reply · \(entry.due) due")
                if let n = entry.glance.nextName { Text(n).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .systemSmall:
            small
        default:
            medium
        }
    }

    private var counts: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Image(systemName: "location.north.circle.fill").foregroundStyle(Palette.amber)
                Text("Bearings").font(.custom("Geist-SemiBold", size: 13))
            }
            Spacer(minLength: 0)
            Link(destination: URL(string: "bearings://filter/waiting")!) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("\(entry.waiting)").font(.custom("Geist-Bold", size: 30)).contentTransition(.numericText())
                    Text("to reply").font(.custom("Geist-Medium", size: 12)).foregroundStyle(.secondary)
                }
            }
            Link(destination: URL(string: "bearings://filter/due")!) {
                Text("\(entry.due) follow-up\(entry.due == 1 ? "" : "s") due").font(.custom("Geist-Medium", size: 12)).foregroundStyle(entry.due > 0 ? Palette.violet : .secondary)
            }
        }
    }

    private var small: some View {
        counts
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .widgetURL(entry.glance.next?.first.map { personURL($0.k) } ?? URL(string: "bearings://home"))
    }

    private var medium: some View {
        HStack(alignment: .top, spacing: 14) {
            counts.frame(width: 96, alignment: .leading)
            VStack(alignment: .leading, spacing: 7) {
                let items = Array((entry.glance.next ?? []).prefix(3))
                if items.isEmpty {
                    Spacer()
                    Text(entry.glance.gen.isEmpty ? "Open Bearings to load your network." : "You’re all caught up.")
                        .font(.custom("Geist-Medium", size: 14)).foregroundStyle(.secondary)
                    Spacer()
                } else {
                    ForEach(items, id: \.self) { it in
                        Link(destination: personURL(it.k)) {
                            HStack(spacing: 8) {
                                Circle().fill(it.kind == "reply" ? Palette.coral : Palette.violet).frame(width: 7, height: 7)
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(it.n).font(.custom("Geist-SemiBold", size: 14)).lineLimit(1)
                                    Text(it.why).font(.custom("Geist-Regular", size: 12)).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

@main
struct BearingsWidgetBundle: WidgetBundle {
    var body: some Widget {
        BearingsHomeWidgets()
        #if os(iOS) && !targetEnvironment(macCatalyst)
        TripLiveActivity()
        #endif
    }
}

struct BearingsHomeWidgets: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BearingsHome", provider: HomeProvider()) { entry in
            HomeWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Bearings")
        .description("Who’s waiting on a reply and which follow-ups are due.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
