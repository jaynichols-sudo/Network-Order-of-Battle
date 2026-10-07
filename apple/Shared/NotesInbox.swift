import Foundation
import Security

/// Meeting notes shared into Bearings from other apps (Plaud, Apple Notes, reMarkable,
/// Mail) through the share extension. They wait in the team keychain group, which the
/// app and its extensions already share, until Bearings next opens and files them.
enum NotesInbox {
    private static let service = "com.jaynichols.networkoob.watch"
    private static let account = "notes-inbox"
    /// Keychain items stay small; a long transcript is trimmed to its most useful start.
    private static let maxChars = 120_000

    struct Item: Codable, Hashable {
        var text: String
        var source: String
        var at: Date
    }

    static func load() -> [Item] {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account,
                                kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return [] }
        return (try? JSONDecoder().decode([Item].self, from: d)) ?? []
    }

    static func save(_ items: [Item]) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        guard !items.isEmpty else { SecItemDelete(q as CFDictionary); return }
        guard let d = try? JSONEncoder().encode(items) else { return }
        let attrs: [String: Any] = [kSecValueData as String: d, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]
        if SecItemUpdate(q as CFDictionary, attrs as CFDictionary) == errSecItemNotFound {
            var add = q
            attrs.forEach { add[$0.key] = $0.value }
            SecItemAdd(add as CFDictionary, nil)
        }
    }

    static func add(_ text: String, source: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        var items = load()
        items.append(Item(text: String(t.prefix(maxChars)), source: source, at: Date()))
        // keep the newest few if several were shared before the app opened
        while items.count > 5 || items.reduce(0, { $0 + $1.text.count }) > maxChars * 2 { items.removeFirst() }
        save(items)
    }

    static func drain() -> [Item] {
        let items = load()
        if !items.isEmpty { save([]) }
        return items
    }

    /// A best guess at where text came from, for the label on the notes sheet.
    static func guessSource(_ text: String, fileName: String = "") -> String {
        let s = (text.prefix(4000) + " " + fileName).lowercased()
        if s.contains("plaud") { return "Plaud" }
        if s.contains("remarkable") { return "reMarkable" }
        return "Shared notes"
    }
}
