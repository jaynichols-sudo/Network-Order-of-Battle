import SwiftUI

struct PeopleView: View {
    @Environment(AppModel.self) private var model
    var zoom: Namespace.ID?
    @State private var showFilters = false

    var body: some View {
        @Bindable var model = model
        List {
            if !model.chips.isEmpty || !model.filters.isEmpty {
                ActiveFilters()
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    .listRowBackground(Color.clear)
            }
            Section {
                if model.results.isEmpty {
                    ContentUnavailableView("No one matches", systemImage: "person.crop.circle.badge.questionmark", description: Text("Remove a filter or clear the search."))
                        .listRowBackground(Color.clear)
                }
                ForEach(model.results) { p in
                    NavigationLink(value: Route.person(p.k)) {
                        PersonRow(person: p, lens: model.info.lens, zoom: zoom)
                    }
                    .swipeActions(edge: .leading) {
                        Button {
                            Task { await model.toggleStar(p.k) }
                        } label: {
                            Label(p.starred ? "Unstar" : "Star", systemImage: p.starred ? "star.slash" : "star.fill")
                        }
                        .tint(Theme.amber)
                    }
                    .swipeActions(edge: .trailing) {
                        Button {
                            Task { await model.followUp(p.k, days: 7) }
                        } label: {
                            Label("In a week", systemImage: "bell")
                        }
                        .tint(Theme.violet)
                    }
                    .contextMenu { PersonMenu(person: p) }
                }
            } header: {
                Text("\(model.results.count.formatted()) \(model.results.count == 1 ? "person" : "people")")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("People")
        .searchable(text: $model.searchText, placement: .navigationBarDrawer(displayMode: .always), prompt: "Names, companies, or “navy o-5 and up”")
        .autocorrectionDisabled()
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort", selection: $model.sort) {
                        ForEach(SortOrder.allCases.filter { s in
                            (s != .rank || model.info.lens) && (s != .warm || model.info.hasRel)
                        }) { s in
                            Text(s.label).tag(s)
                        }
                    }
                    Divider()
                    Button {
                        Task { await model.exportCSV(keys: model.results.map(\.k)) }
                    } label: {
                        Label("Export this list", systemImage: "square.and.arrow.up")
                    }
                } label: {
                    Label("Sort", systemImage: "arrow.up.arrow.down")
                }
                Button {
                    showFilters = true
                } label: {
                    Label("Filters", systemImage: model.filters.isEmpty ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                }
                .badge(model.filters.activeCount)
            }
        }
        .sheet(isPresented: $showFilters) { FilterSheet() }
        .onAppear { if model.showFiltersOnLaunch { model.showFiltersOnLaunch = false; showFilters = true } }
    }
}

struct PersonRow: View {
    let person: Person
    var lens = false
    var zoom: Namespace.ID?

    var body: some View {
        HStack(spacing: 12) {
            avatar
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(person.fullName)
                        .font(Theme.geist(.body, .semibold))
                        .lineLimit(1)
                    flags
                }
                if !person.p.isEmpty {
                    Text(person.p).font(Theme.geist(.subheadline)).foregroundStyle(.secondary).lineLimit(1)
                }
                if !person.c.isEmpty {
                    Text(person.c).font(Theme.geist(.subheadline, .medium)).foregroundStyle(.primary.opacity(0.75)).lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 4) {
                if let t = person.rx?.t, !t.isEmpty {
                    HStack(spacing: 4) {
                        Circle().fill(Band.color(person.band)).frame(width: 7, height: 7)
                        Text(Day.short(t)).font(Theme.mono(.caption)).foregroundStyle(.secondary)
                    }
                    .accessibilityLabel("\(Band.label(person.band)), last message \(Day.ago(t))")
                }
                if lens && !person.cl.grade.isEmpty {
                    Text(person.cl.grade)
                        .font(Theme.mono(.caption, .semibold))
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color(.tertiarySystemFill), in: Capsule())
                } else if !person.indShort.isEmpty && person.cl.ind != "Unclassified" {
                    Text(person.indShort)
                        .font(Theme.geist(.caption, .medium))
                        .foregroundStyle(Color(hex: person.indColor))
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Color(hex: person.indColor).opacity(0.12), in: Capsule())
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var avatar: some View {
        if let zoom {
            Avatar(person: person, size: 46).matchedTransitionSource(id: person.k, in: zoom)
        } else {
            Avatar(person: person, size: 46)
        }
    }

    @ViewBuilder private var flags: some View {
        if person.waiting { Flag(text: "Reply", color: Theme.bad) }
        else if person.due { Flag(text: "Follow up", color: Theme.violet) }
        else if person.moved { Flag(text: "New job", color: Theme.info) }
        else if person.isNew { Flag(text: "New", color: Theme.accent) }
        else if person.x != nil { Flag(text: "Removed", color: .secondary) }
    }
}

struct Flag: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text)
            .font(Theme.geist(.caption, .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.13), in: Capsule())
            .fixedSize()
    }
}

struct PersonMenu: View {
    @Environment(AppModel.self) private var model
    let person: Person
    var body: some View {
        Button {
            Task { await model.toggleStar(person.k) }
        } label: {
            Label(person.starred ? "Remove star" : "Star", systemImage: person.starred ? "star.slash" : "star")
        }
        Menu {
            ForEach([(7, "In a week"), (14, "In 2 weeks"), (30, "In a month"), (90, "In 3 months")], id: \.0) { d, l in
                Button(l) { Task { await model.followUp(person.k, days: d) } }
            }
        } label: {
            Label("Follow up", systemImage: "bell")
        }
        if !person.c.isEmpty {
            Button {
                model.open(.unit(person.c))
            } label: {
                Label("More at \(person.c)", systemImage: "building.2")
            }
        }
        if !person.e.isEmpty {
            Button {
                UIPasteboard.general.string = person.e
                model.show("Email copied")
            } label: {
                Label("Copy email", systemImage: "doc.on.doc")
            }
        }
    }
}

struct ActiveFilters: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(model.chips, id: \.self) { c in
                    Chip(text: c, icon: "sparkles", on: true) {}
                }
                ForEach(tokens, id: \.id) { t in
                    Chip(text: t.label, icon: "xmark", on: true) { remove(t) }
                }
                if model.filters.activeCount + (model.chips.isEmpty ? 0 : 1) > 1 {
                    Button("Clear all") { model.clearFilters() }
                        .font(Theme.geist(.subheadline, .semibold))
                }
            }
        }
    }

    struct Token { let group: String; let value: String; let label: String; var id: String { group + "|" + value } }

    private var tokens: [Token] {
        let f = model.filters
        var out: [Token] = []
        let sigLabels = ["new": "New since last refresh", "jc": "Job change", "star": "Starred", "notes": "Has notes", "email": "Has email", "gov": ".gov / .mil email",
                         "clr": "Clearance", "jcw": "Changed jobs this refresh", "anniv": "Anniversary this week", "due": "Follow-up due",
                         "waiting": "Waiting on your reply", "cold": "Going cold", "never": "Never messaged"]
        for v in f.sig.sorted() { out.append(Token(group: "sig", value: v, label: sigLabels[v] ?? v)) }
        for (g, set) in [("rel", f.rel), ("ind", f.ind), ("sen", f.sen), ("func", f.fn), ("seg", f.seg), ("branch", f.branch), ("status", f.status), ("tier", f.tier), ("cert", f.cert)] {
            for v in set.sorted() { out.append(Token(group: g, value: v, label: v)) }
        }
        if !f.company.isEmpty { out.append(Token(group: "company", value: f.company, label: f.company)) }
        if !f.agency.isEmpty { out.append(Token(group: "agency", value: f.agency, label: f.agency)) }
        if !f.since.isEmpty { out.append(Token(group: "since", value: f.since, label: model.constants.since.first(where: { $0.first == f.since })?.last ?? "Connected")) }
        if f.removed { out.append(Token(group: "removed", value: "", label: "Including removed")) }
        return out
    }

    private func remove(_ t: Token) {
        var f = model.filters
        switch t.group {
        case "sig": f.sig.remove(t.value)
        case "rel": f.rel.remove(t.value)
        case "ind": f.ind.remove(t.value)
        case "sen": f.sen.remove(t.value)
        case "func": f.fn.remove(t.value)
        case "seg": f.seg.remove(t.value)
        case "branch": f.branch.remove(t.value)
        case "status": f.status.remove(t.value)
        case "tier": f.tier.remove(t.value)
        case "cert": f.cert.remove(t.value)
        case "company": f.company = ""
        case "agency": f.agency = ""
        case "since": f.since = ""
        case "removed": f.removed = false
        default: break
        }
        model.filters = f
    }
}

struct Chip: View {
    let text: String
    var icon: String?
    var count: Int?
    var color: Color?
    var on = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let color { Circle().fill(color).frame(width: 8, height: 8) }
                Text(text).lineLimit(1)
                if let count { Text(count.formatted()).foregroundStyle(on ? AnyShapeStyle(.primary.opacity(0.7)) : AnyShapeStyle(.tertiary)).monospacedDigit() }
                if let icon, on { Image(systemName: icon).font(.caption2.weight(.bold)) }
            }
            .font(Theme.geist(.subheadline, .medium))
            .padding(.horizontal, 11)
            .padding(.vertical, 7)
            .background(on ? AnyShapeStyle(Theme.accent.opacity(0.18)) : AnyShapeStyle(Color(.tertiarySystemFill)), in: Capsule())
            .overlay(Capsule().strokeBorder(on ? Theme.accent.opacity(0.6) : .clear, lineWidth: 1))
            .foregroundStyle(.primary)
        }
        .buttonStyle(.plain)
    }
}
