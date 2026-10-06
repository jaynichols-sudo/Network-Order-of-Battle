import Foundation
import UserNotifications

/// Follow-up reminders (with Done and Snooze buttons that also work from an
/// Apple Watch) plus a weekly nudge to refresh the network.
final class Notifications: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    static let shared = Notifications()
    var onAction: ((String?, String) -> Void)?
    private var pendingAction: (String?, String)?
    private var scheduleTask: Task<Void, Never>?

    func register() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let done = UNNotificationAction(identifier: "done", title: "Done", options: [])
        let snooze = UNNotificationAction(identifier: "snooze", title: "Snooze a week", options: [])
        let follow = UNNotificationCategory(identifier: "FOLLOW", actions: [done, snooze], intentIdentifiers: [], options: [])
        let note = UNTextInputNotificationAction(identifier: "note", title: "Add a note", options: [], textInputButtonTitle: "Save", textInputPlaceholder: "What did you talk about?")
        let after = UNNotificationCategory(identifier: "AFTER", actions: [note], intentIdentifiers: [], options: [])
        center.setNotificationCategories([follow, after])
    }

    func requestPermission() async {
        guard UserDefaults.standard.object(forKey: "notify") as? Bool ?? true else { return }
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined {
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        }
    }

    /// Replaces every pending reminder with the current follow-ups.
    @MainActor func schedule(model: AppModel) {
        scheduleTask?.cancel()
        scheduleTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 800_000_000)
            if Task.isCancelled { return }
            let center = UNUserNotificationCenter.current()
            let pending = await center.pendingNotificationRequests()
            center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix("f-") || $0.hasPrefix("b-") || $0 == "refresh" })
            guard UserDefaults.standard.object(forKey: "notify") as? Bool ?? true, !model.info.isSample else { return }
            let settings = await center.notificationSettings()
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
            let now = Date()
            var requests: [UNNotificationRequest] = []
            for r in await model.reminders() {
                guard let day = Day.date(r.due) else { continue }
                var comps = Calendar.current.dateComponents([.year, .month, .day], from: day)
                comps.hour = 9
                guard let at = Calendar.current.date(from: comps), at > now else { continue }
                let c = UNMutableNotificationContent()
                c.title = r.title
                c.body = r.body
                c.sound = .default
                c.categoryIdentifier = "FOLLOW"
                c.userInfo = ["k": r.k]
                requests.append(UNNotificationRequest(identifier: "f-\(r.k)", content: c, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
            }
            requests.sort { a, b in
                let da = (a.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate() ?? .distantFuture
                let db = (b.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate() ?? .distantFuture
                return da < db
            }
            if let last = Day.date(model.info.lastImport) {
                var at = Calendar.current.date(byAdding: .day, value: 7, to: last) ?? now
                at = Calendar.current.date(bySettingHour: 10, minute: 0, second: 0, of: at) ?? at
                if at <= now { at = now.addingTimeInterval(86_400) }
                let c = UNMutableNotificationContent()
                c.title = "Time to refresh your network"
                c.body = "Grab a fresh LinkedIn export to catch job changes and new connections."
                c.userInfo = ["refresh": true]
                let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: at)
                requests.insert(UNNotificationRequest(identifier: "refresh", content: c, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)), at: 0)
            }
            for (p, d) in model.upcomingBirthdays(within: 30).prefix(8) {
                var comps = Calendar.current.dateComponents([.year, .month, .day], from: d)
                comps.hour = 9
                guard let at = Calendar.current.date(from: comps), at > now else { continue }
                let c = UNMutableNotificationContent()
                c.title = "\(p.fullName)’s birthday is today"
                c.body = "A short note goes a long way."
                c.sound = .default
                c.userInfo = ["k": p.k]
                requests.append(UNNotificationRequest(identifier: "b-\(p.k)", content: c, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
            }
            for r in requests.prefix(62) { try? await center.add(r) }
        }
    }

    func deliverPending() {
        if let p = pendingAction { pendingAction = nil; onAction?(p.0, p.1) }
    }

    // MARK: delegate

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let k = info["k"] as? String
        var action = response.actionIdentifier
        if let typed = response as? UNTextInputNotificationResponse {
            action = "note:" + ((info["mt"] as? String) ?? "") + "\n" + typed.userText
        } else if action == UNNotificationDefaultActionIdentifier, info["weekly"] != nil {
            action = "weekly"
        } else if action == UNNotificationDefaultActionIdentifier, let ev = info["event"] as? String {
            action = "event:" + ev
        } else if action == UNNotificationDefaultActionIdentifier {
            if let m = info["meeting"] as? String { action = "meeting:" + m }
            else if let t = info["trip"] as? String { action = "trip:" + t }
            else { action = info["refresh"] != nil ? "refresh" : "open" }
        }
        await MainActor.run {
            if let handler = self.onAction { handler(k, action) } else { self.pendingAction = (k, action) }
        }
    }
}
