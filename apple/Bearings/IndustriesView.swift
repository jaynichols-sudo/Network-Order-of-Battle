import SwiftUI

struct IndustriesList: View {
    @Environment(AppModel.self) private var model
    @State private var data: IndustriesData?
    @State private var gov = false
    @State private var shownUnc = 25

    var body: some View {
        List {
            CompaniesModePicker()
            if let d = data {
                Section {
                    HStack {
                        stat(d.summary.industries.formatted(), "industries")
                        Divider()
                        stat(d.summary.outside.formatted(), "outside government")
                        Divider()
                        stat("\(d.summary.classifiedPct)%", "sorted")
                    }
                    .padding(.vertical, 4)
                }
                Section {
                    Treemap(tiles: d.tiles) { id in model.open(.industry(id)) }
                        .frame(height: 240)
                        .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                } header: {
                    HStack {
                        Text(gov ? "Whole network by industry" : "Private sector by industry")
                        Spacer()
                        if d.govCount > 0 {
                            Button(gov ? "Hide government" : "Show government (\(d.govCount.formatted()))") { gov.toggle() }
                                .font(.caption.weight(.semibold))
                                .textCase(nil)
                        }
                    }
                }
                Section("Every industry") {
                    ForEach(d.list) { row in
                        NavigationLink(value: Route.industry(row.id)) {
                            VStack(alignment: .leading, spacing: 5) {
                                HStack {
                                    Circle().fill(Color(hex: row.color)).frame(width: 9, height: 9)
                                    Text(row.id).font(Theme.geist(.body, .medium)).lineLimit(1)
                                    Spacer()
                                    Text(row.count.formatted()).monospacedDigit()
                                    Text("\(row.pct)%").font(.caption).foregroundStyle(.secondary).monospacedDigit().frame(minWidth: 30, alignment: .trailing)
                                }
                                Text("\(row.companies.formatted()) \(row.companies == 1 ? "company" : "companies")\(row.top.isEmpty ? "" : ": " + row.top.joined(separator: ", "))")
                                    .font(Theme.geist(.footnote)).foregroundStyle(.secondary).lineLimit(1)
                                MixBar(mix: row.mix)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
                if !d.unclassified.isEmpty || !d.guesses.isEmpty {
                    Section {
                        ForEach(d.unclassified.prefix(shownUnc)) { c in
                            IndustryPickerRow(company: c.name, count: c.count, current: "")
                        }
                        if d.unclassified.count > shownUnc {
                            Button("Show \(min(25, d.unclassified.count - shownUnc)) more") { shownUnc += 25 }
                        }
                    } header: {
                        Text("Needs an industry")
                    } footer: {
                        Text("\(d.unclassifiedTotal.formatted()) companies. Tag a company once and everyone there, now and in future imports, follows.\(d.tagged > 0 ? " \(d.tagged.formatted()) tagged by you so far." : "")")
                    }
                    if !d.guesses.isEmpty {
                        Section {
                            ForEach(d.guesses.prefix(20)) { g in
                                IndustryPickerRow(company: g.name, count: g.count, current: g.ind)
                            }
                        } header: {
                            Text("Best guesses to check")
                        } footer: {
                            Text("We guessed these from the company name. Fix any that are wrong.")
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .task(id: "\(gov)-\(model.info.count)-\(model.info.edits)-\(model.people.count)") { data = await model.industries(gov: gov) }
        .overlay { if data == nil { ProgressView() } }
    }

    private func stat(_ v: String, _ l: String) -> some View {
        VStack(spacing: 2) {
            Text(v).font(Theme.geist(.title3, .bold)).monospacedDigit()
            Text(l).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }
}

struct IndustryPickerRow: View {
    @Environment(AppModel.self) private var model
    let company: String
    let count: Int
    let current: String

    var body: some View {
        Menu {
            ForEach(model.constants.industries.filter { $0.id != model.constants.unclassified }) { i in
                Button {
                    Task {
                        await model.setCompanyIndustry(company, i.id)
                        model.show("\(company): \(i.id)")
                    }
                } label: {
                    if i.id == current { Label(i.id, systemImage: "checkmark") } else { Text(i.id) }
                }
            }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(company).foregroundStyle(.primary).lineLimit(1)
                    Text(current.isEmpty ? "\(count.formatted()) \(count == 1 ? "person" : "people")" : "\(current), \(count.formatted()) \(count == 1 ? "person" : "people")")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text(current.isEmpty ? "Pick" : "Change").font(Theme.geist(.subheadline, .semibold)).foregroundStyle(Theme.accent)
            }
        }
    }
}

struct Treemap: View {
    let tiles: [IndustriesData.Tile]
    let onTap: (String) -> Void

    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .topLeading) {
                ForEach(tiles) { t in
                    let w = g.size.width * t.w / 100, h = g.size.height * t.h / 100
                    Button { onTap(t.id) } label: {
                        ZStack(alignment: .topLeading) {
                            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Color(hex: t.color).gradient)
                            if w > 46 && h > 30 {
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(w > 120 && h > 50 ? t.id : t.short).font(.caption.weight(.semibold)).lineLimit(2)
                                    Text(t.n.formatted()).font(.caption2.monospacedDigit()).opacity(0.85)
                                }
                                .foregroundStyle(.white)
                                .padding(5)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .frame(width: max(0, w - 2), height: max(0, h - 2))
                    .offset(x: g.size.width * t.x / 100, y: g.size.height * t.y / 100)
                    .accessibilityLabel("\(t.id), \(t.n)")
                }
            }
        }
    }
}

struct IndustryView: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var d: IndustryDetail?

    var body: some View {
        List {
            if let d {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(d.id).geist(.title2, .bold)
                        Text(summary(d)).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                    }
                    .listRowBackground(Color.clear)
                    Button {
                        var f = Filters(); f.ind = [d.id]
                        model.searchText = ""; model.filters = f; model.paths[.people] = []; model.tab = .people
                    } label: { Label("Show in People", systemImage: "person.2") }
                }
                Section("Seniority") {
                    HStack {
                        ForEach(Array(zip([1, 2, 3, 4], ["Exec", "Director", "Manager", "Staff"])), id: \.0) { i, l in
                            VStack(spacing: 2) {
                                Text((d.mix.count > i ? d.mix[i] : 0).formatted()).font(Theme.geist(.title3, .bold)).monospacedDigit()
                                Text(l).font(.caption).foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                }
                let senior = model.persons(d.senior)
                if !senior.isEmpty {
                    Section("Most senior") {
                        ForEach(senior) { p in NavigationLink(value: Route.person(p.k)) { PersonRow(person: p, lens: model.info.lens) } }
                    }
                }
                if !d.top.isEmpty {
                    Section("Top companies") {
                        ForEach(d.top) { c in
                            NavigationLink(value: Route.unit(c.name)) {
                                HStack { Text(c.name); Spacer(); Text(c.count.formatted()).foregroundStyle(.secondary).monospacedDigit() }
                            }
                        }
                    }
                }
                if !d.funcs.isEmpty {
                    Section("What they do") {
                        ForEach(d.funcs) { f in
                            HStack { Text(f.name); Spacer(); Text(f.count.formatted()).foregroundStyle(.secondary).monospacedDigit() }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(d?.short ?? "Industry")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: id) { d = await model.industry(id) }
        .overlay { if d == nil { ProgressView() } }
    }

    private func summary(_ d: IndustryDetail) -> String {
        var s = "\(d.count.formatted()) \(d.count == 1 ? "person" : "people") at \(d.companies.formatted()) companies"
        if d.vets > 0 { s += ", \(d.vets.formatted()) veterans" }
        if d.stars > 0 { s += ", \(d.stars.formatted()) starred" }
        return s
    }
}
