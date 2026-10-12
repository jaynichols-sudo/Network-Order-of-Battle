import Foundation
import EventKit
import CoreLocation
import UserNotifications
import Observation

/// Reads the iPhone calendar (on device only) to find upcoming meetings with
/// people in your network, and trips away from home, so Northfix can brief you
/// before a meeting and show who's near where you're headed.
@MainActor
@Observable
final class CalendarService {
    static let shared = CalendarService()

    struct Attendee: Hashable {
        var name: String
        var email: String
        var k: String?
    }

    struct Meeting: Identifiable, Hashable {
        var id: String
        var title: String
        var start: Date
        var end: Date
        var location: String
        var attendees: [Attendee]
        var matched: [String] { attendees.compactMap(\.k) }
    }

    /// One flight on a trip, found by the shared engine (src/flights.js).
    struct Flight: Hashable, Codable {
        /// "AA 1234", or empty when only the route is known
        var flight: String
        var from: String
        var to: String
        var dep: Date?
        var arr: Date?
        /// the arrival airport's time zone, like "America/Los_Angeles"
        var tz: String?

        /// "Flight AA 1234, CLT to SAN, lands 2:10 PM"
        var summary: String {
            var parts: [String] = [flight.isEmpty ? "Flight" : "Flight \(flight)"]
            if !from.isEmpty && !to.isEmpty { parts.append("\(from) to \(to)") } else if !to.isEmpty { parts.append("to \(to)") }
            if let arr { parts.append("lands \(CalendarService.clock(arr, tz: tz))") }
            return parts.joined(separator: ", ")
        }
    }

    struct Trip: Identifiable, Hashable, Codable {
        var id: String
        var city: String
        var lat: Double
        var lon: Double
        var start: Date
        var end: Date
        /// "calendar", "feed" (a TripIt or other travel feed) or "you"
        var source: String
        /// Flights on this trip, when they were found in the calendar or the feed. Optional so trips saved before keep loading.
        var flights: [Flight]? = nil
        /// When and where you land, for the "you land tomorrow" note.
        var landAt: Date? = nil
        var landTZ: String? = nil
        var landFlight: String? = nil
        var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
        var when: String {
            let f = DateFormatter()
            f.dateFormat = "MMM d"
            let a = f.string(from: start), b = f.string(from: end)
            return Calendar.current.isDate(start, inSameDayAs: end) ? a : "\(a) to \(b)"
        }
        var whenPhrase: String {
            let days = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: Date()), to: Calendar.current.startOfDay(for: start)).day ?? 0
            if days <= 0 { return "this week" }
            if days == 1 { return "tomorrow" }
            if days < 7 { return "this \(start.formatted(.dateTime.weekday(.wide)))" }
            if days < 14 { return "next week" }
            return "on \(when)"
        }
    }

    private(set) var meetings: [Meeting] = []
    private(set) var calendarTrips: [Trip] = []
    private(set) var myTrips: [Trip] = []
    /// Trips from the TripIt (or other iCalendar) feed, refreshed at most every six hours.
    private(set) var feedTrips: [Trip] = []
    private(set) var hasFeed = false
    private(set) var feedError: String?
    private(set) var authorized = false
    private(set) var scanning = false
    private var lastScan = Date.distantPast
    @ObservationIgnored private let store = EKEventStore()

    var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: "calendarOn") }
        set { UserDefaults.standard.set(newValue, forKey: "calendarOn") }
    }

    /// Calendars you turned off in Settings. Everything else is read, including calendars added later.
    var hiddenCalendars: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: "calendarsOff") ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: "calendarsOff"); lastScan = .distantPast }
    }

    /// Every event calendar on the device, grouped by account (iCloud, Exchange, Google…).
    func calendarGroups() -> [(source: String, calendars: [EKCalendar])] {
        let all = store.calendars(for: .event)
        let groups = Dictionary(grouping: all) { $0.source?.title ?? "Other" }
        return groups.map { ($0.key, $0.value.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }) }
            .sorted { a, b in
                let ra = a.source.lowercased().contains("icloud") ? 0 : 1, rb = b.source.lowercased().contains("icloud") ? 0 : 1
                return ra != rb ? ra < rb : a.source < b.source
            }
    }

    private var readCalendars: [EKCalendar]? {
        let off = hiddenCalendars
        guard !off.isEmpty else { return nil }
        let on = store.calendars(for: .event).filter { !off.contains($0.calendarIdentifier) }
        return on
    }

    var trips: [Trip] {
        (CalendarService.merge(feedTrips, with: calendarTrips) + myTrips).filter { $0.end >= Calendar.current.startOfDay(for: Date()) }.sorted { $0.start < $1.start }
    }

    /// Adds `extra` trips to `base`, folding any that are the same trip (same city, within 60 miles,
    /// dates overlapping or a day and a half apart) into the one already there, flights and all.
    nonisolated static func merge(_ base: [Trip], with extra: [Trip]) -> [Trip] {
        var out = base
        for b in extra {
            if let i = out.firstIndex(where: { a in
                a.coordinate.miles(to: b.coordinate) < 60 &&
                b.start.timeIntervalSince(a.end) < 36 * 3600 && a.start.timeIntervalSince(b.end) < 36 * 3600
            }) {
                var a = out[i]
                a.start = min(a.start, b.start)
                a.end = max(a.end, b.end)
                let have = a.flights ?? []
                let more = (b.flights ?? []).filter { f in !have.contains { $0.flight == f.flight && $0.from == f.from && $0.to == f.to } }
                if !have.isEmpty || !more.isEmpty { a.flights = (have + more).sorted { ($0.dep ?? .distantPast) < ($1.dep ?? .distantPast) } }
                if a.landAt == nil { a.landAt = b.landAt; a.landTZ = b.landTZ; a.landFlight = b.landFlight }
                out[i] = a
            } else {
                out.append(b)
            }
        }
        return out
    }

    /// "2:10 PM", in the time zone given (where you land), else the phone's.
    nonisolated static func clock(_ d: Date, tz: String?) -> String {
        let f = DateFormatter()
        f.dateStyle = .none
        f.timeStyle = .short
        if let tz, let zone = TimeZone(identifier: tz) { f.timeZone = zone }
        return f.string(from: d)
    }

    var home: CLLocationCoordinate2D? {
        let d = UserDefaults.standard
        guard d.object(forKey: "homeLat") != nil else { return nil }
        return CLLocationCoordinate2D(latitude: d.double(forKey: "homeLat"), longitude: d.double(forKey: "homeLon"))
    }
    var homeName: String { UserDefaults.standard.string(forKey: "homeName") ?? "" }

    init() {
        authorized = EKEventStore.authorizationStatus(for: .event) == .fullAccess
        if let d = UserDefaults.standard.data(forKey: "myTrips"), let t = try? JSONDecoder().decode([Trip].self, from: d) { myTrips = t }
        hasFeed = feedURL != nil
    }

    func requestAccess() async -> Bool {
        let ok = (try? await store.requestFullAccessToEvents()) ?? false
        authorized = ok
        enabled = ok
        return ok
    }

    func setHome(_ query: String) async -> Bool {
        guard let m = try? await CLGeocoder().geocodeAddressString(query).first, let l = m.location else { return false }
        let d = UserDefaults.standard
        d.set(l.coordinate.latitude, forKey: "homeLat")
        d.set(l.coordinate.longitude, forKey: "homeLon")
        d.set([m.locality ?? query, m.administrativeArea].compactMap { $0 }.joined(separator: ", "), forKey: "homeName")
        lastScan = .distantPast
        return true
    }

    func addTrip(_ query: String, start: Date, end: Date) async -> Bool {
        guard let m = try? await CLGeocoder().geocodeAddressString(query).first, let l = m.location else { return false }
        let name = [m.locality ?? query, m.administrativeArea ?? m.country].compactMap { $0 }.joined(separator: ", ")
        myTrips.append(Trip(id: "you-\(UUID().uuidString.prefix(8))", city: name, lat: l.coordinate.latitude, lon: l.coordinate.longitude, start: start, end: max(start, end), source: "you"))
        saveMine()
        return true
    }

    func removeTrip(_ t: Trip) {
        myTrips.removeAll { $0.id == t.id }
        saveMine()
    }

    private func saveMine() {
        if let d = try? JSONEncoder().encode(myTrips) { UserDefaults.standard.set(d, forKey: "myTrips") }
    }

    func trip(_ id: String) -> Trip? { trips.first { $0.id == id } }
    func meeting(_ id: String) -> Meeting? { meetings.first { $0.id == id } }

    /// Re-reads the calendar at most every few minutes, and the travel feed at most every six hours.
    func scan(model: AppModel, force: Bool = false) async {
        authorized = EKEventStore.authorizationStatus(for: .event) == .fullAccess
        let calendarOn = enabled && authorized
        guard calendarOn || hasFeed, !scanning else { return }
        guard force || Date().timeIntervalSince(lastScan) > 300 else { return }
        scanning = true
        defer { scanning = false }
        lastScan = Date()
        await loadFeed(model: model)
        guard calendarOn else {
            meetings = []
            calendarTrips = []
            scheduleNotifications(model: model)
            return
        }
        let now = Date()
        let cal = Calendar.current
        let chosen = readCalendars
        if let chosen, chosen.isEmpty { meetings = []; calendarTrips = []; scheduleNotifications(model: model); return }
        let predicate = store.predicateForEvents(withStart: cal.startOfDay(for: now), end: cal.date(byAdding: .day, value: 60, to: now) ?? now, calendars: chosen)
        let events = store.events(matching: predicate)

        // meetings in the next week that include someone you know
        var found: [Meeting] = []
        let soon = cal.date(byAdding: .day, value: 7, to: now) ?? now
        for e in events where !e.isAllDay && e.endDate > now && e.startDate < soon {
            let people = (e.attendees ?? []).filter { !$0.isCurrentUser && $0.participantType == .person }
            guard !people.isEmpty else {
                // no invitees (a copied or hand-made event, like on an "All Work" calendar):
                // look for names you know in the title and notes, "Coffee with Jason Jacobs"
                let text = [e.title ?? "", e.notes ?? "", e.location ?? ""].joined(separator: "\n")
                if let r = try? await model.engine.call("readNotes", [text], as: NotesReading.self), !r.people.isEmpty {
                    let attendees = r.people.prefix(6).map { Attendee(name: $0.name, email: "", k: $0.k) }
                    let id = (e.calendarItemIdentifier) + "-" + String(Int(e.startDate.timeIntervalSince1970))
                    found.append(Meeting(id: id, title: e.title ?? "Meeting", start: e.startDate, end: e.endDate, location: e.location ?? "", attendees: Array(attendees)))
                }
                continue
            }
            let list = people.map { p -> (email: String, name: String) in
                let email = p.url.absoluteString.hasPrefix("mailto:") ? String(p.url.absoluteString.dropFirst(7)) : ""
                return (email, p.name ?? email)
            }
            let keys = await model.matchAttendees(list)
            let attendees = zip(list, keys).map { Attendee(name: $0.0.name, email: $0.0.email, k: $0.1) }
            guard attendees.contains(where: { $0.k != nil }) else { continue }
            let id = (e.calendarItemIdentifier) + "-" + String(Int(e.startDate.timeIntervalSince1970))
            found.append(Meeting(id: id, title: e.title ?? "Meeting", start: e.startDate, end: e.endDate, location: e.location ?? "", attendees: attendees))
        }
        meetings = found.sorted { $0.start < $1.start }

        // flights: a trip goes where you land, even when the event has no map pin
        // (Flighty and airline events put the departure airport in the location)
        let flown = await tripsFromFlights(events, model: model)
        let flightEvents = flown.1

        // trips: events somewhere far from home
        if let home {
            var stops: [(Date, Date, CLLocationCoordinate2D, String)] = []
            var lookups = 0
            for (i, e) in events.enumerated() where !flightEvents.contains(i) {
                guard let where_ = await place(of: e, lookups: &lookups) else { continue }
                if where_.0.miles(to: home) < 75 { continue }
                stops.append((e.startDate, e.endDate, where_.0, where_.1))
            }
            stops.sort { $0.0 < $1.0 }
            var trips: [Trip] = []
            for s in stops {
                if var last = trips.last, last.coordinate.miles(to: s.2) < 60,
                   s.0.timeIntervalSince(last.end) < 36 * 3600 {
                    last.end = max(last.end, s.1)
                    trips[trips.count - 1] = last
                } else {
                    trips.append(Trip(id: "cal-\(s.3)-\(Int(s.0.timeIntervalSince1970 / 86400))", city: s.3, lat: s.2.latitude, lon: s.2.longitude, start: s.0, end: s.1, source: "calendar"))
                }
            }
            calendarTrips = CalendarService.merge(trips, with: flown.0)
        } else {
            calendarTrips = flown.0
        }
        scheduleNotifications(model: model)
    }

    /// One calendar event as the engine reads it.
    private static func payload(_ e: EKEvent, uid: String) -> [String: Any] {
        [
            "uid": uid,
            "start": e.startDate.timeIntervalSince1970 * 1000,
            "end": e.endDate.timeIntervalSince1970 * 1000,
            "startDay": Day.fmt.string(from: e.startDate),
            "endDay": Day.fmt.string(from: e.isAllDay ? e.endDate.addingTimeInterval(-1) : e.endDate),
            "allDay": e.isAllDay,
            "title": e.title ?? "",
            "location": e.location ?? "",
            "notes": String((e.notes ?? "").prefix(1500)),
        ]
    }

    /// Asks the engine which events are flights, then turns those into trips placed where you land.
    /// Returns the trips and the indexes of the flight events, so they aren't also placed by their location.
    private func tripsFromFlights(_ events: [EKEvent], model: AppModel) async -> ([Trip], Set<Int>) {
        guard !events.isEmpty else { return ([], []) }
        struct Hit: Decodable { var to: String? }
        let rows: [Any] = events.map { [$0.title ?? "", $0.location ?? "", String(($0.notes ?? "").prefix(1500))] as [Any] }
        guard let hits = try? await model.engine.call("flightInfos", [rows], as: [Hit?].self), hits.count == events.count else { return ([], []) }
        var idx = Set<Int>()
        var list: [Any] = []
        for (i, h) in hits.enumerated() where h != nil {
            idx.insert(i)
            list.append(CalendarService.payload(events[i], uid: "\(events[i].calendarItemIdentifier)-\(i)"))
        }
        guard !list.isEmpty else { return ([], idx) }
        let opts: [String: Any] = ["flightsOnly": true, "source": "calendar"]
        guard let found = try? await model.engine.call("eventTrips", [list, homePayload, opts], as: [EngineTrip].self) else { return ([], idx) }
        return (await placed(found), idx)
    }

    // MARK: travel feed (TripIt, or any iCalendar link)

    /// The trip shape the engine hands back (src/flights.js).
    struct EngineTrip: Decodable {
        struct F: Decodable { var flight: String?; var from: String?; var to: String?; var dep: Double?; var arr: Double?; var tz: String? }
        struct Land: Decodable { var at: Double; var tz: String?; var flight: String? }
        var id: String
        var city: String
        var lat: Double?
        var lon: Double?
        var startMs: Double
        var endMs: Double
        var source: String?
        var flights: [F]?
        var land: Land?
    }

    private var homePayload: Any {
        guard let home else { return NSNull() }
        return ["lat": home.latitude, "lon": home.longitude, "name": homeName] as [String: Any]
    }

    /// Engine trips → Trips, looking up any city the engine couldn't place (a few per scan).
    private func placed(_ list: [EngineTrip]) async -> [Trip] {
        var out: [Trip] = []
        var lookups = 0
        let today = Calendar.current.startOfDay(for: Date())
        for t in list {
            let end = Date(timeIntervalSince1970: t.endMs / 1000)
            guard end >= today else { continue }
            var maybeLat = t.lat, maybeLon = t.lon, city = t.city
            if maybeLat == nil || maybeLon == nil {
                guard lookups < 5 else { continue }
                lookups += 1
                guard let hit = await geocodeCity(t.city) else { continue }
                maybeLat = hit.0.latitude; maybeLon = hit.0.longitude; city = hit.1
            }
            guard let lat = maybeLat, let lon = maybeLon else { continue }
            let flights = (t.flights ?? []).map { f in
                Flight(flight: f.flight ?? "", from: f.from ?? "", to: f.to ?? "",
                       dep: f.dep.map { Date(timeIntervalSince1970: $0 / 1000) }, arr: f.arr.map { Date(timeIntervalSince1970: $0 / 1000) }, tz: f.tz)
            }
            out.append(Trip(id: t.id, city: city, lat: lat, lon: lon, start: Date(timeIntervalSince1970: t.startMs / 1000), end: end, source: t.source ?? "feed",
                            flights: flights.isEmpty ? nil : flights,
                            landAt: t.land.map { Date(timeIntervalSince1970: $0.at / 1000) }, landTZ: t.land?.tz, landFlight: t.land?.flight))
        }
        return out
    }

    /// A city name → where it is, using the same cache as calendar locations.
    private func geocodeCity(_ text: String) async -> (CLLocationCoordinate2D, String)? {
        var cache = UserDefaults.standard.dictionary(forKey: "geoCache") as? [String: [String: Any]] ?? [:]
        if let c = cache[text] {
            guard let lat = c["lat"] as? Double, let lon = c["lon"] as? Double, let n = c["n"] as? String else { return nil }
            return (CLLocationCoordinate2D(latitude: lat, longitude: lon), n)
        }
        guard let m = try? await CLGeocoder().geocodeAddressString(text).first, let l = m.location else {
            cache[text] = ["none": true]
            UserDefaults.standard.set(cache, forKey: "geoCache")
            return nil
        }
        let name = [m.locality, m.administrativeArea ?? m.country].compactMap { $0 }.joined(separator: ", ")
        cache[text] = ["lat": l.coordinate.latitude, "lon": l.coordinate.longitude, "n": name.isEmpty ? text : name]
        UserDefaults.standard.set(cache, forKey: "geoCache")
        return (l.coordinate, name.isEmpty ? text : name)
    }

    private static let feedSecret = "trips.feed.url"
    private static var feedFile: URL {
        (FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory).appendingPathComponent("trip-feed.ics")
    }

    /// The feed link, kept in this device's Keychain (it works like a password for your trips).
    var feedURL: String? {
        let s = SecretStore.get(CalendarService.feedSecret) ?? ""
        return s.isEmpty ? nil : s
    }
    /// "TripIt" for a TripIt link, else "your travel feed".
    var feedName: String {
        (feedURL.flatMap { URL(string: $0)?.host?.lowercased() } ?? "").contains("tripit") ? "TripIt" : "your travel feed"
    }
    var feedCheckedAt: Date? {
        let t = UserDefaults.standard.double(forKey: "tripFeedAt")
        return t > 0 ? Date(timeIntervalSince1970: t) : nil
    }

    /// webcal:// becomes https://; anything that isn't https is refused.
    static func feedLink(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.lowercased().hasPrefix("webcal://") { s = "https://" + String(s.dropFirst("webcal://".count)) }
        if s.lowercased().hasPrefix("webcals://") { s = "https://" + String(s.dropFirst("webcals://".count)) }
        guard let u = URL(string: s), u.scheme?.lowercased() == "https", let host = u.host, !host.isEmpty else { return nil }
        return u
    }

    /// Saves (or, with nil or empty, removes) the feed link. Fetches it once to check it. Returns an error to show, or nil.
    func setFeed(_ raw: String?, model: AppModel) async -> String? {
        let text = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            SecretStore.set(CalendarService.feedSecret, nil)
            try? FileManager.default.removeItem(at: CalendarService.feedFile)
            UserDefaults.standard.removeObject(forKey: "tripFeedAt")
            UserDefaults.standard.removeObject(forKey: "tripFeedTried")
            hasFeed = false
            feedTrips = []
            feedError = nil
            scheduleNotifications(model: model)
            return nil
        }
        guard let url = CalendarService.feedLink(text) else { return "That doesn’t look like a feed link. It should start with https:// or webcal://." }
        guard let body = await fetch(url) else { return "Couldn’t read that link. Check that you copied the whole thing and that you’re online." }
        guard body.contains("BEGIN:VCALENDAR") else { return "That link didn’t return a calendar. Copy the feed link from TripIt again." }
        SecretStore.set(CalendarService.feedSecret, url.absoluteString)
        save(body)
        hasFeed = true
        feedError = nil
        await parseFeed(model: model)
        scheduleNotifications(model: model)
        return nil
    }

    /// Fetches the feed now, ignoring the six-hour wait. For "Check now" in Settings.
    func refreshFeedNow(model: AppModel) async {
        guard let s = feedURL, let url = CalendarService.feedLink(s) else { return }
        if let body = await fetch(url), body.contains("BEGIN:VCALENDAR") { save(body); feedError = nil }
        else { feedError = "Couldn’t reach \(feedName) just now. Northfix will try again later." }
        await parseFeed(model: model)
        scheduleNotifications(model: model)
    }

    /// Fetches the feed when it's more than six hours old (half an hour after a failed try), then reads the saved copy.
    private func loadFeed(model: AppModel) async {
        guard let s = feedURL, let url = CalendarService.feedLink(s) else { hasFeed = false; feedTrips = []; return }
        hasFeed = true
        let d = UserDefaults.standard, now = Date().timeIntervalSince1970
        if now - d.double(forKey: "tripFeedAt") > 6 * 3600 && now - d.double(forKey: "tripFeedTried") > 30 * 60 {
            d.set(now, forKey: "tripFeedTried")
            if let body = await fetch(url), body.contains("BEGIN:VCALENDAR") { save(body); feedError = nil }
            else { feedError = "Couldn’t reach \(feedName) at the last check. Northfix will try again later." }
        }
        await parseFeed(model: model)
    }

    private func fetch(_ url: URL) async -> String? {
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        req.setValue("text/calendar, */*", forHTTPHeaderField: "Accept")
        guard let got = try? await URLSession.shared.data(for: req),
              let http = got.1 as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        return String(decoding: got.0, as: UTF8.self)
    }

    private func save(_ body: String) {
        try? body.write(to: CalendarService.feedFile, atomically: true, encoding: .utf8)
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "tripFeedAt")
    }

    /// Reads the saved copy of the feed into trips. Re-run on each scan, so a new home city applies.
    private func parseFeed(model: AppModel) async {
        guard let text = try? String(contentsOf: CalendarService.feedFile, encoding: .utf8) else { feedTrips = []; return }
        guard let found = try? await model.engine.call("feedTrips", [text, homePayload], as: [EngineTrip].self) else { return }
        feedTrips = await placed(found)
    }

    private static let virtual = try! NSRegularExpression(pattern: "zoom|teams|webex|meet\\.google|http|https|dial-in|conference bridge|microsoft teams", options: .caseInsensitive)

    /// Where an event is, using the calendar's own map pin, else a cached lookup of its location text.
    private func place(of e: EKEvent, lookups: inout Int) async -> (CLLocationCoordinate2D, String)? {
        let text = (e.location ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if CalendarService.virtual.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil { return nil }
        var cache = UserDefaults.standard.dictionary(forKey: "geoCache") as? [String: [String: Any]] ?? [:]
        if let c = cache[text] {
            guard let lat = c["lat"] as? Double, let lon = c["lon"] as? Double, let n = c["n"] as? String else { return nil }
            return (CLLocationCoordinate2D(latitude: lat, longitude: lon), n)
        }
        if let g = e.structuredLocation?.geoLocation {
            let name = await cityName(g) ?? text
            cache[text] = ["lat": g.coordinate.latitude, "lon": g.coordinate.longitude, "n": name]
            UserDefaults.standard.set(cache, forKey: "geoCache")
            return (g.coordinate, name)
        }
        guard lookups < 15 else { return nil }
        lookups += 1
        guard let m = try? await CLGeocoder().geocodeAddressString(text).first, let l = m.location else {
            cache[text] = ["none": true]
            UserDefaults.standard.set(cache, forKey: "geoCache")
            return nil
        }
        let name = [m.locality, m.administrativeArea ?? m.country].compactMap { $0 }.joined(separator: ", ")
        cache[text] = ["lat": l.coordinate.latitude, "lon": l.coordinate.longitude, "n": name.isEmpty ? text : name]
        UserDefaults.standard.set(cache, forKey: "geoCache")
        return (l.coordinate, name.isEmpty ? text : name)
    }

    private func cityName(_ loc: CLLocation) async -> String? {
        guard let m = try? await CLGeocoder().reverseGeocodeLocation(loc).first else { return nil }
        let s = [m.locality, m.administrativeArea ?? m.country].compactMap { $0 }.joined(separator: ", ")
        return s.isEmpty ? nil : s
    }

    /// People placed within `miles` of a trip, closest and warmest first.
    func nearby(_ t: Trip, model: AppModel, miles: Double = 50) -> [(Person, PersonPlace, Double)] {
        model.places.compactMap { k, pl -> (Person, PersonPlace, Double)? in
            guard !pl.isApproximate, let p = model.person(k), p.x == nil else { return nil }
            let d = pl.coordinate.miles(to: t.coordinate)
            return d <= miles ? (p, pl, d) : nil
        }
        .sorted { ($0.0.score, -$0.2) > ($1.0.score, -$1.2) }
    }

    /// Meeting briefs 30 minutes ahead, and a heads-up three days before a trip.
    private func scheduleNotifications(model: AppModel) {
        let center = UNUserNotificationCenter.current()
        Task {
            let pending = await center.pendingNotificationRequests()
            center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix("m-") || $0.hasPrefix("t-") || $0.hasPrefix("a-") || $0.hasPrefix("l-") })
            guard UserDefaults.standard.object(forKey: "notify") as? Bool ?? true else { return }
            let now = Date()
            for m in meetings.prefix(20) {
                // ten minutes out: who, and the one thing worth remembering
                let at = m.start.addingTimeInterval(-10 * 60)
                guard at > now else { continue }
                let names = m.matched.compactMap { model.person($0) }.sorted { $0.score > $1.score }
                guard let first = names.first else { continue }
                let c = UNMutableNotificationContent()
                c.title = "\(first.fullName)\(names.count > 1 ? " +\(names.count - 1)" : "") in 10 minutes"
                c.subtitle = m.title
                let mem = await model.memory(first.k)?.line
                c.body = mem ?? "\(Band.label(first.band)). Tap for your notes."
                c.interruptionLevel = .timeSensitive
                c.relevanceScore = 1
                c.userInfo = ["meeting": m.id]
                c.sound = .default
                let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: at)
                try? await center.add(UNNotificationRequest(identifier: "m-\(m.id)", content: c, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
            }
            // after the meeting: a quick note, typed right into the notification
            for m in meetings.prefix(20) {
                let at = m.end.addingTimeInterval(15 * 60)
                guard at > now, let first = m.matched.compactMap({ model.person($0) }).first else { continue }
                let c = UNMutableNotificationContent()
                c.title = "How did it go with \(first.f)?"
                c.body = "Add a quick note to \(first.f)’s timeline while it’s fresh. Press and hold to type it here."
                c.categoryIdentifier = "AFTER"
                c.userInfo = ["k": first.k, "mt": m.title]
                let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: at)
                try? await center.add(UNNotificationRequest(identifier: "a-\(m.id)", content: c, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
            }
            for t in trips.prefix(10) {
                let n = nearby(t, model: model).count
                guard n > 0 else { continue }
                var at = Calendar.current.date(byAdding: .day, value: -3, to: t.start) ?? t.start
                at = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: at) ?? at
                if at <= now { continue }
                let c = UNMutableNotificationContent()
                c.title = "\(t.city) on \(t.when)"
                c.body = "\(n) \(n == 1 ? "person" : "people") you know \(n == 1 ? "is" : "are") nearby. Worth setting up a coffee?"
                c.userInfo = ["trip": t.id]
                let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: at)
                try? await center.add(UNNotificationRequest(identifier: "t-\(t.id)", content: c, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
            }
            // the evening before you land: when, and who's close by
            for t in trips.prefix(10) {
                guard let land = t.landAt, land > now else { continue }
                let n = nearby(t, model: model, miles: 25).count
                guard n > 0 else { continue }
                let cal = Calendar.current
                let dayBefore = cal.date(byAdding: .day, value: -1, to: land) ?? land
                var at = cal.date(bySettingHour: 19, minute: 0, second: 0, of: dayBefore) ?? land.addingTimeInterval(-18 * 3600)
                // an early flight: no more than 18 hours ahead
                if land.timeIntervalSince(at) > 30 * 3600 { at = land.addingTimeInterval(-18 * 3600) }
                if at <= now { continue }
                let city = t.city.components(separatedBy: ",").first ?? t.city
                let day = cal.isDate(land, inSameDayAs: cal.date(byAdding: .day, value: 1, to: at) ?? land) ? "tomorrow" : "on \(land.formatted(.dateTime.weekday(.wide)))"
                let c = UNMutableNotificationContent()
                c.title = (t.landFlight ?? "").isEmpty ? "Landing in \(city)" : "Flight \(t.landFlight ?? "") to \(city)"
                c.body = "You land in \(city) \(day) at \(CalendarService.clock(land, tz: t.landTZ)). \(n) \(n == 1 ? "person" : "people") you know \(n == 1 ? "is" : "are") within 25 miles."
                c.userInfo = ["trip": t.id]
                c.sound = .default
                let comps = cal.dateComponents([.year, .month, .day, .hour, .minute], from: at)
                try? await center.add(UNNotificationRequest(identifier: "l-\(t.id)", content: c, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
            }
        }
    }
}
