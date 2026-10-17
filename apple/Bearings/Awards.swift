import SwiftUI

// Recompetes and teaming partners, from USASpending.gov's public award search. The phone asks
// for contracts at the agencies you work (your watchlist and open pursuits), straight from the
// device, with no key, at most once a day. The only thing sent is the agency name. The engine
// (src/awards.js) reads the answers and says who you know at the agency and at the incumbent.

// MARK: - shapes

/// Any JSON value, so the engine's request body can be posted as it is.
enum JSONValue: Codable, Hashable {
    case string(String), int(Int), double(Double), bool(Bool), array([JSONValue]), object([String: JSONValue]), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Int.self) { self = .int(v) }
        else if let v = try? c.decode(Double.self) { self = .double(v) }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .double(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
}

/// One search to run (awardRequests): POST `body` as JSON to `url`.
struct AwardRequest: Decodable {
    var agencyId: String
    var short: String
    var url: String
    var body: JSONValue
}

/// One award as the engine keeps it (awardPage).
struct AwardItem: Codable, Hashable {
    var id: String
    var piid: String?
    var recipient: String?
    var start: String?
    var end: String?
    var amount: Double?
    var agency: String?
    var sub: String?
    var office: String?
    var desc: String?
    var naics: String?
    var naicsName: String?
    var demo: Bool?
    var demoShort: String?
}

struct AwardPage: Decodable {
    var items: [AwardItem]
    var more: Bool?
    var error: String?
    var code: String?
}

/// The answers for one agency, as the engine takes them back.
struct AwardPageSet: Codable, Hashable {
    var agencyId: String
    var items: [AwardItem]
}

struct AwardMini: Decodable, Hashable, Identifiable {
    var k: String
    var name: String
    var p: String?
    var band: String?
    var score: Double?
    var id: String { k }
}

struct Recompete: Decodable, Hashable, Identifiable {
    var id: String
    var competitor: Bool?
    var piid: String?
    var title: String
    var incumbent: String
    var amount: Double
    var amountText: String
    var start: String?
    var end: String
    var days: Int?
    var agency: String
    var agencyName: String
    var agencyId: String
    var office: String?
    var naics: String?
    var link: String?
    var demo: Bool?
    var known: Int
    var warm: Int
    var people: [AwardMini]
    var incumbentKnown: Int
    var incumbentPeople: [AwardMini]
    var watched: Bool
    var pursuit: String?
    var pursuitId: String?
    var tracked: Bool
    var score: Double?
    var line: String

    /// "Ends Mar 3, in 140 days".
    var endText: String {
        guard !end.isEmpty else { return "" }
        guard let d = days else { return "Ends \(Day.nice(end))" }
        if d <= 0 { return "Ends today" }
        return "Ends \(Day.nice(end)), in \(d) \(d == 1 ? "day" : "days")"
    }
}

struct RecompeteList: Decodable {
    var items: [Recompete]
    var total: Int
    var months: Int?
    var value: Double?
    var valueText: String?
}

struct TeamingPartner: Decodable, Hashable, Identifiable {
    struct Mate: Decodable, Hashable { var owner: String; var name: String; var p: String?; var b: String? }
    var name: String
    var competitor: Bool?
    var awards: Int
    var amount: Double
    var amountText: String
    var agencies: [String]
    var ending: Int
    var known: Int
    var warm: Int
    var people: [AwardMini]
    var team: [Mate]
    var watched: Bool
    var line: String
    var id: String { name }
}

struct TeamingList: Decodable {
    struct Ag: Decodable, Hashable { var id: String; var short: String; var name: String }
    var items: [TeamingPartner]
    var total: Int
    var agency: Ag?
}

// MARK: - the feed

@MainActor @Observable
final class AwardFeed {
    static let shared = AwardFeed()
    private(set) var pages: [AwardPageSet] = []
    private(set) var busy = false
    private(set) var lastError = ""
    private(set) var last: Date? = UserDefaults.standard.object(forKey: "awards.last") as? Date
    /// Bumped when the pages change, so screens match again.
    private(set) var rev = 0
    /// The last recompetes list a screen showed, for the detail page.
    private(set) var recompeteList: RecompeteList?
    private var cacheLoaded = false
    /// Contracts are asked for this far ahead; the screen narrows to 12, 18 or 24 months.
    static let months = 24

    private static var cacheURL: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("usaspending-awards.json")
    }

    /// Fetches from USASpending.gov when it's been a day, the agencies changed, or `force`.
    func refresh(model: AppModel, force: Bool = false) async {
        if model.info.isSample {
            let demo = (try? await model.engine.call("demoAwardPages", as: [AwardPageSet].self)) ?? []
            if demo != pages { pages = demo; rev += 1 }
            return
        }
        // just left the sample network: drop its demo awards
        if pages.contains(where: { $0.items.contains { $0.demo == true } }) { pages = []; cacheLoaded = false; rev += 1 }
        loadCache()
        let reqs = (try? await model.engine.call("awardRequests", [[String](), Self.months], as: [AwardRequest].self)) ?? []
        let key = reqs.map(\.agencyId).sorted().joined(separator: ",")
        let sameAgencies = key == (UserDefaults.standard.string(forKey: "awards.key") ?? "")
        if !force, sameAgencies, let last, Date().timeIntervalSince(last) < 24 * 3600 { return }
        guard !reqs.isEmpty else {
            if !pages.isEmpty { pages = []; rev += 1; saveCache() }
            lastError = ""
            return
        }
        guard !busy else { return }
        busy = true
        defer { busy = false }

        var got: [AwardPageSet] = []
        var err = ""
        var answered = false
        for r in reqs {
            guard let url = URL(string: r.url), let body = try? JSONEncoder().encode(r.body) else { continue }
            var req = URLRequest(url: url, timeoutInterval: 40)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("application/json", forHTTPHeaderField: "Accept")
            req.httpBody = body
            do {
                let (data, resp) = try await URLSession.shared.data(for: req)
                let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
                // the engine reads the status too, so a 429 or an HTML error page reads in plain English
                let page = try await model.engine.call("awardPage", [String(decoding: data, as: UTF8.self), status], as: AwardPage.self)
                if let e = page.error, !e.isEmpty {
                    err = e
                    if page.code == "rate" { break }
                    continue
                }
                got.append(AwardPageSet(agencyId: r.agencyId, items: page.items))
                answered = true
            } catch {
                err = "Couldn’t reach USASpending.gov. Check your connection and try again."
            }
        }
        lastError = answered ? "" : err
        // only a good answer starts the once-a-day clock, so a dropped connection tries again next time
        guard answered else { return }
        last = Date()
        UserDefaults.standard.set(last, forKey: "awards.last")
        UserDefaults.standard.set(key, forKey: "awards.key")
        // an agency that failed this time keeps its last answer
        let asked = reqs.map(\.agencyId)
        pages = (try? await model.engine.call("mergeAwardPages", [Self.jsonObject(pages), Self.jsonObject(got), asked], as: [AwardPageSet].self)) ?? got
        rev += 1
        saveCache()
    }

    func recompetes(model: AppModel, months: Int) async -> RecompeteList? {
        let list = try? await model.engine.call("recompetes", [Self.jsonObject(pages), ["months": months]], as: RecompeteList.self)
        if let list { recompeteList = list }
        return list
    }

    func teaming(model: AppModel) async -> TeamingList? {
        try? await model.engine.call("teamingPartners", [Self.jsonObject(pages), [String: Any]()], as: TeamingList.self)
    }

    func recompete(_ id: String) -> Recompete? { recompeteList?.items.first { $0.id == id } }

    /// Makes a pursuit from a recompete (once), saves it, and returns its id.
    func track(_ r: Recompete, model: AppModel) async -> String? {
        var item: [String: Any] = ["id": r.id, "title": r.title, "agency": r.agency, "end": r.end, "amount": r.amount, "incumbent": r.incumbent]
        if let p = r.piid { item["piid"] = p }
        let made = try? await model.engine.call("pursueAward", [item], as: PursuitSummaryLite.self)
        await model.savePursuits()
        _ = await recompetes(model: model, months: recompeteList?.months ?? Self.months)
        return made?.id
    }

    private func loadCache() {
        guard !cacheLoaded else { return }
        cacheLoaded = true
        if let d = try? Data(contentsOf: Self.cacheURL), let v = try? JSONDecoder().decode([AwardPageSet].self, from: d) { pages = v; rev += 1 }
    }

    private func saveCache() {
        if let d = try? JSONEncoder().encode(pages) { try? d.write(to: Self.cacheURL, options: .atomic) }
    }

    private static func jsonObject(_ p: [AwardPageSet]) -> Any {
        guard let d = try? JSONEncoder().encode(p), let o = try? JSONSerialization.jsonObject(with: d) else { return [Any]() }
        return o
    }
}

// MARK: - the screen

/// Recompetes (contracts ending soon) and teaming partners (who wins the work), side by side.
struct AwardsView: View {
    @Environment(AppModel.self) private var model
    @State var mode: String
    @AppStorage("awards.months") private var months = 24
    @State private var list: RecompeteList?
    @State private var partners: TeamingList?
    @State private var loaded = false
    private var feed: AwardFeed { AwardFeed.shared }

    var body: some View {
        List {
            Section {
                Picker("Show", selection: $mode) {
                    Text("Recompetes").tag("recompetes")
                    Text("Teaming partners").tag("teaming")
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            if mode == "recompetes" { recompetesBody } else { teamingBody }
            Section {
                Text(footer).font(Theme.geist(.footnote)).foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(mode == "recompetes" ? "Recompetes" : "Teaming partners")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await feed.refresh(model: model, force: true); await match() }
        .task(id: "\(model.info.rev)-\(model.info.isSample)-\(model.targets.count)") { await feed.refresh(model: model) }
        .task(id: "\(feed.rev)-\(months)-\(model.pursuitsRev)-\(model.info.edits)-\(mode)") { await match() }
    }

    private func match() async {
        if mode == "recompetes" { list = await feed.recompetes(model: model, months: months) } else { partners = await feed.teaming(model: model) }
        loaded = true
    }

    @ViewBuilder private var recompetesBody: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text("ENDING IN THE NEXT \(months) MONTHS").font(Theme.eyebrow).tracking(1.1).foregroundStyle(Theme.text2)
                if let l = list {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("\(l.total)").font(Theme.serif(.largeTitle, .semibold))
                        Text(l.total == 1 ? "contract at agencies you work" : "contracts at agencies you work").font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                    }
                    if let v = l.valueText, l.total > 0 { Text("\(v) in all").font(Theme.geist(.footnote)).foregroundStyle(.secondary) }
                }
                if !feed.lastError.isEmpty { Text(feed.lastError).font(Theme.geist(.footnote)).foregroundStyle(Theme.bad) }
            }
            .padding(.vertical, 4)
            Picker("Ending within", selection: $months) {
                Text("12 months").tag(12)
                Text("18 months").tag(18)
                Text("24 months").tag(24)
            }
        }
        if let l = list {
            if l.items.isEmpty {
                Section { Text(emptyText).foregroundStyle(.secondary) }
            } else {
                Section {
                    ForEach(l.items) { r in
                        NavigationLink(value: Route.recompete(r.id)) { RecompeteRow(r: r) }
                    }
                }
            }
        } else if feed.busy || !loaded {
            ProgressView().frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder private var teamingBody: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text("WHO WINS THE WORK").font(Theme.eyebrow).tracking(1.1).foregroundStyle(Theme.text2)
                Text("Companies with contracts at the agencies you work, biggest first. The ones where you know people come first.")
                    .font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                if !feed.lastError.isEmpty { Text(feed.lastError).font(Theme.geist(.footnote)).foregroundStyle(Theme.bad) }
            }
            .padding(.vertical, 4)
        }
        if let t = partners {
            if t.items.isEmpty {
                Section { Text(emptyText).foregroundStyle(.secondary) }
            } else {
                Section {
                    ForEach(t.items) { c in partnerRow(c) }
                }
            }
        } else if feed.busy || !loaded {
            ProgressView().frame(maxWidth: .infinity)
        }
    }

    private func partnerRow(_ c: TeamingPartner) -> some View {
        Button { model.open(.unit(c.name)) } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(c.name).font(Theme.geist(.subheadline, .semibold)).foregroundStyle(.primary).lineLimit(2)
                    if c.watched { Image(systemName: "star.fill").font(.caption2).foregroundStyle(Theme.amber).accessibilityLabel("On your watchlist") }
                    if c.competitor == true { CompetitorBadge() }
                    Spacer()
                    Text(c.amountText).font(Theme.mono(.footnote, .semibold)).foregroundStyle(.primary)
                }
                Text(partnerDetail(c)).font(Theme.geist(.caption)).foregroundStyle(.secondary).lineLimit(2)
                HStack(spacing: 8) {
                    let ps = model.persons(c.people.map(\.k))
                    if !ps.isEmpty { AvatarStack(people: ps, size: 22) }
                    Text(c.line).font(Theme.geist(.caption)).foregroundStyle(c.known > 0 ? Theme.good : Theme.text3).lineLimit(1)
                }
                if let m = c.team.first {
                    Text("\(m.owner) knows \(m.name)").font(Theme.geist(.caption)).foregroundStyle(Theme.text3).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button { model.introQuery = c.name } label: { Label("Find a way in", systemImage: "point.3.connected.trianglepath.dotted") }
            if !c.watched {
                Button { Task { await model.toggleTarget(c.name); await match() } } label: { Label("Add to watchlist", systemImage: "star") }
            }
        }
    }

    private func partnerDetail(_ c: TeamingPartner) -> String {
        var parts = ["\(c.awards) \(c.awards == 1 ? "contract" : "contracts")", c.agencies.joined(separator: ", ")]
        if c.ending > 0 { parts.append("\(c.ending) ending this year") }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var emptyText: String {
        if model.targets.isEmpty { return "Add agencies to your watchlist or start a pursuit, and Northfix looks up their contracts." }
        return mode == "recompetes" ? "No contracts ending in this window at the agencies you work. Pull down to check again." : "No contracts found yet. Pull down to check again."
    }

    private var footer: String {
        if model.info.isSample { return "These are sample contracts with made-up numbers, matched to the sample network. Contract data from USASpending.gov. Only the agency name is sent." }
        var s = "Contract data from USASpending.gov. Only the agency name is sent. Northfix checks at most once a day, straight from this device, for the agencies on your watchlist and your open pursuits."
        if let last = feed.last { s += " Last checked \(last.formatted(.relative(presentation: .named)))." }
        return s
    }
}

/// Title, agency, incumbent, amount, end date and who you know.
struct RecompeteRow: View {
    @Environment(AppModel.self) private var model
    let r: Recompete

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(([r.agency, r.endText].filter { !$0.isEmpty }).joined(separator: " · ").uppercased())
                    .font(Theme.eyebrow).tracking(0.8).foregroundStyle((r.days ?? 999) <= 180 ? Theme.needs : Theme.accent)
                    .lineLimit(1)
                if r.watched { Image(systemName: "star.fill").font(.caption2).foregroundStyle(Theme.amber).accessibilityLabel("On your watchlist") }
            }
            Text(r.title).font(Theme.serif(.body)).foregroundStyle(.primary).multilineTextAlignment(.leading).lineLimit(3)
            HStack(spacing: 6) {
                Text([r.incumbent, r.amountText].filter { !$0.isEmpty }.joined(separator: " · ")).font(Theme.geist(.footnote, .semibold)).foregroundStyle(.secondary)
                if r.competitor == true { CompetitorBadge() }
            }
            HStack(spacing: 8) {
                let ps = model.persons(r.people.map(\.k))
                if !ps.isEmpty { AvatarStack(people: ps, size: 22) }
                Text(r.line).font(Theme.geist(.caption)).foregroundStyle(.secondary).lineLimit(2)
            }
            if r.tracked {
                Label("Tracked as a pursuit", systemImage: "scope").font(Theme.geist(.caption, .semibold)).foregroundStyle(Theme.info)
            } else if let p = r.pursuit, !p.isEmpty {
                Label(p, systemImage: "scope").font(Theme.geist(.caption, .semibold)).foregroundStyle(Theme.info).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}

// MARK: - one recompete

struct RecompeteView: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var tracking = false
    private var feed: AwardFeed { AwardFeed.shared }

    var body: some View {
        List {
            if let r = feed.recompete(id) {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(r.endText.uppercased()).font(Theme.eyebrow).tracking(1.0).foregroundStyle((r.days ?? 999) <= 180 ? Theme.needs : Theme.accent)
                        Text(r.title).font(Theme.serif(.title2, .semibold)).fixedSize(horizontal: false, vertical: true)
                        Text(r.agencyName + ((r.office ?? "").isEmpty ? "" : ", \(r.office ?? "")")).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                        if r.demo == true {
                            Label("A sample contract. The numbers are made up.", systemImage: "info.circle").font(Theme.geist(.footnote)).foregroundStyle(Theme.info)
                        }
                    }
                    .padding(.vertical, 4)
                    if let link = r.link, !link.isEmpty, let url = URL(string: link) {
                        Link(destination: url) { Label("Open on USASpending.gov", systemImage: "arrow.up.right.square") }
                            .font(Theme.geist(.body, .semibold))
                    }
                }
                Section {
                    if let pid = r.pursuitId, !pid.isEmpty, let name = r.pursuit, !name.isEmpty {
                        Button { model.open(.pursuit(pid)) } label: { Label("Pursuit at \(r.agency): \(name)", systemImage: "scope") }
                    }
                    if r.tracked {
                        Button { model.open(.pursuits) } label: { Label("Tracked as a pursuit", systemImage: "checkmark.circle.fill") }
                    } else {
                        Button {
                            tracking = true
                            Task {
                                if let pid = await feed.track(r, model: model) {
                                    Haptic.success()
                                    model.open(.pursuit(pid))
                                }
                                tracking = false
                            }
                        } label: {
                            HStack {
                                Label("Track as a pursuit", systemImage: "scope")
                                Spacer()
                                if tracking { ProgressView() }
                            }
                        }
                        .disabled(tracking)
                    }
                    Button { model.introQuery = r.agency } label: { Label("Find a way into \(r.agency)", systemImage: "point.3.connected.trianglepath.dotted") }
                } footer: {
                    Text("Tracking makes a pursuit with the agency, the end date as the due date, the value and the incumbent.")
                }
                Section("People you know at \(r.agency)") {
                    if r.people.isEmpty { Text("No one yet.").foregroundStyle(.secondary) }
                    ForEach(r.people) { w in personButton(w) }
                    if r.known > r.people.count {
                        Button("See all \(r.known) at \(r.agency)") { model.open(.unit(r.agency)) }
                    }
                }
                if !r.incumbent.isEmpty {
                    Section("People you know at \(r.incumbent)") {
                        if r.incumbentPeople.isEmpty { Text("No one yet.").foregroundStyle(.secondary) }
                        ForEach(r.incumbentPeople) { w in personButton(w) }
                        if r.incumbentKnown > r.incumbentPeople.count {
                            Button("See all \(r.incumbentKnown) at \(r.incumbent)") { model.open(.unit(r.incumbent)) }
                        }
                    }
                }
                Section("Details") {
                    if !r.incumbent.isEmpty { LabeledContent("Incumbent", value: r.incumbent) }
                    LabeledContent("Value", value: r.amountText)
                    if let s = r.start, !s.isEmpty { LabeledContent("Started", value: Day.nice(s)) }
                    if !r.end.isEmpty { LabeledContent("Ends", value: Day.nice(r.end)) }
                    if let p = r.piid, !p.isEmpty { LabeledContent("Contract number", value: p) }
                    if let n = r.naics, !n.isEmpty { LabeledContent("NAICS", value: n) }
                }
                Section {
                    Text("Contract data from USASpending.gov. Only the agency name is sent.").font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Recompete")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if feed.recompete(id) == nil {
                await feed.refresh(model: model)
                _ = await feed.recompetes(model: model, months: AwardFeed.months)
            }
        }
    }

    @ViewBuilder private func personButton(_ w: AwardMini) -> some View {
        if let p = model.person(w.k) {
            Button { model.open(.person(w.k)) } label: { PersonRow(person: p, lens: model.info.lens) }
                .buttonStyle(.plain)
        }
    }
}
