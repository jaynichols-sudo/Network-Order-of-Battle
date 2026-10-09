import Foundation
import Security

/// The next few open pursuits, for the "Pursuits due" Home Screen widget. The app writes it
/// whenever pursuits change; the widget only reads it. Kept in the same shared keychain
/// group as the glance, so it needs no App Group.
struct PursuitGlance: Codable {
    struct Item: Codable, Hashable {
        var id: String
        var name: String
        var agency: String
        /// yyyy-MM-dd, or empty when there's no due date
        var due: String
        var stage: String
        var filled: Int
        var roles: Int
    }
    var gen: String
    var open: Int
    var items: [Item]
    static let empty = PursuitGlance(gen: "", open: 0, items: [])

    /// "due today", "due in 5 days", "3 days late", counted from `day`.
    static func dueText(_ due: String, from day: Date = Date()) -> String {
        guard let d = Day.date(due) else { return "No due date" }
        let n = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: day), to: Calendar.current.startOfDay(for: d)).day ?? 0
        if n < 0 { return n == -1 ? "1 day late" : "\(-n) days late" }
        if n == 0 { return "Due today" }
        if n == 1 { return "Due tomorrow" }
        return "Due in \(n) days"
    }
}

enum PursuitGlanceStore {
    private static let service = "com.jaynichols.networkoob.watch"
    private static let account = "pursuits"

    static func save(_ g: PursuitGlance) {
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

    static func load() -> PursuitGlance? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: account,
                                kSecReturnData as String: true,
                                kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(PursuitGlance.self, from: data)
    }
}
