import Foundation
import StoreKit
import Observation

/// One-time "Bearings Pro" unlock. Nothing is locked yet: `gating` stays off until
/// pricing is decided and the product exists in App Store Connect.
@MainActor
@Observable
final class Pro {
    static let shared = Pro()
    static let productID = "com.jaynichols.networkoob.pro"
    /// Turn on to lock Pro features (Salesforce, trip planner, meeting prep) behind the purchase.
    static let gating = false

    private(set) var product: Product?
    private(set) var owned = false

    var unlocked: Bool { !Pro.gating || owned }

    func load() async {
        product = try? await Product.products(for: [Pro.productID]).first
        await refresh()
        Task.detached { [weak self] in
            for await update in Transaction.updates {
                if case .verified(let t) = update { await t.finish(); await self?.refresh() }
            }
        }
    }

    func refresh() async {
        var has = false
        for await r in Transaction.currentEntitlements {
            if case .verified(let t) = r, t.productID == Pro.productID, t.revocationDate == nil { has = true }
        }
        owned = has
    }

    func buy() async -> Bool {
        guard let product else { return false }
        guard let r = try? await product.purchase() else { return false }
        if case .success(let v) = r, case .verified(let t) = v { await t.finish(); await refresh(); return true }
        return false
    }

    func restore() async { try? await AppStore.sync(); await refresh() }
}
