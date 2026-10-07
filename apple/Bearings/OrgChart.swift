import SwiftUI

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
        var id: String { k.isEmpty ? "team|\(owner ?? "")|\(name)" : k }
        enum CodingKeys: String, CodingKey { case k, name, p, sen, func_ = "func", band, score, src, owner, rt }
    }
    struct Level: Decodable, Hashable { var id: String; var people: [Card] }
    struct Func: Decodable, Hashable { var id: String; var n: Int }
    struct Link: Decodable, Hashable { var from: String; var to: String }
    var company: String
    var total: Int?
    var levels: [Level]
    var allLevels: [String]?
    var funcs: [Func]
    var gaps: [String]
    var links: [Link]
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

    private static let short: [String: String] = [
        "C-suite / Owner": "Executives", "VP": "Vice presidents", "Director / Head": "Directors and heads",
        "Manager / Lead": "Managers and leads", "Individual contributor": "Individual contributors",
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let c = chart {
                    header(c).cascade(0)
                    ForEach(Array((c.allLevels ?? c.levels.map(\.id)).enumerated()), id: \.element) { i, lv in
                        level(lv, people: c.levels.first { $0.id == lv }?.people ?? [], chart: c)
                            .cascade(i + 1)
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
        .sheet(item: $pickingBossFor) { card in
            PersonPicker { boss in Task { await model.setReportsTo(card.k, boss) } }
                .environment(AppModel.shared)
        }
    }

    private func header(_ c: OrgChart) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(c.company).font(Theme.serif(.title, .semibold))
            let team = c.levels.flatMap(\.people).filter { $0.src == "team" }.count
            Text("\((c.total ?? 0) - team) you know\(team > 0 ? " · \(team) through your team" : "")")
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
                        Text("A gap worth filling. Ways in shows who could introduce you.").font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
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
            if c.src == "team", let o = c.owner {
                Text("Through \(o)").font(Theme.geist(.caption2, .semibold)).foregroundStyle(Theme.info)
            } else if let boss {
                Text("Reports to \(boss.f)").font(Theme.geist(.caption2, .semibold)).foregroundStyle(Theme.violet).lineLimit(1)
            } else if reports > 0 {
                Text("\(reports) report\(reports == 1 ? "" : "s")").font(Theme.geist(.caption2, .semibold)).foregroundStyle(Theme.violet)
            }
        }
        .padding(12)
        .frame(width: 150, height: 150, alignment: .topLeading)
        .background(c.src == "team" ? Theme.bg : Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(dropTarget == c.k ? Theme.primary : c.src == "team" ? Theme.info.opacity(0.5) : .clear,
                              style: StrokeStyle(lineWidth: dropTarget == c.k ? 2 : 1.2, dash: c.src == "team" ? [5, 4] : []))
        }
        .scaleEffect(dropTarget == c.k ? 1.04 : 1)
        .animation(Motion.bouncy, value: dropTarget)
        .accessibilityElement(children: .combine)

        if c.k.isEmpty {
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
