import Foundation
import CoreLocation
import UserNotifications

/// Arrival alerts: land somewhere away from home and Bearings tells you who you know there.
/// Uses iOS's low-power significant-location changes (no GPS polling); the location is only
/// compared on the device with where your people are, and never leaves it.
@MainActor
final class ArrivalAlerts: NSObject, CLLocationManagerDelegate {
    static let shared = ArrivalAlerts()
    private let manager = CLLocationManager()

    static var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: "arrivalAlerts") }
        set { UserDefaults.standard.set(newValue, forKey: "arrivalAlerts") }
    }

    override init() {
        super.init()
        manager.delegate = self
    }

    /// Called at launch: keeps watching if it's on.
    func resume() {
        #if !targetEnvironment(macCatalyst)
        guard Self.enabled, CLLocationManager.significantLocationChangeMonitoringAvailable() else { return }
        manager.startMonitoringSignificantLocationChanges()
        #endif
    }

    func setEnabled(_ on: Bool) {
        Self.enabled = on
        #if !targetEnvironment(macCatalyst)
        if on {
            manager.requestAlwaysAuthorization()
            manager.startMonitoringSignificantLocationChanges()
            Task { await Notifications.shared.requestPermission() }
        } else {
            manager.stopMonitoringSignificantLocationChanges()
        }
        #endif
    }

    var needsAlways: Bool { Self.enabled && manager.authorizationStatus != .authorizedAlways }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        Task { @MainActor in await self.arrived(at: loc) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    private func arrived(at loc: CLLocation) async {
        guard Self.enabled, Pro.shared.unlocked, loc.horizontalAccuracy < 5000 else { return }
        // only away from home, and once per city per four days
        if let home = CalendarService.shared.home,
           loc.distance(from: CLLocation(latitude: home.latitude, longitude: home.longitude)) < 75 * 1609 { return }
        let model = AppModel.shared
        if !model.loaded { await model.start() }
        guard !model.info.isSample else { return }
        guard let city = await Self.cityName(loc) else { return }
        let last = UserDefaults.standard.dictionary(forKey: "arrivalLast") as? [String: Double] ?? [:]
        if let t = last[city], Date().timeIntervalSince1970 - t < 4 * 86400 { return }

        let here = loc.coordinate
        let near = model.places.compactMap { k, pl -> (Person, Double)? in
            guard !pl.isApproximate, let p = model.person(k), p.x == nil else { return nil }
            let d = pl.coordinate.miles(to: here)
            return d <= 50 ? (p, d) : nil
        }
        .sorted { $0.0.score > $1.0.score }
        guard !near.isEmpty else { return }
        var seen = last; seen[city] = Date().timeIntervalSince1970
        UserDefaults.standard.set(seen, forKey: "arrivalLast")

        let close = near.filter { $0.0.band == "strong" }.count
        let names = near.prefix(3).map { $0.0.fullName }
        let c = UNMutableNotificationContent()
        c.title = "Welcome to \(city.components(separatedBy: ",").first ?? city)"
        c.body = "You know \(near.count) \(near.count == 1 ? "person" : "people") within 50 miles"
            + (close > 0 ? ", \(close) of them close" : "") + ": " + names.joined(separator: ", ") + (near.count > 3 ? " and more." : ".")
        c.sound = .default
        c.userInfo = ["arrival": city, "lat": here.latitude, "lon": here.longitude]
        try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "arrival", content: c, trigger: nil))
    }

    private static func cityName(_ loc: CLLocation) async -> String? {
        guard let m = try? await CLGeocoder().reverseGeocodeLocation(loc).first else { return nil }
        let s = [m.locality, m.administrativeArea ?? m.country].compactMap { $0 }.joined(separator: ", ")
        return s.isEmpty ? nil : s
    }
}
