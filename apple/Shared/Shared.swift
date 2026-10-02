import Foundation
import Security
import SwiftUI

// Shared by the watch app and its complications.

struct WatchSnapshot: Codable {
    var v: Int
    var gen: String
    var today: String
    var sample: Bool
    var name: String
    var total: Int
    var people: [WatchPerson]
}

struct WatchPerson: Codable, Identifiable, Hashable {
    var k: String
    var n: String
    var ti: String
    var co: String
    /// Flags: w waiting on you, d has a follow-up date, c going cold, j changed jobs,
    /// n new connection, a anniversary this week, s starred, k one of your closest.
    var f: String
    var b: String?
    var sc: Int?
    var lt: String?
    var dir: String?
    var m: Int?
    var sn: String?
    var due: String?
    var st: Int?
    var no: String?
    var yr: Int?
    var cd: String?

    var id: String { k }
    func has(_ flag: Character) -> Bool { f.contains(flag) }
    var starred: Bool { (st ?? 0) == 1 }
    var subtitle: String {
        if !ti.isEmpty && !co.isEmpty { return "\(ti) at \(co)" }
        return ti.isEmpty ? co : ti
    }
}

enum Day {
    static let fmt: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    static var today: String { fmt.string(from: Date()) }
    static func date(_ s: String?) -> Date? {
        guard let s, s.count >= 10 else { return nil }
        return fmt.date(from: String(s.prefix(10)))
    }
    static func plus(_ days: Int) -> String {
        fmt.string(from: Calendar.current.date(byAdding: .day, value: days, to: Date()) ?? Date())
    }
    static func daysSince(_ s: String?) -> Int? {
        guard let d = date(s) else { return nil }
        return Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: d), to: Calendar.current.startOfDay(for: Date())).day
    }
    static func ago(_ s: String?) -> String {
        guard let n = daysSince(s) else { return "" }
        if n <= 0 { return "today" }
        if n == 1 { return "yesterday" }
        if n < 14 { return "\(n) days ago" }
        if n < 60 { return "\(Int((Double(n) / 7).rounded())) weeks ago" }
        if n < 730 { return "\(Int((Double(n) / 30.4).rounded())) months ago" }
        return "\(Int((Double(n) / 365).rounded())) years ago"
    }
    static func short(_ s: String?) -> String {
        guard let n = daysSince(s) else { return "" }
        if n < 1 { return "today" }
        if n < 14 { return "\(n)d" }
        if n < 60 { return "\(Int((Double(n) / 7).rounded()))w" }
        if n < 730 { return "\(Int((Double(n) / 30.4).rounded()))mo" }
        return "\(Int((Double(n) / 365).rounded()))y"
    }
    static func nice(_ s: String?) -> String {
        guard let d = date(s) else { return "" }
        let f = DateFormatter()
        f.dateFormat = Calendar.current.isDate(d, equalTo: Date(), toGranularity: .year) ? "MMM d" : "MMM d, yyyy"
        return f.string(from: d)
    }
}

enum Palette {
    static let amber = Color(red: 1.0, green: 0.69, blue: 0.13)
    static let coral = Color(red: 1.0, green: 0.48, blue: 0.50)
    static let violet = Color(red: 0.66, green: 0.57, blue: 1.0)
    static let sky = Color(red: 0.49, green: 0.65, blue: 1.0)
    static let green = Color(red: 0.24, green: 0.83, blue: 0.64)
    static let pink = Color(red: 0.90, green: 0.49, blue: 0.85)
    static let plum = Color(red: 0.16, green: 0.14, blue: 0.28)

    static func band(_ b: String?) -> Color {
        switch b {
        case "strong": return green
        case "warm": return amber
        case "light": return sky
        default: return .gray
        }
    }
    static func bandLabel(_ b: String?) -> String {
        switch b {
        case "strong": return "Close"
        case "warm": return "Warm"
        case "light": return "Light"
        default: return "No messages"
        }
    }
}

/// The small summary the complications read. Kept in a keychain item shared by
/// the watch app and its widget extension (same team keychain group), which
/// needs no App Group setup.
struct Glance: Codable {
    var gen: String
    var waiting: Int
    var cold: Int
    var dues: [String]
    var nextName: String?
    var nextWhy: String?
    var sample: Bool

    func dueNow(on day: String = Day.today) -> Int { dues.filter { $0 <= day }.count }
    static let empty = Glance(gen: "", waiting: 0, cold: 0, dues: [], nextName: nil, nextWhy: nil, sample: false)

    static func from(_ s: WatchSnapshot) -> Glance {
        let today = Day.today
        let waiting = s.people.filter { $0.has("w") }.sorted { ($0.lt ?? "") > ($1.lt ?? "") }
        let dueNow = s.people.filter { ($0.due ?? "9") <= today }.sorted { ($0.due ?? "") < ($1.due ?? "") }
        var name: String?, why: String?
        if let p = waiting.first { name = p.n; why = "wrote \(Day.ago(p.lt))" }
        else if let p = dueNow.first { name = p.n; why = "follow-up due" }
        return Glance(gen: s.gen, waiting: waiting.count, cold: s.people.filter { $0.has("c") }.count,
                      dues: s.people.compactMap { $0.due }.sorted(), nextName: name, nextWhy: why, sample: s.sample)
    }
}

enum GlanceStore {
    private static let service = "com.jaynichols.networkoob.watch"
    private static let account = "glance"

    static func save(_ g: Glance) {
        guard let data = try? JSONEncoder().encode(g) else { return }
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: account]
        let attrs: [String: Any] = [kSecValueData as String: data,
                                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]
        if SecItemUpdate(q as CFDictionary, attrs as CFDictionary) == errSecItemNotFound {
            var add = q
            attrs.forEach { add[$0.key] = $0.value }
            SecItemAdd(add as CFDictionary, nil)
        }
    }

    static func load() -> Glance? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: account,
                                kSecReturnData as String: true,
                                kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(Glance.self, from: data)
    }
}
