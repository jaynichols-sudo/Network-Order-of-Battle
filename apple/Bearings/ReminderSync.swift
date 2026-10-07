import Foundation
import EventKit

/// Follow-ups in Apple Reminders. With it on, "Remind me" also adds a reminder to a
/// "Bearings" list (so it shows in Siri, on the watch and on the Mac), and checking it
/// off in Reminders marks the follow-up done here. Everything stays on the device.
@MainActor
final class ReminderSync {
    static let shared = ReminderSync()
    private let store = EKEventStore()
    private let listName = "Bearings"

    var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: "remindersSync") }
        set { UserDefaults.standard.set(newValue, forKey: "remindersSync") }
    }

    var authorized: Bool { EKEventStore.authorizationStatus(for: .reminder) == .fullAccess }

    func requestAccess() async -> Bool {
        if authorized { return true }
        return (try? await store.requestFullAccessToReminders()) ?? false
    }

    /// person key → reminder identifier, for follow-ups this sync created
    private var ids: [String: String] {
        get { UserDefaults.standard.dictionary(forKey: "reminderIDs") as? [String: String] ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: "reminderIDs") }
    }

    private func list() -> EKCalendar? {
        if let id = UserDefaults.standard.string(forKey: "reminderList"), let c = store.calendar(withIdentifier: id) { return c }
        if let c = store.calendars(for: .reminder).first(where: { $0.title == listName }) {
            UserDefaults.standard.set(c.calendarIdentifier, forKey: "reminderList")
            return c
        }
        guard let source = store.defaultCalendarForNewReminders()?.source ?? store.sources.first(where: { $0.sourceType == .calDAV || $0.sourceType == .local }) else { return nil }
        let c = EKCalendar(for: .reminder, eventStore: store)
        c.title = listName
        c.source = source
        c.cgColor = CGColor(red: 1, green: 0.69, blue: 0.13, alpha: 1)
        do {
            try store.saveCalendar(c, commit: true)
            UserDefaults.standard.set(c.calendarIdentifier, forKey: "reminderList")
            return c
        } catch {
            return store.defaultCalendarForNewReminders()
        }
    }

    private func dueComponents(_ date: Date) -> DateComponents {
        var c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        c.hour = 9
        return c
    }

    /// Adds, moves or clears the reminder for someone's follow-up.
    func setFollowUp(k: String, name: String, due: Date?, why: String?) {
        guard enabled, authorized else { return }
        var map = ids
        let existing = map[k].flatMap { store.calendarItem(withIdentifier: $0) as? EKReminder }
        guard let due else {
            if let r = existing { r.isCompleted = true; try? store.save(r, commit: true) }
            map[k] = nil
            ids = map
            return
        }
        let r = existing ?? EKReminder(eventStore: store)
        if existing == nil { guard let l = list() else { return }; r.calendar = l }
        r.title = "Follow up with \(name)"
        r.notes = why
        r.url = URL(string: "bearings://person/\(k.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? k)")
        r.dueDateComponents = dueComponents(due)
        r.alarms = [EKAlarm(absoluteDate: Calendar.current.date(from: dueComponents(due)) ?? due)]
        r.isCompleted = false
        do {
            try store.save(r, commit: true)
            map[k] = r.calendarItemIdentifier
            ids = map
        } catch {}
    }

    /// An action item from meeting notes, as its own reminder.
    func addTask(_ title: String, k: String?, due: Date) async -> Bool {
        guard await requestAccess(), let l = list() else { return false }
        let r = EKReminder(eventStore: store)
        r.calendar = l
        r.title = title
        if let k { r.url = URL(string: "bearings://person/\(k.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? k)") }
        r.dueDateComponents = dueComponents(due)
        do { try store.save(r, commit: true); return true } catch { return false }
    }

    /// Follow-ups checked off in Reminders are done here too.
    func pullCompleted(model: AppModel) async {
        guard enabled, authorized else { return }
        var map = ids
        var changed = false
        for (k, id) in map {
            guard let r = store.calendarItem(withIdentifier: id) as? EKReminder else { map[k] = nil; changed = true; continue }
            if r.isCompleted {
                map[k] = nil
                changed = true
                if !(model.person(k)?.ed?.due ?? "").isEmpty { await model.followUp(k, days: 0, quiet: true) }
            }
        }
        if changed { ids = map }
    }
}
