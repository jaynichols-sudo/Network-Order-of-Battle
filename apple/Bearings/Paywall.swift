import SwiftUI
import StoreKit

/// Bearings Pro: what you get and the three ways to pay.
struct PaywallView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    var feature: Pro.Feature?
    @State private var plan = Pro.yearly
    @State private var buying = false
    @State private var note = ""
    private var pro: Pro { Pro.shared }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Bearings Pro").font(Theme.geist(.largeTitle, .bold)).foregroundStyle(.primary)
                        (Text(feature.map { "\($0.title) is part of Pro. " } ?? "")
                            + Text("The map, Today, search and reminders stay free. Pro adds the tools for working your network."))
                            .font(Theme.geist(.subheadline))
                            .foregroundStyle(Theme.text2)
                    }
                    .padding(.horizontal, 6)

                    VStack(spacing: 0) {
                        ForEach(Array(Pro.Feature.order.enumerated()), id: \.element) { i, f in
                            if i > 0 { Theme.line.frame(height: 1).padding(.leading, 48) }
                            HStack(alignment: .top, spacing: 14) {
                                Image(systemName: f.icon)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Theme.primary)
                                    .frame(width: 32, height: 32)
                                    .background(f == feature ? Theme.needsSoft : Theme.soft, in: Circle())
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(f.title).font(Theme.geist(.subheadline, .semibold))
                                    Text(f.line).font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.vertical, 11)
                        }
                    }
                    .padding(.horizontal, 16)
                    .card()

                    VStack(spacing: 8) {
                        option(Pro.yearly, "Yearly", pro.price(Pro.yearly) + " a year", badge: "Best value")
                        option(Pro.monthly, "Monthly", pro.price(Pro.monthly) + " a month", badge: nil)
                        option(Pro.lifetime, "Lifetime", pro.price(Pro.lifetime) + " once", badge: nil)
                    }

                    Button {
                        buy()
                    } label: {
                        Text(buying ? "One moment…" : pro.owned ? "You have Pro. Thank you!" : "Continue")
                            .font(Theme.geist(.body, .semibold))
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .foregroundStyle(Theme.onPrimary)
                            .background(Theme.primary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(buying || pro.owned)

                    if !note.isEmpty {
                        Text(note).font(Theme.geist(.footnote)).foregroundStyle(Theme.bad).padding(.horizontal, 6)
                    }

                    HStack {
                        Button("Restore purchases") { Task { await pro.restore(); if pro.owned { dismiss() } } }
                        Spacer()
                        Button("Terms") { if let u = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/") { openURL(u) } }
                        Text("·").foregroundStyle(Theme.text3)
                        Button("Privacy") { if let u = URL(string: "https://www.jaynichols.net/bearings/privacy.html") { openURL(u) } }
                    }
                    .font(Theme.geist(.footnote, .medium))
                    .foregroundStyle(Theme.primary)
                    .padding(.horizontal, 6)

                    Text("Subscriptions renew automatically until you cancel in the App Store settings on your device. Payment is charged to your Apple Account. Your network never leaves your devices either way.")
                        .font(Theme.geist(.caption))
                        .foregroundStyle(Theme.text2)
                        .padding(.horizontal, 6)
                }
                .padding(16)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
            .background(Theme.bg)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Not now") { dismiss() } } }
        }
    }

    private func option(_ id: String, _ title: String, _ price: String, badge: String?) -> some View {
        let on = plan == id
        return Button { plan = id; Haptic.tap() } label: {
            HStack(spacing: 12) {
                Image(systemName: on ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(on ? Theme.primary : Theme.text3)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(Theme.geist(.subheadline, .semibold)).foregroundStyle(.primary)
                    Text(price).font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
                }
                Spacer()
                if let badge {
                    Text(badge).font(Theme.geist(.caption, .semibold)).foregroundStyle(Theme.needs)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Theme.needsSoft, in: Capsule())
                }
            }
            .padding(14)
            .card(16)
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(on ? Theme.primary : .clear, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
    }

    private func buy() {
        guard pro.product(plan) != nil else {
            note = "Pro isn’t available to buy yet. Everything is unlocked for now."
            return
        }
        buying = true
        note = ""
        Task {
            if await pro.buy(plan) { Haptic.success(); dismiss() }
            buying = false
        }
    }
}
