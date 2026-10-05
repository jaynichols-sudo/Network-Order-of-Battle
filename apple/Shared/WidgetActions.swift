import Foundation
import Security
import AppIntents
import WidgetKit

/// Taps on widget buttons, queued in the shared keychain until the app next opens.
enum WidgetActionQueue {
    private static let service = "com.jaynichols.networkoob.watch"
    private static let account = "widget-actions"

    struct Item: Codable { var k: String; var action: String }

    static func load() -> [Item] {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account,
                                kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return [] }
        return (try? JSONDecoder().decode([Item].self, from: d)) ?? []
    }

    static func save(_ items: [Item]) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        guard let d = try? JSONEncoder().encode(items) else { return }
        let attrs: [String: Any] = [kSecValueData as String: d, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]
        if SecItemUpdate(q as CFDictionary, attrs as CFDictionary) == errSecItemNotFound {
            var add = q
            attrs.forEach { add[$0.key] = $0.value }
            SecItemAdd(add as CFDictionary, nil)
        }
    }

    static func drain() -> [Item] {
        let items = load()
        if !items.isEmpty { save([]) }
        return items
    }
}

/// "Replied", "Done" or "Snooze" from the Home Screen widget.
struct WidgetPersonIntent: AppIntent {
    static var title: LocalizedStringResource = "Update someone from the widget"
    static var isDiscoverable = false
    @Parameter(title: "Person") var k: String
    @Parameter(title: "Action") var action: String

    init() {}
    init(k: String, action: String) {
        self.k = k
        self.action = action
    }

    func perform() async throws -> some IntentResult {
        var q = WidgetActionQueue.load()
        q.append(.init(k: k, action: action))
        WidgetActionQueue.save(q)
        // reflect it in the widget straight away
        if var g = GlanceStore.load() {
            if let item = g.next?.first(where: { $0.k == k }) {
                g.next?.removeAll { $0.k == k }
                if item.kind == "reply" { g.waiting = max(0, g.waiting - 1) }
                if item.kind == "due", let i = g.dues.firstIndex(where: { $0 <= Day.today }) { g.dues.remove(at: i) }
                if g.nextName == item.n { g.nextName = g.next?.first?.n; g.nextWhy = g.next?.first?.why }
            }
            GlanceStore.save(g)
        }
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

/// Opens a screen in Bearings, for Control Center buttons.
struct OpenBearingsIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Bearings"
    static var openAppWhenRun = true
    static var isDiscoverable = false
    @Parameter(title: "Screen") var screen: String

    init() {}
    init(screen: String) { self.screen = screen }

    func perform() async throws -> some IntentResult {
        #if MAIN_APP
        await MainActor.run {
            if let u = URL(string: "bearings://" + screen) { AppModel.shared.openDeepLink(u) }
        }
        #endif
        return .result()
    }
}
