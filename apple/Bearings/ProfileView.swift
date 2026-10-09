import SwiftUI
import PhotosUI

struct ProfileView: View {
    @Environment(AppModel.self) private var model
    let k: String
    @State private var writing = false
    @State private var addingNotes = false
    @State private var settingRoleStart = false
    @State private var photoItem: PhotosPickerItem?

    var body: some View {
        if let p = model.person(k) {
            ScrollView {
                VStack(spacing: 12) {
                    header(p).cascade(0, distance: 10)
                    MemoryCard(person: p).cascade(1)
                    briefCard(p).cascade(1).edgeSettle()
                    TimelineCard(person: p).cascade(2).edgeSettle()
                    NavigationLink(value: Route.about(p.k)) {
                        HStack {
                            Text("Details, location and notes").font(Theme.geist(.subheadline, .medium)).foregroundStyle(.primary)
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.text3)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 15)
                        .card()
                    }
                    .buttonStyle(.pressable)
                    .cascade(3).edgeSettle()
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
            .background(alignment: .top) {
                // a glow in the color of their sector, behind the header
                Aurora(tint: p.tint)
                    .frame(height: 420)
                    .mask(LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black, location: 0.35), .init(color: .clear, location: 1)],
                                         startPoint: .top, endPoint: .bottom))
                    .padding(.horizontal, -60)
                    .offset(y: -170)
                    .allowsHitTesting(false)
            }
            }
            .background(Theme.bg)
            .sheet(isPresented: $writing) { MessageSheet(k: p.k).environment(AppModel.shared) }
            .navigationTitle(p.f)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { addingNotes = true } label: { Label("Add meeting notes", systemImage: "text.badge.plus") }
                        Button { model.sharePaperBrief(p.k) } label: { Label("Paper brief for reMarkable or print", systemImage: "doc.richtext") }
                        Button { settingRoleStart = true } label: { Label("In this role since…", systemImage: "calendar.badge.clock") }
                        ShareLink(item: model.personText(p.k)) { Label("Share as text, for Notes or Mail", systemImage: "square.and.arrow.up") }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("More")
                }
            }
            .modifier(AddNotesPrompt(isPresented: $addingNotes, forPerson: p.k))
            .sheet(isPresented: $settingRoleStart) { RoleSinceSheet(k: p.k).environment(AppModel.shared) }
            .task(id: k) { await model.loadFull(k) }
        } else {
            ContentUnavailableView("Not found", systemImage: "person.crop.circle.badge.xmark", description: Text("This person isn’t in your network anymore."))
        }
    }

    private func header(_ p: Person) -> some View {
        VStack(spacing: 12) {
            PhotosPicker(selection: $photoItem, matching: .images) {
                Avatar(person: p, size: 76)
                    .overlay(alignment: .bottomTrailing) {
                        if !PhotoStore.shared.hasChosen(p.k) && PhotoStore.shared.image(for: p.k) == nil {
                            Image(systemName: "camera.fill")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(Theme.primary)
                                .frame(width: 26, height: 26)
                                .background(Circle().fill(Theme.card))
                                .overlay(Circle().stroke(Theme.line, lineWidth: 1))
                                .offset(x: 4, y: 4)
                        }
                    }
            }
            .buttonStyle(.pressable(0.95))
            .accessibilityLabel("Photo of \(p.f)")
            .accessibilityHint("Choose a photo")
            .contextMenu {
                if PhotoStore.shared.hasChosen(p.k) {
                    Button("Remove photo", role: .destructive) { PhotoStore.shared.setChosen(p.k, image: nil) }
                }
            }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                        PhotoStore.shared.setChosen(p.k, image: img)
                        Haptic.success()
                    }
                    photoItem = nil
                }
            }
                .shadow(color: p.tint.opacity(0.35), radius: 14, y: 4)
                .visualEffect { view, proxy in
                    // pull down and the avatar swells a little, like it's coming toward you
                    let y = proxy.frame(in: .scrollView).minY
                    return view.scaleEffect(y > 40 ? min(1.25, 1 + (y - 40) / 300) : 1, anchor: .bottom)
                }
            VStack(spacing: 3) {
                Text(p.fullName)
                    .font(Theme.serif(.title, .semibold))
                    .multilineTextAlignment(.center)
                if !p.p.isEmpty {
                    Text(p.p).font(Theme.geist(.subheadline)).foregroundStyle(Theme.text2).multilineTextAlignment(.center).lineLimit(3)
                }
                if !p.c.isEmpty {
                    Button { model.open(.unit(p.c)) } label: {
                        HStack(spacing: 4) {
                            Text(p.c).font(Theme.geist(.subheadline, .semibold)).multilineTextAlignment(.center)
                            Image(systemName: "chevron.right").font(.caption2.weight(.bold)).foregroundStyle(Theme.text3)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            tags(p)
            actions(p).padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16).padding(.top, 20).padding(.bottom, 16)
        .card()
    }

    private struct Tag: Hashable { let text: String; let fg: Color; let bg: Color; var dot: Color? = nil }

    private func tagList(_ p: Person) -> [Tag] {
        var out: [Tag] = []
        if p.waiting { out.append(Tag(text: "Waiting on you", fg: Theme.needs, bg: Theme.needsSoft)) }
        if p.moved { out.append(Tag(text: "New job", fg: Theme.info, bg: Theme.infoSoft)) }
        if let b = model.nextBirthday(p.k), b.timeIntervalSinceNow < 14 * 86400 {
            out.append(Tag(text: Calendar.current.isDateInToday(b) ? "Birthday today" : "Birthday \(b.formatted(.dateTime.month(.abbreviated).day()))", fg: Theme.bad, bg: Theme.bad.opacity(0.12)))
        }
        out.append(Tag(text: p.cl.ind, fg: Theme.text2, bg: Theme.card2, dot: Color(hex: p.indColor)))
        if model.info.hasRel && p.rx != nil { out.append(Tag(text: "\(Band.label(p.band)) · \(p.score)", fg: Band.color(p.band), bg: Band.color(p.band).opacity(0.14))) }
        if let c = p.circle { out.append(Tag(text: p.over ? "\(c.title), overdue" : c.title, fg: Theme.primary, bg: Theme.soft)) }
        if p.isNew { out.append(Tag(text: "New connection", fg: Theme.primary, bg: Theme.soft)) }
        return Array(out.prefix(4))
    }

    @ViewBuilder private func tags(_ p: Person) -> some View {
        let items = tagList(p)
        if !items.isEmpty {
            FlowLayout(spacing: 6) {
                ForEach(items, id: \.self) { t in
                    HStack(spacing: 5) {
                        if let d = t.dot { Circle().fill(d).frame(width: 7, height: 7) }
                        Text(t.text)
                    }
                        .font(Theme.geist(.caption, .semibold))
                        .foregroundStyle(t.fg)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(t.bg, in: Capsule())
                }
            }
        }
    }

    private func actions(_ p: Person) -> some View {
        HStack(spacing: 8) {
            Button { writing = true } label: {
                Text("Message").font(Theme.geist(.subheadline, .semibold)).frame(maxWidth: .infinity, minHeight: 44)
                    .foregroundStyle(Theme.onPrimary)
                    .background(Theme.primary, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.pressable(0.94))
            Button {
                Haptic.star()
                Task { await model.toggleStar(p.k) }
            } label: { small(p.starred ? "Starred" : "Star", icon: p.starred ? "star.fill" : "star", on: p.starred) }
            .buttonStyle(.pressable(0.94))
            Menu {
                ForEach([(7, "In a week"), (14, "In 2 weeks"), (30, "In a month"), (90, "In 3 months")], id: \.0) { d, l in
                    Button(l) { Task { await model.followUp(p.k, days: d) } }
                }
                if let due = p.ed?.due, !due.isEmpty {
                    Divider()
                    Button("Clear reminder", role: .destructive) { Task { await model.followUp(p.k, days: 0) } }
                }
            } label: { small("Remind", icon: (p.ed?.due ?? "").isEmpty ? "bell" : "bell.badge.fill", on: !(p.ed?.due ?? "").isEmpty) }
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
            } label: { small(p.circle == nil ? "Circle" : "In touch", icon: p.circle?.icon ?? "circle.dashed", on: p.circle != nil) }
            .buttonStyle(.plain)
        }
    }

    private func small(_ title: String, icon: String, on: Bool) -> some View {
        VStack(spacing: 2) {
            Image(systemName: icon).font(.system(size: 14, weight: .semibold))
                .foregroundStyle(on ? Theme.needs : Theme.primary)
                .contentTransition(.symbolEffect(.replace))
                .symbolEffect(.bounce, value: on)
            Text(title).font(Theme.geist(.caption2, .medium)).foregroundStyle(.primary).lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(width: 64, height: 44)
        .background(Theme.card2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func briefCard(_ p: Person) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            BriefCard(person: p)
            if p.waiting {
                Button { Task { await model.markReplied(p.k) } } label: { Label("I already replied", systemImage: "arrowshape.turn.up.left") }
                    .buttonStyle(PillButtonStyle(kind: .soft))
            }
            if let due = p.ed?.due, !due.isEmpty {
                HStack {
                    Text(due <= Day.today ? "Follow-up due now" : "Follow up on \(Day.nice(due))")
                        .font(Theme.geist(.footnote, .semibold)).foregroundStyle(due <= Day.today ? Theme.violet : Theme.text2)
                    Spacer()
                    Button("Done") { Task { await model.followUp(p.k, days: 0) } }
                        .buttonStyle(PillButtonStyle(kind: .soft))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .card()
    }
}

/// Everything else about someone: relationship detail, location, links, details, notes and corrections.
struct PersonAboutView: View {
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
    @State private var sfBusy = false
    @FocusState private var noteFocused: Bool
    @Environment(\.openURL) private var openURL
    @State private var addingContact = false

    var body: some View {
        if let p = model.person(k) {
            List {
                if model.info.hasRel { relationship(p) }
                followUp(p)
                location(p)
                EnrichPersonSection(person: p)
                more(p)
                details(p)
                notes(p)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("About \(p.f)")
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
            if let l = links, !l.profile.isEmpty { LinkButton(title: "LinkedIn profile", url: l.profile, icon: "link") }
            if Salesforce.shared.connected && !model.info.isSample {
                Button { sendToSalesforce(p) } label: { Label(sfBusy ? "Sending to Salesforce" : "Send to Salesforce", systemImage: "cloud") }
                    .disabled(sfBusy)
            }
            if model.salesNav, let l = links, !l.salesNav.isEmpty { LinkButton(title: "Sales Navigator", url: l.salesNav, icon: "safari") }
            if !p.e.isEmpty {
                Button {
                    UIPasteboard.general.string = p.e
                    model.show("Email copied")
                } label: { Label("Copy email", systemImage: "doc.on.doc") }
            }
            if !p.c.isEmpty {
                NavigationLink(value: Route.unit(p.c)) { Label("More at \(p.c)", systemImage: "building.2") }
                Button { model.introQuery = p.c } label: { Label("Other ways into \(p.c)", systemImage: "point.3.connected.trianglepath.dotted") }
            }
            if !model.inContacts.contains(p.k) {
                Button { addingContact = true } label: { Label("Add to Contacts", systemImage: "person.crop.circle.badge.plus") }
                    .sheet(isPresented: $addingContact) {
                        NewContactView(name: p.fullName, company: p.c, title: p.p, email: p.e, url: links?.profile ?? p.u).ignoresSafeArea()
                    }
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
