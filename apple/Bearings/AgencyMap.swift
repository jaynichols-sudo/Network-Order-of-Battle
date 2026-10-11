import SwiftUI

// The federal map: every department, agency and major command, and where you are not
// connected yet. Gaps first, so it reads as a to-do list for the federal side.

struct AgencyMap: Decodable {
    struct Row: Decodable, Identifiable, Hashable {
        var id: String
        var dept: String
        var name: String
        var short: String
        var tags: [String]
        var known: Int
        var senior: Int
        var warm: Int
        var status: String
        var gap: String
        var best: [String]
        var watched: Bool
    }
    struct Dept: Decodable, Hashable, Identifiable { var name: String; var agencies: Int; var covered: Int; var thin: Int; var none: Int; var id: String { name } }
    struct Totals: Decodable { var agencies: Int; var covered: Int; var thin: Int; var none: Int }
    var rows: [Row]
    var depts: [Dept]
    var totals: Totals
}

extension AppModel {
    func agencyMap() async -> AgencyMap? { try? await engine.call("agencyCoverage", as: AgencyMap?.self) }
}

struct AgencyMapList: View {
    @Environment(AppModel.self) private var model
    @State private var map: AgencyMap?
    @AppStorage("agencyFilter") private var filter = "gaps"
    @AppStorage("agencyFocus") private var focus = "all"
    @State private var dept = "All departments"

    private static let focuses: [(String, String)] = [("all", "Everything"), ("energy", "Energy"), ("water", "Water"), ("defense", "Defense"),
                                                       ("cyber", "Cyber"), ("transport", "Transportation"), ("infrastructure", "Infrastructure"), ("intel", "Intelligence")]

    var body: some View {
        List {
            CompaniesModePicker()
            if let m = map {
                Section { header(m) }
                Section {
                    Picker("Show", selection: $filter) {
                        Text("Gaps").tag("gaps")
                        Text("Not connected").tag("none")
                        Text("Thin").tag("thin")
                        Text("Covered").tag("covered")
                        Text("All").tag("all")
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    HStack {
                        Menu {
                            ForEach(Self.focuses, id: \.0) { f in Button(f.1) { focus = f.0 } }
                        } label: { Label(Self.focuses.first { $0.0 == focus }?.1 ?? "Everything", systemImage: "scope").font(Theme.geist(.footnote, .semibold)) }
                        Spacer()
                        Menu {
                            Button("All departments") { dept = "All departments" }
                            ForEach(m.depts) { d in Button("\(d.name) (\(d.agencies - d.none)/\(d.agencies))") { dept = d.name } }
                        } label: { Label(dept, systemImage: "building.columns").font(Theme.geist(.footnote, .semibold)) }
                    }
                    .listRowBackground(Color.clear)
                }
                let rows = filtered(m)
                if rows.isEmpty {
                    Section { Text("Nothing here with these filters.").foregroundStyle(.secondary) }
                }
                ForEach(groups(rows), id: \.0) { g in
                    Section(g.0) {
                        ForEach(g.1) { r in row(r) }
                    }
                }
                Section {
                    Text("Bearings matches each person’s employer and title to \(m.totals.agencies) federal departments, agencies and commands. Covered means you know someone senior and someone warm there. Agencies change names: an old name still matches.")
                        .font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .task(id: "\(model.info.rev)-\(model.info.edits)-\(model.targets.count)") { map = await model.agencyMap() }
    }

    private func header(_ m: AgencyMap) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("THE FEDERAL MAP").font(Theme.eyebrow).tracking(1.1).foregroundStyle(Theme.text2)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(m.totals.agencies - m.totals.none)").font(Theme.serif(.largeTitle, .semibold))
                Text("of \(m.totals.agencies) agencies and commands where you know someone").font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
            }
            GeometryReader { g in
                let t = max(1, m.totals.agencies)
                HStack(spacing: 2) {
                    Rectangle().fill(Theme.good).frame(width: g.size.width * CGFloat(m.totals.covered) / CGFloat(t))
                    Rectangle().fill(Theme.accent).frame(width: g.size.width * CGFloat(m.totals.thin) / CGFloat(t))
                    Rectangle().fill(Theme.hairline)
                }
            }
            .frame(height: 10)
            .clipShape(Capsule())
            HStack(spacing: 14) {
                key(Theme.good, "\(m.totals.covered) covered")
                key(Theme.accent, "\(m.totals.thin) thin")
                key(Theme.text3, "\(m.totals.none) not connected")
            }
        }
        .padding(.vertical, 6)
    }

    private func key(_ c: Color, _ s: String) -> some View {
        HStack(spacing: 5) { Circle().fill(c).frame(width: 8, height: 8); Text(s).font(Theme.geist(.caption)).foregroundStyle(.secondary) }
    }

    private func filtered(_ m: AgencyMap) -> [AgencyMap.Row] {
        m.rows.filter { r in
            (focus == "all" || r.tags.contains(focus))
                && (dept == "All departments" || r.dept == dept)
                && (filter == "all" || (filter == "gaps" ? r.status != "covered" : r.status == filter))
        }
        .sorted { a, b in
            let rank = ["none": 0, "thin": 1, "covered": 2]
            return (rank[a.status] ?? 0, -a.known) < (rank[b.status] ?? 0, -b.known)
        }
    }

    private func groups(_ rows: [AgencyMap.Row]) -> [(String, [AgencyMap.Row])] {
        var order: [String] = []
        var out: [String: [AgencyMap.Row]] = [:]
        for r in rows { if out[r.dept] == nil { order.append(r.dept) }; out[r.dept, default: []].append(r) }
        return order.map { ($0, out[$0] ?? []) }
    }

    private func row(_ r: AgencyMap.Row) -> some View {
        let color = r.status == "covered" ? Theme.good : r.status == "thin" ? Theme.accent : Theme.text3
        return NavigationLink(value: Route.unit(r.known > 0 ? unitName(r) : r.short)) {
            HStack(spacing: 12) {
                Circle().fill(color).frame(width: 10, height: 10)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        if r.short != r.name && !r.name.hasPrefix(r.short + " ") {
                            Text(r.short).font(Theme.mono(.caption, .semibold)).foregroundStyle(Theme.text2)
                        }
                        Text(r.name).font(Theme.geist(.subheadline, .semibold)).lineLimit(2)
                    }
                    Text(r.known == 0 ? "No one yet" : "\(r.known) you know\(r.senior > 0 ? " · \(r.senior) senior" : "")\(r.gap.isEmpty ? "" : " · \(r.gap.lowercased())")")
                        .font(Theme.geist(.caption)).foregroundStyle(r.status == "none" ? Theme.text3 : .secondary)
                    if !r.best.isEmpty {
                        HStack(spacing: -6) {
                            ForEach(r.best, id: \.self) { k in if let p = model.person(k) { Avatar(person: p, size: 22).background(Circle().fill(Theme.card).padding(-1.5)) } }
                        }
                    }
                }
                Spacer(minLength: 0)
                if r.watched { Image(systemName: "star.fill").font(.caption).foregroundStyle(Theme.amber) }
            }
            .padding(.vertical, 2)
        }
        .swipeActions {
            Button { model.introQuery = r.short } label: { Label("Ways in", systemImage: "point.3.connected.trianglepath.dotted") }.tint(Theme.info)
            if !r.watched {
                Button { Task { await model.toggleTarget(r.short); map = await model.agencyMap() } } label: { Label("Watch", systemImage: "star") }.tint(Theme.accent)
            }
        }
        .contextMenu {
            Button { model.introQuery = r.short } label: { Label("Find a way in", systemImage: "point.3.connected.trianglepath.dotted") }
            NavigationLink(value: Route.org(r.short)) { Label("Org chart", systemImage: "rectangle.3.group") }
            if !r.watched { Button { Task { await model.toggleTarget(r.short); map = await model.agencyMap() } } label: { Label("Add to watchlist", systemImage: "star") } }
        }
    }

    /// The name the unit page knows these people by: their agency label or employer.
    private func unitName(_ r: AgencyMap.Row) -> String {
        guard let k = r.best.first, let p = model.person(k) else { return r.short }
        return p.cl.agency.isEmpty ? p.c : p.cl.agency
    }
}
