import SwiftUI

// Moves (rotations and people leaving service) and intro tracking.

struct MoveItem: Decodable, Identifiable, Hashable {
    var k: String
    var name: String
    var kind: String
    var why: String
    var months: Int?
    var est: String?
    var id: String { k }
}

struct IntroItem: Decodable, Identifiable, Hashable {
    var id: String
    var via: String
    var viaName: String
    var to: String
    var co: String
    var at: String
    var st: String
    var days: Int
    var nudge: Bool
}

extension AppModel {
    func moves() async -> [MoveItem] { (try? await engine.call("moves", as: [MoveItem].self)) ?? [] }
    func intros() async -> [IntroItem] { (try? await engine.call("intros", as: [IntroItem].self)) ?? [] }

    func setRoleSince(_ k: String, _ date: Date?) async {
        let ym: String = date.map { let f = DateFormatter(); f.dateFormat = "yyyy-MM"; return f.string(from: $0) } ?? ""
        await edit(k, call: "setRoleSince", [k, ym])
    }

    func addIntro(via: String, to: String, company: String) async {
        await edit(via, call: "addIntro", [via, to, company])
        show("Tracking it. We’ll nudge you in a week if it hasn’t happened.")
    }

    func setIntro(via: String, id: String, status: String) async {
        await edit(via, call: "setIntro", [via, id, status])
    }
}

/// People likely to rotate, retire or leave service soon: the moment to stay close.
struct MovesView: View {
    @Environment(AppModel.self) private var model
    @State private var list: [MoveItem] = []

    var body: some View {
        List {
            let leaving = list.filter { $0.kind == "transition" }
            let rotating = list.filter { $0.kind == "pcs" }
            if list.isEmpty {
                ContentUnavailableView("No moves spotted", systemImage: "arrow.triangle.swap",
                                       description: Text("Bearings looks for people whose titles say they’re transitioning or retiring, and service members who’ve been in an assignment two years or more. Set “In this role since” on a profile to sharpen it."))
            }
            if !leaving.isEmpty {
                Section {
                    ForEach(leaving) { m in row(m) }
                } header: { Text("Leaving service or retiring") } footer: { Text("A good moment to help, and to stay close as they land somewhere new.") }
            }
            if !rotating.isEmpty {
                Section {
                    ForEach(rotating) { m in row(m) }
                } header: { Text("Likely to rotate") } footer: { Text("Most tours run two to three years. Reconnect before they move, then again after.") }
            }
        }
        .navigationTitle("Moves")
        .task(id: "\(model.info.rev)-\(model.info.edits)") { list = await model.moves() }
    }

    @ViewBuilder private func row(_ m: MoveItem) -> some View {
        if let p = model.person(m.k) {
            NavigationLink(value: Route.person(m.k)) {
                VStack(alignment: .leading, spacing: 4) {
                    PersonRow(person: p, lens: model.info.lens)
                    Text(m.why).font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// "In this role since": sharpens rotation estimates for one person.
struct RoleSinceSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let k: String
    @State private var date = Date()

    var body: some View {
        NavigationStack {
            Form {
                DatePicker("In this role since", selection: $date, in: ...Date(), displayedComponents: .date)
                Text("Used to estimate when a service member is likely to rotate. Most tours run two to three years.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .navigationTitle("Role start")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Clear") { Task { await model.setRoleSince(k, nil); dismiss() } } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await model.setRoleSince(k, date); dismiss() } } }
            }
        }
        .presentationDetents([.medium])
    }
}

/// Intro asks you've made: asked, made, met. A nudge after a week.
struct IntrosView: View {
    @Environment(AppModel.self) private var model
    @State private var list: [IntroItem] = []
    @State private var nudging: String?

    var body: some View {
        List {
            if list.isEmpty {
                ContentUnavailableView("No intros yet", systemImage: "person.line.dotted.person",
                                       description: Text("When you ask someone for an intro from Ways in, tap Track it. Bearings follows it from asked to made to met."))
            }
            ForEach(["asked", "made", "met", "declined"], id: \.self) { st in
                let rows = list.filter { $0.st == st }
                if !rows.isEmpty {
                    Section(label(st)) {
                        ForEach(rows) { x in row(x) }
                    }
                }
            }
        }
        .navigationTitle("Intros")
        .task(id: "\(model.info.edits)") { list = await model.intros() }
        .sheet(item: Binding(get: { nudging.map { IntroFinderView.Wrapped(id: $0) } }, set: { nudging = $0?.id })) { w in
            MessageSheet(k: w.id).environment(AppModel.shared)
        }
    }

    private func label(_ st: String) -> String {
        ["asked": "Asked", "made": "Introduced", "met": "Met", "declined": "Didn’t happen"][st] ?? st
    }

    private func row(_ x: IntroItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(x.to.isEmpty ? "Into \(x.co)" : "\(x.to)\(x.co.isEmpty ? "" : " at \(x.co)")").font(Theme.geist(.subheadline, .semibold))
                    Text("Through \(x.viaName) · \(x.days == 0 ? "today" : "\(x.days) days ago")").font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                }
                Spacer()
                Menu {
                    Button("Introduced") { Task { await model.setIntro(via: x.via, id: x.id, status: "made"); await reload() } }
                    Button("We met") { Task { Signature.done(); await model.setIntro(via: x.via, id: x.id, status: "met"); await reload() } }
                    Button("Didn’t happen") { Task { await model.setIntro(via: x.via, id: x.id, status: "declined"); await reload() } }
                    Button("Remove", role: .destructive) { Task { await model.setIntro(via: x.via, id: x.id, status: "remove"); await reload() } }
                } label: { Image(systemName: "ellipsis.circle") }
            }
            if x.nudge {
                Button { nudging = x.via } label: { Label("Nudge \(x.viaName.split(separator: " ").first.map(String.init) ?? "")", systemImage: "hand.wave") }
                    .buttonStyle(PillButtonStyle(kind: .soft))
            }
        }
        .padding(.vertical, 2)
    }

    private func reload() async { list = await model.intros() }
}

/// "Track it" after asking for an intro: who you're trying to reach.
struct TrackIntroSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let via: String
    let company: String
    @State private var to = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Who you want to meet (optional)", text: $to)
                    LabeledContent("At", value: company)
                    if let p = model.person(via) { LabeledContent("Asking", value: p.fullName) }
                } footer: { Text("Bearings reminds you to nudge after a week, and keeps the history on their profile.") }
            }
            .navigationTitle("Track this intro")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Track") { Task { await model.addIntro(via: via, to: to, company: company); dismiss() } } }
            }
        }
        .presentationDetents([.medium])
    }
}
