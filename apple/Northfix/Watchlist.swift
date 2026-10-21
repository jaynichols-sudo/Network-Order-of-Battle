import SwiftUI
import Charts

// Account trends (your reach into a company over time) and watchlist alerts (news and
// people changes at the companies and agencies you watch).

struct TrendData: Decodable {
    struct Month: Decodable, Hashable, Identifiable { var m: String; var known: Int; var senior: Int; var id: String { m } }
    struct Snap: Decodable, Hashable, Identifiable { var d: String; var score: Int; var known: Int; var close: Int; var id: String { d } }
    struct Now: Decodable { var score: Int; var known: Int; var close: Int }
    var name: String
    var months: [Month]
    var snaps: [Snap]
    var now: Now
}

struct TargetChange: Decodable, Hashable, Identifiable {
    var target: String
    var k: String
    var name: String
    var p: String
    var kind: String
    var senior: Bool
    var id: String { target + k }
}

extension AppModel {
    func trend(_ name: String) async -> TrendData? { try? await engine.call("trend", [name], as: TrendData?.self) }
    func targetChanges() async -> [TargetChange] { (try? await engine.call("targetChanges", as: [TargetChange].self)) ?? [] }

    /// A weekly coverage snapshot for each watched company, kept so trends grow over time.
    func snapshotTargets() async {
        guard !info.isSample, (try? await engine.call("snapshot", as: Bool.self)) == true else { return }
        await saveFile("history", "history.json")
    }
}

/// On a company page: how your reach there has grown over the year.
struct TrendSection: View {
    @Environment(AppModel.self) private var model
    let name: String
    @State private var t: TrendData?

    var body: some View {
        Section {
            if let t, t.now.known > 0 {
                VStack(alignment: .leading, spacing: 10) {
                    let first = t.months.first?.known ?? 0, last = t.months.last?.known ?? 0
                    HStack(alignment: .firstTextBaseline) {
                        Text("\(last)").font(Theme.mono(.title2, .semibold))
                        Text("people you know there").font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                        Spacer()
                        if last > first {
                            Label("+\(last - first) this year", systemImage: "arrow.up.right").font(Theme.geist(.caption, .semibold)).foregroundStyle(Theme.good)
                        }
                    }
                    Chart {
                        ForEach(t.months) { m in
                            BarMark(x: .value("Month", short(m.m)), y: .value("People", m.known))
                                .foregroundStyle(Theme.info.opacity(0.35))
                                .cornerRadius(3)
                            LineMark(x: .value("Month", short(m.m)), y: .value("Director and up", m.senior))
                                .foregroundStyle(Theme.accent)
                                .lineStyle(StrokeStyle(lineWidth: 2.2))
                                .symbol(.circle).symbolSize(16)
                        }
                    }
                    .chartXAxis { AxisMarks(values: .stride(by: 1)) { v in
                        if let s = v.as(String.self), ["Jan", "Apr", "Jul", "Oct"].contains(s) { AxisValueLabel() }
                    } }
                    .frame(height: 140)
                    HStack(spacing: 14) {
                        legend(Theme.info.opacity(0.5), "Everyone you know")
                        legend(Theme.accent, "Director and up")
                    }
                    if t.snaps.count >= 2, let a = t.snaps.first, let b = t.snaps.last {
                        Text("Coverage score \(a.score) → \(b.score) since \(Day.nice(a.d)).").font(Theme.geist(.footnote)).foregroundStyle(b.score >= a.score ? Theme.good : Theme.bad)
                    }
                }
                .padding(.vertical, 6)
            }
        } header: { Text("Your reach over time") }
        .task(id: "\(name)-\(model.info.rev)") { t = await model.trend(name) }
    }

    private func short(_ ym: String) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM"
        guard let d = f.date(from: ym) else { return ym }
        f.dateFormat = "MMM"
        return f.string(from: d)
    }

    private func legend(_ c: Color, _ s: String) -> some View {
        HStack(spacing: 5) { Circle().fill(c).frame(width: 8, height: 8); Text(s).font(Theme.geist(.caption)).foregroundStyle(.secondary) }
    }
}

// MARK: - news

struct Headline: Codable, Hashable, Identifiable {
    var target: String
    var title: String
    var source: String
    var link: String
    var date: Date
    var id: String { link }
}

/// Headlines about the companies and agencies you watch, from Google News, fetched on the
/// phone a few times a day. Nothing about you is sent: only the company names you watch.
@MainActor @Observable
final class WatchNews {
    static let shared = WatchNews()
    var items: [Headline] = []
    private var last: Date? = UserDefaults.standard.object(forKey: "news.last") as? Date
    var enabled: Bool { UserDefaults.standard.object(forKey: "watchNews") as? Bool ?? true }

    init() {
        if let d = UserDefaults.standard.data(forKey: "news.items"), let v = try? JSONDecoder().decode([Headline].self, from: d) { items = v }
    }

    func refresh(targets: [String], force: Bool = false) async {
        guard enabled, !targets.isEmpty else { return }
        if !force, let last, Date().timeIntervalSince(last) < 4 * 3600 { return }
        var all: [Headline] = []
        await withTaskGroup(of: [Headline].self) { g in
            for t in targets.prefix(8) { g.addTask { await Self.fetch(t) } }
            for await r in g { all += r }
        }
        let week = Date().addingTimeInterval(-10 * 86400)
        var seen = Set<String>()
        items = all.filter { $0.date >= week }.sorted { $0.date > $1.date }.filter { seen.insert($0.title.lowercased()).inserted }.prefix(40).map { $0 }
        last = Date()
        UserDefaults.standard.set(last, forKey: "news.last")
        if let d = try? JSONEncoder().encode(items) { UserDefaults.standard.set(d, forKey: "news.items") }
    }

    nonisolated private static func fetch(_ target: String) async -> [Headline] {
        var c = URLComponents(string: "https://news.google.com/rss/search")!
        c.queryItems = [.init(name: "q", value: "\"\(target)\" when:14d"), .init(name: "hl", value: "en-US"), .init(name: "gl", value: "US"), .init(name: "ceid", value: "US:en")]
        guard let url = c.url, let (d, _) = try? await URLSession.shared.data(from: url) else { return [] }
        let p = RSSParser(target: target)
        let x = XMLParser(data: d)
        x.delegate = p
        x.parse()
        return Array(p.out.prefix(6))
    }
}

private final class RSSParser: NSObject, XMLParserDelegate {
    let target: String
    var out: [Headline] = []
    private var cur: [String: String] = [:]
    private var text = ""
    private var inItem = false
    init(target: String) { self.target = target }

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        if name == "item" { inItem = true; cur = [:] }
        text = ""
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) { text += string }
    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        guard inItem else { return }
        if ["title", "link", "pubDate", "source"].contains(name) { cur[name] = text.trimmingCharacters(in: .whitespacesAndNewlines) }
        if name == "item" {
            inItem = false
            let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
            var title = cur["title"] ?? ""
            let source = cur["source"] ?? ""
            if !source.isEmpty, title.hasSuffix(" - " + source) { title = String(title.dropLast(source.count + 3)) }
            if let link = cur["link"], !title.isEmpty {
                out.append(Headline(target: target, title: title, source: source, link: link, date: f.date(from: cur["pubDate"] ?? "") ?? Date()))
            }
        }
    }
}

/// Today: what changed at the companies you watch, people first, then headlines.
struct WatchlistCard: View {
    @Environment(AppModel.self) private var model
    @State private var changes: [TargetChange] = []
    @State private var showAll = false
    private var news: WatchNews { WatchNews.shared }

    var body: some View {
        let heads = Array(news.items.prefix(3))
        if !changes.isEmpty || !heads.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("ON YOUR WATCHLIST").font(Theme.eyebrow).tracking(1.1).foregroundStyle(Theme.text2)
                    Spacer()
                    Button("All") { showAll = true }.font(Theme.geist(.footnote, .semibold))
                }
                ForEach(changes.prefix(2)) { c in
                    Button { model.open(.person(c.k)) } label: {
                        HStack(spacing: 10) {
                            if let p = model.person(c.k) { Avatar(person: p, size: 34) }
                            VStack(alignment: .leading, spacing: 1) {
                                Text("\(c.kind == "moved" ? "Now at" : "New connection at") \(c.target)").font(Theme.geist(.caption, .semibold)).foregroundStyle(Theme.info)
                                Text("\(c.name)\(c.p.isEmpty ? "" : ", \(c.p)")").font(Theme.geist(.subheadline)).lineLimit(2).multilineTextAlignment(.leading)
                            }
                            Spacer(minLength: 0)
                        }
                    }
                    .buttonStyle(.plain)
                }
                ForEach(heads) { h in headline(h) }
            }
            .padding(16)
            .card(22)
            .sheet(isPresented: $showAll) { WatchlistNewsSheet(changes: changes).environment(AppModel.shared) }
        }
        Color.clear.frame(height: 0)
            .task(id: "\(model.info.rev)-\(model.targets.count)") {
                changes = await model.targetChanges()
                await news.refresh(targets: model.targets.map(\.name))
            }
    }

    @ViewBuilder func headline(_ h: Headline) -> some View {
        if let url = URL(string: h.link) {
            Link(destination: url) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(h.target.uppercased()).font(Theme.eyebrow).tracking(0.8).foregroundStyle(Theme.accent)
                    Text(h.title).font(Theme.serif(.body)).foregroundStyle(.primary).multilineTextAlignment(.leading).lineLimit(3)
                    Text("\(h.source) · \(h.date.formatted(.relative(presentation: .named)))").font(Theme.geist(.caption)).foregroundStyle(.secondary)
                }
            }
        }
    }
}

struct WatchlistNewsSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let changes: [TargetChange]
    private var news: WatchNews { WatchNews.shared }

    var body: some View {
        NavigationStack {
            List {
                if !changes.isEmpty {
                    Section("People") {
                        ForEach(changes) { c in
                            if let p = model.person(c.k) {
                                Button { dismiss(); model.open(.person(c.k)) } label: {
                                    VStack(alignment: .leading, spacing: 2) {
                                        PersonRow(person: p, lens: model.info.lens)
                                        Text("\(c.kind == "moved" ? "Moved to" : "New connection at") \(c.target)").font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                let groups = Dictionary(grouping: news.items, by: \.target)
                ForEach(groups.keys.sorted(), id: \.self) { t in
                    Section(t) {
                        ForEach(groups[t] ?? []) { h in
                            if let url = URL(string: h.link) {
                                Link(destination: url) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(h.title).font(Theme.geist(.subheadline)).foregroundStyle(.primary).multilineTextAlignment(.leading)
                                        Text("\(h.source) · \(h.date.formatted(.relative(presentation: .named)))").font(Theme.geist(.caption)).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .refreshable { await news.refresh(targets: model.targets.map(\.name), force: true) }
            .navigationTitle("Watchlist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
