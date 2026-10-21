import SwiftUI

/// The teaming-partner finder (engine: teamingFinder): who wins work at one agency in a NAICS
/// code, with the warmest way in to each, and one tap into a pursuit's teaming seat
/// (engine: requestTeamingIntro). Worked out on this device from the cached USASpending pages.
struct FinderWay: Decodable, Hashable { var k: String; var name: String; var p: String; var why: String; var inside: Bool }
struct FinderAward: Decodable, Hashable { var id: String; var title: String; var amountText: String; var end: String; var agency: String }
struct FinderPartner: Decodable, Hashable, Identifiable {
    var id: String { name }
    var name: String
    var amountText: String
    var count: Int
    var awards: [FinderAward]
    var naics: [String]
    var known: Int
    var ways: [FinderWay]
    var line: String
}
struct FinderResult: Decodable { var total: Int; var naics: String; var items: [FinderPartner] }
struct TeamingIntroResult: Decodable { var id: String; var partners: [String]; var seated: Bool; var intro: Bool; var via: String }

struct TeamingFinderSection: View {
    @Environment(AppModel.self) private var model
    @AppStorage("finder.agency") private var agency = ""
    @AppStorage("finder.naics") private var naics = ""
    @State private var result: FinderResult?
    @State private var open: [PursuitSummary] = []

    var body: some View {
        Section {
            TextField("Agency, like NAVFAC", text: $agency).textInputAutocapitalization(.characters).autocorrectionDisabled()
            TextField("NAICS code, like 541512", text: $naics).keyboardType(.numberPad)
            if let r = result {
                if r.items.isEmpty { Text("No one with awards there in that code yet.").foregroundStyle(.secondary) }
                ForEach(r.items.prefix(10)) { c in row(c) }
            }
        } header: {
            Text("Find a teaming partner")
        } footer: {
            Text("From the contract data already on this device. Adding someone to a pursuit stays on your devices.")
        }
        .task(id: "\(agency)|\(naics)|\(AwardFeed.shared.rev)") { await find() }
    }

    private func row(_ c: FinderPartner) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(c.name).font(Theme.geist(.body, .semibold))
            Text("\(c.count) \(c.count == 1 ? "award" : "awards") · \(c.amountText)\(c.naics.isEmpty ? "" : " · NAICS " + c.naics.joined(separator: ", "))")
                .font(Theme.geist(.footnote)).foregroundStyle(.secondary)
            Text(c.line).font(Theme.geist(.footnote)).foregroundStyle(c.ways.isEmpty ? .secondary : Theme.accent)
            if let w = c.ways.first, !open.isEmpty {
                Menu {
                    ForEach(open, id: \.id) { p in
                        Button(p.name) { Task { await request(p.id, partner: c.name, way: w) } }
                    }
                } label: {
                    Label(w.inside ? "Put \(w.name) in a pursuit’s teaming seat" : "Ask \(w.name) for an intro, for a pursuit", systemImage: "person.badge.plus")
                        .font(Theme.geist(.footnote, .semibold))
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func find() async {
        let a = agency.trimmingCharacters(in: .whitespaces)
        guard a.count >= 2 || naics.count >= 2 else { result = nil; return }
        result = try? await model.engine.call("teamingFinder", [AwardFeed.shared.pagesJSON, ["agency": a, "naics": naics, "limit": 20] as [String: Any]], as: FinderResult.self)
        open = await model.pursuits().filter { $0.stage != "Won" && $0.stage != "Lost" }
    }

    private func request(_ id: String, partner: String, way: FinderWay) async {
        let args: [Any] = [id, ["partner": partner, "via": way.k, "to": "the capture lead at \(partner)"]]
        if way.inside {
            guard (try? await model.engine.call("requestTeamingIntro", args, as: TeamingIntroResult.self)) != nil else { return }
            await model.savePursuits()
            model.show("\(way.name) is in the teaming seat.")
        } else {
            // logs the intro on their profile and saves edits, like any other intro
            await model.edit(way.k, call: "requestTeamingIntro", args)
            await model.savePursuits()
            model.show("Intro request logged with \(way.name). We’ll nudge you in a week.")
        }
    }
}
