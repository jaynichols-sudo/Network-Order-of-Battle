import SwiftUI
import UserNotifications

/// The recompete radar (engine: recompeteRadar): contracts ending at agencies you work, by how
/// soon, with the warmest way in for each, and a local alert for new ones where you know someone.
/// Everything is worked out on this device from the USASpending.gov pages AwardFeed already keeps.
struct RadarWay: Decodable, Hashable { var k: String; var name: String; var side: String; var why: String }
struct RadarBucket: Decodable, Hashable { var label: String; var count: Int; var covered: Int; var valueText: String }
struct RadarAlert: Decodable, Hashable { var id: String; var title: String; var body: String }
struct RadarItem: Decodable, Hashable, Identifiable {
    var id: String
    var title: String
    var agency: String
    var incumbent: String
    var amountText: String
    var end: String
    var horizon: String
    var isNew: Bool
    var covered: Bool
    var next: String
    var ways: [RadarWay]
}
struct RadarResult: Decodable {
    var months: Int
    var total: Int
    var valueText: String
    var newCount: Int
    var items: [RadarItem]
    var buckets: [RadarBucket]
    var alerts: [RadarAlert]
    var ids: [String]
    var text: String
}

@MainActor
enum RecompeteRadar {
    private static let seenKey = "radar.seen"
    static var seen: [String] { UserDefaults.standard.stringArray(forKey: seenKey) ?? [] }

    static func load(model: AppModel, months: Int) async -> RadarResult? {
        let pages = AwardFeed.shared.pagesJSON
        return try? await model.engine.call("recompeteRadar", [pages, ["months": months, "seen": seen, "limit": 20] as [String: Any]], as: RadarResult.self)
    }

    /// Remembers what's been shown, so the same contract alerts once.
    static func markSeen(_ r: RadarResult) {
        let all = Array(Set(seen + r.ids)).suffix(2000)
        UserDefaults.standard.set(Array(all), forKey: seenKey)
    }

    /// One local notification per new alert. Nothing is sent anywhere.
    static func notify(_ r: RadarResult, model: AppModel) async {
        guard !model.info.isSample, !r.alerts.isEmpty, UserDefaults.standard.object(forKey: "notify") as? Bool ?? true else { return }
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
        for a in r.alerts {
            let c = UNMutableNotificationContent()
            c.title = a.title
            c.body = a.body
            try? await center.add(UNNotificationRequest(identifier: "radar-\(a.id)", content: c, trigger: nil))
        }
    }
}

/// The radar at the top of Recompetes.
struct RecompeteRadarSection: View {
    @Environment(AppModel.self) private var model
    let months: Int
    @State private var radar: RadarResult?

    var body: some View {
        Section {
            if let r = radar, r.total > 0 {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("RECOMPETE RADAR").font(Theme.eyebrow).tracking(1.1).foregroundStyle(Theme.text2)
                        Spacer()
                        ShareLink(item: r.text) { Image(systemName: "square.and.arrow.up") }
                    }
                    if r.newCount > 0 { Text("\(r.newCount) new since you last looked").font(Theme.geist(.footnote, .semibold)).foregroundStyle(Theme.accent) }
                    ForEach(r.buckets, id: \.label) { b in
                        HStack {
                            Text(b.label).font(Theme.geist(.subheadline))
                            Spacer()
                            Text("\(b.count) · \(b.valueText) · \(b.covered) covered").font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.vertical, 4)
                ForEach(r.items.prefix(5)) { x in
                    NavigationLink(value: Route.recompete(x.id)) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("\(x.agency) · \(x.horizon)\(x.isNew ? " · New" : "")".uppercased()).font(Theme.eyebrow).foregroundStyle(x.isNew ? Theme.accent : Theme.text2)
                            Text(x.title).font(Theme.geist(.subheadline, .semibold)).lineLimit(2)
                            Text(x.next).font(Theme.geist(.footnote)).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                }
            }
        }
        .task(id: "\(AwardFeed.shared.rev)-\(months)-\(model.pursuitsRev)") {
            guard let r = await RecompeteRadar.load(model: model, months: min(months, 12)) else { return }
            radar = r
            await RecompeteRadar.notify(r, model: model)
            RecompeteRadar.markSeen(r)
        }
    }
}
