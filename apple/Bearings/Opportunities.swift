import SwiftUI
import UserNotifications

// SAM.gov opportunities matched to your network. The phone asks SAM.gov's public
// Get Opportunities API for notices posted in the last 14 days, with the user's own key,
// at most every six hours. The engine (src/opportunities.js) maps each buying office to an
// agency on the federal map and says who you know there. No Northfix server is involved.

// MARK: - what SAM.gov sends, slimmed by the engine

/// One notice as the engine keeps it (opportunityPage). Every field is text.
struct SamNotice: Codable, Hashable {
    struct Award: Codable, Hashable { var amount: String?; var date: String?; var awardee: String? }
    var noticeId: String
    var title: String?
    var solicitationNumber: String?
    var fullParentPathName: String?
    var department: String?
    var subTier: String?
    var office: String?
    var postedDate: String?
    var type: String?
    var baseType: String?
    var responseDeadLine: String?
    var naicsCode: String?
    var classificationCode: String?
    var uiLink: String?
    var typeOfSetAsideDescription: String?
    var active: String?
    var award: Award?
    var demo: Bool?
}

/// One SAM.gov answer, read by the engine.
struct SamPage: Decodable {
    var total: Int
    var items: [SamNotice]
    var error: String?
    var code: String?
}

/// One search to run, from the engine (opportunityRequests).
struct SamRequest: Decodable {
    var postedFrom: String
    var postedTo: String
    var limit: Int
    var offset: Int
    var ptype: String?
    var ncode: String?
}

/// A notice matched to your network (matchOpportunities).
struct Opportunity: Decodable, Identifiable, Hashable {
    struct Who: Decodable, Hashable { var k: String; var name: String; var p: String; var band: String; var score: Double }
    struct Award: Decodable, Hashable { var amount: String?; var date: String?; var awardee: String? }
    var id: String
    var title: String
    var sol: String
    var kind: String
    var type: String
    var agency: String
    var agencyName: String
    var agencyId: String
    var dept: String
    var office: String
    var area: String
    var path: String
    var posted: String
    var due: String
    var days: Int?
    var naics: String
    var setAside: String
    /// "yes", "no" or "open" when set-asides are picked, else "".
    var fit: String?
    var link: String
    var award: Award?
    var known: Int
    var senior: Int
    var warm: Int
    var officeKnown: Int
    var people: [Who]
    var watched: Bool
    var pursuit: String
    var pursuitId: String
    var isNew: Bool
    var demo: Bool
    var score: Double
    var line: String

    /// "Due Oct 24", "Due today", or "" when there is no deadline.
    var dueText: String {
        guard let d = days, !due.isEmpty else { return "" }
        if d == 0 { return "Due today" }
        if d == 1 { return "Due tomorrow" }
        return "Due \(Day.nice(due))"
    }
}

struct OpportunityMatch: Decodable {
    struct Alert: Decodable, Hashable { var id: String; var title: String; var body: String }
    struct AgencyRef: Decodable, Hashable { var id: String; var short: String; var name: String }
    var items: [Opportunity]
    var total: Int
    var matched: Int
    var newCount: Int
    var ids: [String]
    var alerts: [Alert]
    var types: [String: Int]
    var agency: AgencyRef?
}

// MARK: - settings

/// The user's SAM.gov key (this device's Keychain) and what to look for (UserDefaults).
enum SamSettings {
    static let keyName = "sam.key"
    static let allTypes: [(String, String)] = [("r", "Sources sought"), ("p", "Presolicitation"), ("k", "Combined solicitation"),
                                               ("o", "Solicitation"), ("s", "Special notice"), ("a", "Award")]
    static let defaultTypes = ["r", "p", "k", "o", "s"]
    /// Where a signed-in SAM.gov user finds their public API key.
    static let keyPage = URL(string: "https://sam.gov/profile/details")!

    static var apiKey: String? {
        guard let k = SecretStore.get(keyName)?.trimmingCharacters(in: .whitespacesAndNewlines), !k.isEmpty else { return nil }
        return k
    }
    static var hasKey: Bool { apiKey != nil }
    static var naics: String {
        get { UserDefaults.standard.string(forKey: "sam.naics") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "sam.naics") }
    }
    static var keywords: String {
        get { UserDefaults.standard.string(forKey: "sam.keywords") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "sam.keywords") }
    }
    static var types: [String] {
        get { UserDefaults.standard.stringArray(forKey: "sam.types") ?? defaultTypes }
        set { UserDefaults.standard.set(newValue, forKey: "sam.types") }
    }
    static var notify: Bool {
        get { UserDefaults.standard.object(forKey: "sam.notify") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "sam.notify") }
    }
    /// Set-aside programs the company qualifies for (engine keys: small, 8a, hubzone, sdvosb, vosb, wosb, edwosb).
    static let allSetAsides: [(String, String)] = [("small", "Small business"), ("8a", "8(a)"), ("hubzone", "HUBZone"), ("sdvosb", "Service-disabled veteran-owned"),
                                                   ("vosb", "Veteran-owned"), ("wosb", "Women-owned"), ("edwosb", "Economically disadvantaged women-owned")]
    static var setAsides: [String] {
        get { UserDefaults.standard.stringArray(forKey: "sam.setAsides") ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: "sam.setAsides") }
    }
    static var hideIneligible: Bool {
        get { UserDefaults.standard.bool(forKey: "sam.hideIneligible") }
        set { UserDefaults.standard.set(newValue, forKey: "sam.hideIneligible") }
    }
    /// The filters as the engine takes them.
    static var filters: [String: Any] { ["naics": naics, "keywords": keywords, "types": types, "setAsides": setAsides, "hideIneligible": hideIneligible] }
    static func label(_ code: String) -> String { allTypes.first { $0.0 == code }?.1 ?? "Notice" }
}

// MARK: - the feed

@MainActor @Observable
final class SamFeed {
    static let shared = SamFeed()
    private(set) var match: OpportunityMatch?
    private(set) var busy = false
    private(set) var lastError = ""
    private(set) var last: Date? = UserDefaults.standard.object(forKey: "sam.last") as? Date
    private var notices: [SamNotice] = []
    private var cacheLoaded = false
    private var matchKey = ""

    private static var cacheURL: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("sam-opportunities.json")
    }

    /// Whether there is anything to show: the sample network's demo notices, or a saved key.
    func available(_ model: AppModel) -> Bool { model.info.isSample || SamSettings.hasKey }

    /// Fetches from SAM.gov when it's been six hours (or `force`), then matches to the network.
    func refresh(model: AppModel, force: Bool = false) async {
        if model.info.isSample {
            notices = (try? await model.engine.call("demoOpportunities", as: [SamNotice].self)) ?? []
            await rematch(model: model, force: force)
            return
        }
        // just left the sample network: drop its demo notices
        if notices.contains(where: { $0.demo == true }) { notices = []; cacheLoaded = false; match = nil }
        guard let key = SamSettings.apiKey else { match = nil; notices = []; return }
        loadCache()
        if !force, let last, Date().timeIntervalSince(last) < 6 * 3600 {
            await rematch(model: model)
            return
        }
        guard !busy else { return }
        busy = true
        defer { busy = false }

        let reqs = (try? await model.engine.call("opportunityRequests", [SamSettings.filters, 14], as: [SamRequest].self)) ?? []
        var got: [SamNotice] = []
        var err = ""
        var code = ""
        var answered = false
        var failed: [SamRequest] = []
        for r in reqs {
            guard var c = URLComponents(string: "https://api.sam.gov/opportunities/v2/search") else { continue }
            var q: [URLQueryItem] = [.init(name: "api_key", value: key), .init(name: "postedFrom", value: r.postedFrom), .init(name: "postedTo", value: r.postedTo),
                                     .init(name: "limit", value: String(r.limit)), .init(name: "offset", value: String(r.offset))]
            if let p = r.ptype { q.append(.init(name: "ptype", value: p)) }
            if let n = r.ncode { q.append(.init(name: "ncode", value: n)) }
            c.queryItems = q
            guard let url = c.url else { continue }
            var req = URLRequest(url: url, timeoutInterval: 40)
            req.setValue("application/json", forHTTPHeaderField: "Accept")
            do {
                let (data, resp) = try await URLSession.shared.data(for: req)
                let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
                // the engine reads the status too, so a 429 or an HTML error page reads in plain English
                let page = try await model.engine.call("opportunityPage", [String(decoding: data, as: UTF8.self), status], as: SamPage.self)
                if let e = page.error, !e.isEmpty {
                    err = e
                    code = page.code ?? ""
                    failed.append(r)
                    if code == "key" || code == "rate" { break }
                    continue
                }
                got += page.items
                answered = true
            } catch {
                err = "Couldn’t reach SAM.gov. Check your connection and try again."
                code = ""
                failed.append(r)
            }
        }
        // a good answer, a bad key or a used-up limit waits six hours, so the daily limit lasts;
        // a dropped connection or a server error tries again at the next check
        if answered || code == "key" || code == "rate" {
            last = Date()
            UserDefaults.standard.set(last, forKey: "sam.last")
        }
        lastError = answered && failed.isEmpty ? "" : err
        guard answered else { await rematch(model: model); return }
        // a search that failed keeps the notices it brought back last time
        if !failed.isEmpty, let merged = try? await model.engine.call("mergeOpportunities", [Self.jsonObject(notices), Self.jsonObject(got), failed.map { ["ncode": $0.ncode ?? ""] }], as: [SamNotice].self) {
            got = merged
        }
        notices = got
        saveCache()

        // what counts as new: anything not seen before this check
        let prior = UserDefaults.standard.stringArray(forKey: "sam.seen")
        if let prior { UserDefaults.standard.set(prior, forKey: "sam.seenPrev") } else { UserDefaults.standard.removeObject(forKey: "sam.seenPrev") }
        await rematch(model: model, force: true)
        guard let m = match else { return }
        let next = (try? await model.engine.call("markOpportunitiesSeen", [prior ?? [], m.ids], as: [String].self)) ?? m.ids
        UserDefaults.standard.set(next, forKey: "sam.seen")
        if prior != nil { await notify(m.alerts, model: model) }
    }

    /// Matches the saved notices to the network again, when the network or the filters changed.
    func rematch(model: AppModel, force: Bool = false) async {
        let key = "\(model.info.isSample)-\(model.info.rev)-\(model.info.edits)-\(model.info.count)-\(model.targets.count)-\(notices.count)-\(SamSettings.naics)|\(SamSettings.keywords)|\(SamSettings.types.joined())|\(SamSettings.setAsides.joined())|\(SamSettings.hideIneligible)"
        if !force && key == matchKey && match != nil { return }
        var opts = SamSettings.filters
        if !model.info.isSample, let seen = UserDefaults.standard.stringArray(forKey: "sam.seenPrev") { opts["seen"] = seen }
        match = try? await model.engine.call("matchOpportunities", [Self.jsonObject(notices), opts], as: OpportunityMatch.self)
        matchKey = key
    }

    /// Notices at one agency or command, for its page. Nil when the name isn't a federal agency.
    func at(_ name: String, model: AppModel) async -> OpportunityMatch? {
        guard available(model) else { return nil }
        if notices.isEmpty { await refresh(model: model) }
        var opts = SamSettings.filters
        opts["agency"] = name
        opts["all"] = true
        return try? await model.engine.call("matchOpportunities", [Self.jsonObject(notices), opts], as: OpportunityMatch.self)
    }

    func opportunity(_ id: String) -> Opportunity? { match?.items.first { $0.id == id } }

    /// After the key is removed: nothing to show, nothing cached.
    func clear() {
        notices = []
        match = nil
        lastError = ""
        last = nil
        matchKey = ""
        for k in ["sam.last", "sam.seen", "sam.seenPrev"] { UserDefaults.standard.removeObject(forKey: k) }
        try? FileManager.default.removeItem(at: Self.cacheURL)
    }

    /// The filters changed: check again on the next refresh rather than in six hours.
    func filtersChanged() {
        last = nil
        UserDefaults.standard.removeObject(forKey: "sam.last")
    }

    private func loadCache() {
        guard !cacheLoaded else { return }
        cacheLoaded = true
        if let d = try? Data(contentsOf: Self.cacheURL), let v = try? JSONDecoder().decode([SamNotice].self, from: d) { notices = v }
    }

    private func saveCache() {
        if let d = try? JSONEncoder().encode(notices) { try? d.write(to: Self.cacheURL, options: .atomic) }
    }

    private static func jsonObject(_ n: [SamNotice]) -> Any {
        guard let d = try? JSONEncoder().encode(n), let o = try? JSONSerialization.jsonObject(with: d) else { return [Any]() }
        return o
    }

    /// A local notification for new notices at agencies where you know three or more people,
    /// that you watch, or where you have a pursuit (the engine picks them).
    private func notify(_ alerts: [OpportunityMatch.Alert], model: AppModel) async {
        guard SamSettings.notify, UserDefaults.standard.object(forKey: "notify") as? Bool ?? true, !model.info.isSample, !alerts.isEmpty else { return }
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
        for a in alerts.prefix(3) {
            let c = UNMutableNotificationContent()
            c.title = a.title
            c.body = a.body
            c.sound = .default
            c.userInfo = ["opportunity": a.id]
            try? await center.add(UNNotificationRequest(identifier: "sam-\(a.id)", content: c, trigger: nil))
        }
    }
}

// MARK: - Today: new at agencies you know

struct OpportunitiesCard: View {
    @Environment(AppModel.self) private var model
    private var feed: SamFeed { SamFeed.shared }

    var body: some View {
        let items = Array((feed.match?.items ?? []).prefix(3))
        if feed.available(model), !items.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("NEW AT AGENCIES YOU KNOW").font(Theme.eyebrow).tracking(1.1).foregroundStyle(Theme.text2)
                    Spacer()
                    Button("All") { Haptic.tap(); model.open(.opportunities) }.font(Theme.geist(.footnote, .semibold))
                }
                ForEach(items) { o in
                    Button { Haptic.tap(); model.open(.opportunity(o.id)) } label: { OpportunityRow(o: o) }
                        .buttonStyle(.plain)
                    if o.id != items.last?.id { Theme.line.frame(height: 1) }
                }
                if model.info.isSample {
                    Text("Sample notices. Add your SAM.gov key in Settings to see real ones.").font(Theme.geist(.caption)).foregroundStyle(Theme.text3)
                }
            }
            .padding(16)
            .card(22)
        }
        Color.clear.frame(height: 0)
            .task(id: "\(model.loaded)-\(model.info.rev)-\(model.info.isSample)-\(model.targets.count)") {
                guard model.loaded else { return }
                await feed.refresh(model: model)
            }
    }
}

/// Title, agency, type, due date and who you know there.
struct OpportunityRow: View {
    @Environment(AppModel.self) private var model
    let o: Opportunity

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if o.isNew { Circle().fill(Theme.needs).frame(width: 7, height: 7).accessibilityLabel("New") }
                Text(([o.agency, o.type] + (o.dueText.isEmpty ? [] : [o.dueText])).joined(separator: " · ").uppercased())
                    .font(Theme.eyebrow).tracking(0.8).foregroundStyle(o.days.map { $0 <= 7 } == true ? Theme.needs : Theme.accent)
                    .lineLimit(1)
                if o.watched { Image(systemName: "star.fill").font(.caption2).foregroundStyle(Theme.amber).accessibilityLabel("On your watchlist") }
                if o.fit == "no" { Text("Not eligible").font(Theme.geist(.caption2, .semibold)).foregroundStyle(Theme.needs) }
                else if o.fit == "yes" { Text("Your set-aside").font(Theme.geist(.caption2, .semibold)).foregroundStyle(Theme.good) }
            }
            Text(o.title).font(Theme.serif(.body)).foregroundStyle(.primary).multilineTextAlignment(.leading).lineLimit(3)
            HStack(spacing: 8) {
                let ps = model.persons(o.people.map(\.k))
                if !ps.isEmpty { AvatarStack(people: ps, size: 22) }
                Text(o.line).font(Theme.geist(.caption)).foregroundStyle(.secondary).lineLimit(2)
            }
            if !o.pursuit.isEmpty {
                Label(o.pursuit, systemImage: "scope").font(Theme.geist(.caption, .semibold)).foregroundStyle(Theme.info).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}

// MARK: - the list

struct OpportunitiesView: View {
    @Environment(AppModel.self) private var model
    @State private var kind = "all"
    private var feed: SamFeed { SamFeed.shared }

    var body: some View {
        List {
            if !feed.available(model) {
                awardLinks
                Section {
                    ContentUnavailableView {
                        Label("Add your SAM.gov key", systemImage: "building.columns")
                    } description: {
                        Text("Northfix can show new SAM.gov notices at the agencies where you know people. It uses your own free SAM.gov key.")
                    } actions: {
                        Button("Open Settings") { model.showSettings = true }.buttonStyle(PillButtonStyle(kind: .primary))
                    }
                }
            } else if let m = feed.match {
                Section {
                    header(m)
                    let kinds = SamSettings.allTypes.filter { (m.types[$0.0] ?? 0) > 0 }
                    if kinds.count > 1 {
                        Picker("Type", selection: $kind) {
                            Text("All types").tag("all")
                            ForEach(kinds, id: \.0) { k in Text("\(k.1) (\(m.types[k.0] ?? 0))").tag(k.0) }
                        }
                    }
                }
                let rows = m.items.filter { kind == "all" || $0.kind == kind }
                if rows.isEmpty {
                    Section { Text(m.total == 0 ? "No notices yet. Pull down to check SAM.gov." : "Nothing at agencies you know with these filters.").foregroundStyle(.secondary) }
                } else {
                    Section {
                        ForEach(rows) { o in
                            NavigationLink(value: Route.opportunity(o.id)) { OpportunityRow(o: o) }
                        }
                    }
                }
                Section {
                    Text(footer).font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                    Button("SAM.gov settings") { model.showSettings = true }.font(Theme.geist(.footnote, .semibold))
                }
                awardLinks
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Opportunities")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await feed.refresh(model: model, force: true) }
        .task(id: "\(model.info.rev)-\(model.info.isSample)") { await feed.refresh(model: model) }
    }

    /// Recompetes and teaming partners, from USASpending.gov. No key needed.
    private var awardLinks: some View {
        Section {
            NavigationLink(value: Route.recompetes) { Label("Recompetes: contracts ending soon", systemImage: "arrow.triangle.2.circlepath.doc.on.clipboard") }
            NavigationLink(value: Route.teaming) { Label("Teaming partners", systemImage: "person.2.badge.gearshape") }
        } footer: {
            Text("Contract data from USASpending.gov. Only the agency name is sent.")
        }
    }

    private func header(_ m: OpportunityMatch) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("SAM.GOV, LAST 14 DAYS").font(Theme.eyebrow).tracking(1.1).foregroundStyle(Theme.text2)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(m.matched)").font(Theme.serif(.largeTitle, .semibold))
                Text(m.matched == 1 ? "notice at an agency you know or watch" : "notices at agencies you know or watch").font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
            }
            if m.newCount > 0 {
                Text("\(m.newCount) new since the last check").font(Theme.geist(.footnote, .semibold)).foregroundStyle(Theme.needs)
            }
            if !feed.lastError.isEmpty {
                Text(feed.lastError).font(Theme.geist(.footnote)).foregroundStyle(Theme.bad)
            }
        }
        .padding(.vertical, 4)
    }

    private var footer: String {
        if model.info.isSample { return "These are sample notices with made-up numbers, matched to the sample network. Add your own SAM.gov key in Settings to see real ones." }
        var s = "Northfix checks SAM.gov at most every 6 hours, straight from this device, and matches notices to the people you know here. Nothing goes to a Northfix server."
        if let last = feed.last { s += " Last checked \(last.formatted(.relative(presentation: .named)))." }
        return s
    }
}

// MARK: - one notice

struct OpportunityView: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var startingPursuit = false
    private var feed: SamFeed { SamFeed.shared }

    var body: some View {
        List {
            if let o = feed.opportunity(id) {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(([o.type] + (o.dueText.isEmpty ? [] : [o.dueText])).joined(separator: " · ").uppercased())
                            .font(Theme.eyebrow).tracking(1.0).foregroundStyle(o.days.map { $0 <= 7 } == true ? Theme.needs : Theme.accent)
                        Text(o.title).font(Theme.serif(.title2, .semibold)).fixedSize(horizontal: false, vertical: true)
                        Text(o.agencyName + (o.office.isEmpty ? "" : ", \(o.office)")).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                        if o.demo {
                            Label("A sample notice. The number is made up.", systemImage: "info.circle").font(Theme.geist(.footnote)).foregroundStyle(Theme.info)
                        }
                    }
                    .padding(.vertical, 4)
                    if let url = URL(string: o.link), !o.link.isEmpty {
                        Link(destination: url) { Label("Open on SAM.gov", systemImage: "arrow.up.right.square") }
                            .font(Theme.geist(.body, .semibold))
                    }
                }
                Section("People you know there") {
                    if o.people.isEmpty {
                        Text(o.pursuit.isEmpty ? "No one yet. You watch this agency." : "No one yet. It’s on your pursuit \(o.pursuit).").foregroundStyle(.secondary)
                    }
                    ForEach(o.people, id: \.k) { w in
                        if let p = model.person(w.k) {
                            Button { model.open(.person(w.k)) } label: { PersonRow(person: p, lens: model.info.lens) }
                                .buttonStyle(.plain)
                        }
                    }
                    if o.known > o.people.count {
                        Button("See all \(o.known) at \(o.agency)") { model.open(.unit(o.agency)) }
                    }
                    Text(o.line).font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                }
                Section {
                    Button { model.introQuery = o.agency } label: { Label("Find a way in", systemImage: "point.3.connected.trianglepath.dotted") }
                    if !o.pursuitId.isEmpty {
                        Button { model.open(.pursuit(o.pursuitId)) } label: { Label("Pursuit: \(o.pursuit)", systemImage: "scope") }
                    } else {
                        Button { startingPursuit = true } label: { Label("Start a pursuit for this", systemImage: "scope") }
                    }
                    if !o.watched && !o.agencyId.isEmpty {
                        Button { Task { await model.toggleTarget(o.agency); await feed.rematch(model: model, force: true) } } label: { Label("Watch \(o.agency)", systemImage: "star") }
                    }
                }
                Section("Details") {
                    if !o.sol.isEmpty { LabeledContent("Notice number", value: o.sol) }
                    if !o.posted.isEmpty { LabeledContent("Posted", value: Day.nice(o.posted)) }
                    if !o.due.isEmpty { LabeledContent("Responses due", value: Day.nice(o.due)) }
                    if !o.naics.isEmpty { LabeledContent("NAICS", value: o.naics) }
                    if !o.setAside.isEmpty { LabeledContent("Set-aside", value: o.setAside + (o.fit == "no" ? " (not eligible)" : o.fit == "yes" ? " (you qualify)" : "")) }
                    if let a = o.award {
                        if let w = a.awardee, !w.isEmpty { LabeledContent("Awarded to", value: w) }
                        if let amt = a.amount, let v = Double(amt), v > 0 { LabeledContent("Amount", value: v.formatted(.currency(code: "USD").precision(.fractionLength(0)))) }
                    }
                    if !o.area.isEmpty { LabeledContent("Part of", value: o.area) }
                    Text(o.path).font(Theme.geist(.caption)).foregroundStyle(.secondary)
                }
            } else {
                Section { Text("This notice is no longer in the last 14 days of SAM.gov.").foregroundStyle(.secondary) }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Notice")
        .navigationBarTitleDisplayMode(.inline)
        .task { if feed.opportunity(id) == nil { await feed.refresh(model: model) } }
        .sheet(isPresented: $startingPursuit) {
            NewPursuitSheet(agency: feed.opportunity(id)?.agency ?? "").environment(AppModel.shared)
        }
    }
}

// MARK: - on an agency's page

/// "Open on SAM.gov": the notices at this agency, when it is one on the federal map.
/// The page loads `match` with `SamFeed.shared.at(name, model:)`; nothing shows when it's empty.
struct SamUnitSection: View {
    @Environment(AppModel.self) private var model
    let match: OpportunityMatch?

    var body: some View {
        if let m = match, !m.items.isEmpty {
            Section {
                ForEach(m.items.prefix(5)) { o in
                    Button { model.open(.opportunity(o.id)) } label: { OpportunityRow(o: o) }
                        .buttonStyle(.plain)
                }
                if m.items.count > 5 {
                    Button("All opportunities") { model.open(.opportunities) }
                }
            } header: {
                Text("Open on SAM.gov: \(m.items.count)")
            }
        }
    }
}

// MARK: - settings

struct SamSettingsSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var key = ""
    @State private var hasKey = SamSettings.hasKey
    @State private var naics = SamSettings.naics
    @State private var keywords = SamSettings.keywords
    @State private var types = Set(SamSettings.types)
    @State private var notify = SamSettings.notify
    @State private var setAsides = Set(SamSettings.setAsides)
    @State private var hideIneligible = SamSettings.hideIneligible
    @State private var status = ""
    @State private var checking = false
    @State private var dirty = false

    var body: some View {
        Section {
            SecureField(hasKey ? "Public API key (saved)" : "Public API key", text: $key)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button(checking ? "Checking SAM.gov…" : "Save and check") { save() }
                .disabled(checking || key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            if hasKey {
                TextField("NAICS codes (optional)", text: $naics, prompt: Text("NAICS codes, like 541512, 541330"))
                    .keyboardType(.numbersAndPunctuation)
                    .onChange(of: naics) { _, v in SamSettings.naics = v; dirty = true }
                TextField("Keywords (optional)", text: $keywords, prompt: Text("Keywords, like SCADA, control systems"))
                    .textInputAutocapitalization(.never)
                    .onChange(of: keywords) { _, v in SamSettings.keywords = v; dirty = true }
                ForEach(SamSettings.allTypes, id: \.0) { t in
                    Toggle(t.1, isOn: Binding(
                        get: { types.contains(t.0) },
                        set: { on in
                            if on { types.insert(t.0) } else if types.count > 1 { types.remove(t.0) }
                            SamSettings.types = SamSettings.allTypes.map(\.0).filter { types.contains($0) }
                            dirty = true
                        }))
                }
                DisclosureGroup("Set-asides you qualify for\(setAsides.isEmpty ? "" : " (\(setAsides.count))")") {
                    ForEach(SamSettings.allSetAsides, id: \.0) { t in
                        Toggle(t.1, isOn: Binding(
                            get: { setAsides.contains(t.0) },
                            set: { on in
                                if on { setAsides.insert(t.0) } else { setAsides.remove(t.0) }
                                SamSettings.setAsides = SamSettings.allSetAsides.map(\.0).filter { setAsides.contains($0) }
                                dirty = true
                            }))
                    }
                    Toggle("Hide notices I can’t bid on", isOn: $hideIneligible)
                        .onChange(of: hideIneligible) { _, v in SamSettings.hideIneligible = v; dirty = true }
                }
                Toggle("Notify me about new ones", isOn: $notify)
                    .onChange(of: notify) { _, v in SamSettings.notify = v }
                Button("Remove key", role: .destructive) {
                    SecretStore.set(SamSettings.keyName, nil)
                    SamFeed.shared.clear()
                    hasKey = false
                    status = "Removed."
                }
            } else {
                Button("Get a free key on SAM.gov") { openURL(SamSettings.keyPage) }
            }
            if !status.isEmpty { Text(status).font(Theme.geist(.footnote)).foregroundStyle(Theme.text2) }
        } header: {
            Text("SAM.gov opportunities")
        } footer: {
            Text(hasKey
                 ? "Your key and searches go straight from this device to SAM.gov. Northfix looks at notices posted in the last 14 days, at most every 6 hours, and matches them to the people you know on this device. Leave NAICS and keywords empty to see everything at agencies you know. Pick your set-asides to mark notices you can’t bid on. You get a notification when a new one appears at an agency you watch or where you know 3 or more people."
                 : "Your key and searches go straight from this device to SAM.gov. To get a free key, sign in at SAM.gov, open Account Details, and choose Public API Key. You’ll need your password to see it. Copy it, then paste it here. It stays in this device’s Keychain.")
        }
        .onDisappear {
            guard dirty else { return }
            dirty = false
            SamFeed.shared.filtersChanged()
            Task { await SamFeed.shared.refresh(model: model, force: true) }
        }
    }

    private func save() {
        let k = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !k.isEmpty else { return }
        SecretStore.set(SamSettings.keyName, k)
        key = ""
        hasKey = true
        checking = true
        status = ""
        Task {
            if model.info.isSample {
                status = "Saved. You’re on the sample network, so Northfix shows sample notices until you import your own."
            } else {
                await SamFeed.shared.refresh(model: model, force: true)
                let feed = SamFeed.shared
                if !feed.lastError.isEmpty {
                    status = feed.lastError
                } else {
                    let n = feed.match?.matched ?? 0
                    status = "Connected. \(n) \(n == 1 ? "notice" : "notices") at agencies you know or watch."
                }
            }
            checking = false
        }
    }
}
