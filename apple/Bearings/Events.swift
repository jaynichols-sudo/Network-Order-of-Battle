import SwiftUI
import Vision
import UniformTypeIdentifiers
#if !targetEnvironment(macCatalyst)
import VisionKit
#endif

// Event mode: before a conference, see who you know that's going; during it, scan
// cards and jot notes; afterward, a follow-up list until everyone's been contacted.

struct NetEvent: Codable, Identifiable, Hashable {
    var id = UUID().uuidString
    var name: String
    var place = ""
    var start: Date
    var end: Date
    var attending: [String] = []
    var met: [Met] = []

    struct Met: Codable, Identifiable, Hashable {
        var id = UUID().uuidString
        var k: String?
        var name: String
        var company = ""
        var title = ""
        var email = ""
        var phone = ""
        var note = ""
        var at = Date()
        var followed = false
    }

    var isOn: Bool { Date() >= Calendar.current.startOfDay(for: start) && Date() <= end.addingTimeInterval(86400) }
    var isUpcoming: Bool { Date() < Calendar.current.startOfDay(for: start) }
    var isRecent: Bool { !isOn && !isUpcoming && Date().timeIntervalSince(end) < 21 * 86400 }
    var when: String {
        let f = DateFormatter(); f.dateFormat = "MMM d"
        return Calendar.current.isDate(start, inSameDayAs: end) ? f.string(from: start) : "\(f.string(from: start)) to \(f.string(from: end))"
    }
}

extension AppModel {
    func toFollowUp(_ e: NetEvent) -> [NetEvent.Met] { e.met.filter { !followedUp($0, e) } }

    /// Followed up if you ticked it, messaged them since the event started, or logged a touch.
    func followedUp(_ m: NetEvent.Met, _ e: NetEvent) -> Bool {
        if m.followed { return true }
        guard let k = m.k, let p = person(k) else { return false }
        let since = Day.fmt.string(from: e.start)
        return (p.rx?.t ?? "") >= since && p.rx?.dir == "o" || (p.ed?.touched ?? "") >= since
    }
}

// MARK: Home strip

struct EventsStrip: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let live = model.events.filter { $0.isOn || $0.isUpcoming || $0.isRecent }.sorted { $0.start < $1.start }
        VStack(alignment: .leading, spacing: 10) {
            if !live.isEmpty {
                Text("Events").font(Theme.geist(.title3, .bold))
                ForEach(live.prefix(3)) { e in
                    NavigationLink(value: Route.event(e.id)) { EventRow(event: e) }.buttonStyle(.plain)
                }
            }
            Button { model.newEvent = true } label: {
                Label(live.isEmpty ? "Going to a conference? Set up event mode" : "New event", systemImage: "ticket")
                    .font(Theme.geist(.subheadline, .semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14).padding(.vertical, 12)
                    .card(18)
            }
            .buttonStyle(.plain)
        }
    }
}

struct EventRow: View {
    @Environment(AppModel.self) private var model
    let event: NetEvent

    var body: some View {
        let todo = model.toFollowUp(event).count
        HStack(spacing: 12) {
            Image(systemName: event.isOn ? "dot.radiowaves.left.and.right" : event.isUpcoming ? "calendar" : "checklist")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(event.isOn ? Theme.good : Theme.violet)
                .frame(width: 38, height: 38)
                .background((event.isOn ? Theme.good : Theme.violet).opacity(0.14), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(event.name).font(Theme.geist(.headline))
                Text(line(todo)).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(14)
        .card(18)
    }

    private func line(_ todo: Int) -> String {
        if event.isUpcoming { return "\(event.when). \(event.attending.isEmpty ? "Load the attendee list to see who you know" : "You know \(event.attending.count) going")" }
        if event.isOn { return "Happening now. \(event.met.count) met so far" }
        return todo == 0 ? "All \(event.met.count) followed up" : "\(todo) of \(event.met.count) still to follow up"
    }
}

// MARK: create

struct NewEventSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var place = ""
    @State private var start = Date()
    @State private var end = Date().addingTimeInterval(2 * 86400)

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name, like AFCEA TechNet Augusta", text: $name)
                    TextField("Where (optional)", text: $place)
                }
                Section {
                    DatePicker("Starts", selection: $start, displayedComponents: .date)
                    DatePicker("Ends", selection: $end, in: start..., displayedComponents: .date)
                } footer: {
                    Text("Next, load the attendee list if you have one, or just start scanning cards when you get there.")
                }
            }
            .navigationTitle("New event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        let e = NetEvent(name: name.trimmingCharacters(in: .whitespaces), place: place, start: start, end: Calendar.current.date(bySettingHour: 23, minute: 59, second: 0, of: end) ?? end)
                        Task {
                            await model.saveEvent(e)
                            dismiss()
                            model.tab = .home
                            model.paths[.home] = [.event(e.id)]
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}

// MARK: event screen

struct EventView: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var loadingList = false
    @State private var pickingList = false
    @State private var pasting = false
    @State private var pasted = ""
    @State private var addingKnown = false
    @State private var scanning = false
    @State private var draft: NetEvent.Met?
    @State private var writingTo: String?
    @State private var savingContact: NetEvent.Met?

    var body: some View {
        if let e = model.events.first(where: { $0.id == id }) {
            List {
                header(e)
                actions(e)
                metSection(e)
                attendingSection(e)
                Section {
                    Button("Delete event", role: .destructive) { Task { await model.deleteEvent(e) } }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(e.name)
            .navigationBarTitleDisplayMode(.inline)
            .fileImporter(isPresented: $pickingList, allowedContentTypes: [.commaSeparatedText, .plainText, .text]) { r in
                if case .success(let url) = r { loadList(url: url, e) }
            }
            .sheet(isPresented: $pasting) { pasteSheet(e) }
            .sheet(isPresented: $addingKnown) { PersonPicker { k in addKnown(k, e) } }
            .sheet(item: $draft) { m in MetForm(met: m, event: e) }
            .sheet(item: Binding(get: { writingTo.map { IntroFinderView.Wrapped(id: $0) } }, set: { writingTo = $0?.id })) { w in
                MessageSheet(k: w.id, event: e.name)
            }
            .sheet(item: $savingContact) { m in NewContactView(name: m.name, company: m.company, title: m.title, email: m.email, phone: m.phone).ignoresSafeArea() }
            #if !targetEnvironment(macCatalyst)
            .fullScreenCover(isPresented: $scanning) {
                CardScanner { lines in
                    scanning = false
                    if let lines { draft = CardParser.parse(lines) }
                }
                .ignoresSafeArea()
            }
            #endif
        } else {
            ContentUnavailableView("Event not found", systemImage: "ticket")
        }
    }

    private func header(_ e: NetEvent) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text(e.name).font(Theme.geist(.title2, .bold))
                Text([e.when, e.place].filter { !$0.isEmpty }.joined(separator: " · ")).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 18) { stats(e) }
                    VStack(alignment: .leading, spacing: 8) { stats(e) }
                }
                .padding(.top, 6)
            }
            .listRowBackground(Color.clear)
        }
    }

    @ViewBuilder private func stats(_ e: NetEvent) -> some View {
        stat(e.attending.count, "you know going")
        stat(e.met.count, "met")
        stat(model.toFollowUp(e).count, "to follow up")
    }

    private func stat(_ n: Int, _ l: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(n.formatted()).font(Theme.mono(.title2, .semibold))
            Text(l).font(Theme.geist(.caption)).foregroundStyle(.secondary)
        }
    }

    private func actions(_ e: NetEvent) -> some View {
        Section {
            #if !targetEnvironment(macCatalyst)
            if VNDocumentCameraViewController.isSupported {
                Button { scanning = true } label: { Label("Scan a business card or badge", systemImage: "camera.viewfinder") }
            }
            #endif
            Button { addingKnown = true } label: { Label("Met someone you’re connected to", systemImage: "person.crop.circle.badge.checkmark") }
            Button { draft = NetEvent.Met(name: "") } label: { Label("Add someone new", systemImage: "person.badge.plus") }
            Menu {
                Button { pickingList = true } label: { Label("Choose a file (CSV or text)", systemImage: "doc") }
                Button { pasting = true } label: { Label("Paste names or emails", systemImage: "doc.on.clipboard") }
            } label: {
                HStack {
                    Label(loadingList ? "Matching…" : "Load the attendee list", systemImage: "list.bullet.rectangle")
                    Spacer()
                    if loadingList { ProgressView() }
                }
            }
        } footer: {
            Text("Notes you add here also go on each person’s timeline. Dictate them with the microphone on the keyboard.")
        }
    }

    @ViewBuilder private func metSection(_ e: NetEvent) -> some View {
        if !e.met.isEmpty {
            Section("Met (\(e.met.count))") {
                ForEach(e.met.sorted { $0.at > $1.at }) { m in metRow(m, e) }
            }
        }
    }

    private func metRow(_ m: NetEvent.Met, _ e: NetEvent) -> some View {
        let done = model.followedUp(m, e)
        return HStack(alignment: .top, spacing: 12) {
            Button {
                var x = m; x.followed.toggle()
                Task { await model.updateMet(x, in: e) }
            } label: {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(done ? Theme.good : Color(.tertiaryLabel))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(done ? "Followed up" : "Mark followed up")
            VStack(alignment: .leading, spacing: 3) {
                Text(m.name).font(Theme.geist(.body, .semibold)).strikethrough(done, color: .secondary)
                let sub = [m.title, m.company].filter { !$0.isEmpty }.joined(separator: " · ")
                if !sub.isEmpty { Text(sub).font(Theme.geist(.subheadline)).foregroundStyle(.secondary) }
                if !m.note.isEmpty { Text(m.note).font(Theme.geist(.subheadline)).foregroundStyle(.secondary).lineLimit(3) }
                HStack(spacing: 14) {
                    if let k = m.k {
                        Button("Message") { writingTo = k }
                        NavigationLink("Profile", value: Route.person(k))
                    } else {
                        Button("Save to Contacts") { savingContact = m }
                        if let u = linkedInSearch(m) { Link("Find on LinkedIn", destination: u) }
                    }
                }
                .font(Theme.geist(.subheadline, .semibold))
                .buttonStyle(.borderless)
                .padding(.top, 2)
            }
        }
        .swipeActions {
            Button(role: .destructive) { Task { await model.removeMet(m, from: e) } } label: { Label("Remove", systemImage: "trash") }
        }
    }

    private func linkedInSearch(_ m: NetEvent.Met) -> URL? {
        var c = URLComponents(string: "https://www.linkedin.com/search/results/people/")
        c?.queryItems = [URLQueryItem(name: "keywords", value: [m.name, m.company].filter { !$0.isEmpty }.joined(separator: " "))]
        return c?.url
    }

    @ViewBuilder private func attendingSection(_ e: NetEvent) -> some View {
        let ps = model.persons(e.attending).sorted { $0.score > $1.score }
        if !ps.isEmpty {
            Section("You know \(ps.count) going") {
                ForEach(ps) { p in
                    NavigationLink(value: Route.person(p.k)) { PersonRow(person: p, lens: model.info.lens) }
                        .swipeActions(edge: .leading) {
                            Button { addKnown(p.k, e) } label: { Label("Met", systemImage: "hand.wave") }.tint(Theme.good)
                        }
                }
            }
        }
    }

    private func pasteSheet(_ e: NetEvent) -> some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $pasted).frame(minHeight: 260).font(Theme.geist(.body))
                } footer: {
                    Text("One person per line: a name, an email, or both. Copy it from the registration page or a spreadsheet.")
                }
            }
            .navigationTitle("Attendee list")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { pasting = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Match") { pasting = false; match(text: pasted, e) }.disabled(pasted.isEmpty)
                }
            }
        }
    }

    private func loadList(url: URL, _ e: NetEvent) {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        guard let d = try? Data(contentsOf: url) else { model.show("Couldn’t read that file"); return }
        match(text: String(decoding: d, as: UTF8.self), e)
    }

    private func match(text: String, _ e: NetEvent) {
        loadingList = true
        Task {
            let entries = AttendeeParser.parse(text)
            let keys = await model.matchAttendees(entries)
            var x = e
            x.attending = Array(Set(x.attending + keys.compactMap { $0 }))
            await model.saveEvent(x)
            loadingList = false
            Haptic.success()
            model.show("\(entries.count) on the list. You know \(x.attending.count).")
        }
    }

    private func addKnown(_ k: String, _ e: NetEvent) {
        guard let p = model.person(k) else { return }
        draft = NetEvent.Met(k: k, name: p.fullName, company: p.c, title: p.p, email: p.e)
    }
}

/// Edit what you know about someone you just met, then save it to the event.
struct MetForm: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State var met: NetEvent.Met
    let event: NetEvent

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $met.name).textContentType(.name)
                    TextField("Title", text: $met.title).textContentType(.jobTitle)
                    TextField("Company", text: $met.company).textContentType(.organizationName)
                    TextField("Email", text: $met.email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                    TextField("Phone", text: $met.phone).textContentType(.telephoneNumber).keyboardType(.phonePad)
                }
                Section {
                    TextField("What you talked about, what you promised", text: $met.note, axis: .vertical).lineLimit(3...8)
                } header: { Text("Note") } footer: { Text("Tap the microphone on the keyboard to dictate.") }
            }
            .navigationTitle(met.k == nil ? "Someone new" : "You met \(met.name.split(separator: " ").first.map(String.init) ?? "")")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await model.addMet(met, to: event)
                            dismiss()
                        }
                    }
                    .disabled(met.name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}

/// Pick someone from your network.
struct PersonPicker: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let onPick: (String) -> Void
    @State private var q = ""

    var body: some View {
        NavigationStack {
            List {
                ForEach(matches) { p in
                    Button {
                        dismiss()
                        onPick(p.k)
                    } label: { PersonRow(person: p, lens: model.info.lens) }
                    .buttonStyle(.plain)
                }
            }
            .listStyle(.plain)
            .searchable(text: $q, placement: .navigationBarDrawer(displayMode: .always), prompt: "Name or company")
            .navigationTitle("Who did you meet?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private var matches: [Person] {
        let t = q.lowercased().trimmingCharacters(in: .whitespaces)
        guard t.count >= 2 else { return [] }
        return Array(model.people.filter { $0.x == nil && ($0.fullName.lowercased().contains(t) || $0.c.lowercased().contains(t)) }.prefix(50))
    }
}

// MARK: parsing

enum AttendeeParser {
    static func parse(_ text: String) -> [(email: String, name: String)] {
        let emailRx = try? NSRegularExpression(pattern: "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", options: .caseInsensitive)
        var out: [(email: String, name: String)] = []
        for raw in text.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty else { continue }
            var email = ""
            if let m = emailRx?.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)), let r = Range(m.range, in: line) { email = String(line[r]) }
            var cells = line.components(separatedBy: CharacterSet(charactersIn: ",\t;")).map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " \"")) }.filter { !$0.isEmpty && !$0.contains("@") }
            if cells.first?.lowercased().contains("name") == true && cells.count > 1 && out.isEmpty && email.isEmpty { continue } // header row
            var name = cells.first ?? ""
            // "First, Last" spread over two columns
            if cells.count >= 2, !name.contains(" "), !cells[1].contains(" "), cells[1].first?.isUppercase == true { name += " " + cells[1]; cells.removeFirst() }
            if !email.isEmpty || name.contains(" ") { out.append((email, name)) }
        }
        return out
    }
}

/// Turns the text on a business card into a person, as best it can. You can fix anything after.
enum CardParser {
    static func parse(_ lines: [String]) -> NetEvent.Met {
        var m = NetEvent.Met(name: "")
        let clean = lines.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let emailRx = try? NSRegularExpression(pattern: "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", options: .caseInsensitive)
        let phoneRx = try? NSRegularExpression(pattern: "(\\+?\\d[\\d\\s().-]{8,}\\d)")
        let titleWords = ["director", "manager", "president", "vp", "vice", "chief", "officer", "engineer", "head", "lead", "specialist", "analyst", "consultant", "architect",
                          "founder", "partner", "colonel", "commander", "general", "captain", "major", "sergeant", "administrator", "executive", "coordinator", "advisor", "principal", "ceo", "cto", "cio", "ciso", "cfo"]
        let coWords = ["inc", "llc", "corp", "corporation", "company", "ltd", "group", "solutions", "systems", "technologies", "agency", "department", "command", "university", "energy", "security", "partners"]
        var rest: [String] = []
        for l in clean {
            let r = NSRange(l.startIndex..., in: l)
            if m.email.isEmpty, let x = emailRx?.firstMatch(in: l, range: r), let rr = Range(x.range, in: l) { m.email = String(l[rr]); continue }
            if m.phone.isEmpty, let x = phoneRx?.firstMatch(in: l, range: r), let rr = Range(x.range, in: l), l.filter(\.isNumber).count >= 10 { m.phone = String(l[rr]); continue }
            if l.lowercased().contains("www.") || l.lowercased().hasPrefix("http") { continue }
            rest.append(l)
        }
        func words(_ s: String) -> [String] { s.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty } }
        if let t = rest.first(where: { words($0).contains(where: titleWords.contains) }) { m.title = t; rest.removeAll { $0 == t } }
        if let c = rest.first(where: { words($0).contains(where: coWords.contains) }) { m.company = c; rest.removeAll { $0 == c } }
        // a name: two to four words, mostly letters, no digits
        if let n = rest.first(where: { l in
            let w = l.split(separator: " ")
            return (2...4).contains(w.count) && !l.contains(where: \.isNumber) && w.allSatisfy { $0.first?.isUppercase == true }
        }) { m.name = n; rest.removeAll { $0 == n } }
        if m.company.isEmpty, let dom = m.email.split(separator: "@").last?.split(separator: ".").first,
           !["gmail", "yahoo", "outlook", "hotmail", "icloud", "aol", "me", "proton"].contains(dom.lowercased()) {
            m.company = dom.prefix(1).uppercased() + dom.dropFirst()
        }
        if m.company.isEmpty, let c = rest.first { m.company = c }
        return m
    }

    /// Reads the text in an image, top to bottom.
    static func text(in image: CGImage) async -> [String] {
        await Task.detached(priority: .userInitiated) { () -> [String] in
            let req = VNRecognizeTextRequest()
            req.recognitionLevel = .accurate
            req.usesLanguageCorrection = false
            try? VNImageRequestHandler(cgImage: image).perform([req])
            let obs = req.results ?? []
            return obs.sorted { $0.boundingBox.minY > $1.boundingBox.minY }.compactMap { $0.topCandidates(1).first?.string }
        }.value
    }
}

#if !targetEnvironment(macCatalyst)
/// The system document camera, which finds the card's edges and flattens it.
struct CardScanner: UIViewControllerRepresentable {
    let done: ([String]?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(done: done) }
    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let vc = VNDocumentCameraViewController()
        vc.delegate = context.coordinator
        return vc
    }
    func updateUIViewController(_ vc: VNDocumentCameraViewController, context: Context) {}

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let done: ([String]?) -> Void
        init(done: @escaping ([String]?) -> Void) { self.done = done }
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            guard scan.pageCount > 0, let cg = scan.imageOfPage(at: 0).cgImage else { done(nil); return }
            Task { @MainActor in
                let lines = await CardParser.text(in: cg)
                self.done(lines)
            }
        }
        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { done(nil) }
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) { done(nil) }
    }
}
#endif
