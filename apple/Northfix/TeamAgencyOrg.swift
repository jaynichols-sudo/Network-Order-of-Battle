import SwiftUI

/// The team's view of one agency (engine: teamAgencyOrg): open pursuits there, yours and your
/// teammates', and the government seats nobody fills, with who on the shared chart could fill
/// each. Built from the team shares already decrypted on this device; nothing new is sent.
struct TeamAgencyOrg: Decodable {
    struct Candidate: Decodable, Hashable { var name: String; var p: String; var band: String; var k: String; var via: String }
    struct Seat: Decodable, Hashable { var role: String; var filled: Bool; var holders: [String]; var candidates: [Candidate] }
    struct PursuitSeats: Decodable, Hashable { var id: String; var name: String; var owner: String; var stage: String; var seats: [Seat] }
    struct Contributor: Decodable, Hashable { var owner: String; var people: Int }
    var company: String
    var contributors: [Contributor]
    var pursuits: [PursuitSeats]
    var openSeats: Int
    var fillable: Int
}

struct TeamAgencySeatsCard: View {
    @Environment(AppModel.self) private var model
    let name: String
    @State private var org: TeamAgencyOrg?

    var body: some View {
        Group {
            if let o = org, !o.pursuits.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("TEAM PURSUITS HERE").font(Theme.eyebrow).tracking(1.1).foregroundStyle(Theme.text2)
                    Text("\(o.openSeats) open \(o.openSeats == 1 ? "seat" : "seats"), \(o.fillable) with someone on the chart who could fill it")
                        .font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                    if o.contributors.count > 1 {
                        Text(o.contributors.map { "\($0.owner) \($0.people)" }.joined(separator: " · ")).font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                    }
                    ForEach(o.pursuits, id: \.self) { p in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(p.name) · \(p.owner) · \(p.stage)").font(Theme.geist(.subheadline, .semibold))
                            ForEach(p.seats.filter { !$0.filled }, id: \.role) { s in
                                HStack(alignment: .firstTextBaseline) {
                                    Text(s.role).font(Theme.geist(.footnote, .semibold))
                                    Spacer()
                                    Text(s.candidates.isEmpty ? "No one yet" : s.candidates.map { "\($0.name) (\($0.via))" }.joined(separator: ", "))
                                        .font(Theme.geist(.footnote)).foregroundStyle(s.candidates.isEmpty ? Theme.text2 : Theme.accent).multilineTextAlignment(.trailing)
                                }
                            }
                        }
                    }
                }
                .padding(14)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .task(id: "\(name)-\(model.info.rev)-\(model.pursuitsRev)") {
            org = try? await model.engine.call("teamAgencyOrg", [name], as: TeamAgencyOrg.self)
        }
    }
}
