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
        HomeEntry(date: Date(), glance: Glance(gen: "preview", waiting: 3, cold: 2, dues: [Day.today], nextName: "Alex Morgan", nextWhy: "wrote 2 days ago", sample: false,
                                               next: [Glance.Item(k: "a", n: "Alex Morgan", why: "Wrote 2 days ago", kind: "reply"),
                                                      Glance.Item(k: "b", n: "Dana Flynn", why: "Wrote 5 days ago", kind: "reply"),
                                                      Glance.Item(k: "c", n: "Rebecca Holt", why: "Follow up today", kind: "due")],
                                               jobs: 4, close: 12))
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

/// The Home Screen and Lock Screen widget in the "Calm cards" design: like Today, it leads
/// with how many people need you, then who they are with one action each, then the counts.
struct HomeWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    let entry: HomeEntry

    private var t: Calm.Tokens { Calm.tokens(scheme) }
    private var need: Int { entry.waiting + entry.due }
    private var items: [Glance.Item] { entry.glance.next ?? [] }
    private var headline: String {
        entry.glance.gen.isEmpty ? "Open Bearings to load your network." : Calm.needLine(need)
    }

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "location.north.fill").font(.system(size: 10, weight: .bold))
                    Text("\(need)").font(.system(size: 20, weight: .semibold, design: .rounded))
                }
            }
            .widgetAccentable()
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(need == 0 ? "Bearings, all caught up" : "Bearings, \(need) need you")
        case .accessoryInline:
            Text(need == 0 ? "Bearings: all caught up" : "\(entry.waiting) to reply · \(entry.due) to follow up")
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(need == 0 ? "All caught up" : "\(need) need\(need == 1 ? "s" : "") you")
                    .font(.headline)
                    .widgetAccentable()
                Text("\(entry.waiting) to reply · \(entry.due) due")
                if let n = entry.glance.nextName { Text(n).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .systemSmall:
            small
        case .systemLarge:
            large
        default:
            medium
        }
    }

    // MARK: pieces

    private func dateLine(long: Bool) -> some View {
        HStack(spacing: 5) {
            Image(systemName: "location.north.circle.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(t.primary)
                .widgetAccentable()
                .accessibilityHidden(true)
            Group {
                if long {
                    Text(entry.date, format: .dateTime.weekday(.wide).month(.wide).day())
                } else {
                    Text(entry.date, format: .dateTime.weekday(.wide))
                }
            }
            .font(Calm.font(12, .medium, relativeTo: .caption))
            .foregroundStyle(t.text2)
            .lineLimit(1)
        }
    }

    private func headlineText(_ size: CGFloat, lines: Int) -> some View {
        Text(headline)
            .font(Calm.font(size, .bold, relativeTo: .headline))
            .foregroundStyle(t.text)
            .lineLimit(lines)
            .minimumScaleFactor(0.8)
    }

    /// A number over its label. Amber is kept for "waiting on you".
    private func stat(_ n: Int, _ label: String, size: CGFloat, color: Color? = nil) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(n.formatted())
                .font(Calm.font(size, .bold, relativeTo: .title2))
                .foregroundStyle(color ?? t.text)
                .contentTransition(.numericText())
            Text(label)
                .font(Calm.font(11, .medium, relativeTo: .caption2))
                .foregroundStyle(t.text2)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }

    private func waitingStat(_ label: String) -> some View {
        Link(destination: URL(string: "bearings://filter/waiting")!) {
            stat(entry.waiting, label, size: 24, color: entry.waiting > 0 ? t.needs : nil)
        }
    }

    private func dueStat(_ size: CGFloat) -> some View {
        Link(destination: URL(string: "bearings://filter/due")!) {
            stat(entry.due, "follow up", size: size)
        }
    }

    @ViewBuilder private func jobsStat(_ size: CGFloat) -> some View {
        if let j = entry.glance.jobs {
            Link(destination: URL(string: "bearings://filter/jcw")!) {
                stat(j, "new jobs", size: size)
            }
        }
    }

    @ViewBuilder private func closeStat(_ size: CGFloat) -> some View {
        if let c = entry.glance.close, c > 0 {
            stat(c, "close", size: size)
        }
    }

    /// The people to get back to, each with one action, in a white card.
    private func peopleCard(limit: Int, roomy: Bool) -> some View {
        let list = Array(items.prefix(limit))
        return VStack(alignment: .leading, spacing: 0) {
            if roomy {
                Text("Needs you")
                    .font(Calm.font(15, .bold, relativeTo: .headline))
                    .foregroundStyle(t.text)
                    .padding(.top, 8)
                    .padding(.bottom, 2)
            }
            if list.isEmpty {
                Spacer(minLength: 0)
                Text(entry.glance.gen.isEmpty ? "Your network appears here once Bearings has opened." : "No one is waiting on you.")
                    .font(Calm.font(13, .medium, relativeTo: .footnote))
                    .foregroundStyle(t.text2)
                Spacer(minLength: 0)
            } else {
                ForEach(Array(list.enumerated()), id: \.element) { i, it in
                    if i > 0 { t.line.frame(height: 1) }
                    row(it, roomy: roomy)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, roomy ? 4 : 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .calmCard(t)
    }

    private func row(_ it: Glance.Item, roomy: Bool) -> some View {
        let reply = it.kind == "reply"
        let side: CGFloat = roomy ? 32 : 26
        return HStack(spacing: 8) {
            Link(destination: personURL(it.k)) {
                HStack(spacing: 8) {
                    Text(Calm.initials(it.n))
                        .font(Calm.font(roomy ? 12 : 10, .semibold, relativeTo: .caption2))
                        .foregroundStyle(reply ? t.needs : t.primary)
                        .frame(width: side, height: side)
                        .background(Circle().fill(reply ? t.needsSoft : t.soft))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(it.n)
                            .font(Calm.font(roomy ? 15 : 13, .semibold, relativeTo: .subheadline))
                            .foregroundStyle(t.text)
                            .lineLimit(1)
                        Text(it.why)
                            .font(Calm.font(roomy ? 13 : 11, relativeTo: .footnote))
                            .foregroundStyle(t.text2)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
            }
            if !entry.glance.sample {
                Button(intent: WidgetPersonIntent(k: it.k, action: reply ? "replied" : "done")) {
                    if roomy {
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark").font(.system(size: 10, weight: .bold))
                            Text(reply ? "Replied" : "Done").font(Calm.font(12, .semibold, relativeTo: .caption))
                        }
                        .padding(.horizontal, 10)
                        .frame(minHeight: 28)
                        .foregroundStyle(reply ? t.onPrimary : t.primary)
                        .background(Capsule().fill(reply ? t.primary : t.soft))
                    } else {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(reply ? t.onPrimary : t.primary)
                            .frame(width: 26, height: 26)
                            .background(Circle().fill(reply ? t.primary : t.soft))
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(reply ? "Mark \(it.n) replied" : "Mark \(it.n) done")
            }
        }
        .padding(.vertical, roomy ? 6 : 3)
    }

    // MARK: sizes

    private var small: some View {
        VStack(alignment: .leading, spacing: 0) {
            dateLine(long: false)
            headlineText(17, lines: 3)
                .padding(.top, 6)
            Spacer(minLength: 4)
            HStack(alignment: .bottom, spacing: 14) {
                waitingStat("waiting")
                if entry.due > 0 { dueStat(18) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(entry.glance.next?.first.map { personURL($0.k) } ?? URL(string: "bearings://home"))
    }

    /// One line under the waiting count: new jobs and close, as on Today's compass card,
    /// or follow-ups for a glance saved before those counts existed.
    @ViewBuilder private var mediumSecondary: some View {
        if let j = entry.glance.jobs {
            let c = entry.glance.close ?? 0
            Link(destination: URL(string: "bearings://filter/jcw")!) {
                Text(c > 0 ? "\(j) new jobs · \(c) close" : "\(j) new job\(j == 1 ? "" : "s")")
            }
        } else {
            Link(destination: URL(string: "bearings://filter/due")!) {
                Text("\(entry.due) to follow up")
            }
        }
    }

    private var medium: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                headlineText(15, lines: 3)
                Spacer(minLength: 4)
                waitingStat("waiting on you")
                mediumSecondary
                    .font(Calm.font(11, .medium, relativeTo: .caption2))
                    .foregroundStyle(t.text2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                    .padding(.top, 2)
            }
            .frame(width: 112, alignment: .leading)
            .frame(maxHeight: .infinity, alignment: .topLeading)
            peopleCard(limit: 3, roomy: false)
        }
        .widgetURL(URL(string: "bearings://home"))
    }

    private var large: some View {
        VStack(alignment: .leading, spacing: 10) {
            dateLine(long: true)
            headlineText(22, lines: 2)
            HStack(alignment: .top, spacing: 0) {
                waitingStat("waiting").frame(maxWidth: .infinity, alignment: .leading)
                dueStat(18).frame(maxWidth: .infinity, alignment: .leading)
                if entry.glance.jobs != nil {
                    jobsStat(18).frame(maxWidth: .infinity, alignment: .leading)
                }
                if (entry.glance.close ?? 0) > 0 {
                    closeStat(18).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(10)
            .calmCard(t)
            peopleCard(limit: 3, roomy: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(URL(string: "bearings://home"))
    }
}

@main
struct BearingsWidgetBundle: WidgetBundle {
    var body: some Widget {
        BearingsHomeWidgets()
        #if os(iOS) && !targetEnvironment(macCatalyst)
        TripLiveActivity()
        CatchUpControl()
        NearbyControl()
        #endif
    }
}

struct BearingsHomeWidgets: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BearingsHome", provider: HomeProvider()) { entry in
            HomeWidgetView(entry: entry)
                .containerBackground(for: .widget) { CalmWidgetBackground() }
        }
        .configurationDisplayName("Bearings")
        .description("Who needs you: who’s waiting on a reply and which follow-ups are due.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

#if os(iOS) && !targetEnvironment(macCatalyst)
/// Control Center: jump into Catch Up.
struct CatchUpControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.jaynichols.networkoob.control.catchup") {
            ControlWidgetButton(action: OpenBearingsIntent(screen: "tab/catchup")) {
                Label("Catch Up", systemImage: "rectangle.stack")
            }
        }
        .displayName("Bearings Catch Up")
        .description("Swipe through new connections and job changes.")
    }
}

/// Control Center: who's nearby, on the map.
struct NearbyControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.jaynichols.networkoob.control.nearby") {
            ControlWidgetButton(action: OpenBearingsIntent(screen: "map")) {
                Label("Who’s nearby", systemImage: "location.north.circle")
            }
        }
        .displayName("Who’s nearby")
        .description("Opens the Bearings map around you.")
    }
}
#endif
