import Foundation
import StoreKit
import Observation

/// Northfix Pro. The map, Today, People, Companies, Catch Up, search and reminders stay
/// free. Pro adds the tools for working a network: event mode, ways in, team packs,
/// arrival alerts, the account map PDF and CRM sync (Salesforce, HubSpot, Dynamics 365).
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
    /// The Pro products. Team Starter below is a separate entitlement and never unlocks Pro by itself.
    static let all = [yearly, monthly, lifetime]

    /// Northfix Team, up to 5 seats: a yearly subscription the team owner buys in the app, so a
    /// small team can start on the App Store. The team server checks the transaction and turns
    /// the team's plan on (POST /v1/billing/apple, see docs/team.md). Bigger teams pay on the web.
    static let team5 = "com.jaynichols.networkoob.team5"
    static let team5Seats = 5

    /// Turn on to lock Pro features behind the purchase.
    static let gating = false

    enum Feature: String, Identifiable {
        case events, waysIn, team, arrivals, accountMap, salesforce, enrich
        var id: String { rawValue }
        var title: String {
            switch self {
            case .events: return "Event mode"
            case .waysIn: return "Ways in"
            case .team: return "Team"
            case .arrivals: return "Arrival alerts"
            case .accountMap: return "Account map PDF"
            case .salesforce: return "CRM sync"
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
            case .salesforce: return "Send contacts, tasks and notes to Salesforce, HubSpot or Dynamics 365."
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
    static let proposed: [String: String] = [yearly: "$99.99", monthly: "$19.99", lifetime: "$249.99", team5: "$2,939.99"]

    private(set) var products: [String: Product] = [:]
    private(set) var owned = false
    private(set) var ownedID: String?

    /// The Team Starter subscription this Apple Account holds, if any: the latest transaction as
    /// the signed JWS the team server checks, and when the paid period ends. Set even when it has
    /// lapsed, so the Team screen can say so and the server can be told when it renews.
    private(set) var teamStarterJWS: String?
    private(set) var teamStarterExpires: Date?
    var hasTeamStarter: Bool { teamStarterJWS != nil && (teamStarterExpires.map { $0 > Date() } ?? false) }

    var unlocked: Bool { !Pro.gating || owned }

    func price(_ id: String) -> String { products[id]?.displayPrice ?? Pro.proposed[id] ?? "" }
    func product(_ id: String) -> Product? { products[id] }
    /// Kept for Settings: the lifetime product, as before.
    var product: Product? { products[Pro.lifetime] ?? products[Pro.yearly] }

    func load() async {
        if let list = try? await Product.products(for: Pro.all + [Pro.team5]) {
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
        var until: Date?
        for await r in Transaction.currentEntitlements {
            if case .verified(let t) = r, Pro.all.contains(t.productID), t.revocationDate == nil,
               t.expirationDate.map({ $0 > Date() }) ?? true {
                has = t.productID
                until = t.expirationDate
            }
        }
        owned = has != nil
        ownedID = has
        await refreshTeamStarter()
        await writeAIAccess(until: has == nil ? nil : until)
    }

    /// Reads the latest Team Starter transaction, current or lapsed.
    func refreshTeamStarter() async {
        if let r = await Transaction.latest(for: Pro.team5), case .verified(let t) = r, t.revocationDate == nil {
            teamStarterJWS = r.jwsRepresentation
            teamStarterExpires = t.expirationDate
        } else {
            teamStarterJWS = nil
            teamStarterExpires = nil
        }
    }

    /// Buys Northfix Team, up to 5 seats. Returns the signed transaction to send to the team
    /// server, or nil when the purchase didn't go through (including when it was cancelled).
    func buyTeamStarter() async -> String? {
        guard let product = products[Pro.team5] else { return nil }
        guard let r = try? await product.purchase() else { return nil }
        if case .success(let v) = r, case .verified(let t) = v {
            await t.finish()
            await refreshTeamStarter()
            return v.jwsRepresentation
        }
        return nil
    }

    /// What ai-access.json last said, so it's only rewritten when that changes.
    @ObservationIgnored private var aiAccessWritten: String?

    /// Northfix for AI tools (the local MCP server in mcp/) reads ai-access.json next to the
    /// network files to know whether to answer without the free daily limit. It mirrors what
    /// the app already knows; it isn't a lock. Saved in iCloud, so Pro bought on an iPhone
    /// reaches the Mac too.
    func writeAIAccess(until: Date?) async {
        let pro = unlocked || TeamSync.shared.grantsPro
        let iso = ISO8601DateFormatter()
        let untilText = pro ? until.map { iso.string(from: $0) } : nil
        let key = "\(pro)|\(untilText ?? "")"
        guard key != aiAccessWritten else { return }
        let body: [String: Any] = ["pro": pro, "until": untilText ?? NSNull(), "written": iso.string(from: Date())]
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8) else { return }
        do {
            try await AppModel.shared.store.write("ai-access.json", text)
            aiAccessWritten = key
        } catch {}
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
        if Pro.shared.unlocked || TeamSync.shared.grantsPro { return true }
        paywallFeature = f
        return false
    }
}
