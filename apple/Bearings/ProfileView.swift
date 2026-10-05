import SwiftUI

struct ProfileView: View {
    @Environment(AppModel.self) private var model
    let k: String
    @State private var links: PersonLinks?
    @State private var note = ""
    @State private var tags = ""
    @State private var industry = ""
    @State private var forCompany = true
    @State private var seg = ""
    @State private var branch = ""
    @State private var status = ""
    @State private var grade = ""
    @State private var rank = ""
    @State private var loadedFor = ""
    @State private var placeQuery = ""
    @State private var editingPlace = false
    @State private var writing = false
    @State private var sfBusy = false
    @FocusState private var noteFocused: Bool
    @Environment(\.openURL) private var openURL

    var body: some View {
        if let p = model.person(k) {
            List {
                header(p)
                if model.info.hasRel { relationship(p) }
                TimelineSection(person: p)
                followUp(p)
                location(p)
                more(p)
                details(p)
                notes(p)
            }
            .listStyle(.insetGrouped)
            .sheet(isPresented: $writing) { MessageSheet(k: p.k) }
            .navigationTitle(p.f)
            .navigationBarTitleDisplayMode(.inline)
            .task(id: k) {
                await model.loadFull(k)
                links = await model.links(k)
                fill(p)
            }
        } else {
            ContentUnavailableView("Not found", systemImage: "person.crop.circle.badge.xmark", description: Text("This person isn’t in your network anymore."))
        }
    }

    private func fill(_ p: Person) {
        guard loadedFor != p.k else { return }
        loadedFor = p.k
        let ed = p.ed ?? Edit()
        note = ed.note
        tags = ed.tags.joined(separator: ", ")
        industry = ed.ind
        forCompany = ed.ind.isEmpty
        seg = ed.seg; branch = ed.branch; status = ed.status; grade = ed.grade; rank = ed.rank
    }

    private func header(_ p: Person) -> some View {
        Section {
            VStack(spacing: 14) {
                ZStack {
                    if model.info.hasRel {
                        Circle().stroke(Color(.tertiarySystemFill), lineWidth: 4)
                        Circle()
                            .trim(from: 0, to: CGFloat(p.score) / 100)
                            .stroke(Band.color(p.band), style: StrokeStyle(lineWidth: 4, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                    }
                    Avatar(person: p, size: 104)
                }
                .frame(width: 118, height: 118)
                VStack(spacing: 4) {
                    Text(p.fullName)
                        .font(Theme.geist(.title, .bold))
                        .multilineTextAlignment(.center)
                    if !p.p.isEmpty {
                        Text(p.p).font(Theme.geist(.body)).foregroundStyle(.secondary).multilineTextAlignment(.center).lineLimit(3)
                    }
                    if !p.c.isEmpty {
                        Button { model.open(.unit(p.c)) } label: {
                            HStack(spacing: 4) {
                                Text(p.c).font(Theme.geist(.body, .semibold))
                                Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(.tertiary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                badges(p)
                actionRow(p)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 4)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 8, trailing: 0))
        }
    }

    private func badgeList(_ p: Person) -> [Badge] {
        var out: [Badge] = []
        if p.waiting { out.append(Badge(text: "Waiting on your reply", color: Theme.amber)) }
        if p.moved { out.append(Badge(text: "New job", color: Theme.info)) }
        if p.isNew { out.append(Badge(text: "New connection", color: Theme.accent)) }
        if p.due { out.append(Badge(text: "Follow-up due", color: Theme.violet)) }
        if p.over, let c = p.circle { out.append(Badge(text: "\(c.title): overdue", color: Theme.violet)) }
        if model.info.hasRel && p.rx != nil { out.append(Badge(text: Band.label(p.band), color: Band.color(p.band))) }
        return Array(out.prefix(3))
    }

    struct Badge: Hashable { let text: String; let color: Color }

    @ViewBuilder private func badges(_ p: Person) -> some View {
        let items = badgeList(p)
        if !items.isEmpty {
            HStack(spacing: 6) {
                ForEach(items, id: \.self) { b in Flag(text: b.text, color: b.color) }
            }
        }
    }

    private func actionRow(_ p: Person) -> some View {
        HStack(spacing: 10) {
            RoundAction(title: "Message", icon: "square.and.pencil", tint: Theme.accent) { writing = true }
            RoundAction(title: p.starred ? "Starred" : "Star", icon: p.starred ? "star.fill" : "star", tint: Theme.amber, on: p.starred) {
                Haptic.star()
                Task { await model.toggleStar(p.k) }
            }
            Menu {
                ForEach([(7, "In a week"), (14, "In 2 weeks"), (30, "In a month"), (90, "In 3 months")], id: \.0) { d, l in
                    Button(l) { Task { await model.followUp(p.k, days: d) } }
                }
                if let due = p.ed?.due, !due.isEmpty {
                    Divider()
                    Button("Clear reminder", role: .destructive) { Task { await model.followUp(p.k, days: 0) } }
                }
            } label: {
                RoundActionLabel(title: "Remind", icon: (p.ed?.due ?? "").isEmpty ? "bell" : "bell.badge.fill", tint: Theme.violet, on: !(p.ed?.due ?? "").isEmpty)
            }
            .buttonStyle(.plain)
            Menu {
                Section("Keep in touch") {
                    ForEach(KeepCircle.allCases) { c in
                        Button {
                            Task { await model.setCircle(p.k, c) }
                        } label: {
                            Label("\(c.title) · \(c.cadence.lowercased())", systemImage: p.circle == c ? "checkmark" : c.icon)
                        }
                    }
                    if p.circle != nil {
                        Button("Remove from circle", role: .destructive) { Task { await model.setCircle(p.k, nil) } }
                    }
                }
                Button {
                    Task { await model.touched(p.k) }
                } label: { Label("I was in touch today", systemImage: "checkmark.bubble") }
            } label: {
                RoundActionLabel(title: p.circle == nil ? "Circle" : (p.over ? "Overdue" : "In touch"), icon: p.circle?.icon ?? "circle.dashed",
                                 tint: p.over ? Theme.violet : Theme.good, on: p.circle != nil)
            }
            .buttonStyle(.plain)
            if let l = links, let u = URL(string: l.profile), !l.profile.isEmpty {
                RoundAction(title: "LinkedIn", icon: "link", tint: Theme.info) { Haptic.tap(); openURL(u) }
            }
            if Salesforce.shared.connected && !model.info.isSample {
                RoundAction(title: sfBusy ? "Sending" : "Salesforce", icon: "cloud", tint: Theme.info) { sendToSalesforce(p) }
                    .disabled(sfBusy)
            }
        }
        .padding(.top, 4)
    }

    private func sendToSalesforce(_ p: Person) {
        sfBusy = true
        Task {
            do {
                try await Salesforce.shared.push(p, profileURL: links?.profile ?? p.u)
                Haptic.success()
                model.show("Sent to Salesforce")
            } catch { model.show("Salesforce: \(error.localizedDescription)") }
            sfBusy = false
        }
    }

    @ViewBuilder private func more(_ p: Person) -> some View {
        Section {
            if model.salesNav, let l = links, !l.salesNav.isEmpty { LinkButton(title: "Sales Navigator", url: l.salesNav, icon: "safari") }
            if !p.e.isEmpty {
                Button {
                    UIPasteboard.general.string = p.e
                    model.show("Email copied")
                } label: { Label("Copy email", systemImage: "doc.on.doc") }
            }
            if !p.c.isEmpty {
                NavigationLink(value: Route.unit(p.c)) { Label("More at \(p.c)", systemImage: "building.2") }
            }
            if Salesforce.shared.connected && !model.info.isSample, let url = Salesforce.shared.contactURL(p.k) {
                Link(destination: url) { Label("Open in Salesforce", systemImage: "cloud") }
            }
        }
    }

    @ViewBuilder private func relationship(_ p: Person) -> some View {
        Section("Relationship") {
            if let x = p.rx {
                if !x.t.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(x.dir == "i" ? "\(p.f) wrote you \(Day.ago(x.t))" : "You wrote \(Day.ago(x.t))")
                            .font(Theme.geist(.subheadline, .semibold))
                        if !x.s.isEmpty {
                            Text("“\(x.s)”").font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                        }
                    }
                }
                let summary = relSummary(x)
                if !summary.isEmpty { Text(summary).font(Theme.geist(.footnote)).foregroundStyle(.secondary) }
                if !x.invn.isEmpty { Text("Invite note: “\(x.invn)”").font(Theme.geist(.footnote)).foregroundStyle(.secondary) }
                if p.waiting {
                    Button {
                        Task { await model.markReplied(p.k) }
                    } label: {
                        Label("Waiting on your reply. I replied", systemImage: "arrowshape.turn.up.left.fill")
                    }
                    .tint(Theme.bad)
                }
            } else {
                Text("You haven’t messaged \(p.f) on LinkedIn. A short hello is an easy start.")
                    .font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
            }
        }
    }

    private func relSummary(_ x: Relationship) -> String {
        var parts: [String] = []
        if x.m > 0 { parts.append("\(x.m.formatted()) \(x.m == 1 ? "message" : "messages") since \(Day.nice(x.f))") }
        if x.eg > 0 || x.er > 0 { parts.append(x.eg > 0 && x.er > 0 ? "you endorsed each other" : x.eg > 0 ? "you endorsed them" : "they endorsed you") }
        if x.rg > 0 || x.rr > 0 { parts.append(x.rg > 0 && x.rr > 0 ? "you recommended each other" : x.rg > 0 ? "you wrote them a recommendation" : "they wrote you a recommendation") }
        if !x.inv.isEmpty { parts.append(x.inv == "o" ? "you invited them\(x.invd.isEmpty ? "" : " on \(Day.nice(x.invd))")" : "they invited you") }
        guard !parts.isEmpty else { return "" }
        let s = parts.joined(separator: ", ")
        return s.prefix(1).uppercased() + s.dropFirst() + "."
    }

    @ViewBuilder private func followUp(_ p: Person) -> some View {
        if let due = p.ed?.due, !due.isEmpty {
            Section("Follow up") {
                HStack {
                    VStack(alignment: .leading) {
                        if due <= Day.today { Text("Follow up now").font(Theme.geist(.subheadline, .semibold)).foregroundStyle(Theme.violet) }
                        Text("You planned to follow up on \(Day.nice(due)).").font(Theme.geist(.subheadline))
                    }
                    Spacer()
                    Button("Done") { Task { await model.followUp(p.k, days: 0) } }
                        .buttonStyle(.bordered)
                }
            }
        }
    }

    private func location(_ p: Person) -> some View {
        Section("Location") {
            if let pl = model.places[p.k], !editingPlace {
                VStack(alignment: .leading, spacing: 2) {
                    Text(pl.name + (pl.isApproximate ? " (roughly)" : "")).font(Theme.geist(.body, .medium))
                    Text(pl.sourceLabel).font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                }
                Button(pl.src == "you" ? "Change location" : "Not right? Set it") { placeQuery = pl.src == "you" ? pl.name : ""; editingPlace = true }
                if pl.src == "you" {
                    Button("Clear location", role: .destructive) { Task { _ = await model.setLocation(p.k, query: "") } }
                }
            } else if editingPlace {
                TextField("City, like Tampa, FL or London", text: $placeQuery)
                    .submitLabel(.done)
                    .onSubmit { savePlace(p) }
                HStack {
                    Button("Save") { savePlace(p) }.buttonStyle(.borderedProminent)
                    Button("Cancel") { editingPlace = false }.buttonStyle(.bordered)
                }
            } else {
                Text("Not known yet. LinkedIn doesn’t share locations.").font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                Button("Set location") { placeQuery = ""; editingPlace = true }
            }
        }
    }

    private func savePlace(_ p: Person) {
        Task { if await model.setLocation(p.k, query: placeQuery) { editingPlace = false } }
    }

    private func details(_ p: Person) -> some View {
        let c = p.cl
        let lens = model.info.lens
        return Section("Details") {
            LabeledContent("Industry") {
                HStack(spacing: 6) {
                    Circle().fill(Color(hex: p.indColor)).frame(width: 8, height: 8)
                    Text(c.ind + (c.indHow == "you" ? " (set by you)" : c.indHow == "guess" ? " (best guess)" : ""))
                }
            }
            LabeledContent("Seniority", value: c.sen)
            LabeledContent("Role", value: c.fn)
            if lens && c.seg != "Other Commercial" { LabeledContent("Segment", value: c.seg) }
            if lens && (!c.branch.isEmpty || !c.status.isEmpty) { LabeledContent("Service", value: [c.branch, c.status].filter { !$0.isEmpty }.joined(separator: ", ")) }
            else if !lens && c.status == "Veteran / Retired" { LabeledContent("Service", value: [c.branch, "Veteran"].filter { !$0.isEmpty }.joined(separator: " ")) }
            if lens && !c.grade.isEmpty { LabeledContent("Rank", value: (c.rank.isEmpty || c.rank == c.grade ? "" : c.rank + " ") + c.grade) }
            if lens && !c.agency.isEmpty { LabeledContent("Agency or command", value: c.agency) }
            if !c.certs.isEmpty || (lens && c.clr) { LabeledContent("Certifications", value: (c.certs.isEmpty ? "None listed" : c.certs.joined(separator: ", ")) + (lens && c.clr ? ", clearance mentioned" : "")) }
            LabeledContent("Connected", value: Day.nice(p.d))
            if let x = p.x { LabeledContent("Status", value: "Not in your export since \(Day.nice(x))") }
            if !p.e.isEmpty { LabeledContent("Email", value: p.e).textSelection(.enabled) }
        }
        .font(Theme.geist(.subheadline))
    }

    @ViewBuilder private func notes(_ p: Person) -> some View {
        Section {
            TextField("How you know them, last conversation, next step", text: $note, axis: .vertical)
                .lineLimit(3...12)
                .focused($noteFocused)
            TextField("Tags, separated by commas", text: $tags)
                .textInputAutocapitalization(.never)
            Picker("Industry", selection: $industry) {
                Text("Automatic: \(p.cl.ind)").tag("")
                ForEach(model.constants.industries.filter { $0.id != model.constants.unclassified }) { i in
                    Text(i.id).tag(i.id)
                }
            }
            if !p.c.isEmpty { Toggle("Use this for everyone at \(p.c)", isOn: $forCompany) }
            if model.info.lens {
                Picker("Segment", selection: $seg) {
                    Text("Automatic").tag("")
                    ForEach(model.constants.segs, id: \.id) { s in Text(s.id).tag(s.id) }
                }
                Picker("Branch", selection: $branch) {
                    Text("Automatic").tag("")
                    ForEach(model.constants.branches, id: \.self) { Text($0).tag($0) }
                    Text("None").tag("__none")
                }
                Picker("Status", selection: $status) {
                    Text("Automatic").tag("")
                    ForEach(model.constants.statuses, id: \.self) { Text($0).tag($0) }
                    Text("None").tag("__none")
                }
                Picker("Grade", selection: $grade) {
                    Text("Automatic").tag("")
                    ForEach(model.constants.grades, id: \.self) { Text($0).tag($0) }
                    Text("None").tag("__none")
                }
                TextField("Rank title, like Colonel, USMC (Ret.)", text: $rank)
            }
            Button {
                noteFocused = false
                save(p)
            } label: {
                Text("Save").frame(maxWidth: .infinity).fontWeight(.semibold)
            }
        } header: {
            Text("Notes and corrections")
        } footer: {
            if model.info.isSample { Text("Sample data: changes aren’t saved.") }
        }
    }

    private func save(_ p: Person) {
        let tagList = tags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.prefix(20)
        var patch: [String: Any] = ["note": String(note.prefix(4000)), "tags": Array(tagList), "rank": String(rank.trimmingCharacters(in: .whitespaces).prefix(80))]
        if model.info.lens { patch["seg"] = seg; patch["branch"] = branch; patch["status"] = status; patch["grade"] = grade }
        var co: (company: String, ind: String)?
        if forCompany && !p.c.isEmpty { co = (p.c, industry) } else { patch["ind"] = industry }
        loadedFor = ""
        Task { await model.saveProfile(p.k, patch: patch, companyIndustry: co) }
    }
}
