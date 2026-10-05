import SwiftUI

/// A round action button with its label underneath, like the Contacts app.
struct RoundAction: View {
    let title: String
    let icon: String
    let tint: Color
    var on = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            RoundActionLabel(title: title, icon: icon, tint: tint, on: on)
        }
        .buttonStyle(.plain)
    }
}

struct RoundActionLabel: View {
    let title: String
    let icon: String
    let tint: Color
    var on = false

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(on ? .white : tint)
                .frame(width: 52, height: 52)
                .glassCircle(tint: on ? tint : tint.opacity(0.14))
                .contentTransition(.symbolEffect(.replace))
            Text(title)
                .font(Theme.geist(.caption, .medium))
                .foregroundStyle(.secondary)
        }
        .frame(minWidth: 54)
        .accessibilityElement(children: .combine)
    }
}

/// Your history with someone, newest first: messages, notes, job changes, how you connected.
struct TimelineSection: View {
    let person: Person

    struct Event: Identifiable {
        let id: String
        let date: String
        let icon: String
        let color: Color
        let title: String
        var detail = ""
    }

    var body: some View {
        let events = Self.events(for: person)
        if !events.isEmpty {
            Section("Timeline") {
                ForEach(Array(events.enumerated()), id: \.element.id) { i, e in
                    row(e, first: i == 0, last: i == events.count - 1)
                }
                .listRowSeparator(.hidden)
            }
        }
    }

    private func row(_ e: Event, first: Bool, last: Bool) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                Rectangle().fill(first ? .clear : Color(.separator)).frame(width: 1.5, height: 8)
                Image(systemName: e.icon)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(e.color)
                    .frame(width: 26, height: 26)
                    .background(e.color.opacity(0.15), in: Circle())
                Rectangle().fill(last ? .clear : Color(.separator)).frame(width: 1.5).frame(maxHeight: .infinity)
            }
            .frame(width: 26)
            VStack(alignment: .leading, spacing: 3) {
                Text(Day.nice(e.date).uppercased())
                    .font(Theme.mono(.caption2))
                    .foregroundStyle(.secondary)
                Text(e.title).font(Theme.geist(.subheadline, .semibold))
                if !e.detail.isEmpty {
                    Text(e.detail).font(Theme.geist(.subheadline)).foregroundStyle(.secondary).lineLimit(4)
                }
            }
            .padding(.top, 8)
            .padding(.bottom, last ? 4 : 10)
            Spacer(minLength: 0)
        }
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
        .accessibilityElement(children: .combine)
    }

    static func events(for p: Person) -> [Event] {
        var out: [Event] = []
        if let due = p.ed?.due, !due.isEmpty {
            out.append(Event(id: "due", date: due, icon: "bell.fill", color: Theme.violet, title: due <= Day.today ? "Follow-up due" : "Follow-up planned"))
        }
        if let c = p.circle, !p.next.isEmpty {
            out.append(Event(id: "next", date: p.next, icon: c.icon, color: Theme.violet, title: p.over ? "Overdue to reach out" : "Next check-in", detail: "\(c.title), \(c.cadence.lowercased())"))
        }
        if let t = p.ed?.touched, !t.isEmpty {
            out.append(Event(id: "touched", date: t, icon: "checkmark.bubble.fill", color: Theme.good, title: "You were in touch"))
        }
        out.append(contentsOf: notes(p))
        if let x = p.rx {
            if !x.t.isEmpty {
                out.append(Event(id: "last", date: x.t, icon: x.dir == "i" ? "arrow.down.left" : "arrow.up.right", color: x.dir == "i" ? Theme.amber : Theme.good,
                                 title: x.dir == "i" ? "\(p.f) wrote you" : "You wrote \(p.f)", detail: x.s.isEmpty ? "" : "“\(x.s)”"))
            }
            if !x.f.isEmpty && x.f != x.t && x.m > 1 {
                out.append(Event(id: "first", date: x.f, icon: "bubble.left.and.bubble.right.fill", color: Theme.info, title: "First message",
                                 detail: "\(x.m.formatted()) messages since"))
            }
            if !x.invd.isEmpty {
                out.append(Event(id: "inv", date: x.invd, icon: "envelope.fill", color: Theme.accent,
                                 title: x.inv == "o" ? "You invited \(p.f) to connect" : "\(p.f) invited you to connect",
                                 detail: x.invn.isEmpty ? "" : "“\(x.invn)”"))
            }
        }
        if let jc = p.jc, !jc.isEmpty {
            out.append(Event(id: "jc", date: jc, icon: "briefcase.fill", color: Theme.info,
                             title: "Started a new role", detail: [p.p, p.c].filter { !$0.isEmpty }.joined(separator: " at ")))
        }
        for (i, r) in (p.pv ?? []).enumerated() where !r.until.isEmpty {
            out.append(Event(id: "pv\(i)", date: r.until, icon: "arrow.uturn.left", color: .secondary,
                             title: "Left \(r.c.isEmpty ? "a role" : r.c)", detail: r.p))
        }
        if !p.d.isEmpty {
            out.append(Event(id: "conn", date: p.d, icon: "link", color: Theme.accent, title: "Connected on LinkedIn"))
        }
        return out.sorted { $0.date > $1.date }
    }

    /// Notes written as "2026-10-02 (meeting): text", one per line.
    private static func notes(_ p: Person) -> [Event] {
        guard let note = p.ed?.note, !note.isEmpty else { return [] }
        var out: [Event] = []
        for (i, line) in note.split(separator: "\n").enumerated() {
            let s = String(line)
            guard s.count > 12, let colon = s.firstIndex(of: ":") else { continue }
            let date = String(s.prefix(10))
            guard Day.date(date) != nil else { continue }
            let head = s[s.index(s.startIndex, offsetBy: 10)..<colon].trimmingCharacters(in: .whitespaces)
            let source = head.trimmingCharacters(in: CharacterSet(charactersIn: "()"))
            let body = s[s.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            out.append(Event(id: "note\(i)", date: date, icon: "note.text", color: Theme.violet,
                             title: source.isEmpty ? "Note" : "Note from \(source)", detail: body))
        }
        return out
    }
}
