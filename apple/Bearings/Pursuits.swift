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
    var pwin: Int?
    var pwinSet: Bool?
    var amount: Double?
    var weighted: Double?
    var incumbent: String?
    var cold: Int?
    var next: KeyDate?
    var fiscal: Fiscal?
    var competitor: Bool?
}

struct PursuitDetail: Decodable {
    struct Mini: Decodable, Hashable, Identifiable { var k: String; var name: String; var p: String; var band: String; var score: Int; var last: String?; var id: String { k } }
    struct Role: Decodable, Hashable, Identifiable {
        var role: String
        var people: [Mini]
        var suggest: [Mini]
        /// "government" or "industry" (Incumbent, Teaming partner).
        var side: String?
        /// For an industry seat: the companies it's filled from.
        var companies: [String]?
        var hint: String?
        var owner: String?
        var cold: Bool?
        var coldDays: Int?
        var id: String { role }
        var isIndustry: Bool { side == "industry" }
    }
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
    var pwin: Int?
    var pwinSet: Bool?
    var amount: Double?
    var weighted: Double?
    var incumbent: String?
    var cold: Int?
    var partners: [String]?
    var owners: [String: String]?
    var teammates: [String]?
    var next: KeyDate?
    var fiscal: Fiscal?
    var dates: [DateSlot]?
    var bid: BidDecision?
    var competitor: Bool?
    var competitors: [String]?
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

    /// Which teammate owns the relationship in one seat. An empty name clears it.
    func setSeatOwner(_ id: String, role: String, owner: String) async {
        _ = try? await engine.call("setSeatOwner", [id, role, owner], as: PursuitSummaryLite?.self)
        await savePursuits()
    }

    func savePursuits() async {
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
    @State private var digest = false

    var body: some View {
        List {
            if list.isEmpty {
                ContentUnavailableView {
                    Label("No pursuits yet", systemImage: "scope")
                } description: {
                    Text("Add a bid or a deal, and Northfix maps the people who decide it: who you know in each seat, the gaps, and your warmest ways in.")
                } actions: {
                    Button("Add a pursuit") { adding = true }.buttonStyle(PillButtonStyle(kind: .primary))
                }
            } else {
                Section {
                    NavigationLink(value: Route.pipeline) {
                        HStack(spacing: 12) {
                            Image(systemName: "chart.bar.xaxis").foregroundStyle(Theme.accent).frame(width: 28)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Pipeline").font(Theme.geist(.headline))
                                Text(pipelineLine).font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section {
                    ForEach(list) { p in
                        NavigationLink(value: Route.pursuit(p.id)) { row(p) }
                    }
                }
            }
        }
        .navigationTitle("Pursuits")
        .toolbar {
            ToolbarItem(placement: .primaryAction) { Button { adding = true } label: { Image(systemName: "plus") }.accessibilityLabel("Add a pursuit") }
            if !list.isEmpty {
                ToolbarItem(placement: .secondaryAction) { Button { digest = true } label: { Label("Weekly digest", systemImage: "doc.plaintext") } }
            }
        }
        .sheet(isPresented: $adding) { NewPursuitSheet().environment(AppModel.shared) }
        .sheet(isPresented: $digest) { CaptureDigestSheet().environment(AppModel.shared) }
        .task { if UserDefaults.standard.string(forKey: "captureOpen") == "pursuits" { try? await Task.sleep(nanoseconds: 1_500_000_000); digest = true } }
        .task(id: "\(model.pursuitsRev)-\(model.info.rev)") { list = await model.pursuits() }
    }

    private var pipelineLine: String {
        let open = list.filter { $0.stage != "Won" && $0.stage != "Lost" }
        let weighted = open.reduce(0.0) { $0 + ($1.weighted ?? 0) }
        let base = "\(open.count) open"
        return weighted > 0 ? base + ", \(Money.text(weighted)) weighted" : base
    }

    private func row(_ p: PursuitSummary) -> some View {
        HStack(spacing: 12) {
            ProgressRing(done: p.filled, total: p.roles, size: 36, line: 4)
            VStack(alignment: .leading, spacing: 3) {
                Text(p.name).font(Theme.geist(.headline))
                Text([p.agency, p.stage, PursuitDue.text(p.days)].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                HStack(spacing: 6) {
                    Text("\(p.filled) of \(p.roles) seats known\(p.warm > 0 ? " · \(p.warm) warm" : "")")
                        .font(Theme.geist(.caption)).foregroundStyle(p.filled < 3 ? Theme.needs : Theme.good)
                    if let c = p.cold, c > 0 { ColdBadge(text: c == 1 ? "1 cold" : "\(c) cold") }
                    if p.fiscal?.q4 == true, p.stage != "Won", p.stage != "Lost" { Q4Badge() }
                }
                if let n = p.next, n.kind != "proposal" {
                    Text(n.line).font(Theme.geist(.caption, .semibold)).foregroundStyle(n.days <= 7 ? Theme.needs : Theme.text2)
                }
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
    @State private var incumbent = ""
    @State private var partners = ""
    @State private var pwinText = ""
    @State private var fieldsLoaded = false
    @State private var planning: CallPlanTarget?
    @State private var sharing = false

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
                                if d.pwin != nil {
                                    Text(winLine(d)).font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                                }
                            }
                        }
                        Picker("Stage", selection: Binding(get: { d.stage }, set: { v in Task { await model.updatePursuit(id, ["stage": v]); await load() } })) {
                            ForEach(d.stages, id: \.self) { Text($0) }
                        }
                        .pickerStyle(.menu)
                        if let f = d.fiscal {
                            HStack(spacing: 6) {
                                Text("Due in \(f.label)").font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                                if f.q4 { Q4Badge() }
                            }
                        }
                        if let cs = d.competitors, !cs.isEmpty {
                            Label("Competitor\(cs.count == 1 ? "" : "s") on this one: \(cs.joined(separator: ", "))", systemImage: "flag.2.crossed")
                                .font(Theme.geist(.footnote, .semibold)).foregroundStyle(Theme.needs)
                        }
                    }
                    .padding(.vertical, 4)
                }
                if let slots = d.dates {
                    KeyDatesSection(pursuitId: id, slots: slots) { await load() }
                }
                if let b = d.bid {
                    BidSection(pursuitId: id, bid: b) { await load() }
                }
                Section {
                    ForEach(d.roleList.filter { !$0.isIndustry }) { r in roleRow(r, d) }
                } header: {
                    Text("Who decides")
                } footer: {
                    Text("Suggestions come from titles at \(d.agency). Tap one to put them in the seat.")
                }
                let industry = d.roleList.filter { $0.isIndustry }
                if !industry.isEmpty {
                    Section {
                        ForEach(industry) { r in roleRow(r, d) }
                    } header: {
                        Text("Industry")
                    } footer: {
                        Text("Who holds the work today, and who you’d bid it with.")
                    }
                }
                Section {
                    LabeledContent("Incumbent") {
                        TextField("Incumbent", text: $incumbent, prompt: Text("Like Leidos"))
                            .multilineTextAlignment(.trailing)
                            .onSubmit { saveFields() }
                    }
                    LabeledContent("Teaming partners") {
                        TextField("Teaming partners", text: $partners, prompt: Text("Comma separated"))
                            .multilineTextAlignment(.trailing)
                            .onSubmit { saveFields() }
                    }
                    LabeledContent("Win chance") {
                        HStack(spacing: 2) {
                            TextField("Win chance", text: $pwinText, prompt: Text(d.pwinSet == true ? "" : "\(d.pwin ?? 0)"))
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                                .frame(maxWidth: 70)
                                .onSubmit { saveFields() }
                            Text("%").foregroundStyle(.secondary)
                        }
                    }
                    if !pwinText.isEmpty || incumbent != (d.incumbent ?? "") || partners != (d.partners ?? []).joined(separator: ", ") {
                        Button("Save") { saveFields() }.font(Theme.geist(.subheadline, .semibold))
                    }
                } header: {
                    Text("Capture")
                } footer: {
                    Text(d.pwinSet == true
                         ? "Clear the win chance to go back to the typical one for the stage."
                         : "Leave win chance empty to use the typical one for \(d.stage): \(d.pwin ?? 0)%.")
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
                    Button { shareSheet() } label: {
                        HStack {
                            Label("Share one-pager (PDF)", systemImage: "doc.richtext")
                            Spacer()
                            if sharing { ProgressView() }
                        }
                    }
                    .disabled(sharing)
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
        .onDisappear { save(); saveFields() }
        .sheet(item: Binding(get: { picking.map { IntroFinderView.Wrapped(id: $0) } }, set: { picking = $0?.id })) { w in
            PersonPicker { k in Task { await model.assignRole(id, role: w.id, k: k, on: true); await load() } }
                .environment(AppModel.shared)
        }
        .sheet(item: $planning) { t in CallPlanSheet(k: t.k, pursuitId: t.pursuitId).environment(AppModel.shared) }
    }

    private func winLine(_ d: PursuitDetail) -> String {
        var s = "\(d.pwin ?? 0)% win chance"
        if d.pwinSet != true { s += ", typical for \(d.stage)" }
        let w = d.weighted ?? 0
        if w > 0 { s += " · " + Money.text(w) + " weighted" }
        return s
    }

    private func load() async {
        d = await model.pursuit(id)
        if note.isEmpty { note = d?.note ?? "" }
        if !fieldsLoaded, let d {
            incumbent = d.incumbent ?? ""
            partners = (d.partners ?? []).joined(separator: ", ")
            pwinText = d.pwinSet == true ? "\(d.pwin ?? 0)" : ""
            fieldsLoaded = true
        }
    }

    private func save() {
        guard let d, note != d.note else { return }
        Task { await model.updatePursuit(id, ["note": note]) }
    }

    /// Saves the incumbent, partners and win chance, when they changed.
    private func saveFields() {
        guard let d, fieldsLoaded else { return }
        var patch: [String: String] = [:]
        let inc = incumbent.trimmingCharacters(in: .whitespacesAndNewlines)
        if inc != (d.incumbent ?? "") { patch["incumbent"] = inc }
        let parts = partners.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        if parts != (d.partners ?? []) { patch["partners"] = parts.joined(separator: ", ") }
        let digits = pwinText.filter(\.isNumber)
        let wasSet = d.pwinSet == true ? "\(d.pwin ?? 0)" : ""
        if let n = Int(digits) {
            let v = String(min(100, max(0, n)))
            if v != wasSet { patch["pwin"] = v }
            if v != pwinText { pwinText = v }
        } else if !wasSet.isEmpty {
            patch["pwin"] = ""
            pwinText = ""
        }
        guard !patch.isEmpty else { return }
        Task { await model.updatePursuit(id, patch); await load() }
    }

    private func shareSheet() {
        sharing = true
        Task {
            if let s = await model.pursuitSheet(id), let url = PursuitSheetDocument.pdf(s) {
                model.shareFile = ShareFile(url: url)
            } else {
                model.show("Couldn’t make the one-pager")
            }
            sharing = false
        }
    }

    @ViewBuilder private func roleRow(_ r: PursuitDetail.Role, _ d: PursuitDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(r.role).font(Theme.geist(.subheadline, .semibold))
                if r.cold == true { ColdBadge(text: "Cold") }
                Spacer()
                if r.people.isEmpty {
                    Text("Empty seat").font(Theme.geist(.caption, .semibold)).foregroundStyle(Theme.needs)
                        .padding(.horizontal, 8).padding(.vertical, 3).background(Theme.needsSoft, in: Capsule())
                }
                Button { picking = r.role } label: { Image(systemName: "plus.circle") }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Add someone as \(r.role)")
            }
            if let cos = r.companies, !cos.isEmpty {
                Text("At \(cos.joined(separator: ", "))").font(Theme.geist(.footnote)).foregroundStyle(.secondary)
            }
            if let h = r.hint, !h.isEmpty {
                Text(h).font(Theme.geist(.footnote)).foregroundStyle(Theme.text3)
            }
            if r.cold == true {
                Text(r.coldDays.map { "No contact in \($0) days." } ?? "You haven’t been in touch yet.")
                    .font(Theme.geist(.caption)).foregroundStyle(Theme.info)
            }
            if let mates = d.teammates, !mates.isEmpty {
                let owner = r.owner ?? ""
                Menu {
                    Button { Task { await model.setSeatOwner(id, role: r.role, owner: ""); await load() } } label: {
                        if owner.isEmpty { Label("No owner", systemImage: "checkmark") } else { Text("No owner") }
                    }
                    ForEach(mates, id: \.self) { m in
                        Button { Task { await model.setSeatOwner(id, role: r.role, owner: m); await load() } } label: {
                            if owner == m { Label(m, systemImage: "checkmark") } else { Text(m) }
                        }
                    }
                } label: {
                    Label(owner.isEmpty ? "Assign an owner" : "Owner: \(owner)", systemImage: "person.crop.circle.badge.checkmark")
                        .font(Theme.geist(.caption, .semibold))
                }
                .buttonStyle(.borderless)
            }
            ForEach(r.people) { m in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        if let p = model.person(m.k) {
                            Button { model.open(.person(m.k)) } label: { PersonRow(person: p, lens: model.info.lens) }.buttonStyle(.plain)
                        }
                        Spacer()
                        Button { Task { await model.assignRole(id, role: r.role, k: m.k, on: false); await load() } } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Remove \(m.name)")
                    }
                    HStack(spacing: 12) {
                        Button { planning = CallPlanTarget(k: m.k, pursuitId: id) } label: { Label("Call plan", systemImage: "list.bullet.clipboard") }
                            .buttonStyle(.borderless)
                            .font(Theme.geist(.caption, .semibold))
                        if let last = m.last, !last.isEmpty {
                            Text("Last in touch \(Day.ago(last))").font(Theme.geist(.caption)).foregroundStyle(.secondary)
                        }
                    }
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

/// A small "Cold" pill for a pursuit seat no one has been in touch with lately.
struct ColdBadge: View {
    var text = "Cold"

    var body: some View {
        Label(text, systemImage: "thermometer.snowflake")
            .font(Theme.geist(.caption2, .semibold))
            .foregroundStyle(Theme.info)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(Theme.infoSoft, in: Capsule())
            .accessibilityLabel(text == "Cold" ? "Cold seat" : "\(text) seats")
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
