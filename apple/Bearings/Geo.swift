import Foundation
import CoreLocation
import Contacts

/// Where someone probably is. LinkedIn's export has no locations, so these come
/// from the person's card in iPhone Contacts (address, then phone number),
/// from places named in their title or company, or from what you set yourself.
struct PersonPlace: Codable, Hashable {
    var name: String
    var lat: Double
    var lon: Double
    /// "city" or "region" (a whole state or country, so only roughly placed)
    var prec: String
    /// you, address, phone, title, sample
    var src: String

    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
    var isApproximate: Bool { prec != "city" }
    var sourceLabel: String {
        switch src {
        case "you": return "Set by you"
        case "address": return "From their address in your Contacts"
        case "phone": return "From their phone number in your Contacts"
        case "title": return "From their job title or company"
        case "company": return "From the location you set for their company"
        case "sample": return "Sample data"
        default: return ""
        }
    }
}

/// Offline place lookups: phone prefixes (Google libphonenumber data, Apache 2.0)
/// and city coordinates (GeoNames, CC BY 4.0).
final class PlaceIndex: @unchecked Sendable {
    static let shared = PlaceIndex()

    private var loaded = false
    private var places: [[Any]] = []
    private var prefixes: [String: [String: Int]] = [:]
    private var cities: [String: (Double, Double, Int)] = [:]   // "name|admin|CC" and "name||CC"
    private let lock = NSLock()

    private func load() {
        lock.lock(); defer { lock.unlock() }
        guard !loaded else { return }
        loaded = true
        if let url = Bundle.main.url(forResource: "geo-phone", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            places = obj["places"] as? [[Any]] ?? []
            prefixes = obj["cc"] as? [String: [String: Int]] ?? [:]
        }
        if let url = Bundle.main.url(forResource: "geo-cities", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let list = try? JSONSerialization.jsonObject(with: data) as? [[Any]] {
            for c in list {
                guard c.count >= 6, let n = c[0] as? String, let a = c[1] as? String, let cc = c[2] as? String,
                      let lat = (c[3] as? NSNumber)?.doubleValue, let lon = (c[4] as? NSNumber)?.doubleValue,
                      let pop = (c[5] as? NSNumber)?.intValue else { continue }
                let key = PlaceIndex.norm(n)
                for k in ["\(key)|\(a)|\(cc)", "\(key)||\(cc)"] {
                    if let cur = cities[k], cur.2 >= pop { continue }
                    cities[k] = (lat, lon, pop)
                }
            }
        }
    }

    static func norm(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .init(identifier: "en_US"))
            .replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    /// A place for a phone number. Numbers without a country code are read as North American.
    func place(phone raw: String) -> PersonPlace? {
        load()
        var digits = raw.filter(\.isNumber)
        if raw.trimmingCharacters(in: .whitespaces).hasPrefix("+") {
            // already international
        } else if digits.hasPrefix("00") {
            digits.removeFirst(2)
        } else if digits.hasPrefix("011") {
            digits.removeFirst(3)
        } else if digits.count == 10 {
            digits = "1" + digits
        } else if !(digits.count == 11 && digits.hasPrefix("1")) {
            return nil
        }
        for ccLen in 1...3 where digits.count > ccLen {
            let cc = String(digits.prefix(ccLen))
            guard let map = prefixes[cc] else { continue }
            let national = String(digits.dropFirst(ccLen))
            var len = min(national.count, 9)
            while len > 0 {
                if let i = map[String(national.prefix(len))], i < places.count { return place(at: i, src: "phone") }
                len -= 1
            }
            return nil
        }
        return nil
    }

    private func place(at i: Int, src: String) -> PersonPlace? {
        let p = places[i]
        guard p.count >= 4, let n = p[0] as? String, let lat = (p[1] as? NSNumber)?.doubleValue,
              let lon = (p[2] as? NSNumber)?.doubleValue, let prec = p[3] as? String else { return nil }
        return PersonPlace(name: n, lat: lat, lon: lon, prec: prec, src: src)
    }

    /// A city by name, with an optional state or province code, in a country (ISO code).
    func city(_ name: String, admin: String = "", country: String = "US") -> (Double, Double)? {
        load()
        let key = PlaceIndex.norm(name)
        let cc = country.uppercased()
        if !admin.isEmpty, let c = cities["\(key)|\(admin.uppercased())|\(cc)"] { return (c.0, c.1) }
        if let c = cities["\(key)||\(cc)"], admin.isEmpty { return (c.0, c.1) }
        return nil
    }

    static let usStates: [String: String] = ["alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE", "district of columbia": "DC", "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY"]

    /// A place for a postal address from Contacts.
    func place(address a: CNPostalAddress) -> PersonPlace? {
        let country = a.isoCountryCode.isEmpty ? "US" : a.isoCountryCode.uppercased()
        let city = a.city.trimmingCharacters(in: .whitespaces)
        guard !city.isEmpty else { return nil }
        var admin = a.state.trimmingCharacters(in: .whitespaces)
        if country == "US", admin.count > 2 { admin = PlaceIndex.usStates[admin.lowercased()] ?? "" }
        let adminForLookup = country == "US" ? admin : ""
        guard let c = self.city(city, admin: adminForLookup, country: country) ?? self.city(city, country: country) else { return nil }
        let label = country == "US" && !admin.isEmpty ? "\(city), \(admin)" : [city, Locale.current.localizedString(forRegionCode: country) ?? country].joined(separator: ", ")
        return PersonPlace(name: label, lat: c.0, lon: c.1, prec: "city", src: "address")
    }
}

/// Builds the person -> place table from Contacts and title clues, and saves it.
enum Locator {
    struct Result { var places: [String: PersonPlace]; var matched: Int; var births: [String: String] = [:]; var inContacts: [String] = [] }

    static func contactsAllowed() -> Bool {
        let s = CNContactStore.authorizationStatus(for: .contacts)
        if #available(iOS 18.0, *), s == .limited { return true }
        return s == .authorized
    }

    static func requestContacts() async -> Bool {
        if contactsAllowed() { return true }
        return (try? await CNContactStore().requestAccess(for: .contacts)) ?? false
    }

    /// Matches people to Contacts cards by email first, then by unique full name.
    static func build(people: [Person], clues: [[String]]) async -> Result {
        await Task.detached(priority: .utility) {
            var out: [String: PersonPlace] = [:]
            var matched = 0
            var found: [String: String] = [:]
            var linked: [String] = []
            let index = PlaceIndex.shared
            if contactsAllowed() {
                let keys: [CNKeyDescriptor] = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactEmailAddressesKey,
                                               CNContactPhoneNumbersKey, CNContactPostalAddressesKey, CNContactOrganizationNameKey,
                                               CNContactThumbnailImageDataKey, CNContactBirthdayKey].map { $0 as CNKeyDescriptor }
                var births: [String: String] = [:]
                var photos: [String: Data] = [:]
                var byEmail: [String: CNContact] = [:]
                var byName: [String: [CNContact]] = [:]
                let req = CNContactFetchRequest(keysToFetch: keys)
                try? CNContactStore().enumerateContacts(with: req) { c, _ in
                    for e in c.emailAddresses { byEmail[(e.value as String).lowercased()] = c }
                    let n = PlaceIndex.norm("\(c.givenName) \(c.familyName)")
                    if n.contains(" ") { byName[n, default: []].append(c) }
                }
                for p in people where p.x == nil {
                    var card: CNContact?
                    if !p.e.isEmpty { card = byEmail[p.e.lowercased()] }
                    if card == nil, let list = byName[PlaceIndex.norm(p.fullName)] {
                        if list.count == 1 { card = list[0] }
                        else { card = list.first { !p.c.isEmpty && PlaceIndex.norm($0.organizationName) == PlaceIndex.norm(p.c) } }
                    }
                    guard let c = card else { continue }
                    matched += 1
                    linked.append(p.k)
                    if let img = c.thumbnailImageData { photos[p.k] = img }
                    if let b = c.birthday, let mo = b.month, let d = b.day { births[p.k] = String(format: "%02d-%02d", mo, d) }
                    let addresses = c.postalAddresses.sorted { a, _ in a.label == CNLabelWork }
                    if let a = addresses.lazy.compactMap({ index.place(address: $0.value) }).first {
                        out[p.k] = a
                        continue
                    }
                    let phones = c.phoneNumbers.sorted { a, b in rank(a.label) < rank(b.label) }
                    let found = phones.compactMap { index.place(phone: $0.value.stringValue) }
                    if let best = found.first(where: { !$0.isApproximate }) ?? found.first { out[p.k] = best }
                }
                PhotoStore.shared.replaceAll(photos)
                found = births
            }
            for clue in clues where clue.count == 3 && out[clue[0]] == nil {
                if let c = index.city(clue[1], admin: clue[2], country: "US") {
                    out[clue[0]] = PersonPlace(name: "\(clue[1]), \(clue[2])", lat: c.0, lon: c.1, prec: "city", src: "title")
                }
            }
            return Result(places: out, matched: matched, births: found, inContacts: linked)
        }.value
    }

    private static func rank(_ label: String?) -> Int {
        switch label {
        case CNLabelWork: return 0
        case CNLabelPhoneNumberMain: return 1
        case CNLabelPhoneNumberMobile, CNLabelPhoneNumberiPhone: return 2
        default: return 3
        }
    }

    /// Plausible spots for the sample network, so the map has something to show.
    static func samplePlaces(_ people: [Person]) -> [String: PersonPlace] {
        let spots: [(String, Double, Double)] = [
            ("Washington, DC", 38.8951, -77.0364), ("Arlington, VA", 38.8816, -77.091), ("Norfolk, VA", 36.8468, -76.2852),
            ("Raleigh, NC", 35.7721, -78.6386), ("Greensboro, NC", 36.0726, -79.792), ("Jacksonville, NC", 34.7541, -77.4302),
            ("Fayetteville, NC", 35.0527, -78.8784), ("Tampa, FL", 27.9475, -82.4584), ("San Diego, CA", 32.7157, -117.1647),
            ("Colorado Springs, CO", 38.8339, -104.8214), ("Huntsville, AL", 34.7304, -86.5861), ("San Antonio, TX", 29.4241, -98.4936),
            ("Charleston, SC", 32.7765, -79.9311), ("Chattanooga, TN", 35.0456, -85.3097), ("Atlanta, GA", 33.749, -84.388),
            ("Honolulu, HI", 21.3069, -157.8583), ("London, United Kingdom", 51.5085, -0.1257), ("Stuttgart, Germany", 48.7823, 9.177)]
        var out: [String: PersonPlace] = [:]
        for p in people where p.x == nil {
            var h: UInt64 = 1469598103934665603
            for b in p.k.utf8 { h = (h ^ UInt64(b)) &* 1099511628211 }
            guard h % 10 < 7 else { continue }
            let s = spots[Int((h / 10) % UInt64(spots.count))]
            out[p.k] = PersonPlace(name: s.0, lat: s.1, lon: s.2, prec: "city", src: "sample")
        }
        return out
    }
}

extension CLLocationCoordinate2D {
    func miles(to o: CLLocationCoordinate2D) -> Double {
        CLLocation(latitude: latitude, longitude: longitude).distance(from: CLLocation(latitude: o.latitude, longitude: o.longitude)) / 1609.344
    }
}
