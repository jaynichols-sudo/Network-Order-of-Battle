import SwiftUI

/// The capture assistant on a SAM.gov notice: a bid/no-bid memo and call plans (engine:
/// captureMemo). With Apple Intelligence the memo is written by the on-device model from the
/// engine's facts; without it, the engine's template. Nothing leaves the device.
struct CaptureMemo: Decodable {
    struct Factor: Decodable, Hashable { var key: String; var label: String; var answer: String; var why: String }
    struct Plan: Decodable, Hashable { var k: String; var name: String; var plan: String; var prompt: String }
    var title: String
    var call: String
    var why: String
    var score: Int
    var factors: [Factor]
    var callPlans: [Plan]
    var memo: String
    var prompt: String
}

struct CaptureMemoSection: View {
    @Environment(AppModel.self) private var model
    let o: Opportunity
    @State private var memo: CaptureMemo?
    @State private var aiText: String?
    @State private var plans: [String: String] = [:]
    @State private var loading = false

    var body: some View {
        Section {
            if let m = memo {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Image(systemName: Brief.aiAvailable ? "apple.intelligence" : "doc.text")
                        Text("BID / NO BID").font(Theme.eyebrow).tracking(1.1).foregroundStyle(Theme.text2)
                        Spacer()
                        if loading { ProgressView().controlSize(.small) }
                        ShareLink(item: aiText ?? m.memo) { Image(systemName: "square.and.arrow.up") }
                    }
                    Text("\(m.call) · \(m.score)/100").font(Theme.serif(.title3, .semibold))
                    Text(m.why).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
                ForEach(m.factors, id: \.key) { f in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(f.label): \(f.answer)").font(Theme.geist(.subheadline, .semibold))
                        Text(f.why).font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                    }
                }
                DisclosureGroup("Full memo") {
                    Text(aiText ?? m.memo).font(Theme.geist(.footnote)).textSelection(.enabled)
                }
                ForEach(m.callPlans, id: \.k) { p in
                    DisclosureGroup("Call plan: \(p.name)") {
                        Text(plans[p.k] ?? p.plan).font(Theme.geist(.footnote)).textSelection(.enabled)
                    }
                }
            } else {
                Button { Task { await load() } } label: { Label("Bid/no-bid memo and call plans", systemImage: "doc.text.magnifyingglass") }
            }
        } footer: {
            Text(Brief.aiAvailable ? "Written on this iPhone by Apple Intelligence from your own data." : "Written from your own data on this device.")
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        var n: [String: Any] = ["id": o.id, "title": o.title, "sol": o.sol, "type": o.type, "agency": o.agency, "agencyName": o.agencyName, "office": o.office,
                                "due": o.due, "naics": o.naics, "setAside": o.setAside, "fit": o.fit ?? "", "officeKnown": o.officeKnown, "pursuitId": o.pursuitId]
        if let d = o.days { n["days"] = d }
        if let a = o.award?.awardee { n["award"] = ["recipient": a] }
        let naics = SamSettings.naics.split(whereSeparator: { $0 == "," || $0 == " " }).map(String.init)
        guard let m = try? await model.engine.call("captureMemo", [n, ["naics": naics] as [String: Any]], as: CaptureMemo.self) else { return }
        memo = m
        aiText = await Brief.captureMemo(m.prompt, key: o.id + "|" + String(m.score))
        for p in m.callPlans {
            if let t = await Brief.callPlan(p.prompt, key: p.k + "|" + o.id) { plans[p.k] = t }
        }
    }
}
