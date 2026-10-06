import SwiftUI
import UserNotifications

/// The Monday brief: five people worth reaching out to this week, with one reason each.
/// The picks are saved for the week so the list holds still while you work through it.
struct WeeklyPick: Codable, Identifiable, Hashable {
    var k: String
    var kind: String
    var why: String
    var id: String { k }
}

enum WeeklyBrief {
    /// Monday of this week, as yyyy-MM-dd.
    static var weekStart: String {
        var cal = Calendar(identifier: .gregorian)
        cal.firstWeekday = 2
        let start = cal.dateInterval(of: .weekOfYear, for: Date())?.start ?? Date()
        return Day.fmt.string(from: start)
    }

    static var enabled: Bool {
        get { UserDefaults.standard.object(forKey: "mondayBrief") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "mondayBrief") }
    }

    /// Every Monday at 7:30, while the brief is on.
    static func schedule() async {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ["monday"])
        guard enabled else { return }
        await Notifications.shared.requestPermission()
        let c = UNMutableNotificationContent()
        c.title = "Your week in Bearings"
        c.body = "Five people worth reaching out to, with a reason and a draft for each. About ten minutes."
        c.sound = .default
        c.userInfo = ["weekly": true]
        var when = DateComponents()
        when.weekday = 2
        when.hour = 7
        when.minute = 30
        try? await center.add(UNNotificationRequest(identifier: "monday", content: c, trigger: UNCalendarNotificationTrigger(dateMatching: when, repeats: true)))
    }
}

extension AppModel {
    /// This week's picks, chosen once per week.
    func weeklyPicks() async -> [WeeklyPick] {
        let key = "weekly-\(info.mode)-" + WeeklyBrief.weekStart
        if let d = prefs.data(forKey: key), let saved = try? JSONDecoder().decode([WeeklyPick].self, from: d), !saved.isEmpty {
            return saved.filter { person($0.k) != nil }
        }
        let picks = (try? await engine.call("weekly", [[String]()], as: [WeeklyPick].self)) ?? []
        if !picks.isEmpty, let d = try? JSONEncoder().encode(picks) { prefs.set(d, forKey: key) }
        return picks
    }

    /// Swaps one pick for the next best person.
    func replacePick(_ p: WeeklyPick, in list: [WeeklyPick]) async -> [WeeklyPick] {
        let skip = list.map(\.k) + (prefs.stringArray(forKey: "weekly-skipped-" + WeeklyBrief.weekStart) ?? [])
        prefs.set(skip, forKey: "weekly-skipped-" + WeeklyBrief.weekStart)
        let more = (try? await engine.call("weekly", [skip], as: [WeeklyPick].self)) ?? []
        var out = list.filter { $0.k != p.k }
        if let next = more.first { out.append(next) }
        if let d = try? JSONEncoder().encode(out) { prefs.set(d, forKey: "weekly-\(info.mode)-" + WeeklyBrief.weekStart) }
        return out
    }

    /// Done this week: messaged them or logged a touch since Monday.
    func weeklyDone(_ k: String) -> Bool {
        guard let p = person(k) else { return false }
        let since = WeeklyBrief.weekStart
        return p.touch >= since || ((p.rx?.t ?? "") >= since && p.rx?.dir == "o")
    }
}

/// The Home card that leads into the brief.
struct WeeklyCard: View {
    @Environment(AppModel.self) private var model
    @State private var picks: [WeeklyPick] = []

    var body: some View {
        Group { content }
            .task(id: "\(model.info.rev)-\(model.info.edits)-\(model.showWeekly)") { picks = await model.weeklyPicks() }
    }

    @ViewBuilder private var content: some View {
        if !picks.isEmpty {
            let done = picks.filter { model.weeklyDone($0.k) }.count
            Button { model.showWeekly = true } label: {
                HStack(spacing: 14) {
                    ZStack {
                        Circle().stroke(Color(.tertiarySystemFill), lineWidth: 5)
                        Circle().trim(from: 0, to: CGFloat(done) / CGFloat(max(1, picks.count)))
                            .stroke(Theme.amber, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                        Text("\(done)/\(picks.count)").font(Theme.mono(.caption, .semibold))
                    }
                    .frame(width: 48, height: 48)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(done >= picks.count ? "Your week is done" : "Your week: \(picks.count - done) to reach out to")
                            .font(Theme.geist(.headline)).foregroundStyle(.primary)
                        let names = model.persons(picks.filter { !model.weeklyDone($0.k) }.map(\.k)).prefix(3).map(\.f)
                        Text(done >= picks.count ? "Nice work. A new five arrive Monday morning." : names.joined(separator: ", ") + ". A reason and a draft for each.")
                            .font(Theme.geist(.subheadline)).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                }
                .padding(14)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.amber.opacity(done >= picks.count ? 0 : 0.45), lineWidth: 1.5))
            }
            .buttonStyle(.plain)
        }
    }
}

struct WeeklyBriefView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var picks: [WeeklyPick] = []
    @State private var writing: WeeklyPick?
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    header
                    if loaded && picks.isEmpty {
                        ContentUnavailableView("Nothing pressing this week", systemImage: "checkmark.seal",
                                               description: Text("No one’s waiting on you and your circles are up to date. Enjoy it."))
                    }
                    ForEach(picks) { p in card(p) }
                    if !picks.isEmpty && done == picks.count {
                        Label("All done for this week. A new five arrive Monday morning.", systemImage: "checkmark.seal.fill")
                            .font(Theme.geist(.subheadline, .semibold))
                            .foregroundStyle(Theme.good)
                            .padding(.top, 4)
                    }
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("This week")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .navigationDestination(for: Route.self) { r in if case .person(let k) = r { ProfileView(k: k) } }
            .sheet(item: $writing) { p in MessageSheet(k: p.k) }
            .task(id: model.info.edits) {
                picks = await model.weeklyPicks()
                loaded = true
            }
        }
    }

    private var done: Int { picks.filter { model.weeklyDone($0.k) }.count }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Week of \(Day.nice(WeeklyBrief.weekStart))").font(Theme.mono(.caption, .semibold)).foregroundStyle(Theme.accent)
            Text("Five people worth your time").font(Theme.geist(.title, .bold))
            Text("One reason and a ready-made message for each. Mark them done as you go.").font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
            if !picks.isEmpty {
                ProgressView(value: Double(done), total: Double(picks.count)).tint(Theme.amber).padding(.top, 4)
                    .animation(.smooth, value: done)
            }
        }
        .padding(.bottom, 4)
    }

    @ViewBuilder private func card(_ w: WeeklyPick) -> some View {
        if let p = model.person(w.k) {
            let isDone = model.weeklyDone(w.k)
            VStack(alignment: .leading, spacing: 12) {
                NavigationLink(value: Route.person(w.k)) {
                    HStack(spacing: 12) {
                        Avatar(person: p, size: 48)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p.fullName).font(Theme.geist(.headline)).foregroundStyle(.primary).strikethrough(isDone, color: .secondary)
                            Text(p.subtitle).font(Theme.geist(.subheadline)).foregroundStyle(.secondary).lineLimit(2)
                        }
                        Spacer(minLength: 0)
                        if isDone { Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(Theme.good) }
                    }
                }
                .buttonStyle(.plain)
                Text(w.why).font(Theme.geist(.body)).fixedSize(horizontal: false, vertical: true)
                if !isDone {
                    HStack(spacing: 10) {
                        Button { writing = w } label: { Label("Write", systemImage: "square.and.pencil").frame(maxWidth: .infinity) }
                            .prominentGlassButton()
                        Button { Task { await model.touched(w.k) } } label: { Label("Done", systemImage: "checkmark").frame(maxWidth: .infinity) }
                            .glassButton()
                        Menu {
                            Button { Task { picks = await model.replacePick(w, in: picks) } } label: { Label("Someone else instead", systemImage: "arrow.triangle.2.circlepath") }
                        } label: { Image(systemName: "ellipsis").frame(width: 30, height: 30) }
                        .accessibilityLabel("More")
                    }
                    .font(Theme.geist(.subheadline, .semibold))
                    .controlSize(.large)
                }
            }
            .padding(16)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .opacity(isDone ? 0.7 : 1)
            .animation(.smooth, value: isDone)
        }
    }
}
