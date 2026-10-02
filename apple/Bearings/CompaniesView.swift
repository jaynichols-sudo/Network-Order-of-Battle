import SwiftUI

struct CompaniesView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Group {
            switch model.companiesMode {
            case .watchlist: WatchlistList()
            case .industries: IndustriesList()
            case .all: AllCompaniesList()
            }
        }
        .navigationTitle("Companies")
        .toolbar { MainToolbar() }
    }
}

/// The Watchlist / Industries / All switch, shown at the top of each list.
struct CompaniesModePicker: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        @Bindable var model = model
        Section {
            Picker("View", selection: $model.companiesMode) {
                ForEach(CompaniesMode.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        }
    }
}

struct WatchlistList: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            CompaniesModePicker()
            Section {
                ForEach(model.targets) { t in
                    NavigationLink(value: Route.unit(t.name)) {
                        HStack(spacing: 14) {
                            CoverageRing(score: t.score, size: 50)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(t.name).font(Theme.geist(.body, .semibold))
                                Text(knowLine(t)).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                                Text(t.gap).font(Theme.geist(.footnote, .medium)).foregroundStyle(t.gaps.isEmpty ? Theme.good : Theme.bad)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .swipeActions {
                        Button(role: .destructive) {
                            Task { await model.toggleTarget(t.name) }
                        } label: { Label("Remove", systemImage: "minus.circle") }
                    }
                }
                Button {
                    model.showAddTarget = true
                } label: {
                    Label(model.info.lens ? "Add a company, agency or command" : "Add a company", systemImage: "plus.circle.fill")
                }
            } footer: {
                Text("Coverage shows whether you know someone at each level: executive, director, manager and staff.")
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if model.targets.isEmpty {
                ContentUnavailableView {
                    Label("No watchlist yet", systemImage: "scope")
                } description: {
                    Text("Pick the companies you’re working. Bearings shows where you don’t know anyone senior yet.")
                } actions: {
                    Button("Add a company") { model.showAddTarget = true }.buttonStyle(.borderedProminent)
                }
            }
        }
    }

    private func knowLine(_ t: TargetSummary) -> String {
        var s = "You know \(t.count.formatted())"
        if t.stars > 0 { s += ", \(t.stars) starred" }
        if t.news > 0 { s += ", \(t.news) new or moved" }
        return s
    }
}

struct AddTargetView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var q = ""
    @State private var items: [NameCount] = []

    var body: some View {
        NavigationStack {
            List {
                let trimmed = q.trimmingCharacters(in: .whitespaces)
                if !trimmed.isEmpty && !items.contains(where: { $0.name.caseInsensitiveCompare(trimmed) == .orderedSame }) && !model.isTarget(trimmed) {
                    Button {
                        add(trimmed)
                    } label: {
                        Label("Add “\(trimmed)”", systemImage: "plus")
                    }
                }
                Section(q.isEmpty ? "Where you know the most people" : "Matches") {
                    ForEach(items) { it in
                        Button {
                            add(it.name)
                        } label: {
                            HStack {
                                Text(it.name).foregroundStyle(.primary)
                                Spacer()
                                Text(it.count.formatted()).foregroundStyle(.secondary).monospacedDigit()
                                Image(systemName: "plus.circle").foregroundStyle(Theme.accent)
                            }
                        }
                    }
                }
            }
            .searchable(text: $q, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search, or type a new name")
            .navigationTitle("Add to your watchlist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .task(id: q) { items = await model.addCandidates(q) }
        }
    }

    private func add(_ name: String) {
        Task {
            await model.toggleTarget(name)
            items = await model.addCandidates(q)
        }
    }
}

struct AllCompaniesList: View {
    @Environment(AppModel.self) private var model
    @State private var orgs: Orgs?

    var body: some View {
        List {
            CompaniesModePicker()
            if let o = orgs {
                Section("Companies") { bars(o.companies) }
                if !o.agencies.isEmpty { Section("Agencies and commands") { bars(o.agencies) } }
            }
        }
        .listStyle(.insetGrouped)
        .task(id: model.info.count + model.info.edits) { orgs = await model.orgs() }
        .overlay { if orgs == nil { ProgressView() } }
    }

    private func bars(_ items: [NameCount]) -> some View {
        let maxN = max(1, items.first?.count ?? 1)
        return ForEach(items) { it in
            NavigationLink(value: Route.unit(it.name)) {
                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Text(it.name).lineLimit(1)
                        Spacer()
                        Text(it.count.formatted()).foregroundStyle(.secondary).monospacedDigit()
                    }
                    GeometryReader { g in
                        Capsule().fill(Color(hex: it.color ?? "#8F89A8"))
                            .frame(width: max(4, g.size.width * CGFloat(it.count) / CGFloat(maxN)))
                    }
                    .frame(height: 4)
                }
            }
        }
    }
}

struct UnitView: View {
    @Environment(AppModel.self) private var model
    let name: String
    @State private var u: UnitDetail?
    @State private var note = ""
    @State private var editingLink = false
    @State private var linkText = ""

    var body: some View {
        List {
            if let u {
                headerSection(u)
                actionSection(u)
                linkSection(u)
                gapSection(u)
                ForEach(u.rungs) { r in rungSection(r) }
                if u.isTarget { noteSection }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: name) {
            await load()
            note = u?.note ?? ""
        }
        .overlay { if u == nil { ProgressView() } }
    }

    private func load() async { u = await model.unit(name) }

    private func headerSection(_ u: UnitDetail) -> some View {
        Section {
            HStack(spacing: 16) {
                CoverageRing(score: u.score, size: 72)
                VStack(alignment: .leading, spacing: 4) {
                    Text(u.name).geist(.title2, .bold)
                    Text(summary(u)).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                }
            }
            .listRowBackground(Color.clear)
        }
    }

    private func summary(_ u: UnitDetail) -> String {
        let who = u.count == 1 ? "person" : "people"
        return "You know \(u.count.formatted()) \(who) here. Coverage \(u.score)%."
    }

    private func industryBinding(_ u: UnitDetail) -> Binding<String> {
        Binding(get: { u.industry.set }, set: { v in
            Task {
                await model.setCompanyIndustry(name, v)
                await load()
            }
        })
    }

    private func actionSection(_ u: UnitDetail) -> some View {
        Section {
            Button {
                Task {
                    await model.toggleTarget(name)
                    await load()
                }
            } label: {
                Label(u.isTarget ? "Remove from watchlist" : "Add to watchlist", systemImage: u.isTarget ? "minus.circle" : "plus.circle.fill")
            }
            Button { showInPeople(u) } label: { Label("Show in People", systemImage: "person.2") }
            if u.isCompany {
                Picker("Industry", selection: industryBinding(u)) {
                    Text("Automatic: \(u.industry.auto)").tag("")
                    ForEach(model.constants.industries.filter { $0.id != model.constants.unclassified }) { i in
                        Text(i.id).tag(i.id)
                    }
                }
            }
        }
    }

    private func showInPeople(_ u: UnitDetail) {
        var f = Filters()
        if model.info.lens && !u.isCompany { f.agency = name } else { f.company = name }
        model.searchText = ""
        model.filters = f
        model.paths[.people] = []
        model.tab = .people
    }

    private func linkSection(_ u: UnitDetail) -> some View {
        Section {
            LinkButton(title: u.links.companyExact ? "Company page" : "Find company page", url: u.links.company)
            LinkButton(title: "Your connections there", url: u.links.peopleAt)
            if model.salesNav {
                LinkButton(title: "Sales Navigator", url: u.links.salesNav, icon: "safari")
            }
            if editingLink {
                TextField("https://www.linkedin.com/company/…", text: $linkText)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                HStack {
                    Button("Save") { saveLink() }.buttonStyle(.borderedProminent)
                    Button("Cancel") { editingLink = false }.buttonStyle(.bordered)
                }
            } else {
                Button(u.links.companyExact ? "Change page link" : "Save the exact page") {
                    linkText = u.links.companyExact ? u.links.company : ""
                    editingLink = true
                }
            }
        } header: {
            Text("On LinkedIn")
        }
    }

    private func saveLink() {
        Task {
            if await model.setCompanyLink(name, linkText) {
                editingLink = false
                await load()
            }
        }
    }

    private func gapSection(_ u: UnitDetail) -> some View {
        Section {
            if u.gaps.isEmpty {
                Label("Covered at every level", systemImage: "checkmark.circle.fill").foregroundStyle(Theme.good)
            } else {
                ForEach(u.gaps, id: \.self) { g in
                    Label(g, systemImage: "exclamationmark.circle.fill").foregroundStyle(Theme.bad)
                }
            }
        }
    }

    private func rungSection(_ r: UnitDetail.Rung) -> some View {
        let ps = model.persons(r.keys)
        return Section {
            if ps.isEmpty {
                Text("Nobody yet").foregroundStyle(.secondary)
            }
            ForEach(ps.prefix(40)) { p in
                NavigationLink(value: Route.person(p.k)) { PersonRow(person: p, lens: model.info.lens) }
            }
            if ps.count > 40 {
                Text("and \(ps.count - 40) more").foregroundStyle(.secondary)
            }
        } header: {
            HStack {
                Text(r.label)
                Spacer()
                Text("\(r.keys.count)")
            }
        }
    }

    private var noteSection: some View {
        Section("Notes") {
            TextField("What you’re working on here, who to meet next", text: $note, axis: .vertical)
                .lineLimit(3...10)
                .onChange(of: note) { _, v in saveNote(v) }
        }
    }

    private func saveNote(_ v: String) {
        Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            if v == note { await model.setTargetNote(name, v) }
        }
    }
}
