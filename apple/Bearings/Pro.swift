import Foundation
import StoreKit
import Observation

/// Bearings Pro. The map, Today, People, Companies, Catch Up, search and reminders stay
/// free. Pro adds the tools for working a network: event mode, ways in, team packs,
/// arrival alerts, the account map PDF and Salesforce.
///
/// Nothing is locked until `gating` is turned on, which waits on Jay confirming prices
/// and the products existing in App Store Connect (see docs/pricing.md).
@MainActor
@Observable
final class Pro {
    static let shared = Pro()

    static let yearly = "com.jaynichols.networkoob.pro.yearly"
    static let monthly = "com.jaynichols.networkoob.pro.monthly"
    /// The original one-time unlock, kept as the lifetime option.
    static let lifetime = "com.jaynichols.networkoob.pro"
    static let all = [yearly, monthly, lifetime]

    /// Turn on to lock Pro features behind the purchase.
    static let gating = false

    enum Feature: String, Identifiable {
        case events, waysIn, team, arrivals, accountMap, salesforce, enrich
        var id: String { rawValue }
        var title: String {
            switch self {
            case .events: return "Event mode"
            case .waysIn: return "Ways in"
            case .team: return "Team packs"
            case .arrivals: return "Arrival alerts"
            case .accountMap: return "Account map PDF"
            case .salesforce: return "Salesforce"
            case .enrich: return "ZoomInfo and Seamless.AI"
            }
        }
        var line: String {
            switch self {
            case .events: return "See who you know before a conference, then work the follow-up list."
            case .waysIn: return "The best paths into any company, with the intro ask drafted."
            case .team: return "Pool networks with teammates, privately, to find warm paths."
            case .arrivals: return "Land somewhere and see who you know there."
            case .accountMap: return "A one-page map of who you know at an account, to share."
            case .salesforce: return "Send contacts, tasks and notes to your Salesforce."
            case .enrich: return "Fill in emails, phones and locations from your own account."
            }
        }
        var icon: String {
            switch self {
            case .events: return "ticket"
            case .waysIn: return "point.3.connected.trianglepath.dotted"
            case .team: return "person.3"
            case .arrivals: return "airplane.arrival"
            case .accountMap: return "doc.richtext"
            case .salesforce: return "cloud"
            case .enrich: return "sparkle.magnifyingglass"
            }
        }
        static let order: [Feature] = [.events, .waysIn, .team, .arrivals, .enrich, .accountMap, .salesforce]
    }

    /// Prices to show before the App Store answers (and in screenshots); the real ones come from StoreKit.
    static let proposed: [String: String] = [yearly: "$29.99", monthly: "$3.99", lifetime: "$79.99"]

    private(set) var products: [String: Product] = [:]
    private(set) var owned = false
    private(set) var ownedID: String?

    var unlocked: Bool { !Pro.gating || owned }

    func price(_ id: String) -> String { products[id]?.displayPrice ?? Pro.proposed[id] ?? "" }
    func product(_ id: String) -> Product? { products[id] }
    /// Kept for Settings: the lifetime product, as before.
    var product: Product? { products[Pro.lifetime] ?? products[Pro.yearly] }

    func load() async {
        if let list = try? await Product.products(for: Pro.all) {
            products = Dictionary(uniqueKeysWithValues: list.map { ($0.id, $0) })
        }
        await refresh()
        Task.detached { [weak self] in
            for await update in Transaction.updates {
                if case .verified(let t) = update { await t.finish(); await self?.refresh() }
            }
        }
    }

    func refresh() async {
        var has: String?
        for await r in Transaction.currentEntitlements {
            if case .verified(let t) = r, Pro.all.contains(t.productID), t.revocationDate == nil,
               t.expirationDate.map({ $0 > Date() }) ?? true {
                has = t.productID
            }
        }
        owned = has != nil
        ownedID = has
    }

    func buy(_ id: String = Pro.lifetime) async -> Bool {
        guard let product = products[id] else { return false }
        guard let r = try? await product.purchase() else { return false }
        if case .success(let v) = r, case .verified(let t) = v { await t.finish(); await refresh(); return true }
        return false
    }

    func restore() async { try? await AppStore.sync(); await refresh() }
}

extension AppModel {
    /// True when the feature can be used; otherwise shows the paywall for it.
    func allow(_ f: Pro.Feature) -> Bool {
        if Pro.shared.unlocked { return true }
        paywallFeature = f
        return false
    }
}
