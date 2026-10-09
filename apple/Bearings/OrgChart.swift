import SwiftUI
import UIKit

// The org chart: everyone you and your team know at a company or agency, laid out by
// level from the top down, with the seats nobody covers called out. LinkedIn doesn't
// share reporting lines, so those come from you: drag someone onto their manager.

struct OrgChart: Decodable {
    struct Card: Decodable, Hashable, Identifiable {
        var k: String
        var name: String
        var p: String
        var sen: String
        var func_: String
        var band: String
        var score: Int
        var src: String
        var owner: String?
        var rt: String
        var e: String?
        var li: String?
        var id: String { k.isEmpty ? "\(src)|\(owner ?? "")|\(name)" : k }
        enum CodingKeys: String, CodingKey { case k, name, p, sen, func_ = "func", band, score, src, owner, rt, e, li }
    }
    struct Level: Decodable, Hashable { var id: String; var people: [Card] }
    struct Func: Decodable, Hashable { var id: String; var n: Int }
    struct Link: Decodable, Hashable { var from: String; var to: String }
    /// A mapped agency's top-level offices (directorates, PEOs, divisions), with the people
    /// you know placed in them. Absent for companies we don't map, and in older engines.
    struct Office: Decodable, Hashable, Identifiable {
        var code: String
        var name: String
        var people: [Card]?
        var filled: Bool?
        var id: String { code }
        var members: [Card] { people ?? [] }
    }
    struct Structure: Decodable, Hashable {
        var agency: String
        var short: String?
        var leader: String?
        var asOf: String?
        var source: String?
        var offices: [Office]?
    }
    var company: String
    var total: Int?
    var known: Int?
    var team: Int?
    var listed: Int?
    var levels: [Level]
    var allLevels: [String]?
    var funcs: [Func]
    var gaps: [String]
    var links: [Link]
    var structure: Structure?
}

extension AppModel {
    func orgChart(_ q: String) async -> OrgChart? { try? await engine.call("orgChart", [q], as: OrgChart.self) }

    func setReportsTo(_ k: String, _ boss: String?) async {
        await edit(k, call: "setReportsTo", [k, boss ?? ""])
    }
}

struct OrgChartView: View {
    @Environment(AppModel.self) private var model
    let name: String
    @State private var chart: OrgChart?
    @State private var dropTarget: String?
    @State private var pickingBossFor: OrgChart.Card?
    @State private var outside: OrgChart.Card?
    @State private var filling = false
    @State private var importing = false
    @State private var allOffices = false

    private static let short: [String: String] = [
        "C-suite / Owner": "Executives", "VP": "Vice presidents", "Director / Head": "Directors and heads",
        "Manager / Lead": "Managers and leads", "Individual contributor": "Individual contributors",
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let c = chart {
                    header(c).cascade(0)
                    if let s = c.structure, let offices = s.offices, !offices.isEmpty {
                        structure(s, offices: offices, chart: c).cascade(1)
                    }
                    ForEach(Array((c.allLevels ?? c.levels.map(\.id)).enumerated()), id: \.element) { i, lv in
                        level(lv, people: c.levels.first { $0.id == lv }?.people ?? [], chart: c)
                            .cascade(i + 2)
                    }
                    Text("LinkedIn doesn’t share who reports to whom. Drag someone onto their manager, or press and hold a card to set it. Only you see this.")
                        .font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
                        .padding(.horizontal, 4)
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
                }
            }
            .padding(16)
            .frame(maxWidth: 900)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg)
        .navigationTitle("Org chart")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(name)-\(model.info.edits)-\(model.info.rev)") { chart = await model.orgChart(name) }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    if ZoomInfo.configured {
                        Button { fill() } label: { Label("Fill empty seats from ZoomInfo", systemImage: "person.crop.rectangle.stack") }
                    }
                    Button { importing = true } label: { Label("Import a ZoomInfo or Seamless file", systemImage: "tablecells.badge.ellipsis") }
                    if (chart?.listed ?? 0) > 0 {
                        Button(role: .destructive) { Task { await model.clearProspects(chart?.company ?? name); chart = await model.orgChart(name) } } label: {
                            Label("Remove people you don’t know", systemImage: "person.crop.circle.badge.minus")
                        }
                    }
                } label: {
                    if filling { ProgressView() } else { Image(systemName: "person.crop.rectangle.stack") }
                }
                .accessibilityLabel("Fill empty seats")
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.commaSeparatedText, .plainText]) { r in
            if case .success(let url) = r { Task { await model.importEnrichment(url); chart = await model.orgChart(name) } }
        }
        .confirmationDialog(outside?.name ?? "", isPresented: Binding(get: { outside != nil }, set: { if !$0 { outside = nil } }), titleVisibility: .visible, presenting: outside) { c in
            Button("Find on LinkedIn") { openLinkedIn(c) }
            Button("Find a way in") { model.introQuery = chart?.company ?? name }
            if let e = c.e, !e.isEmpty { Button("Copy email") { UIPasteboard.general.string = e } }
        } message: { c in
            Text("\(c.p.isEmpty ? "" : c.p + ". ")Not in your network yet. From \(c.owner == "zoominfo" ? "ZoomInfo" : "your imported file").")
        }
        .sheet(item: $pickingBossFor) { card in
            PersonPicker { boss in Task { await model.setReportsTo(card.k, boss) } }
                .environment(AppModel.shared)
        }
    }

    private func fill() {
        filling = true
        Task {
            let n = await model.fillOrgFromZoomInfo(chart?.company ?? name)
            chart = await model.orgChart(name)
            filling = false
            if let n { Haptic.success(); model.show(n == 0 ? "No new senior people found in ZoomInfo" : "Added \(n) people from ZoomInfo") }
        }
    }

    private func openLinkedIn(_ c: OrgChart.Card) {
        let url: URL? = (c.li.flatMap { $0.isEmpty ? nil : ($0.hasPrefix("http") ? $0 : "https://" + $0) }).flatMap(URL.init(string:))
            ?? URL(string: "https://www.linkedin.com/search/results/people/?keywords=" + ("\(c.name) \(chart?.company ?? name)".addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""))
        if let url { UIApplication.shared.open(url) }
    }

    private func header(_ c: OrgChart) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(c.company).font(Theme.serif(.title, .semibold))
            let team = c.team ?? c.levels.flatMap(\.people).filter { $0.src == "team" }.count
            let listed = c.listed ?? 0
            Text("\(c.known ?? ((c.total ?? 0) - team - listed)) you know\(team > 0 ? " · \(team) through your team" : "")\(listed > 0 ? " · \(listed) to meet" : "")")
                .font(Theme.geist(.subheadline)).foregroundStyle(Theme.text2)
            if !c.gaps.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(c.gaps, id: \.self) { g in
                        Label("No one senior in \(g)", systemImage: "exclamationmark.circle")
                            .font(Theme.geist(.caption, .semibold))
                            .foregroundStyle(Theme.needs)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(Theme.needsSoft, in: Capsule())
                    }
                }
            }
        }
        .padding(.horizontal, 4)
    }

    // MARK: offices

    /// The agency's real top-level offices: who you know in each, and the empty ones as
    /// places to find a way in. Offices with people come first; the rest fold away.
    @ViewBuilder private func structure(_ s: OrgChart.Structure, offices: [OrgChart.Office], chart c: OrgChart) -> some View {
        let filled = offices.filter { !$0.members.isEmpty }
        let empty = offices.filter { $0.members.isEmpty }
        let keep = max(0, 6 - filled.count)
        let shown = filled + (allOffices ? empty : Array(empty.prefix(keep)))
        let hidden = offices.count - shown.count
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Label(s.leader ?? "Leadership", systemImage: "building.columns")
                    .font(Theme.geist(.caption, .semibold))
                    .foregroundStyle(Theme.onPrimary)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Theme.primary, in: Capsule())
                Text("Offices").font(Theme.geist(.footnote, .semibold)).foregroundStyle(Theme.text2)
                Spacer()
                Text("\(filled.count) of \(offices.count) covered").font(Theme.mono(.footnote)).foregroundStyle(Theme.text3)
            }
            .padding(.horizontal, 4)
            .accessibilityElement(children: .combine)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 156), spacing: 10)], alignment: .leading, spacing: 10) {
                ForEach(shown) { o in office(o, chart: c) }
            }
            if hidden > 0 || (allOffices && empty.count > keep) {
                Button {
                    withAnimation(Motion.bouncy) { allOffices.toggle() }
                } label: {
                    Text(allOffices ? "Show fewer offices" : "Show all \(offices.count) offices")
                        .font(Theme.geist(.footnote, .semibold))
                }
                .buttonStyle(PillButtonStyle(kind: .soft))
                .frame(maxWidth: .infinity)
            }
            Text("Structure as of \(s.asOf ?? "recently"). Offices change: tell us if this is out of date.")
                .font(Theme.geist(.caption)).foregroundStyle(Theme.text3)
                .padding(.horizontal, 4)
        }
    }

    @ViewBuilder private func office(_ o: OrgChart.Office, chart c: OrgChart) -> some View {
        let people = o.members
        VStack(alignment: .leading, spacing: 6) {
            Text(o.code).font(Theme.mono(.caption, .semibold)).foregroundStyle(people.isEmpty ? Theme.text3 : Theme.primary)
            Text(o.name).font(Theme.geist(.subheadline, .semibold)).lineLimit(2).multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if people.isEmpty {
                Text("No one here yet").font(Theme.geist(.caption)).foregroundStyle(Theme.text2)
                Button("Ways in") { model.introQuery = c.company }
                    .font(Theme.geist(.caption, .semibold))
                    .buttonStyle(PillButtonStyle(kind: .soft))
            } else {
                HStack(spacing: -8) {
                    ForEach(people.prefix(5)) { p in officeFace(p) }
                    if people.count > 5 {
                        Text("+\(people.count - 5)")
                            .font(.custom("Geist-SemiBold", fixedSize: 11)).foregroundStyle(Theme.text2)
                            .frame(width: 30, height: 30)
                            .background(Circle().fill(Theme.soft))
                            .background(Circle().fill(Theme.card).padding(-2))
                    }
                }
                Text(people.count == 1 ? people[0].name : "\(people[0].name) and \(people.count - 1) more")
                    .font(Theme.geist(.caption)).foregroundStyle(Theme.text2).lineLimit(1)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 138, alignment: .topLeading)
        .background(people.isEmpty ? Theme.bg : Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            if people.isEmpty {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Theme.text3.opacity(0.5), style: StrokeStyle(lineWidth: 1.2, dash: [5, 4]))
            }
        }
    }

    /// A small face in an office card. Tapping opens the profile (or, for someone you
    /// don't know yet, the same choices as their card below).
    @ViewBuilder private func officeFace(_ c: OrgChart.Card) -> some View {
        let person = c.k.isEmpty ? nil : model.person(c.k)
        let face = Group {
            if let person {
                Avatar(person: person, size: 30)
            } else {
                Text(String(c.name.split(separator: " ").compactMap(\.first).prefix(2)))
                    .font(.custom("Geist-Bold", fixedSize: 11)).foregroundStyle(Theme.primary)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(Theme.card))
                    .background(Circle().strokeBorder(Theme.primary.opacity(0.5), style: StrokeStyle(lineWidth: 1.2, dash: [3, 3])))
            }
        }
        .background(Circle().fill(Theme.card).padding(-2))
        .accessibilityLabel(c.name)
        if c.src == "list" {
            Button { outside = c } label: { face }.buttonStyle(.pressable)
        } else if c.k.isEmpty {
            face
        } else {
            Button { model.open(.person(c.k)) } label: { face }.buttonStyle(.pressable)
        }
    }

    @ViewBuilder private func level(_ id: String, people: [OrgChart.Card], chart c: OrgChart) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(Self.short[id] ?? id).font(Theme.geist(.footnote, .semibold)).foregroundStyle(Theme.text2)
                Spacer()
                if !people.isEmpty { Text(people.count.formatted()).font(Theme.mono(.footnote)).foregroundStyle(Theme.text3) }
            }
            .padding(.horizontal, 4)
            if people.isEmpty {
                HStack(spacing: 10) {
                    Image(systemName: "person.crop.circle.dashed").font(.title2).foregroundStyle(Theme.text3)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("No one here yet").font(Theme.geist(.subheadline, .semibold))
                        Text(ZoomInfo.configured ? "A gap worth filling. Ways in shows who could introduce you, and ZoomInfo can show who sits here." : "A gap worth filling. Ways in shows who could introduce you.").font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
                    }
                    Spacer()
                    Button("Ways in") { model.introQuery = c.company }.buttonStyle(PillButtonStyle(kind: .soft))
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.text3.opacity(0.5), style: StrokeStyle(lineWidth: 1.2, dash: [5, 4])))
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 10) {
                        ForEach(people) { p in card(p, chart: c) }
                    }
                    .padding(.horizontal, 2).padding(.vertical, 4)
                }
                .scrollClipDisabled()
            }
        }
    }

    @ViewBuilder private func card(_ c: OrgChart.Card, chart: OrgChart) -> some View {
        let person = c.k.isEmpty ? nil : model.person(c.k)
        let boss = c.rt.isEmpty ? nil : model.person(c.rt)
        let reports = chart.links.filter { $0.to == c.k }.count
        let face = VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                if let person {
                    Avatar(person: person, size: 40).zoomSource(person: person.k)
                } else {
                    Text(String(c.name.split(separator: " ").compactMap(\.first).prefix(2)))
                        .font(.custom("Geist-Bold", fixedSize: 14)).foregroundStyle(Theme.primary)
                        .frame(width: 40, height: 40)
                        .background(Circle().strokeBorder(Theme.primary.opacity(0.5), style: StrokeStyle(lineWidth: 1.5, dash: [3, 3])))
                }
                Circle().fill(Band.color(c.band)).frame(width: 8, height: 8).accessibilityHidden(true)
            }
            Text(c.name).font(Theme.geist(.subheadline, .semibold)).lineLimit(1)
            Text(c.p.isEmpty ? c.func_ : c.p).font(Theme.geist(.caption)).foregroundStyle(Theme.text2).lineLimit(2).multilineTextAlignment(.leading)
            Spacer(minLength: 0)
            if c.src == "list" {
                Text(c.owner == "zoominfo" ? "From ZoomInfo" : "From your file").font(Theme.geist(.caption2, .semibold)).foregroundStyle(Theme.needs)
            } else if c.src == "team", let o = c.owner {
                Text("Through \(o)").font(Theme.geist(.caption2, .semibold)).foregroundStyle(Theme.info)
            } else if let boss {
                Text("Reports to \(boss.f)").font(Theme.geist(.caption2, .semibold)).foregroundStyle(Theme.violet).lineLimit(1)
            } else if reports > 0 {
                Text("\(reports) report\(reports == 1 ? "" : "s")").font(Theme.geist(.caption2, .semibold)).foregroundStyle(Theme.violet)
            }
        }
        .padding(12)
        .frame(width: 150, height: 150, alignment: .topLeading)
        .background(c.src == "you" ? Theme.card : Theme.bg, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(dropTarget == c.k ? Theme.primary : c.src == "team" ? Theme.info.opacity(0.5) : c.src == "list" ? Theme.needs.opacity(0.5) : .clear,
                              style: StrokeStyle(lineWidth: dropTarget == c.k ? 2 : 1.2, dash: c.src == "you" ? [] : [5, 4]))
        }
        .scaleEffect(dropTarget == c.k ? 1.04 : 1)
        .animation(Motion.bouncy, value: dropTarget)
        .accessibilityElement(children: .combine)

        if c.src == "list" {
            Button { outside = c } label: { face }.buttonStyle(.pressable)
        } else if c.k.isEmpty {
            face
        } else {
            Button { model.open(.person(c.k)) } label: { face }
                .buttonStyle(.pressable)
                .draggable(c.k) {
                    Text(c.name).font(Theme.geist(.subheadline, .semibold)).padding(10).background(Theme.card, in: Capsule())
                }
                .dropDestination(for: String.self) { items, _ in
                    guard let k = items.first, k != c.k else { return false }
                    Haptic.success()
                    Task { await model.setReportsTo(k, c.k) }
                    return true
                } isTargeted: { on in dropTarget = on ? c.k : (dropTarget == c.k ? nil : dropTarget) }
                .contextMenu {
                    Button { pickingBossFor = c } label: { Label("Reports to…", systemImage: "arrow.up.right") }
                    if boss != nil {
                        Button(role: .destructive) { Task { await model.setReportsTo(c.k, nil) } } label: { Label("Clear manager", systemImage: "xmark") }
                    }
                }
                .accessibilityAction(named: "Set manager") { pickingBossFor = c }
        }
    }
}
