import SwiftUI

struct IntroPaths: Decodable {
    struct Alum: Decodable, Identifiable { var k: String; var was: String; var until: String; var id: String { k } }
    struct Best: Decodable, Identifiable { var k: String; var why: String; var id: String { k } }
    var company: String
    var ind: String
    var now: [String]
    var alumni: [Alum]
    var sector: [String]
    var best: [Best]
}

/// "Who can get me into X?" Your best paths into a company, warmest first.
struct IntroFinderView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State var query: String
    @State private var paths: IntroPaths?
    @State private var suggestions: [NameCount] = []
    @State private var writingTo: String?

    var body: some View {
        NavigationStack {
            List {
                if let p = paths, !query.isEmpty {
                    results(p)
                } else {
                    Section {
                        Text("Type a company, agency or command. Bearings finds who works there now, who used to, and who you’re close to nearby in the same field.")
                            .font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                    }
                    if !suggestions.isEmpty {
                        Section("Suggestions") {
                            ForEach(suggestions) { s in
                                Button { query = s.name } label: {
                                    HStack { Text(s.name).foregroundStyle(.primary); Spacer(); Text(s.count.formatted()).font(Theme.mono(.footnote)).foregroundStyle(.secondary) }
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Find a way in")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Company, like Dominion Energy")
            .autocorrectionDisabled()
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .navigationDestination(for: Route.self) { r in
                if case .person(let k) = r { ProfileView(k: k) } else if case .about(let k) = r { PersonAboutView(k: k) }
            }
            .task(id: query) {
                try? await Task.sleep(nanoseconds: 250_000_000)
                if Task.isCancelled { return }
                suggestions = query.count >= 2 ? Array(await model.addCandidates(query).prefix(6)) : []
                paths = query.count >= 2 ? await model.introPaths(query) : nil
            }
            .sheet(item: Binding(get: { writingTo.map { Wrapped(id: $0) } }, set: { writingTo = $0?.id })) { w in MessageSheet(k: w.id, intro: paths?.company ?? query) }
        }
    }

    struct Wrapped: Identifiable { let id: String }

    @ViewBuilder private func results(_ p: IntroPaths) -> some View {
        if p.now.isEmpty && p.alumni.isEmpty && p.sector.isEmpty {
            Section {
                ContentUnavailableView("No paths yet", systemImage: "point.3.connected.trianglepath.dotted",
                                       description: Text("No one in your network works or worked at “\(query)”. Try a shorter name."))
            }
        } else {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(p.company).font(Theme.geist(.title2, .bold))
                    Text(summary(p)).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                }
                .listRowBackground(Color.clear)
            }
            if !p.best.isEmpty {
                Section("Best ways in") {
                    ForEach(p.best) { b in
                        if let person = model.person(b.k) {
                            VStack(alignment: .leading, spacing: 8) {
                                NavigationLink(value: Route.person(b.k)) { PersonRow(person: person, lens: model.info.lens) }
                                Text(b.why).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                                Button { writingTo = b.k } label: { Label("Ask for an intro", systemImage: "square.and.pencil") }
                                    .font(Theme.geist(.subheadline, .semibold))
                                    .glassButton()
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            }
            peopleSection("Work there now", p.now)
            if !p.alumni.isEmpty {
                Section("Used to work there") {
                    ForEach(p.alumni) { a in
                        if let person = model.person(a.k) {
                            NavigationLink(value: Route.person(a.k)) {
                                VStack(alignment: .leading, spacing: 2) {
                                    PersonRow(person: person, lens: model.info.lens)
                                    if !a.was.isEmpty || !a.until.isEmpty {
                                        Text("Was \(a.was.isEmpty ? "there" : a.was)\(a.until.isEmpty ? "" : ", until \(Day.nice(a.until))")")
                                            .font(Theme.geist(.footnote)).foregroundStyle(.secondary).padding(.leading, 58)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            peopleSection(p.ind.isEmpty ? "Close to you nearby" : "Close to you in \(p.ind)", p.sector)
        }
    }

    @ViewBuilder private func peopleSection(_ title: String, _ keys: [String]) -> some View {
        let ps = model.persons(keys)
        if !ps.isEmpty {
            Section("\(title) (\(ps.count))") {
                ForEach(ps) { person in
                    NavigationLink(value: Route.person(person.k)) { PersonRow(person: person, lens: model.info.lens) }
                }
            }
        }
    }

    private func summary(_ p: IntroPaths) -> String {
        var parts: [String] = []
        if !p.now.isEmpty { parts.append("\(p.now.count) there now") }
        if !p.alumni.isEmpty { parts.append("\(p.alumni.count) used to be") }
        if !p.sector.isEmpty { parts.append("\(p.sector.count) close in the same field") }
        return parts.joined(separator: ", ")
    }
}

/// Who you know at one company, by seniority, as a PDF to share or attach to an account.
struct AccountMapDocument: View {
    let u: UnitDetail
    let people: [String: Person]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("ACCOUNT MAP").font(.custom("GeistMono-SemiBold", fixedSize: 10)).foregroundStyle(Color(hex: "#B07400"))
                    Text(u.name).font(.custom("Geist-Bold", fixedSize: 28)).foregroundStyle(.black)
                    Text("\(u.count) people you know · coverage \(u.score) of 100 · \(Day.nice(Day.today))")
                        .font(.custom("Geist-Regular", fixedSize: 11)).foregroundStyle(.black.opacity(0.6))
                }
                Spacer()
                Image("BrandMark").resizable().scaledToFit().frame(width: 34, height: 34)
            }
            if !u.gaps.isEmpty {
                Text("Gaps: " + u.gaps.joined(separator: "; "))
                    .font(.custom("Geist-Medium", fixedSize: 11)).foregroundStyle(Color(hex: "#9A3B3F"))
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(hex: "#FBEDEE"), in: RoundedRectangle(cornerRadius: 8))
            }
            ForEach(u.rungs.filter { !$0.keys.isEmpty }) { r in
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(r.label.uppercased())  \(r.keys.count)").font(.custom("GeistMono-SemiBold", fixedSize: 10)).foregroundStyle(.black.opacity(0.55))
                    ForEach(r.keys.prefix(40), id: \.self) { k in
                        if let p = people[k] { row(p, extra: "") }
                    }
                    if r.keys.count > 40 { Text("and \(r.keys.count - 40) more").font(.custom("Geist-Regular", fixedSize: 10)).foregroundStyle(.black.opacity(0.5)) }
                }
            }
            if let al = u.alumni, !al.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("USED TO WORK THERE  \(al.count)").font(.custom("GeistMono-SemiBold", fixedSize: 10)).foregroundStyle(.black.opacity(0.55))
                    ForEach(al.prefix(25)) { a in
                        if let p = people[a.k] { row(p, extra: a.was.isEmpty ? "" : "was \(a.was)") }
                    }
                }
            }
            Divider()
            Text("Prepared with Bearings. Relationship strength comes from your own LinkedIn messages. Confidential.")
                .font(.custom("Geist-Regular", fixedSize: 9)).foregroundStyle(.black.opacity(0.45))
        }
        .padding(36)
        .frame(width: 612, alignment: .leading)
        .background(Color.white)
        .environment(\.colorScheme, .light)
    }

    private func row(_ p: Person, extra: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Circle().fill(Band.color(p.band)).frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 1) {
                Text(p.fullName).font(.custom("Geist-SemiBold", fixedSize: 12)).foregroundStyle(.black)
                Text([extra.isEmpty ? p.p : extra, p.rx.map { $0.t.isEmpty ? "" : "last message \(Day.nice($0.t))" } ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.custom("Geist-Regular", fixedSize: 10)).foregroundStyle(.black.opacity(0.6)).lineLimit(1)
            }
            Spacer()
            Text(Band.label(p.band)).font(.custom("Geist-Medium", fixedSize: 9)).foregroundStyle(.black.opacity(0.55))
        }
    }

    @MainActor static func pdf(_ u: UnitDetail, model: AppModel) -> URL? {
        var people: [String: Person] = [:]
        for k in u.rungs.flatMap(\.keys) + (u.alumni ?? []).map(\.k) { if let p = model.person(k) { people[k] = p } }
        let renderer = ImageRenderer(content: AccountMapDocument(u: u, people: people))
        let safe = u.name.replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(safe) account map.pdf")
        var ok = false
        renderer.render { size, draw in
            var box = CGRect(origin: .zero, size: size)
            guard let ctx = CGContext(url as CFURL, mediaBox: &box, nil) else { return }
            ctx.beginPDFPage(nil)
            draw(ctx)
            ctx.endPDFPage()
            ctx.closePDF()
            ok = true
        }
        return ok ? url : nil
    }
}
