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
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { model.introQuery = "" } label: { Text("Ways in").font(Theme.geist(.subheadline, .semibold)) }
                    .accessibilityLabel("Find a way into a company")
            }
        }
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
                            CoverageRing(score: t.score, size: 50).zoomSource(unit: t.name)
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
    @State private var editingPlace = false
    @State private var placeText = ""
    @State private var enrichAsking = false
    @State private var startingPursuit = false
    /// Everyone at this company or unit, capped so one tap can't burn a whole credit balance.
    private var unitKeys: [String] { Array((u?.rungs.flatMap(\.keys) ?? []).prefix(100)) }

    var body: some View {
        List {
            if let u {
                headerSection(u)
                actionSection(u)
                linkSection(u)
                locationSection(u)
                gapSection(u)
                TrendSection(name: name)
                ForEach(u.rungs) { r in rungSection(r) }
                alumniSection(u)
                if u.isTarget { noteSection }
            }
        }
        .listStyle(.insetGrouped)
        .sheet(isPresented: $startingPursuit) { NewPursuitSheet(agency: name).environment(AppModel.shared) }
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { model.introQuery = name } label: { Label("Find a way in", systemImage: "point.3.connected.trianglepath.dotted") }
                    Button { startingPursuit = true } label: { Label("Start a pursuit here", systemImage: "scope") }
                    NavigationLink(value: Route.org(name)) { Label("Org chart", systemImage: "rectangle.3.group") }
                    if let u {
                        Button {
                            if let url = AccountMapDocument.pdf(u, model: model) { model.shareFile = ShareFile(url: url) }
                        } label: { Label("Share account map (PDF)", systemImage: "doc.richtext") }
                        if EnrichProvider.current != .off {
                            Button { enrichAsking = true } label: {
                                Label("Look up everyone here with \(EnrichProvider.current.title)", systemImage: "sparkle.magnifyingglass")
                            }
                        }
                    }
                } label: { Label("More", systemImage: "ellipsis.circle") }
            }
        }
        .confirmationDialog("Look up \(unitKeys.count) people with \(EnrichProvider.current.title)?", isPresented: $enrichAsking, titleVisibility: .visible) {
            Button("Look up \(unitKeys.count)") { Task { _ = await model.enrich(unitKeys) } }
        } message: {
            Text(EnrichProvider.current == .seamless ? "This uses up to \(unitKeys.count) Seamless.AI research credits. Their names and companies are sent to Seamless.AI." : "Their names and companies are sent to ZoomInfo, using your account.")
        }
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

    private func locationSection(_ u: UnitDetail) -> some View {
        Section {
            if editingPlace {
                TextField("City, like Jacksonville, FL or Stuttgart", text: $placeText)
                    .submitLabel(.done)
                    .onSubmit { savePlace() }
                HStack {
                    Button("Save") { savePlace() }.buttonStyle(.borderedProminent)
                    Button("Cancel") { editingPlace = false }.buttonStyle(.bordered)
                }
            } else if let l = u.location {
                LabeledContent("Everyone here", value: l.name)
                Button("Change location") { placeText = l.name; editingPlace = true }
                Button("Clear location", role: .destructive) {
                    Task {
                        _ = await model.setCompanyLocation(name, query: "")
                        await load()
                    }
                }
            } else {
                Button {
                    placeText = ""
                    editingPlace = true
                } label: {
                    Label("Set a location for everyone here", systemImage: "mappin.and.ellipse")
                }
            }
        } header: {
            Text("Location")
        } footer: {
            Text("Handy for a command, base or office where everyone works in one place. It shows them on the Map. A location you set on a person still wins.")
        }
    }

    private func savePlace() {
        Task {
            if await model.setCompanyLocation(name, query: placeText) {
                editingPlace = false
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

    @ViewBuilder private func alumniSection(_ u: UnitDetail) -> some View {
        let list = u.alumni ?? []
        if !list.isEmpty {
            Section {
                ForEach(list.prefix(25)) { a in
                    if let p = model.person(a.k) {
                        NavigationLink(value: Route.person(p.k)) {
                            VStack(alignment: .leading, spacing: 4) {
                                PersonRow(person: p, lens: model.info.lens)
                                Text("Was \(a.was.isEmpty ? "here" : a.was), until \(Day.nice(a.until))")
                                    .font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                                    .padding(.leading, 54)
                            }
                        }
                    }
                }
            } header: {
                Text("Used to work here")
            } footer: {
                Text("People who were here at an earlier refresh and have since moved on. Often the best way in.")
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
