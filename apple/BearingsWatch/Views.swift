import SwiftUI

// MARK: home

struct RootView: View {
    @EnvironmentObject var store: WatchStore

    var body: some View {
        NavigationStack {
            Group {
                if store.snap == nil {
                    EmptyStateView()
                } else {
                    HomeList()
                }
            }
            .navigationTitle("Bearings")
            .navigationDestination(for: WatchSection.self) { s in
                PeopleList(section: s)
            }
            .navigationDestination(for: WatchPerson.self) { p in
                PersonView(k: p.k)
            }
            .containerBackground(Palette.plum.gradient, for: .navigation)
        }
    }
}

struct EmptyStateView: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Image(systemName: "location.north.circle.fill")
                    .font(.system(size: 42))
                    .foregroundStyle(Palette.amber)
                Text("Open Bearings on your iPhone")
                    .font(.headline)
                    .multilineTextAlignment(.center)
                Text("Your network appears here once the iPhone app has opened. Who’s waiting on you, follow-ups and more.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
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
    var tint: Color {
        switch self {
        case .waiting: return Palette.coral
        case .due: return Palette.amber
        case .upcoming: return Palette.violet
        case .cooling: return Palette.sky
        case .moved: return Palette.sky
        case .fresh: return Palette.amber
        case .anniversaries: return Palette.green
        case .starred: return Palette.amber
        case .closest: return Palette.pink
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

struct HomeList: View {
    @EnvironmentObject var store: WatchStore

    var body: some View {
        List {
            SummaryHeader()
                .listRowBackground(Color.clear)
            let primary: [WatchSection] = [.waiting, .due]
            let rest: [WatchSection] = [.upcoming, .cooling, .moved, .fresh, .anniversaries, .starred, .closest]
            ForEach(primary, id: \.self) { s in SectionRow(section: s, count: store.list(s).count, prominent: true) }
            ForEach(rest, id: \.self) { s in
                let n = store.list(s).count
                if n > 0 { SectionRow(section: s, count: n, prominent: false) }
            }
            if let s = store.snap {
                Text(s.sample ? "Sample network. Import yours on iPhone." : "\(s.total.formatted()) people. Updated \(updated(s.gen)).")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
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
        let w = store.waiting.count, d = store.dueNow.count
        VStack(alignment: .leading, spacing: 2) {
            Text(greeting)
                .font(.footnote)
                .foregroundStyle(.secondary)
            if w + d == 0 {
                Text("You’re all caught up")
                    .font(.headline)
            } else {
                Text(line(w, d))
                    .font(.headline)
            }
        }
    }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let base = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
        if let n = store.snap?.name, !n.isEmpty { return "\(base), \(n)" }
        return base
    }

    private func line(_ w: Int, _ d: Int) -> String {
        var parts: [String] = []
        if w > 0 { parts.append("\(w) to reply") }
        if d > 0 { parts.append("\(d) to follow up") }
        return parts.joined(separator: ", ")
    }
}

struct SectionRow: View {
    let section: WatchSection
    let count: Int
    let prominent: Bool

    var body: some View {
        NavigationLink(value: section) {
            HStack(spacing: 10) {
                Image(systemName: section.icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(section.tint)
                    .frame(width: 22)
                Text(section.title)
                    .lineLimit(2)
                Spacer(minLength: 4)
                Text("\(count)")
                    .font(.system(.body, design: .rounded).weight(.semibold))
                    .foregroundStyle(count > 0 && prominent ? section.tint : .secondary)
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
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
            }
            ForEach(people) { p in
                NavigationLink(value: p) {
                    PersonRow(p: p, section: section)
                }
            }
        }
        .navigationTitle(section.title)
    }
}

struct PersonRow: View {
    let p: WatchPerson
    let section: WatchSection

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                if p.starred {
                    Image(systemName: "star.fill").font(.system(size: 10)).foregroundStyle(Palette.amber)
                }
                Text(p.n).font(.headline).lineLimit(1)
            }
            Text(detail)
                .font(.footnote)
                .foregroundStyle(.secondary)
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
                        }
                        .tint(Palette.coral)
                    }
                    message(p)
                    followUp(p)
                    Button {
                        store.setStar(p, !p.starred)
                    } label: {
                        Label(p.starred ? "Starred" : "Star", systemImage: p.starred ? "star.fill" : "star")
                    }
                    .tint(Palette.amber)
                    notes(p)
                    if let cd = p.cd {
                        Text("Connected \(Day.nice(cd))")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle(p.n.components(separatedBy: " ").first ?? p.n)
        } else {
            Text("This person is no longer on your watch.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private func header(_ p: WatchPerson) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(p.n).font(.title3.weight(.semibold))
            if !p.ti.isEmpty { Text(p.ti).font(.footnote).foregroundStyle(.secondary) }
            if !p.co.isEmpty { Text(p.co).font(.footnote.weight(.semibold)) }
            if p.b != nil {
                HStack(spacing: 5) {
                    Circle().fill(Palette.band(p.b)).frame(width: 7, height: 7)
                    Text(Palette.bandLabel(p.b)).font(.caption2.weight(.semibold))
                    if let m = p.m { Text("· \(m) messages").font(.caption2).foregroundStyle(.secondary) }
                }
                .padding(.top, 2)
            }
        }
    }

    @ViewBuilder private func message(_ p: WatchPerson) -> some View {
        if let lt = p.lt {
            VStack(alignment: .leading, spacing: 3) {
                Text(p.dir == "i" ? "They wrote \(Day.ago(lt))" : "You wrote \(Day.ago(lt))")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                if let sn = p.sn, !sn.isEmpty {
                    Text("“\(sn)”").font(.footnote).lineLimit(5)
                }
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        }
    }

    @ViewBuilder private func followUp(_ p: WatchPerson) -> some View {
        if let due = p.due {
            VStack(alignment: .leading, spacing: 6) {
                Text(due <= Day.today ? "Follow up now" : "Follow up \(Day.nice(due))")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.amber)
                HStack {
                    Button("Done") { store.followUp(p, days: 0) }
                    Button("+1 week") { store.followUp(p, days: 7) }
                }
                .font(.footnote)
            }
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
                Text("Notes").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                Text(no).font(.footnote).lineLimit(8)
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
                        Text(label)
                        Spacer()
                        Text(Day.nice(Day.plus(days))).font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .navigationTitle("Follow up")
    }
}
