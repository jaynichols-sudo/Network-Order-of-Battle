import Foundation
import EventKit
import CoreLocation
import UserNotifications
import Observation

/// Reads the iPhone calendar (on device only) to find upcoming meetings with
/// people in your network, and trips away from home, so Bearings can brief you
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

    struct Trip: Identifiable, Hashable, Codable {
        var id: String
        var city: String
        var lat: Double
        var lon: Double
        var start: Date
        var end: Date
        /// "calendar" or "you"
        var source: String
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
        (calendarTrips + myTrips).filter { $0.end >= Calendar.current.startOfDay(for: Date()) }.sorted { $0.start < $1.start }
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

    /// Re-reads the calendar at most every few minutes.
    func scan(model: AppModel, force: Bool = false) async {
        authorized = EKEventStore.authorizationStatus(for: .event) == .fullAccess
        guard enabled, authorized, !scanning else { return }
        guard force || Date().timeIntervalSince(lastScan) > 300 else { return }
        scanning = true
        defer { scanning = false }
        lastScan = Date()
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

        // trips: events somewhere far from home
        if let home {
            var stops: [(Date, Date, CLLocationCoordinate2D, String)] = []
            var lookups = 0
            for e in events {
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
            calendarTrips = trips
        }
        scheduleNotifications(model: model)
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
            center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix("m-") || $0.hasPrefix("t-") || $0.hasPrefix("a-") })
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
        }
    }
}
