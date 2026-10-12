import Foundation

// After a meeting with people you know, Northfix asks "How did it go?" (scheduled in
// CalendarService). Reply right in the notification, on iPhone or Apple Watch, and the
// note lands on everyone who was there.

extension AppModel {
    /// Files the answer to the after-meeting prompt. Called from the notification delegate,
    /// which iOS may run with the app launched in the background, so it loads the network first.
    static func afterMeeting(action: String, text: String?, keys: [String], meeting: String, title: String) async {
        let m = AppModel.shared
        await m.start()
        CalendarService.markAsked(meeting)
        guard !m.info.isSample else { return }
        let ks = keys.filter { m.person($0) != nil }
        guard !ks.isEmpty else { return }
        let names = ListFormatter.localizedString(byJoining: ks.compactMap { m.person($0)?.f })
        switch action {
        case "meet.note":
            let note = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !note.isEmpty else { return }
            // read like a Quick note: "next week", "Friday" or "in 3 days" sets a follow-up
            let days = await m.quickLog(note, save: false).days
            for k in ks {
                await m.edit(k, call: "addNote", [k, String(note.prefix(480)), title.isEmpty ? "Meeting" : title])
                await m.edit(k, call: "touch", [k])
                if days > 0 { await m.followUp(k, days: days, quiet: true) }
            }
            m.show("Saved to \(names).\(days > 0 ? " Follow-up set for \(Day.nice(Day.plus(days)))." : "")")
        case "meet.week":
            for k in ks { await m.followUp(k, days: 7, quiet: true) }
            m.show("Follow-up set for \(Day.nice(Day.plus(7))).")
        default:
            return
        }
        Notifications.shared.schedule(model: m)
    }
}
