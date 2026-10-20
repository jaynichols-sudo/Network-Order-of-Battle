import SwiftUI

// Capture, round 2: key dates and the bid/no-bid scorecard on a pursuit, the fiscal year, the
// weekly capture digest and competitors. The engine (src/engine.js) does the work; these are
// the screens.

/// One key date as the engine sends it: the next one on a pursuit, or one in a list.
struct KeyDate: Decodable, Hashable {
    var kind: String
    var label: String
    var date: String
    var days: Int
    /// "Questions due in 6 days", "Orals tomorrow".
    var line: String {
        let when = days == 0 ? "today" : days == 1 ? "tomorrow" : days < 0 ? "\(-days) days ago" : "in \(days) days"
        return "\(label) \(when)"
    }
}

/// A slot for a key date on a pursuit; `date` is empty when it isn't set.
struct DateSlot: Decodable, Hashable, Identifiable {
    var kind: String
    var label: String
    var date: String
    var id: String { kind }
}

/// "FY27 Q4", and whether it's the end-of-year quarter.
struct Fiscal: Decodable, Hashable {
    var fy: Int
    var q: Int
    var label: String
    var q4: Bool
}

struct BidDecision: Decodable, Hashable {
    struct Question: Decodable, Hashable, Identifiable {
        var key: String
        var text: String
        var answer: String
        var mine: String
        var suggested: String
        var why: String
        var id: String { key }
    }
    var id: String
    var name: String
    var questions: [Question]
    var score: Int?
    var answered: Int
    var call: String
    var why: String
}

struct CaptureDigest: Decodable {
    struct Part: Decodable, Hashable { var title: String; var lines: [String] }
    var date: String
    var head: String
    var sections: [Part]
    var text: String
    var empty: Bool
}

struct CompetitorInfo: Decodable, Identifiable, Hashable {
    struct Mini: Decodable, Hashable, Identifiable { var k: String; var name: String; var p: String; var band: String; var score: Double; var id: String { k } }
    struct Ref: Decodable, Hashable { var id: String; var name: String }
    var name: String
    var known: Int
    var people: [Mini]
    var joined: [Mini]
    var pursuits: [Ref]
    var line: String
    var id: String { name }
}

extension AppModel {
    func setPursuitDate(_ id: String, kind: String, date: Date?) async {
        _ = try? await engine.call("setPursuitDate", [id, kind, date.map { Day.fmt.string(from: $0) } ?? ""], as: PursuitSummaryLite?.self)
        await savePursuits()
    }

    func setBidAnswer(_ id: String, key: String, answer: String) async {
        _ = try? await engine.call("setBidAnswer", [id, key, answer], as: BidDecision?.self)
        await savePursuits()
    }

    func captureDigest() async -> CaptureDigest? {
        let awards = AwardFeed.shared.pages
        let notices = SamFeed.shared.match?.items.map { ["isNew": $0.isNew ?? false, "agency": $0.agency, "title": $0.title, "due": $0.due ?? ""] as [String: Any] } ?? []
        var opts: [String: Any] = ["notices": notices]
        if let d = try? JSONEncoder().encode(awards), let o = try? JSONSerialization.jsonObject(with: d) { opts["awards"] = o }
        return try? await engine.call("captureDigest", [opts], as: CaptureDigest.self)
    }

    func competitors() async -> [CompetitorInfo] { (try? await engine.call("competitors", as: [CompetitorInfo].self)) ?? [] }

    func setCompetitor(_ name: String, on: Bool) async {
        _ = try? await engine.call("setCompetitor", [name, on], as: JSONValue.self)
        Haptic.tap()
        show(on ? "Marked \(name) as a competitor" : "\(name) is no longer marked as a competitor")
        await saveFile("targets", "targets.json")
        await refreshSummary()
    }
}

/// "Q4: end of year money": July to September, when agencies award the most.
struct Q4Badge: View {
    var body: some View {
        Text("Q4")
            .font(Theme.geist(.caption2, .semibold))
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(Theme.accent.opacity(0.12), in: Capsule())
            .accessibilityLabel("Fiscal fourth quarter, end of year money")
    }
}

/// A small "Competitor" pill.
struct CompetitorBadge: View {
    var body: some View {
        Label("Competitor", systemImage: "flag.2.crossed")
            .font(Theme.geist(.caption2, .semibold))
            .foregroundStyle(Theme.needs)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(Theme.needsSoft, in: Capsule())
    }
}

/// Industry day, questions due, RFPs, proposal due, orals and award on a pursuit.
struct KeyDatesSection: View {
    @Environment(AppModel.self) private var model
    let pursuitId: String
    let slots: [DateSlot]
    var reload: () async -> Void

    var body: some View {
        Section {
            ForEach(slots) { s in
                if let date = Day.date(s.date) {
                    HStack {
                        DatePicker(s.label, selection: Binding(get: { date }, set: { v in Task { await model.setPursuitDate(pursuitId, kind: s.kind, date: v); await reload() } }),
                                   displayedComponents: .date)
                        Button { Task { await model.setPursuitDate(pursuitId, kind: s.kind, date: nil); await reload() } } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Clear \(s.label)")
                    }
                } else {
                    Button {
                        Task { await model.setPursuitDate(pursuitId, kind: s.kind, date: Calendar.current.date(byAdding: .day, value: 14, to: Date())); await reload() }
                    } label: {
                        HStack {
                            Text(s.label).foregroundStyle(.primary)
                            Spacer()
                            Label("Add", systemImage: "plus.circle").labelStyle(.titleAndIcon).font(Theme.geist(.subheadline))
                        }
                    }
                }
            }
        } header: {
            Text("Key dates")
        } footer: {
            Text("The next date shows on the pursuit list and in the weekly digest. Proposal due is the pursuit’s due date.")
        }
    }
}

/// The bid/no-bid scorecard: each question with your answer or Northfix's suggestion.
struct BidSection: View {
    @Environment(AppModel.self) private var model
    let pursuitId: String
    let bid: BidDecision
    var reload: () async -> Void

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(bid.call).font(Theme.geist(.headline)).foregroundStyle(color)
                    Spacer()
                    if let s = bid.score { Text("\(s) of 100").font(Theme.mono(.footnote, .semibold)).foregroundStyle(.secondary) }
                }
                Text(bid.why).font(Theme.geist(.footnote)).foregroundStyle(.secondary)
            }
            .padding(.vertical, 2)
            ForEach(bid.questions) { q in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(q.text).font(Theme.geist(.subheadline))
                        Spacer(minLength: 8)
                        Menu {
                            Button { set(q, "") } label: {
                                let t = q.suggested.isEmpty ? "Not answered" : "Suggested: \(word(q.suggested))"
                                if q.mine.isEmpty { Label(t, systemImage: "checkmark") } else { Text(t) }
                            }
                            ForEach(["yes", "maybe", "no"], id: \.self) { a in
                                Button { set(q, a) } label: { if q.mine == a { Label(word(a), systemImage: "checkmark") } else { Text(word(a)) } }
                            }
                        } label: {
                            Text(q.answer.isEmpty ? "Answer" : word(q.answer))
                                .font(Theme.geist(.subheadline, .semibold))
                                .foregroundStyle(q.answer == "no" ? Theme.needs : q.answer == "yes" ? Theme.good : Theme.accent)
                        }
                        .buttonStyle(.borderless)
                    }
                    if q.mine.isEmpty, !q.why.isEmpty {
                        Text("Suggested from your network: \(q.why)").font(Theme.geist(.caption)).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 2)
            }
        } header: {
            Text("Bid or no bid")
        } footer: {
            Text("Northfix suggests answers from your own data. Pick an answer to overrule it.")
        }
    }

    private var color: Color { bid.call == "Bid" ? Theme.good : bid.call == "No bid" ? Theme.needs : Theme.accent }
    private func word(_ a: String) -> String { a == "yes" ? "Yes" : a == "no" ? "No" : a == "maybe" ? "Maybe" : a }
    private func set(_ q: BidDecision.Question, _ a: String) { Task { Haptic.tap(); await model.setBidAnswer(pursuitId, key: q.key, answer: a); await reload() } }
}

/// The weekly capture digest, ready to copy or share.
struct CaptureDigestSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var d: CaptureDigest?

    var body: some View {
        NavigationStack {
            List {
                if let d {
                    Section { Text(d.head).font(Theme.geist(.subheadline, .semibold)) }
                    if d.empty {
                        Section { Text("Nothing needs attention this week. Add key dates and fill seats on your pursuits to see them here.").foregroundStyle(.secondary) }
                    }
                    ForEach(d.sections, id: \.title) { s in
                        Section(s.title) {
                            ForEach(s.lines, id: \.self) { Text($0).font(Theme.geist(.subheadline)) }
                        }
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("Weekly digest")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                if let d {
                    ToolbarItem(placement: .primaryAction) { ShareLink(item: d.text) { Label("Share", systemImage: "square.and.arrow.up") } }
                }
            }
            .task { d = await model.captureDigest() }
        }
    }
}

/// Fiscal quarters on the pipeline: open value by the quarter it's due in.
struct PipelineQuarter: Decodable, Hashable {
    var label: String
    var q4: Bool
    var count: Int
    var value: Double?
    var weighted: Double?
    var valueText: String
    var weightedText: String
}

struct QuarterSection: View {
    let quarters: [PipelineQuarter]

    var body: some View {
        Section {
            ForEach(quarters, id: \.label) { q in
                HStack(alignment: .firstTextBaseline) {
                    Text(q.label).font(Theme.geist(.subheadline, .semibold))
                    if q.q4 { Q4Badge() }
                    Text("\(q.count)").font(Theme.mono(.footnote)).foregroundStyle(.secondary)
                    Spacer()
                    Text(q.valueText).font(Theme.mono(.footnote, .semibold))
                    Text("\(q.weightedText) weighted").font(Theme.geist(.caption)).foregroundStyle(.secondary)
                }
            }
        } header: {
            Text("By fiscal quarter")
        } footer: {
            Text("The federal fiscal year starts October 1. Q4, July to September, is when agencies award the most.")
        }
    }
}

/// Competitors on the Companies screen: who you know at each, and who joined lately.
struct CompetitorsSection: View {
    @Environment(AppModel.self) private var model
    @State private var list: [CompetitorInfo] = []

    var body: some View {
        Group {
            if !list.isEmpty {
                Section {
                    ForEach(list) { c in
                        NavigationLink(value: Route.unit(c.name)) {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack { Text(c.name).font(Theme.geist(.body, .semibold)); CompetitorBadge() }
                                Text(c.line).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                                if !c.pursuits.isEmpty {
                                    Text("On \(c.pursuits.map(\.name).joined(separator: ", "))").font(Theme.geist(.footnote)).foregroundStyle(Theme.needs)
                                }
                            }
                        }
                        .swipeActions { Button { Task { await model.setCompetitor(c.name, on: false); list = await model.competitors() } } label: { Label("Not a competitor", systemImage: "flag.slash") } }
                    }
                } header: {
                    Text("Competitors")
                } footer: {
                    Text("Who you know at each competitor, and who joined in the last six months.")
                }
            }
        }
        .task(id: model.targets.map { "\($0.name)\($0.competitor == true)" }.joined()) { list = await model.competitors() }
    }
}
