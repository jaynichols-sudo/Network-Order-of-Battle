import SwiftUI
#if os(iOS) && !targetEnvironment(macCatalyst)
import ActivityKit
#endif

// Bearings remembers what you talked about. Before a meeting with someone you know it puts
// the one thing worth remembering on the Lock Screen and the watch, and every profile
// opens with it.

struct MemoryInfo: Decodable, Hashable {
    struct Note: Decodable, Hashable { var date: String; var source: String; var text: String }
    struct Message: Decodable, Hashable { var date: String; var mine: Bool; var text: String }
    var k: String
    var line: String
    var last: Note?
    var msg: Message?
    var waiting: Bool
}

extension AppModel {
    func memory(_ k: String) async -> MemoryInfo? {
        try? await engine.call("memory", [k], as: MemoryInfo?.self)
    }
}

/// "Last time…" at the top of a profile.
struct MemoryCard: View {
    @Environment(AppModel.self) private var model
    let person: Person
    @State private var info: MemoryInfo?

    var body: some View {
        Group {
            if let info, info.last != nil || info.msg?.text.isEmpty == false {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 6) {
                        Image(systemName: "brain.head.profile").foregroundStyle(Theme.violet)
                        Text("What to remember").font(Theme.geist(.footnote, .semibold)).foregroundStyle(Theme.text2)
                        Spacer()
                        if let s = info.last?.source, !s.isEmpty {
                            Text(s).font(Theme.geist(.caption, .semibold)).foregroundStyle(Theme.violet)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(Theme.violet.opacity(0.12), in: Capsule())
                        }
                    }
                    Text(info.line)
                        .font(Theme.geist(.body))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .card()
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .animation(Motion.spring, value: info)
        .task(id: "\(person.k)-\(model.info.edits)") { info = await model.memory(person.k) }
    }
}

/// The next meeting with someone you know, as a Live Activity from three hours before
/// until it ends.
@MainActor
enum MeetingMode {
    static var enabled: Bool {
        get { UserDefaults.standard.object(forKey: "meetingCard") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "meetingCard") }
    }

    static func next(model: AppModel) -> (CalendarService.Meeting, Person)? {
        let now = Date()
        let soon = now.addingTimeInterval(3 * 3600)
        for m in CalendarService.shared.meetings.sorted(by: { $0.start < $1.start }) where m.end > now && m.start <= soon {
            let ps = model.persons(m.matched).sorted { $0.score > $1.score }
            if let p = ps.first { return (m, p) }
        }
        return nil
    }

    static func refresh(model: AppModel) async {
        #if os(iOS) && !targetEnvironment(macCatalyst)
        let existing = Activity<MeetingActivityAttributes>.activities
        guard enabled, !model.info.isSample, ActivityAuthorizationInfo().areActivitiesEnabled, let (m, p) = next(model: model) else {
            for a in existing { await a.end(nil, dismissalPolicy: .immediate) }
            return
        }
        let mem = await model.memory(p.k)
        let others = max(0, m.matched.count - 1)
        let state = MeetingActivityAttributes.ContentState(name: p.fullName, initials: p.initials, color: p.color,
                                                           memory: mem?.line ?? p.subtitle, others: others)
        let content = ActivityContent(state: state, staleDate: m.end)
        for a in existing where a.attributes.meetingID != m.id { await a.end(nil, dismissalPolicy: .immediate) }
        if let a = existing.first(where: { $0.attributes.meetingID == m.id }) {
            await a.update(content)
        } else {
            _ = try? Activity.request(attributes: MeetingActivityAttributes(meetingID: m.id, title: m.title, start: m.start, end: m.end, k: p.k),
                                      content: content, pushType: nil)
        }
        #endif
    }
}
