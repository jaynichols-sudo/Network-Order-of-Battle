import SwiftUI
import WidgetKit

// Pursuits: an opportunity (a bid, a deal) and the people who decide it. Each seat shows who
// you know in it, or who could fill it, and the warmest ways into the agency.

struct PursuitSummary: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var agency: String
    var due: String
    var days: Int?
    var value: String
    var stage: String
    var filled: Int
    var roles: Int
    var warm: Int
    var people: Int
}

struct PursuitDetail: Decodable {
    struct Mini: Decodable, Hashable, Identifiable { var k: String; var name: String; var p: String; var band: String; var score: Int; var id: String { k } }
    struct Role: Decodable, Hashable, Identifiable { var role: String; var people: [Mini]; var suggest: [Mini]; var id: String { role } }
    struct Best: Decodable, Hashable, Identifiable { var k: String; var why: String; var id: String { k } }
    var id: String
    var name: String
    var agency: String
    var due: String
    var days: Int?
    var value: String
    var stage: String
    var filled: Int
    var roles: Int
    var warm: Int
    var note: String
    var stages: [String]
    var roleList: [Role]
    var known: Int
    var best: [Best]
}

extension AppModel {
    func pursuits() async -> [PursuitSummary] { (try? await engine.call("pursuits", as: [PursuitSummary].self)) ?? [] }
    func pursuit(_ id: String) async -> PursuitDetail? { try? await engine.call("pursuit", [id], as: PursuitDetail?.self) }

    @discardableResult
    func addPursuit(name: String, agency: String, due: Date?, value: String) async -> String? {
        var o: [String: String] = ["name": name, "agency": agency, "value": value]
        if let due { o["due"] = Day.fmt.string(from: due) }
        struct Made: Decodable { var id: String }
        let made = try? await engine.call("addPursuit", [o], as: Made.self)
        await savePursuits()
        return made?.id
    }

    func updatePursuit(_ id: String, _ patch: [String: String]) async {
        _ = try? await engine.call("updatePursuit", [id, patch], as: PursuitSummaryLite?.self)
        await savePursuits()
    }

    func assignRole(_ id: String, role: String, k: String, on: Bool) async {
        _ = try? await engine.call("assignRole", [id, role, k, on], as: PursuitSummaryLite?.self)
        await savePursuits()
    }

    func removePursuit(_ id: String) async {
        _ = try? await engine.call("removePursuit", [id], as: Bool.self)
        await savePursuits()
    }

    private func savePursuits() async {
        await saveFile("pursuits", "pursuits.json")
        pursuitsRev += 1
        await writePursuitGlance()
    }

    /// The "Pursuits due" widget's snapshot: the next three open pursuits, soonest due first.
    func writePursuitGlance() async {
        let open = await pursuits().filter { $0.stage != "Won" && $0.stage != "Lost" }
        let items = open.prefix(3).map {
            PursuitGlance.Item(id: $0.id, name: $0.name, agency: $0.agency, due: $0.due, stage: $0.stage, filled: $0.filled, roles: $0.roles)
        }
        PursuitGlanceStore.save(PursuitGlance(gen: ISO8601DateFormatter().string(from: Date()), open: open.count, items: Array(items)))
        WidgetCenter.shared.reloadTimelines(ofKind: "BearingsPursuits")
    }
}

/// Just enough to decode the engine's reply to an update.
struct PursuitSummaryLite: Decodable { var id: String }

struct PursuitsView: View {
    @Environment(AppModel.self) private var model
    @State private var list: [PursuitSummary] = []
    @State private var adding = false

    var body: some View {
        List {
            if list.isEmpty {
                ContentUnavailableView {
                    Label("No pursuits yet", systemImage: "scope")
                } description: {
                    Text("Add a bid or a deal, and Bearings maps the people who decide it: who you know in each seat, the gaps, and your warmest ways in.")
                } actions: {
                    Button("Add a pursuit") { adding = true }.buttonStyle(PillButtonStyle(kind: .primary))
                }
            } else {
                ForEach(list) { p in
                    NavigationLink(value: Route.pursuit(p.id)) { row(p) }
                }
            }
        }
        .navigationTitle("Pursuits")
        .toolbar { ToolbarItem(placement: .primaryAction) { Button { adding = true } label: { Image(systemName: "plus") }.accessibilityLabel("Add a pursuit") } }
        .sheet(isPresented: $adding) { NewPursuitSheet().environment(AppModel.shared) }
        .task(id: "\(model.pursuitsRev)-\(model.info.rev)") { list = await model.pursuits() }
    }

    private func row(_ p: PursuitSummary) -> some View {
        HStack(spacing: 12) {
            ProgressRing(done: p.filled, total: p.roles, size: 36, line: 4)
            VStack(alignment: .leading, spacing: 3) {
                Text(p.name).font(Theme.geist(.headline))
                Text([p.agency, p.stage, PursuitDue.text(p.days)].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                Text("\(p.filled) of \(p.roles) seats known\(p.warm > 0 ? " · \(p.warm) warm" : "")")
                    .font(Theme.geist(.caption)).foregroundStyle(p.filled < 3 ? Theme.needs : Theme.good)
            }
        }
        .padding(.vertical, 4)
    }
}

enum PursuitDue {
    static func text(_ days: Int?) -> String {
        guard let d = days else { return "" }
        if d < 0 { return "due \(-d) days ago" }
        if d == 0 { return "due today" }
        if d == 1 { return "due tomorrow" }
        return "due in \(d) days"
    }
}

struct PursuitView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var d: PursuitDetail?
    @State private var picking: String?
    @State private var note = ""

    var body: some View {
        List {
            if let d {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(d.agency.uppercased()).font(Theme.eyebrow).tracking(1.1).foregroundStyle(Theme.text2)
                        Text(d.name).font(Theme.serif(.title, .semibold))
                        HStack(spacing: 14) {
                            ProgressRing(done: d.filled, total: d.roles, size: 44, line: 5)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(d.filled) of \(d.roles) seats known").font(Theme.geist(.subheadline, .semibold))
                                Text([PursuitDue.text(d.days), d.value, "\(d.known) people you know at \(d.agency)"].filter { !$0.isEmpty }.joined(separator: " · "))
                                    .font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                            }
                        }
                        Picker("Stage", selection: Binding(get: { d.stage }, set: { v in Task { await model.updatePursuit(id, ["stage": v]); await load() } })) {
                            ForEach(d.stages, id: \.self) { Text($0) }
                        }
                        .pickerStyle(.menu)
                    }
                    .padding(.vertical, 4)
                }
                Section {
                    ForEach(d.roleList) { r in roleRow(r) }
                } header: {
                    Text("Who decides")
                } footer: {
                    Text("Suggestions come from titles at \(d.agency). Tap one to put them in the seat.")
                }
                if !d.best.isEmpty {
                    Section("Warmest ways in") {
                        ForEach(d.best) { b in
                            if let p = model.person(b.k) {
                                NavigationLink(value: Route.person(b.k)) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        PersonRow(person: p, lens: model.info.lens)
                                        Text(b.why).font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
                Section("Notes") {
                    TextField("What you know about this one", text: $note, axis: .vertical)
                        .lineLimit(3...8)
                        .onSubmit { save() }
                }
                Section {
                    NavigationLink(value: Route.org(d.agency)) { Label("Org chart for \(d.agency)", systemImage: "rectangle.3.group") }
                    Button(role: .destructive) { Task { await model.removePursuit(id); dismiss() } } label: { Label("Delete pursuit", systemImage: "trash") }
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle(d?.name ?? "Pursuit")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(model.pursuitsRev)-\(model.info.edits)") { await load() }
        .onDisappear { save() }
        .sheet(item: Binding(get: { picking.map { IntroFinderView.Wrapped(id: $0) } }, set: { picking = $0?.id })) { w in
            PersonPicker { k in Task { await model.assignRole(id, role: w.id, k: k, on: true); await load() } }
                .environment(AppModel.shared)
        }
    }

    private func load() async {
        d = await model.pursuit(id)
        if note.isEmpty { note = d?.note ?? "" }
    }

    private func save() {
        guard let d, note != d.note else { return }
        Task { await model.updatePursuit(id, ["note": note]) }
    }

    @ViewBuilder private func roleRow(_ r: PursuitDetail.Role) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(r.role).font(Theme.geist(.subheadline, .semibold))
                Spacer()
                if r.people.isEmpty {
                    Text("Empty seat").font(Theme.geist(.caption, .semibold)).foregroundStyle(Theme.needs)
                        .padding(.horizontal, 8).padding(.vertical, 3).background(Theme.needsSoft, in: Capsule())
                }
                Button { picking = r.role } label: { Image(systemName: "plus.circle") }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Add someone as \(r.role)")
            }
            ForEach(r.people) { m in
                HStack {
                    if let p = model.person(m.k) {
                        Button { model.open(.person(m.k)) } label: { PersonRow(person: p, lens: model.info.lens) }.buttonStyle(.plain)
                    }
                    Spacer()
                    Button { Task { await model.assignRole(id, role: r.role, k: m.k, on: false); await load() } } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Remove \(m.name)")
                }
            }
            if !r.suggest.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(r.suggest) { s in
                            Button { Task { Haptic.tap(); await model.assignRole(id, role: r.role, k: s.k, on: true); await load() } } label: {
                                HStack(spacing: 6) {
                                    if let p = model.person(s.k) { Avatar(person: p, size: 22) }
                                    VStack(alignment: .leading, spacing: 0) {
                                        Text(s.name).font(Theme.geist(.caption, .semibold)).lineLimit(1)
                                        Text(s.p).font(Theme.geist(.caption2)).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                }
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .frame(maxWidth: 200, alignment: .leading)
                                .background(Theme.card2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}

struct NewPursuitSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var agency = ""
    @State private var name = ""
    @State private var org = ""
    @State private var hasDue = false
    @State private var due = Date().addingTimeInterval(30 * 86400)
    @State private var value = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name, like “DISA OT gateway pilot”", text: $name)
                    TextField("Agency or company", text: $org)
                        .textInputAutocapitalization(.characters)
                    TextField("Value or vehicle (optional)", text: $value)
                }
                Section {
                    Toggle("Due date", isOn: $hasDue)
                    if hasDue { DatePicker("Due", selection: $due, displayedComponents: .date) }
                }
                if !model.targets.isEmpty {
                    Section("From your watchlist") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                ForEach(model.targets.prefix(10), id: \.name) { t in
                                    Button(t.name) { org = t.name }.buttonStyle(PillButtonStyle(kind: org == t.name ? .primary : .soft))
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("New pursuit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        Task {
                            if let id = await model.addPursuit(name: name, agency: org, due: hasDue ? due : nil, value: value) {
                                dismiss()
                                model.open(.pursuit(id))
                            }
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || org.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear { if org.isEmpty { org = agency } }
        }
    }
}
