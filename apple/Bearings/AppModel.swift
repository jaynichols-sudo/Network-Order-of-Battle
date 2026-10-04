import Foundation
import SwiftUI
import Observation
import CoreLocation
import WidgetKit

enum AppTab: String, Hashable, CaseIterable {
    case home, people, companies, explore, catchup

    var title: String {
        switch self {
        case .home: return "Home"
        case .people: return "People"
        case .companies: return "Companies"
        case .explore: return "Explore"
        case .catchup: return "Catch Up"
        }
    }
    var icon: String {
        switch self {
        case .home: return "house"
        case .people: return "person.2"
        case .companies: return "building.2"
        case .explore: return "scope"
        case .catchup: return "rectangle.stack"
        }
    }
}

enum Route: Hashable {
    case person(String)
    case unit(String)
    case industry(String)
    case meeting(String)
    case trip(String)
    case trips
}

enum CompaniesMode: String, CaseIterable, Identifiable {
    case watchlist, industries, all
    var id: String { rawValue }
    var label: String {
        switch self {
        case .watchlist: return "Watchlist"
        case .industries: return "Industries"
        case .all: return "All"
        }
    }
}

struct ShareFile: Identifiable {
    let id = UUID()
    let url: URL
}

/// App-wide state. Owns the engine and the saved files, and turns user actions
/// into engine calls plus saves.
@MainActor
@Observable
final class AppModel {
    /// The one model, shared with Siri, Shortcuts and Spotlight.
    static let shared = AppModel()

    private(set) var engine = Engine()
    let store = CloudStore()

    // loaded data
    private(set) var info = EngineInfo.blank
    private(set) var people: [Person] = []
    private(set) var byKey: [String: Person] = [:]
    private(set) var home = HomeData.empty
    private(set) var constants = Constants.empty
    private(set) var targets: [TargetSummary] = []
    private(set) var loaded = false
    private(set) var isCloud = false
    var syncNote = ""
    var errorNote = ""
    var toast: String?

    // places
    private(set) var places: [String: PersonPlace] = [:]
    private var foundPlaces: [String: PersonPlace] = [:]
    private var companyPlaced: [String: PersonPlace] = [:]
    private(set) var placesBuilt = ""
    private(set) var contactsMatched = 0
    private(set) var locating = false

    // navigation
    var tab: AppTab = .home
    var paths: [AppTab: [Route]] = [:]
    var companiesMode: CompaniesMode = .watchlist
    var showImport = false
    var showSettings = false
    var showAddTarget = false
    var showOnboarding = false
    var showPayoff = false
    var shareFile: ShareFile?
    var pendingImportURL: URL?

    // people search
    var searchText = "" { didSet { scheduleSearch() } }
    var filters = Filters() { didSet { if filters != oldValue { scheduleSearch() } } }
    var sort: SortOrder = .new { didSet { if sort != oldValue { scheduleSearch() } } }
    private(set) var results: [Person] = []
    private(set) var chips: [String] = []
    private var searchTask: Task<Void, Never>?

    private var reloadTask: Task<Void, Never>?
    private var watchTask: Task<Void, Never>?

    var prefs: UserDefaults { .standard }
    var lensPref: Bool? {
        get { prefs.object(forKey: "lens") as? Bool }
        set { if let v = newValue { prefs.set(v, forKey: "lens") } else { prefs.removeObject(forKey: "lens") } }
    }
    var lensArg: Any { lensPref.map { $0 as Any } ?? NSNull() }
    var salesNav: Bool { prefs.bool(forKey: "salesnav") }
    var firstName: String { (prefs.string(forKey: "name") ?? "").split(separator: " ").first.map(String.init) ?? "" }
    var lastBackup: String { prefs.string(forKey: "lastBackup") ?? "" }

    func person(_ k: String) -> Person? { byKey[k] }
    func persons(_ keys: [String]) -> [Person] { keys.compactMap { byKey[$0] } }

    // MARK: loading

    @ObservationIgnored private var startTask: Task<Void, Never>?

    /// Safe to call from anywhere (Siri, widgets, the app); the first caller does the work, others wait.
    func start() async {
        if let t = startTask { await t.value; return }
        let t = Task { @MainActor in await self.doStart() }
        startTask = t
        await t.value
    }

    private func doStart() async {
        guard !loaded else { return }
        Theme.configureAppearance()
        constants = (try? await engine.call("constants", as: Constants.self)) ?? .empty
        store.onRemoteChange = { [weak self] in
            Task { @MainActor in self?.scheduleReload() }
        }
        isCloud = await store.isCloud()
        await reload()
        loaded = true
        store.startWatching()
        WatchLink.shared.start()
        WatchLink.shared.onAction = { [weak self] in Task { @MainActor in await self?.drainWatch() } }
        await drainWatch()
        Notifications.shared.onAction = { [weak self] k, action in Task { @MainActor in await self?.handleNotification(k: k, action: action) } }
        Notifications.shared.deliverPending()
        if info.isSample && !prefs.bool(forKey: "onboarded") { showOnboarding = true }
        applyDemoArguments()
        if let u = pendingDeepLink { pendingDeepLink = nil; openDeepLink(u) }
    }

    /// Launch arguments used by CI to capture screenshots, e.g. -startTab people -demoOpen person.
    private func applyDemoArguments() {
        if let t = prefs.string(forKey: "startTab"), let tab = AppTab(rawValue: t) { self.tab = tab }
        if let m = prefs.string(forKey: "startCompanies"), let mode = CompaniesMode(rawValue: m) { companiesMode = mode }
        switch prefs.string(forKey: "demoOpen") ?? "" {
        case "person":
            let k = (people.filter { !$0.waiting && $0.rx != nil }.max { $0.score < $1.score } ?? people.first)?.k
            if let k { paths[tab, default: []].append(.person(k)) }
        case "unit":
            if let t = targets.first { paths[tab, default: []].append(.unit(t.name)) }
        case "settings": showSettings = true
        case "import": showImport = true
        case "filters": showFiltersOnLaunch = true
        default: break
        }
    }
    var showFiltersOnLaunch = false
    private var pendingDeepLink: URL?

    func scheduleReload() {
        reloadTask?.cancel()
        reloadTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            if Task.isCancelled { return }
            await reload()
        }
    }

    /// Reads every saved file and loads them into the engine.
    func reload() async {
        if engine.today != Day.today { engine = Engine(); constants = (try? await engine.call("constants", as: Constants.self)) ?? constants }
        let net = await store.read("network.json")
        if case .pending = net {
            syncNote = "Downloading your network from iCloud. This can take a minute on a new device."
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 6_000_000_000)
                await reload()
            }
            if !loaded { await loadSample() }
            return
        }
        syncNote = ""
        var texts: [String: Any] = [:]
        if case .data(let t) = net, let t { texts["network"] = t }
        for (key, file) in [("edits", "edits.json"), ("review", "review.json"), ("targets", "targets.json"), ("industries", "industries.json")] {
            if case .data(let t) = await store.read(file), let t { texts[key] = t }
        }
        do {
            info = try await engine.call("loadFiles", [texts, lensArg], as: EngineInfo.self)
            errorNote = ""
        } catch {
            errorNote = "Your saved network didn’t load (\(error.localizedDescription)). Close and reopen the app to try again."
        }
        if case .data(let t) = await store.read("places.json"), let t, let d = t.data(using: .utf8),
           let f = try? JSONDecoder().decode(PlacesFile.self, from: d) {
            foundPlaces = f.people
            placesBuilt = f.built
            contactsMatched = f.matched ?? 0
        }
        await refreshAll()
    }

    func loadSample() async {
        info = (try? await engine.call("loadSample", as: EngineInfo.self)) ?? info
        await refreshAll()
    }

    /// Pulls everything the screens show from the engine.
    func refreshAll() async {
        do {
            let list = try await engine.call("people", as: [Person].self)
            people = list
            byKey = Dictionary(list.map { ($0.k, $0) }, uniquingKeysWith: { a, _ in a })
        } catch {
            errorNote = error.localizedDescription
        }
        await refreshSummary()
        await runSearch()
        await refreshCompanyPlaces()
        mergePlaces()
        Task { await CalendarService.shared.scan(model: self) }
        SpotlightIndex.update(people, sample: info.isSample)
        Notifications.shared.schedule(model: self)
        pushWatch()
    }

    // MARK: places

    struct PlacesFile: Codable {
        var v = 1
        var built: String
        var matched: Int?
        var people: [String: PersonPlace]
    }

    /// Your own settings win: the person first, then their company or office. Then Contacts and title clues.
    func mergePlaces() {
        var out = info.isSample ? Locator.samplePlaces(people) : foundPlaces
        for (k, pl) in companyPlaced { out[k] = pl }
        for p in people {
            if let e = p.ed, !e.loc.isEmpty, let la = e.lat, let lo = e.lon {
                out[p.k] = PersonPlace(name: e.loc, lat: la, lon: lo, prec: "city", src: "you")
            }
        }
        places = out
    }

    /// Works out where people are from Contacts and job titles. Asks for Contacts access first.
    func locate(askContacts: Bool = true) async {
        guard !locating, !info.isSample else { return }
        locating = true
        defer { locating = false }
        if askContacts { _ = await Locator.requestContacts() }
        let clues = (try? await engine.call("placeClues", as: [[String]].self)) ?? []
        let r = await Locator.build(people: people, clues: clues)
        foundPlaces = r.places
        contactsMatched = r.matched
        placesBuilt = Day.today
        let file = PlacesFile(built: placesBuilt, matched: r.matched, people: r.places)
        if let d = try? JSONEncoder().encode(file) { try? await store.write("places.json", String(decoding: d, as: UTF8.self)) }
        mergePlaces()
        show("Found a location for \(places.count.formatted()) \(places.count == 1 ? "person" : "people")")
    }

    func setLocation(_ k: String, query: String) async -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces)
        if q.isEmpty {
            await edit(k, call: "setEdit", [k, ["loc": "", "lat": NSNull(), "lon": NSNull()]])
            mergePlaces()
            return true
        }
        guard let mark = try? await CLGeocoder().geocodeAddressString(q).first, let loc = mark.location else {
            show("Couldn’t find “\(q)”. Try a city and state or country.")
            return false
        }
        let name = [mark.locality ?? q, mark.administrativeArea ?? mark.country].compactMap { $0 }.joined(separator: ", ")
        await edit(k, call: "setEdit", [k, ["loc": name, "lat": loc.coordinate.latitude, "lon": loc.coordinate.longitude]])
        mergePlaces()
        return true
    }

    private struct Loc: Decodable { var name: String; var lat: Double; var lon: Double }

    private func refreshCompanyPlaces() async {
        let m = (try? await engine.call("companyPlaces", as: [String: Loc].self)) ?? [:]
        companyPlaced = m.mapValues { PersonPlace(name: $0.name, lat: $0.lat, lon: $0.lon, prec: "city", src: "company") }
    }

    /// Sets (or with an empty query, clears) the location for everyone at a company or command.
    func setCompanyLocation(_ company: String, query: String) async -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces)
        var loc: Any = NSNull()
        if !q.isEmpty {
            guard let mark = try? await CLGeocoder().geocodeAddressString(q).first, let l = mark.location else {
                show("Couldn’t find “\(q)”. Try a city and state or country.")
                return false
            }
            let name = [mark.locality ?? q, mark.administrativeArea ?? mark.country].compactMap { $0 }.joined(separator: ", ")
            loc = ["name": name, "lat": l.coordinate.latitude, "lon": l.coordinate.longitude]
        }
        do {
            try await engine.run("setCompanyLocation", [company, loc])
            await saveFile("industries", "industries.json")
            await refreshCompanyPlaces()
            mergePlaces()
            Haptic.success()
            let n = companyPlaced.count
            show(q.isEmpty ? "Location cleared for \(company)" : "Placed everyone at \(company). \(n.formatted()) \(n == 1 ? "person" : "people") placed by company.")
            return true
        } catch {
            show(error.localizedDescription)
            return false
        }
    }

    private func refreshSummary() async {
        if let i = try? await engine.call("info", as: EngineInfo.self) { info = i }
        home = (try? await engine.call("home", [["lastBackup": lastBackup]], as: HomeData.self)) ?? home
        targets = (try? await engine.call("targets", as: [TargetSummary].self)) ?? targets
    }

    /// After an edit to one person, refresh just them plus the summaries.
    private func refreshPerson(_ k: String) async {
        if let p = try? await engine.call("person", [k], as: Person?.self) {
            var copy = p
            copy.links = nil
            byKey[k] = copy
            if let i = people.firstIndex(where: { $0.k == k }) { people[i] = copy }
            if let i = results.firstIndex(where: { $0.k == k }) { results[i] = copy }
        }
        await refreshSummary()
        mergePlaces()
        Notifications.shared.schedule(model: self)
        pushWatch()
    }

    // MARK: search

    private func scheduleSearch() {
        searchTask?.cancel()
        searchTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 150_000_000)
            if Task.isCancelled { return }
            await runSearch()
        }
    }

    func runSearch() async {
        let args: [String: Any] = ["text": searchText, "filters": filters.json, "sort": sort.rawValue]
        guard let r = try? await engine.call("search", [args], as: SearchResult.self) else { return }
        results = r.keys.compactMap { byKey[$0] }
        chips = r.chips
    }

    var queryArgs: [String: Any] { ["text": searchText, "filters": filters.json] }

    func facets() async -> Facets? {
        try? await engine.call("facets", [queryArgs], as: Facets.self)
    }

    func clearFilters() {
        filters = Filters()
        searchText = ""
    }

    // MARK: edits

    private func saveFile(_ engineName: String, _ file: String) async {
        guard !info.isSample, let json = await engine.fileJSON(engineName) else { return }
        do { try await store.write(file, json) } catch { show("Couldn’t save: \(error.localizedDescription)") }
    }

    private func edit(_ k: String, call: String, _ args: [Any]) async {
        do {
            try await engine.run(call, args)
            await saveFile("edits", "edits.json")
            await refreshPerson(k)
        } catch { show(error.localizedDescription) }
    }

    func toggleStar(_ k: String) async {
        let on = !(byKey[k]?.starred ?? false)
        if on { Haptic.star() } else { Haptic.tap() }
        await edit(k, call: "setEdit", [k, ["star": on]])
    }

    func followUp(_ k: String, days: Int) async {
        await edit(k, call: "followUp", [k, days])
        if days > 0 {
            Haptic.star()
            show("We’ll remind you on \(Day.nice(Day.plus(days)))")
            await Notifications.shared.requestPermission()
            Notifications.shared.schedule(model: self)
        } else {
            Haptic.tap()
            show("Follow-up cleared")
        }
    }

    func markReplied(_ k: String) async {
        Haptic.success()
        await edit(k, call: "markReplied", [k])
        show("Marked as replied")
    }

    func addNote(_ k: String, _ text: String, source: String = "") async {
        await edit(k, call: "addNote", [k, text, source])
    }

    /// Saves the notes and corrections form. Industry can apply to the whole company.
    func saveProfile(_ k: String, patch: [String: Any], companyIndustry: (company: String, ind: String)?) async {
        do {
            var p = patch
            if let ci = companyIndustry {
                try await engine.run("setCompanyIndustry", [ci.company, ci.ind])
                await saveFile("industries", "industries.json")
                p["ind"] = ""
            }
            try await engine.run("setEdit", [k, p])
            await saveFile("edits", "edits.json")
            if companyIndustry != nil { await refreshAll() } else { await refreshPerson(k) }
            Haptic.success()
            show(info.isSample ? "Sample data: changes aren’t saved" : (isCloud ? "Saved and syncing to iCloud" : "Saved"))
        } catch { show("Couldn’t save: \(error.localizedDescription)") }
    }

    // MARK: companies

    func toggleTarget(_ name: String) async {
        struct R: Decodable { let on: Bool }
        guard let r = try? await engine.call("toggleTarget", [name], as: R.self) else { return }
        if r.on { Haptic.star() } else { Haptic.tap() }
        show(r.on ? "Added \(name) to your watchlist" : "Removed \(name) from your watchlist")
        await saveFile("targets", "targets.json")
        await refreshSummary()
    }

    func isTarget(_ name: String) -> Bool { targets.contains { $0.name == name } }

    func setTargetNote(_ name: String, _ note: String) async {
        try? await engine.run("setTargetNote", [name, note])
        await saveFile("targets", "targets.json")
    }

    func setCompanyIndustry(_ company: String, _ ind: String) async {
        do {
            try await engine.run("setCompanyIndustry", [company, ind])
            await saveFile("industries", "industries.json")
            await refreshAll()
        } catch { show(error.localizedDescription) }
    }

    func setCompanyLink(_ company: String, _ url: String) async -> Bool {
        do {
            try await engine.run("setCompanyLink", [company, url])
            await saveFile("industries", "industries.json")
            Haptic.success()
            show(url.isEmpty ? "Removed the saved page" : "Saved. That link opens the exact page now.")
            return true
        } catch {
            show(error.localizedDescription)
            return false
        }
    }

    func unit(_ name: String) async -> UnitDetail? { try? await engine.call("unit", [name], as: UnitDetail.self) }
    func industries(gov: Bool) async -> IndustriesData? { try? await engine.call("industries", [["gov": gov]], as: IndustriesData.self) }
    func industry(_ id: String) async -> IndustryDetail? { try? await engine.call("industry", [id], as: IndustryDetail.self) }
    func orgs() async -> Orgs? { try? await engine.call("orgs", [["text": "", "filters": Filters().json]], as: Orgs.self) }
    func addCandidates(_ q: String) async -> [NameCount] { (try? await engine.call("addTargetCandidates", [q], as: [NameCount].self)) ?? [] }
    func radar() async -> RadarData { (try? await engine.call("radar", [queryArgs], as: RadarData.self)) ?? .empty }
    func ranks() async -> RanksData? { try? await engine.call("ranks", [queryArgs], as: RanksData.self) }
    func clusters() async -> ClustersData? { try? await engine.call("clusters", [queryArgs, ["max": 40]], as: ClustersData.self) }
    func payoff() async -> Payoff? { try? await engine.call("payoff", as: Payoff.self) }
    /// Swaps in the full record (message snippet, full notes) for a profile.
    func loadFull(_ k: String) async {
        guard var p = try? await engine.call("person", [k], as: Person?.self) else { return }
        p.links = nil
        byKey[k] = p
        if let i = people.firstIndex(where: { $0.k == k }) { people[i] = p }
    }

    func messages(_ k: String, trip: (city: String, when: String)? = nil, meeting: String? = nil) async -> [DraftMessage] {
        var ctx: [String: Any] = [:]
        let me = (prefs.string(forKey: "name") ?? "").trimmingCharacters(in: .whitespaces)
        if !me.isEmpty { ctx["me"] = me }
        if let t = trip { ctx["trip"] = ["city": t.city, "when": t.when] }
        if let m = meeting { ctx["meeting"] = m }
        return (try? await engine.call("messages", [k, ctx], as: [DraftMessage].self)) ?? []
    }

    /// Calendar attendees to people in the network (nil where nobody matches).
    func matchAttendees(_ list: [(email: String, name: String)]) async -> [String?] {
        let arg = list.map { ["email": $0.email, "name": $0.name] }
        return (try? await engine.call("matchAttendees", [arg], as: [String?].self)) ?? Array(repeating: nil, count: list.count)
    }

    func alsoAt(_ keys: [String]) async -> [String: [String]] {
        (try? await engine.call("alsoAt", [keys], as: [String: [String]].self)) ?? [:]
    }

    func links(_ k: String) async -> PersonLinks? {
        guard let p = try? await engine.call("person", [k], as: Person?.self) else { return nil }
        return p.links
    }

    // MARK: catch up

    func deck(_ mode: String) async -> [String] { (try? await engine.call("deck", [mode], as: [String].self)) ?? [] }

    func reviewed(_ k: String, mode: String, star: Bool) async {
        if star && !(byKey[k]?.starred ?? false) {
            Haptic.star()
            try? await engine.run("setEdit", [k, ["star": true]])
            await saveFile("edits", "edits.json")
        } else { Haptic.tap() }
        try? await engine.run("reviewed", [k, mode])
        await saveFile("review", "review.json")
        await refreshPerson(k)
    }

    // MARK: lens

    func setLens(_ on: Bool?) async {
        lensPref = on
        _ = try? await engine.call("setLens", [lensArg], as: EngineInfo.self)
        if !(on ?? info.lensAuto) {
            filters.seg = []; filters.branch = []; filters.status = []; filters.tier = []; filters.agency = ""
            if sort == .rank { sort = .new }
        }
        await refreshAll()
    }

    // MARK: card actions

    func perform(_ a: CardAction) {
        Haptic.tap()
        switch a.kind {
        case "tab":
            if let t = a.tab, let tab = AppTab(rawValue: t) { self.tab = tab }
        case "filter":
            var f = Filters()
            f.sig = Set(a.sig ?? [])
            f.seg = Set(a.seg ?? [])
            f.status = Set(a.status ?? [])
            searchText = ""
            filters = f
            paths[.people] = []
            tab = .people
        case "unit":
            if let n = a.name { paths[tab, default: []].append(.unit(n)) }
        case "addTarget":
            companiesMode = .watchlist
            tab = .companies
            showAddTarget = true
        case "industries":
            companiesMode = .industries
            tab = .companies
        case "backup":
            Task { await backup() }
        default: break
        }
    }

    func open(_ route: Route) { paths[tab, default: []].append(route) }

    /// bearings://person/<key>, bearings://tab/<name>, from widgets.
    func openDeepLink(_ url: URL) {
        guard loaded else { pendingDeepLink = url; return }
        let parts = url.pathComponents.filter { $0 != "/" }
        switch url.host {
        case "person":
            if let raw = parts.first, let k = raw.removingPercentEncoding, byKey[k] != nil {
                tab = .people
                paths[.people] = [.person(k)]
            }
        case "tab":
            if let t = parts.first, let at = AppTab(rawValue: t) { tab = at }
        case "meeting":
            if let id = parts.first?.removingPercentEncoding { tab = .home; paths[.home] = [.meeting(id)] }
        case "trip":
            if let id = parts.first?.removingPercentEncoding { tab = .home; paths[.home] = [.trip(id)] }
        case "filter":
            if let sig = parts.first { perform(CardAction(kind: "filter", tab: nil, name: nil, sig: [sig], seg: nil, status: nil)) }
        default:
            tab = .home
        }
    }

    // MARK: import

    func readImport(_ url: URL) async throws -> ImportPlan {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let data = try Data(contentsOf: url)
        var texts: [String: Any] = [:]
        let isZip = data.count > 4 && data[data.startIndex] == 0x50 && data[data.startIndex + 1] == 0x4B
        if isZip {
            let zip = try ZipReader(data: data)
            guard let conn = try zip.text("connections.csv") else {
                throw Engine.Failure(message: "No Connections.csv inside that zip. Request the export with “Connections” selected.")
            }
            texts["connections"] = conn
            let more = ["messages": "messages.csv", "invitations": "invitations.csv", "endGiven": "endorsement_given_info.csv",
                        "endRecv": "endorsement_received_info.csv", "recGiven": "recommendations_given.csv", "recRecv": "recommendations_received.csv"]
            for (k, f) in more { if let t = try? zip.text(f) { texts[k] = t } }
        } else {
            texts["connections"] = String(decoding: data, as: UTF8.self)
        }
        return try await engine.call("importTexts", [texts, "ios"], as: ImportPlan.self)
    }

    func commitImport(_ plan: ImportPlan) async throws {
        guard let json = await engine.fileJSON("network") else { throw Engine.Failure(message: "Nothing to save. Choose the file again.") }
        try await store.write("network.json", json)
        if plan.wasSample {
            try await engine.run("clearNotes")
            for (n, f) in [("edits", "edits.json"), ("review", "review.json"), ("targets", "targets.json"), ("industries", "industries.json")] {
                if let j = await engine.fileJSON(n) { try await store.write(f, j) }
            }
        }
        prefs.set(true, forKey: "onboarded")
        await reload()
        if Locator.contactsAllowed() || !foundPlaces.isEmpty { await locate(askContacts: false) }
        Haptic.success()
        if plan.wasSample || plan.stats.first {
            tab = .home
            showPayoff = true
        } else {
            show("\(plan.stats.added.formatted()) new, \(plan.stats.changed.formatted()) changed jobs. Catch up from Home.")
        }
    }

    // MARK: backup, restore, export

    func backup() async {
        guard let s = try? await engine.call("backup", as: String.self) else { return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("bearings-notes-\(Day.today).json")
        do {
            try s.write(to: url, atomically: true, encoding: .utf8)
            prefs.set(Day.today, forKey: "lastBackup")
            shareFile = ShareFile(url: url)
            await refreshSummary()
        } catch { show("Backup failed: \(error.localizedDescription)") }
    }

    func restore(_ url: URL) async {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
            let text = try String(contentsOf: url, encoding: .utf8)
            let r = try await engine.call("restore", [text], as: RestoreResult.self)
            for (n, f) in [("edits", "edits.json"), ("review", "review.json"), ("targets", "targets.json"), ("industries", "industries.json")] {
                await saveFile(n, f)
            }
            await refreshAll()
            Haptic.success()
            show("Restored \(r.added.formatted()) \(r.added == 1 ? "person’s notes" : "people’s notes")\(r.kept > 0 ? ", kept \(r.kept.formatted()) newer" : "")")
        } catch { show("Couldn’t restore: \(error.localizedDescription)") }
    }

    func exportCSV(keys: [String]?) async {
        let arg: Any = keys.map { $0 as Any } ?? NSNull()
        guard let csv = try? await engine.call("exportCSV", [arg], as: String.self) else { return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("bearings-\(Day.today).csv")
        do {
            try csv.write(to: url, atomically: true, encoding: .utf8)
            shareFile = ShareFile(url: url)
        } catch { show("Export failed: \(error.localizedDescription)") }
    }

    // MARK: reminders, watch

    func reminders() async -> [Reminder] { (try? await engine.call("reminders", as: [Reminder].self)) ?? [] }

    func handleNotification(k: String?, action: String) async {
        if action.hasPrefix("meeting:") { tab = .home; paths[.home] = [.meeting(String(action.dropFirst(8)))]; return }
        if action.hasPrefix("trip:") { tab = .home; paths[.home] = [.trip(String(action.dropFirst(5)))]; return }
        guard let k else { if action == "refresh" { showImport = true }; return }
        switch action {
        case "done": await followUp(k, days: 0)
        case "snooze": await followUp(k, days: 7)
        default:
            tab = .people
            paths[.people] = [.person(k)]
        }
    }

    private func pushWatch() {
        watchTask?.cancel()
        watchTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            if Task.isCancelled { return }
            // the engine builds the snapshot; pass its JSON straight through
            if let snap = try? await engine.call("watch", [firstName], as: WatchSnapshotJSON.self) {
                WatchLink.shared.send(json: snap.json)
                // the same summary drives the iPhone and iPad widgets
                GlanceStore.save(Glance.from(snap.snapshot))
                WidgetCenter.shared.reloadAllTimelines()
            }
        }
    }

    func drainWatch() async {
        let actions = WatchLink.shared.drain()
        guard !actions.isEmpty else { return }
        if info.isSample { show("Watch changes aren’t saved in the sample network"); return }
        var n = 0
        for a in actions {
            guard let k = a["k"] as? String, let kind = a["kind"] as? String else { continue }
            switch kind {
            case "replied": try? await engine.run("markReplied", [k]); n += 1
            case "follow": try? await engine.run("followUp", [k, (a["days"] as? NSNumber)?.intValue ?? 0]); n += 1
            case "star": try? await engine.run("setEdit", [k, ["star": (a["on"] as? NSNumber)?.boolValue ?? false]]); n += 1
            case "note":
                if let t = a["text"] as? String { try? await engine.run("addNote", [k, t, "watch"]); n += 1 }
            default: break
            }
        }
        if n > 0 {
            await saveFile("edits", "edits.json")
            await refreshAll()
            show("Updated \(n) \(n == 1 ? "person" : "people") from your watch")
        }
    }

    // MARK: toast

    func show(_ message: String) {
        toast = message
        let m = message
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if toast == m { toast = nil }
        }
    }
}

/// Re-encodes the engine's watch snapshot so it can be sent as-is.
struct WatchSnapshotJSON: Decodable {
    let json: String
    let snapshot: WatchSnapshot
    init(from decoder: Decoder) throws {
        let snap = try WatchSnapshot(from: decoder)
        snapshot = snap
        json = String(decoding: (try? JSONEncoder().encode(snap)) ?? Data(), as: UTF8.self)
    }
}
