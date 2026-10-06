import SwiftUI

// MARK: today

enum WatchRoute: Hashable {
    case section(WatchSection)
    case person(String)
}

struct RootView: View {
    @EnvironmentObject var store: WatchStore
    @State private var path: [WatchRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if store.snap == nil {
                    EmptyStateView()
                } else {
                    TodayList()
                }
            }
            .navigationTitle(store.snap == nil ? "Bearings" : "Today")
            .navigationDestination(for: WatchRoute.self) { r in
                switch r {
                case .section(let s): PeopleList(section: s)
                case .person(let k): PersonView(k: k)
                }
            }
            .containerBackground(WatchTheme.bg, for: .navigation)
        }
        .onAppear {
            // used by CI screenshots: -watchOpen waiting | person
            switch UserDefaults.standard.string(forKey: "watchOpen") ?? "" {
            case "waiting": path = [.section(.waiting)]
            case "person": if let p = store.waiting.first ?? store.people.first { path = [.section(.waiting), .person(p.k)] }
            default: break
            }
        }
    }
}

struct EmptyStateView: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Image(systemName: "location.north.circle.fill")
                    .font(.system(size: 42))
                    .foregroundStyle(WatchTheme.amber)
                    .accessibilityHidden(true)
                Text("Open Bearings on your iPhone")
                    .font(WatchTheme.font(.headline, .bold))
                    .foregroundStyle(WatchTheme.text)
                    .multilineTextAlignment(.center)
                Text("Your network appears here once the iPhone app has opened. Who’s waiting on you, follow-ups and more.")
                    .font(WatchTheme.font(.footnote))
                    .foregroundStyle(WatchTheme.text2)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 8)
        }
    }
}

enum WatchSection: String, Hashable, CaseIterable {
    case waiting, due, upcoming, cooling, moved, fresh, anniversaries, starred, closest

    var title: String {
        switch self {
        case .waiting: return "Waiting on you"
        case .due: return "Follow up now"
        case .upcoming: return "Coming up"
        case .cooling: return "Going cold"
        case .moved: return "Changed jobs"
        case .fresh: return "New connections"
        case .anniversaries: return "Anniversaries"
        case .starred: return "Starred"
        case .closest: return "Closest"
        }
    }
    var icon: String {
        switch self {
        case .waiting: return "arrowshape.turn.up.left.fill"
        case .due: return "bell.fill"
        case .upcoming: return "calendar"
        case .cooling: return "snowflake"
        case .moved: return "briefcase.fill"
        case .fresh: return "person.badge.plus"
        case .anniversaries: return "gift.fill"
        case .starred: return "star.fill"
        case .closest: return "heart.fill"
        }
    }
    /// Amber is kept for "waiting on you" (and the star glyph, as on the phone).
    var tint: Color {
        switch self {
        case .waiting: return WatchTheme.amber
        case .due: return WatchTheme.violet
        case .upcoming: return WatchTheme.violet
        case .cooling: return WatchTheme.info
        case .moved: return WatchTheme.info
        case .fresh: return WatchTheme.good
        case .anniversaries: return WatchTheme.good
        case .starred: return WatchTheme.amber
        case .closest: return WatchTheme.good
        }
    }
    var empty: String {
        switch self {
        case .waiting: return "Nobody is waiting on a reply."
        case .due: return "No follow-ups due."
        case .upcoming: return "No follow-ups planned. Set one from a person."
        case .cooling: return "No good relationships going cold."
        case .moved: return "No job changes since your last refresh."
        case .fresh: return "No new connections since your last refresh."
        case .anniversaries: return "No anniversaries this week."
        case .starred: return "Star people on your iPhone or here."
        case .closest: return "Import your LinkedIn messages on iPhone to see who you’re closest to."
        }
    }
}

extension WatchStore {
    func list(_ s: WatchSection) -> [WatchPerson] {
        switch s {
        case .waiting: return waiting
        case .due: return dueNow
        case .upcoming: return upcoming
        case .cooling: return cooling
        case .moved: return moved
        case .fresh: return fresh
        case .anniversaries: return anniversaries
        case .starred: return starred
        case .closest: return closest
        }
    }
}

/// The watch's Today: the same headline as the phone, the counts that matter, then every list.
struct TodayList: View {
    @EnvironmentObject var store: WatchStore

    var body: some View {
        List {
            SummaryHeader()
                .listRowBackground(Color.clear)
            SummaryCard()
                .listRowBackground(WatchTheme.rowCard)
            let primary: [WatchSection] = [.waiting, .due]
            let rest: [WatchSection] = [.upcoming, .cooling, .moved, .fresh, .anniversaries, .starred, .closest]
            ForEach(primary, id: \.self) { s in
                SectionRow(section: s, count: store.list(s).count, prominent: true)
                    .listRowBackground(WatchTheme.rowCard)
            }
            ForEach(rest, id: \.self) { s in
                let n = store.list(s).count
                if n > 0 {
                    SectionRow(section: s, count: n, prominent: false)
                        .listRowBackground(WatchTheme.rowCard)
                }
            }
            if let s = store.snap {
                Text(s.sample ? "Sample network. Import yours on iPhone." : "\(s.total.formatted()) people. Updated \(updated(s.gen)).")
                    .font(WatchTheme.font(.footnote))
                    .foregroundStyle(WatchTheme.text2)
                    .listRowBackground(Color.clear)
            }
        }
    }

    private func updated(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = f.date(from: iso) else { return "recently" }
        return d.formatted(.relative(presentation: .named))
    }
}

struct SummaryHeader: View {
    @EnvironmentObject var store: WatchStore

    var body: some View {
        let need = store.waiting.count + store.dueNow.count
        VStack(alignment: .leading, spacing: 2) {
            Text(greeting)
                .font(WatchTheme.font(.footnote))
                .foregroundStyle(WatchTheme.text2)
            Text(headline(need))
                .font(WatchTheme.font(.headline, .bold))
                .foregroundStyle(WatchTheme.text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let base = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
        if let n = store.snap?.name, !n.isEmpty { return "\(base), \(n)" }
        return base
    }

    /// "Five people need you", spelled out up to ten like the phone's Today.
    private func headline(_ n: Int) -> String {
        if n <= 0 { return "You’re all caught up." }
        if n == 1 { return "One person needs you." }
        let words = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"]
        return "\(n < words.count ? words[n] : n.formatted()) people need you."
    }
}

/// Waiting on you (big, amber) with follow-ups and job changes beside it. Opens the waiting list.
struct SummaryCard: View {
    @EnvironmentObject var store: WatchStore

    var body: some View {
        let w = store.waiting.count, d = store.dueNow.count, j = store.moved.count
        NavigationLink(value: WatchRoute.section(.waiting)) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(w.formatted())
                        .font(WatchTheme.font(.title2, .bold))
                        .foregroundStyle(w > 0 ? WatchTheme.amber : WatchTheme.text)
                    Text("waiting on you")
                        .font(WatchTheme.font(.footnote))
                        .foregroundStyle(WatchTheme.text2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                Text(secondary(d, j))
                    .font(WatchTheme.font(.footnote))
                    .foregroundStyle(WatchTheme.text2)
                    .lineLimit(2)
            }
            .padding(.vertical, 4)
        }
        .accessibilityElement(children: .combine)
    }

    private func secondary(_ d: Int, _ j: Int) -> String {
        var parts = ["\(d) to follow up"]
        if j > 0 { parts.append("\(j) new job\(j == 1 ? "" : "s")") }
        return parts.joined(separator: " · ")
    }
}

struct SectionRow: View {
    let section: WatchSection
    let count: Int
    let prominent: Bool

    var body: some View {
        NavigationLink(value: WatchRoute.section(section)) {
            HStack(spacing: 10) {
                Image(systemName: section.icon)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(section.tint)
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(WatchTheme.soft))
                    .accessibilityHidden(true)
                Text(section.title)
                    .font(WatchTheme.font(.body, .medium))
                    .foregroundStyle(WatchTheme.text)
                    .lineLimit(2)
                Spacer(minLength: 4)
                Text("\(count)")
                    .font(WatchTheme.font(.body, .semibold))
                    .foregroundStyle(count > 0 && prominent ? section.tint : WatchTheme.text2)
            }
        }
    }
}

// MARK: lists

struct PeopleList: View {
    @EnvironmentObject var store: WatchStore
    let section: WatchSection

    var body: some View {
        let people = store.list(section)
        List {
            if people.isEmpty {
                Text(section.empty)
                    .font(WatchTheme.font(.footnote))
                    .foregroundStyle(WatchTheme.text2)
                    .listRowBackground(Color.clear)
            }
            ForEach(people) { p in
                NavigationLink(value: WatchRoute.person(p.k)) {
                    PersonRow(p: p, section: section)
                }
                .listRowBackground(WatchTheme.rowCard)
            }
        }
        .navigationTitle(section.title)
        .containerBackground(WatchTheme.bg, for: .navigation)
    }
}

struct PersonRow: View {
    let p: WatchPerson
    let section: WatchSection

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                if p.starred {
                    Image(systemName: "star.fill").font(.system(size: 10)).foregroundStyle(WatchTheme.amber)
                        .accessibilityLabel("Starred")
                }
                Text(p.n).font(WatchTheme.font(.headline, .semibold)).foregroundStyle(WatchTheme.text).lineLimit(1)
            }
            Text(detail)
                .font(WatchTheme.font(.footnote))
                .foregroundStyle(section == .waiting ? WatchTheme.amber : WatchTheme.text2)
                .lineLimit(2)
        }
        .padding(.vertical, 2)
    }

    private var detail: String {
        switch section {
        case .waiting: return "Wrote \(Day.ago(p.lt))"
        case .due, .upcoming: return "Follow up \(Day.nice(p.due))"
        case .cooling: return "Last talked \(Day.ago(p.lt))"
        case .anniversaries:
            if let y = p.yr { return "\(y) \(y == 1 ? "year" : "years") connected" }
            return p.subtitle
        default: return p.subtitle
        }
    }
}

// MARK: person

struct PersonView: View {
    @EnvironmentObject var store: WatchStore
    let k: String
    @State private var draft = ""
    @State private var noteSent = false

    var body: some View {
        if let p = store.person(k) {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    header(p)
                    if p.has("w") {
                        Button {
                            store.markReplied(p)
                        } label: {
                            Label("I replied", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(WatchTheme.onAmber)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(WatchTheme.amber)
                    }
                    message(p)
                    followUp(p)
                    Button {
                        store.setStar(p, !p.starred)
                    } label: {
                        Label(p.starred ? "Starred" : "Star", systemImage: p.starred ? "star.fill" : "star")
                    }
                    .tint(WatchTheme.amber)
                    notes(p)
                    if let cd = p.cd {
                        Text("Connected \(Day.nice(cd))")
                            .font(WatchTheme.font(.footnote))
                            .foregroundStyle(WatchTheme.text3)
                    }
                }
            }
            .navigationTitle(p.n.components(separatedBy: " ").first ?? p.n)
            .containerBackground(WatchTheme.bg, for: .navigation)
        } else {
            Text("This person is no longer on your watch.")
                .font(WatchTheme.font(.footnote))
                .foregroundStyle(WatchTheme.text2)
        }
    }

    @ViewBuilder private func header(_ p: WatchPerson) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(p.n).font(WatchTheme.font(.title3, .bold)).foregroundStyle(WatchTheme.text)
            if !p.ti.isEmpty { Text(p.ti).font(WatchTheme.font(.footnote)).foregroundStyle(WatchTheme.text2) }
            if !p.co.isEmpty { Text(p.co).font(WatchTheme.font(.footnote, .semibold)).foregroundStyle(WatchTheme.text) }
            if p.b != nil {
                HStack(spacing: 5) {
                    Circle().fill(Palette.band(p.b)).frame(width: 7, height: 7)
                        .accessibilityHidden(true)
                    Text(Palette.bandLabel(p.b)).font(WatchTheme.font(.caption2, .semibold)).foregroundStyle(WatchTheme.text)
                    if let m = p.m { Text("· \(m) messages").font(WatchTheme.font(.caption2)).foregroundStyle(WatchTheme.text2) }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Capsule().fill(WatchTheme.soft))
                .padding(.top, 3)
            }
        }
        .watchCard()
    }

    @ViewBuilder private func message(_ p: WatchPerson) -> some View {
        if let lt = p.lt {
            VStack(alignment: .leading, spacing: 3) {
                Text(p.dir == "i" ? "They wrote \(Day.ago(lt))" : "You wrote \(Day.ago(lt))")
                    .font(WatchTheme.font(.caption2, .semibold))
                    .foregroundStyle(WatchTheme.text2)
                if let sn = p.sn, !sn.isEmpty {
                    Text("“\(sn)”").font(WatchTheme.font(.footnote)).foregroundStyle(WatchTheme.text).lineLimit(5)
                }
            }
            .watchCard()
        }
    }

    @ViewBuilder private func followUp(_ p: WatchPerson) -> some View {
        if let due = p.due {
            VStack(alignment: .leading, spacing: 6) {
                Text(due <= Day.today ? "Follow up now" : "Follow up \(Day.nice(due))")
                    .font(WatchTheme.font(.footnote, .semibold))
                    .foregroundStyle(due <= Day.today ? WatchTheme.amber : WatchTheme.violet)
                HStack {
                    Button("Done") { store.followUp(p, days: 0) }
                    Button("+1 week") { store.followUp(p, days: 7) }
                }
                .font(WatchTheme.font(.footnote, .medium))
            }
            .watchCard()
        } else {
            NavigationLink {
                FollowUpPicker(p: p)
            } label: {
                Label("Follow up", systemImage: "bell")
            }
        }
    }

    @ViewBuilder private func notes(_ p: WatchPerson) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let no = p.no, !no.isEmpty {
                Text("Notes").font(WatchTheme.font(.caption2, .semibold)).foregroundStyle(WatchTheme.text2)
                Text(no).font(WatchTheme.font(.footnote)).foregroundStyle(WatchTheme.text).lineLimit(8)
            }
            TextField(noteSent ? "Note saved. Add another" : "Add a note", text: $draft)
                .onSubmit {
                    store.addNote(p, draft)
                    draft = ""
                    noteSent = true
                }
        }
    }
}

struct FollowUpPicker: View {
    @EnvironmentObject var store: WatchStore
    @Environment(\.dismiss) private var dismiss
    let p: WatchPerson

    var body: some View {
        List {
            ForEach([(1, "Tomorrow"), (7, "In a week"), (14, "In 2 weeks"), (30, "In a month"), (90, "In 3 months")], id: \.0) { days, label in
                Button {
                    store.followUp(p, days: days)
                    dismiss()
                } label: {
                    HStack {
                        Text(label).font(WatchTheme.font(.body, .medium)).foregroundStyle(WatchTheme.text)
                        Spacer()
                        Text(Day.nice(Day.plus(days))).font(WatchTheme.font(.footnote)).foregroundStyle(WatchTheme.text2)
                    }
                }
                .listRowBackground(WatchTheme.rowCard)
            }
        }
        .navigationTitle("Follow up")
        .containerBackground(WatchTheme.bg, for: .navigation)
    }
}
