import SwiftUI

// Capture: the pipeline across your pursuits, the one-page PDF for a pursuit, call plans,
// and conference attendee lists. The engine (src/engine.js) does the matching; these are
// the screens.

// MARK: - money

enum Money {
    /// 1840000 as "$1.8M", the way the engine writes it.
    static func text(_ n: Double) -> String {
        let v = max(0, n)
        if v >= 1e9 { return "$" + trim(v / 1e9, v >= 1e11 ? 0 : 1) + "B" }
        if v >= 1e6 { return "$" + trim(v / 1e6, v >= 1e8 ? 0 : 1) + "M" }
        if v >= 1e3 { return "$" + String(Int((v / 1e3).rounded())) + "K" }
        return "$" + String(Int(v.rounded()))
    }

    private static func trim(_ v: Double, _ digits: Int) -> String {
        let s = String(format: "%.\(digits)f", v)
        return s.hasSuffix(".0") ? String(s.dropLast(2)) : s
    }
}

// MARK: - engine shapes

struct PipelineData: Decodable {
    struct Stage: Decodable, Hashable, Identifiable {
        var stage: String
        var count: Int
        var value: Double?
        var weighted: Double?
        var valueText: String
        var weightedText: String
        var id: String { stage }
    }
    struct Total: Decodable { var count: Int; var value: Double?; var weighted: Double?; var valueText: String?; var weightedText: String? }
    struct Row: Decodable, Hashable, Identifiable {
        var owner: String
        var mine: Bool
        var id: String
        var name: String
        var agency: String?
        var stage: String
        var due: String?
        var value: String?
        var amount: Double
        var pwin: Double?
        var closed: String?
        var weighted: Double?
        var key: String { owner + "|" + (id.isEmpty ? name : id) }
    }
    var stages: [Stage]
    var open: Total
    var won: Total
    var lost: Total
    var winRate: Int?
    var dueThisQuarter: Total
    var history: [Row]
    var rows: [Row]
    var quarters: [PipelineQuarter]?
    var withTeam: Bool?
    var hasTeam: Bool?
    var unpriced: Int?
}

struct PursuitSheetData: Decodable {
    struct Who: Decodable, Hashable { var name: String; var detail: String?; var last: String? }
    struct Seat: Decodable, Hashable { var role: String; var side: String?; var owner: String?; var cold: Bool?; var people: [Who]; var status: String }
    struct Best: Decodable, Hashable { var name: String; var why: String }
    struct Mate: Decodable, Hashable { var name: String; var detail: String? }
    var title: String
    var made: String?
    var facts: [[String]]
    var seats: [Seat]
    var best: [Best]
    var team: [Mate]?
    var note: String?
    var cold: Int?
    var footer: String
}

struct CallPlan: Decodable {
    var k: String
    var name: String
    var pursuit: String?
    var seat: String?
    var facts: [String]
    var plan: String
    var prompt: String
}

/// Who to plan a call with, and for which pursuit (nil: the engine picks their open one).
struct CallPlanTarget: Identifiable, Hashable {
    let k: String
    var pursuitId: String?
    var id: String { k + "|" + (pursuitId ?? "") }
}

struct AttendeeMatch: Decodable, Identifiable {
    struct Known: Decodable, Hashable, Identifiable { var k: String; var name: String; var p: String?; var band: String?; var score: Double?; var c: String?; var id: String { k } }
    struct Company: Decodable, Hashable, Identifiable {
        struct Who: Decodable, Hashable { var name: String; var p: String? }
        var company: String
        var count: Int
        var people: [Who]
        var known: Int
        var target: Bool
        var id: String { company }
    }
    var event: String
    var rows: Int
    var known: [Known]
    var knownCount: Int
    var newCount: Int
    var companies: [Company]
    var added: Int?
    var id: String { event + "|\(rows)" }
}

extension AppModel {
    func pipeline(withTeam: Bool) async -> PipelineData? { try? await engine.call("pipeline", [withTeam], as: PipelineData?.self) }
    func pursuitSheet(_ id: String) async -> PursuitSheetData? { try? await engine.call("pursuitSheet", [id], as: PursuitSheetData?.self) }
    func callPlan(_ k: String, pursuitId: String?) async -> CallPlan? {
        try? await engine.call("callPlan", [k, pursuitId.map { $0 as Any } ?? NSNull()], as: CallPlan?.self)
    }

    /// Reads an attendee list (CSV) for an event. Throws a plain-English error when it has no name columns.
    func matchAttendeeList(_ text: String, event: String) async throws -> AttendeeMatch {
        let m = try await engine.call("matchAttendeeList", [text, event], as: AttendeeMatch.self)
        // people you don't know yet are kept as prospects, for org charts
        if (m.added ?? 0) > 0 { await saveFile("prospects", "prospects.json") }
        return m
    }

    /// Tags people with the event's name. Returns how many were tagged.
    func tagAttendees(_ keys: [String], event: String) async -> Int {
        struct Tagged: Decodable { var tagged: Int }
        let n = (try? await engine.call("tagAttendees", [keys, event], as: Tagged.self))?.tagged ?? 0
        if n > 0 {
            await saveFile("edits", "edits.json")
            await refreshAll()
        }
        return n
    }
}

// MARK: - pipeline

struct PipelineView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("pipelineWithTeam") private var withTeam = true
    @State private var data: PipelineData?

    var body: some View {
        List {
            if let p = data {
                Section {
                    header(p)
                    if p.hasTeam == true {
                        Toggle(isOn: $withTeam) { Label("Include team", systemImage: "person.3") }
                            .font(Theme.geist(.subheadline, .semibold))
                    }
                }
                Section {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 18) { stats(p) }
                        VStack(alignment: .leading, spacing: 10) { stats(p) }
                    }
                    .padding(.vertical, 4)
                }
                let maxValue = max(1, p.stages.map { $0.value ?? 0 }.max() ?? 1)
                Section("By stage") {
                    ForEach(p.stages) { s in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(s.stage).font(Theme.geist(.subheadline, .semibold))
                                Text("\(s.count)").font(Theme.mono(.footnote)).foregroundStyle(.secondary)
                                Spacer()
                                Text(s.valueText).font(Theme.mono(.footnote, .semibold))
                                if s.stage != "Won" && s.stage != "Lost" {
                                    Text("\(s.weightedText) weighted").font(Theme.geist(.caption)).foregroundStyle(.secondary)
                                }
                            }
                            GeometryReader { g in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(Theme.hairline)
                                    Capsule().fill(color(s.stage).opacity(0.35)).frame(width: g.size.width * CGFloat(min(1, (s.value ?? 0) / maxValue)))
                                    Capsule().fill(color(s.stage)).frame(width: g.size.width * CGFloat(min(1, (s.weighted ?? 0) / maxValue)))
                                }
                            }
                            .frame(height: 6)
                        }
                        .padding(.vertical, 2)
                    }
                }
                if let q = p.quarters, !q.isEmpty { QuarterSection(quarters: q) }
                let open = p.rows.filter { $0.stage != "Won" && $0.stage != "Lost" }
                if !open.isEmpty {
                    Section("Open, biggest weighted first") {
                        ForEach(open, id: \.key) { r in row(r) }
                    }
                }
                if !p.history.isEmpty {
                    Section("Won and lost") {
                        ForEach(p.history, id: \.key) { r in row(r) }
                    }
                }
                Section {
                    Text(footer(p)).font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Pipeline")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(model.pursuitsRev)-\(model.info.rev)-\(TeamSync.shared.rev)-\(withTeam)") { data = await model.pipeline(withTeam: withTeam) }
    }

    private func header(_ p: PipelineData) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("OPEN PIPELINE").font(Theme.eyebrow).tracking(1.1).foregroundStyle(Theme.text2)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(p.open.weightedText ?? "$0").font(Theme.serif(.largeTitle, .semibold))
                Text("weighted").font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
            }
            Text("\(p.open.valueText ?? "$0") across \(p.open.count) open \(p.open.count == 1 ? "pursuit" : "pursuits"), weighted by the chance of winning each.")
                .font(Theme.geist(.footnote)).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder private func stats(_ p: PipelineData) -> some View {
        stat(p.dueThisQuarter.weightedText ?? "$0", "due this quarter (\(p.dueThisQuarter.count))")
        stat(p.winRate.map { "\($0)%" } ?? "None yet", "win rate")
        stat("\(p.won.count)", "won, \(p.won.valueText ?? "$0")")
        stat("\(p.lost.count)", "lost, \(p.lost.valueText ?? "$0")")
    }

    private func stat(_ v: String, _ l: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(v).font(Theme.mono(.title3, .semibold))
            Text(l).font(Theme.geist(.caption)).foregroundStyle(.secondary)
        }
    }

    private func color(_ stage: String) -> Color {
        switch stage {
        case "Won": return Theme.good
        case "Lost": return Theme.bad
        case "Submitted", "Proposal": return Theme.accent
        default: return Theme.info
        }
    }

    @ViewBuilder private func row(_ r: PipelineData.Row) -> some View {
        let content = VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Text(r.name).font(Theme.geist(.subheadline, .semibold)).lineLimit(2)
                Spacer()
                Text(r.amount > 0 ? Money.text(r.amount) : "No value").font(Theme.mono(.footnote, .semibold)).foregroundStyle(r.amount > 0 ? Color.primary : Color.secondary)
            }
            Text(detail(r)).font(Theme.geist(.caption)).foregroundStyle(.secondary).lineLimit(2)
        }
        if r.mine && !r.id.isEmpty {
            NavigationLink(value: Route.pursuit(r.id)) { content }
        } else {
            content
        }
    }

    private func detail(_ r: PipelineData.Row) -> String {
        var parts: [String] = [r.agency ?? "", r.stage].filter { !$0.isEmpty }
        if r.stage == "Won" || r.stage == "Lost" {
            if let c = r.closed, !c.isEmpty { parts.append("decided \(Day.nice(c))") }
        } else {
            if let pw = r.pwin, pw.isFinite { parts.append("\(Int(pw.rounded()))%") }
            if let w = r.weighted, w > 0 { parts.append("\(Money.text(w)) weighted") }
            if let due = r.due, !due.isEmpty { parts.append("due \(Day.nice(due))") }
        }
        if !r.mine { parts.append("via \(r.owner)") }
        return parts.joined(separator: " · ")
    }

    private func footer(_ p: PipelineData) -> String {
        var s = "Weighted value is the value times the win chance. A pursuit without its own win chance uses the typical one for its stage."
        if let n = p.unpriced, n > 0 {
            s += " \(n) \(n == 1 ? "pursuit has" : "pursuits have") no value yet, so \(n == 1 ? "it counts" : "they count") as $0. Add a value like $2.4M."
        }
        if p.withTeam == true { s += " Includes pursuits your teammates shared." }
        return s
    }
}

// MARK: - the one-pager

/// One pursuit on one page, for a gate review: facts, every seat, ways in.
struct PursuitSheetDocument: View {
    let s: PursuitSheetData

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("PURSUIT").font(.custom("GeistMono-SemiBold", fixedSize: 10)).foregroundStyle(Color(hex: "#B07400"))
                    Text(s.title).font(.custom("Geist-Bold", fixedSize: 24)).foregroundStyle(.black)
                    Text(Day.nice(s.made ?? Day.today)).font(.custom("Geist-Regular", fixedSize: 11)).foregroundStyle(.black.opacity(0.6))
                }
                Spacer()
                Image("BrandMark").resizable().scaledToFit().frame(width: 34, height: 34)
            }
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(s.facts.enumerated()), id: \.offset) { _, f in
                    if f.count >= 2 {
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text(f[0]).font(.custom("Geist-Medium", fixedSize: 10)).foregroundStyle(.black.opacity(0.55)).frame(width: 140, alignment: .leading)
                            Text(f[1]).font(.custom("Geist-Regular", fixedSize: 11)).foregroundStyle(.black)
                        }
                    }
                }
            }
            if let c = s.cold, c > 0 {
                Text(c == 1 ? "1 seat is going cold." : "\(c) seats are going cold.")
                    .font(.custom("Geist-Medium", fixedSize: 11)).foregroundStyle(Color(hex: "#2F5BC7"))
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(hex: "#E9EFF9"), in: RoundedRectangle(cornerRadius: 8))
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("SEATS").font(.custom("GeistMono-SemiBold", fixedSize: 10)).foregroundStyle(.black.opacity(0.55))
                ForEach(Array(s.seats.enumerated()), id: \.offset) { _, seat in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Circle().fill(seat.cold == true ? Color(hex: "#3E6FE8") : seat.people.isEmpty ? Color(hex: "#C77700") : Color(hex: "#11946F")).frame(width: 7, height: 7)
                            Text(seat.role + (seat.side == "industry" ? " (industry)" : "")).font(.custom("Geist-SemiBold", fixedSize: 12)).foregroundStyle(.black)
                            if let o = seat.owner, !o.isEmpty {
                                Text("Owner: \(o)").font(.custom("Geist-Regular", fixedSize: 10)).foregroundStyle(.black.opacity(0.55))
                            }
                            Spacer()
                            Text(seat.status).font(.custom("Geist-Regular", fixedSize: 10)).foregroundStyle(.black.opacity(0.6)).lineLimit(2).multilineTextAlignment(.trailing)
                        }
                        ForEach(Array(seat.people.enumerated()), id: \.offset) { _, w in
                            Text(Self.line(w))
                                .font(.custom("Geist-Regular", fixedSize: 10)).foregroundStyle(.black.opacity(0.7)).lineLimit(1)
                                .padding(.leading, 15)
                        }
                    }
                }
            }
            if !s.best.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("WARMEST WAYS IN").font(.custom("GeistMono-SemiBold", fixedSize: 10)).foregroundStyle(.black.opacity(0.55))
                    ForEach(Array(s.best.prefix(6).enumerated()), id: \.offset) { _, b in
                        Text("\(b.name). \(b.why)").font(.custom("Geist-Regular", fixedSize: 10)).foregroundStyle(.black.opacity(0.75)).lineLimit(2)
                    }
                }
            }
            if let team = s.team, !team.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("THROUGH YOUR TEAM").font(.custom("GeistMono-SemiBold", fixedSize: 10)).foregroundStyle(.black.opacity(0.55))
                    ForEach(Array(team.enumerated()), id: \.offset) { _, m in
                        Text([m.name, m.detail ?? ""].filter { !$0.isEmpty }.joined(separator: ". ")).font(.custom("Geist-Regular", fixedSize: 10)).foregroundStyle(.black.opacity(0.75))
                    }
                }
            }
            if let n = s.note, !n.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("NOTES").font(.custom("GeistMono-SemiBold", fixedSize: 10)).foregroundStyle(.black.opacity(0.55))
                    Text(n).font(.custom("Geist-Regular", fixedSize: 10)).foregroundStyle(.black.opacity(0.75))
                }
            }
            Divider()
            Text(s.footer).font(.custom("Geist-Regular", fixedSize: 9)).foregroundStyle(.black.opacity(0.45))
        }
        .padding(36)
        .frame(width: 612, alignment: .leading)
        .background(Color.white)
        .environment(\.colorScheme, .light)
    }

    static func line(_ w: PursuitSheetData.Who) -> String {
        var parts = [w.name]
        if let d = w.detail, !d.isEmpty { parts.append(d) }
        if let l = w.last, !l.isEmpty { parts.append("last in touch " + l) }
        return parts.joined(separator: " · ")
    }

    @MainActor static func pdf(_ s: PursuitSheetData) -> URL? {
        let renderer = ImageRenderer(content: PursuitSheetDocument(s: s))
        let safe = s.title.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(safe) one-pager.pdf")
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

// MARK: - call plan

/// A short plan before a call: written by the on-device model when there is one, else the engine's plan.
struct CallPlanSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let k: String
    var pursuitId: String?
    @State private var plan: CallPlan?
    @State private var aiText: String?
    @State private var loading = true

    var body: some View {
        NavigationStack {
            List {
                if let plan {
                    Section {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(plan.name).font(Theme.serif(.title2, .semibold))
                            let sub = [plan.seat ?? "", plan.pursuit ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
                            if !sub.isEmpty { Text(sub).font(Theme.geist(.subheadline)).foregroundStyle(.secondary) }
                        }
                        .listRowBackground(Color.clear)
                    }
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 6) {
                                Image(systemName: Brief.aiAvailable ? "apple.intelligence" : "list.bullet.clipboard")
                                    .foregroundStyle(Brief.aiAvailable ? AnyShapeStyle(LinearGradient(colors: [Theme.amber, Theme.violet, Theme.info], startPoint: .leading, endPoint: .trailing)) : AnyShapeStyle(Theme.accent))
                                Text("Call plan").font(Theme.geist(.footnote, .semibold)).foregroundStyle(Theme.text2)
                                Spacer()
                                if loading { ProgressView().controlSize(.small) }
                            }
                            Text(text(plan))
                                .font(Theme.geist(.body))
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)
                                .contentTransition(.opacity)
                                .animation(.smooth, value: aiText)
                        }
                        .padding(.vertical, 4)
                    } footer: {
                        Text(Brief.aiAvailable ? "Written on this device from what Northfix knows. Nothing leaves your device." : "Made from what Northfix knows about them. Nothing leaves your device.")
                    }
                    Section("What Northfix knows") {
                        ForEach(Array(plan.facts.enumerated()), id: \.offset) { _, f in
                            Text(f).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                        }
                    }
                    Section {
                        Button { dismiss(); model.open(.person(plan.k)) } label: { Label("Open profile", systemImage: "person.crop.circle") }
                    }
                } else if loading {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Text("No plan for this person.").foregroundStyle(.secondary)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Call plan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                if let plan {
                    ToolbarItem(placement: .topBarLeading) {
                        ShareLink(item: "\(plan.name)\n\n\(text(plan))") { Image(systemName: "square.and.arrow.up") }
                            .accessibilityLabel("Share the plan")
                    }
                }
            }
            .task(id: k + (pursuitId ?? "")) {
                loading = true
                plan = await model.callPlan(k, pursuitId: pursuitId)
                if let p = plan, Brief.aiAvailable {
                    aiText = await Brief.callPlan(p.prompt, key: p.k + "|" + (pursuitId ?? "") + "|" + p.facts.joined())
                }
                loading = false
            }
        }
    }

    private func text(_ p: CallPlan) -> String { aiText ?? p.plan }
}

// MARK: - attendee lists

/// An event's attendee list, matched: who you know, and who's new by company.
struct AttendeeListSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let match: AttendeeMatch
    @State private var tagged: Int?
    @State private var tagging = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(match.event.isEmpty ? "Attendee list" : match.event).font(Theme.serif(.title2, .semibold))
                        Text("\(match.rows) on the list. You know \(match.knownCount). \(match.newCount) new.")
                            .font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                    }
                    .listRowBackground(Color.clear)
                }
                if match.knownCount > 0 && !match.event.isEmpty {
                    Section {
                        if let tagged {
                            Label(tagged == 0 ? "Already tagged." : "Tagged \(tagged) with \(match.event).", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(Theme.good)
                        } else {
                            Button {
                                tagging = true
                                Task {
                                    tagged = await model.tagAttendees(match.known.map(\.k), event: match.event)
                                    tagging = false
                                    Haptic.success()
                                }
                            } label: {
                                HStack {
                                    Label("Tag the \(match.knownCount) you know with \(match.event)", systemImage: "tag")
                                    Spacer()
                                    if tagging { ProgressView() }
                                }
                            }
                            .disabled(tagging)
                        }
                    } footer: {
                        Text("The tag makes a list you can filter by in People.")
                    }
                }
                if !match.known.isEmpty {
                    Section("You know \(match.knownCount)") {
                        ForEach(match.known) { w in
                            if let p = model.person(w.k) {
                                Button { dismiss(); model.open(.person(w.k)) } label: { PersonRow(person: p, lens: model.info.lens) }
                                    .buttonStyle(.plain)
                            }
                        }
                    }
                }
                if !match.companies.isEmpty {
                    Section {
                        ForEach(match.companies) { c in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 6) {
                                    Text(c.company).font(Theme.geist(.subheadline, .semibold))
                                    if c.target { Image(systemName: "star.fill").font(.caption2).foregroundStyle(Theme.amber).accessibilityLabel("On your watchlist") }
                                    Spacer()
                                    Text("\(c.count) new").font(Theme.mono(.footnote)).foregroundStyle(.secondary)
                                }
                                Text(c.people.map { [$0.name, $0.p ?? ""].filter { !$0.isEmpty }.joined(separator: ", ") }.joined(separator: "; "))
                                    .font(Theme.geist(.footnote)).foregroundStyle(.secondary).lineLimit(3)
                                if c.known > 0 {
                                    Text("You already know \(c.known) there").font(Theme.geist(.caption, .semibold)).foregroundStyle(Theme.good)
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    } header: {
                        Text("New, by company")
                    } footer: {
                        Text((match.added ?? 0) > 0 ? "Northfix keeps the \(match.added ?? 0) new people with a company on this device, so they fill gaps on org charts." : "Read on this device. Nothing is uploaded.")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Attendee list")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
