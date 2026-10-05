import SwiftUI
#if os(iOS) && !targetEnvironment(macCatalyst)
import ActivityKit
#endif

/// Trip mode: when a trip is under way or starts within two days, Bearings puts it on
/// the Lock Screen and in the Dynamic Island with how many people you know nearby.
@MainActor
enum TripMode {
    static var enabled: Bool {
        get { UserDefaults.standard.object(forKey: "tripMode") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "tripMode") }
    }

    static var current: CalendarService.Trip? {
        let soon = Date().addingTimeInterval(2 * 86400)
        return CalendarService.shared.trips.first { $0.start <= soon }
    }

    static func refresh(model: AppModel) async {
        #if os(iOS) && !targetEnvironment(macCatalyst)
        let existing = Activity<TripActivityAttributes>.activities
        guard enabled, !model.info.isSample, ActivityAuthorizationInfo().areActivitiesEnabled, let t = current else {
            for a in existing { await a.end(nil, dismissalPolicy: .immediate) }
            return
        }
        let near = CalendarService.shared.nearby(t, model: model, miles: 50)
        let lead: String
        if let first = near.first {
            let miles = Int(first.2.rounded())
            lead = "\(first.0.fullName), \(miles <= 1 ? "under a mile" : "\(miles) mi") away" + (near.count > 1 ? " +\(near.count - 1)" : "")
        } else {
            lead = ""
        }
        let state = TripActivityAttributes.ContentState(
            nearby: near.count,
            initials: near.prefix(3).map { $0.0.initials },
            names: near.prefix(3).map { $0.0.f },
            lead: lead,
            now: t.start <= Date())
        let content = ActivityContent(state: state, staleDate: t.end.addingTimeInterval(86400))
        for a in existing where a.attributes.tripID != t.id { await a.end(nil, dismissalPolicy: .immediate) }
        if let a = existing.first(where: { $0.attributes.tripID == t.id }) {
            await a.update(content)
        } else {
            _ = try? Activity.request(attributes: TripActivityAttributes(tripID: t.id, city: t.city, when: t.when), content: content, pushType: nil)
        }
        #endif
    }
}

/// Rides above the tab bar on iOS 26 while you're traveling.
struct TripAccessory: View {
    @Environment(AppModel.self) private var model
    let trip: CalendarService.Trip

    var body: some View {
        let n = CalendarService.shared.nearby(trip, model: model).count
        Button {
            model.tab = .home
            model.paths[.home] = [.trip(trip.id)]
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "location.north.circle.fill").foregroundStyle(Theme.amber)
                VStack(alignment: .leading, spacing: 0) {
                    Text(trip.city).font(Theme.geist(.subheadline, .semibold)).lineLimit(1)
                    Text(n == 0 ? "Trip mode: \(trip.whenPhrase)" : "\(n) \(n == 1 ? "person" : "people") you know nearby")
                        .font(Theme.geist(.caption)).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 14)
        }
        .buttonStyle(.plain)
    }
}
