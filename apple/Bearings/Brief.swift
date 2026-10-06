import SwiftUI
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Briefs and drafts. With Apple Intelligence (iOS 26 and later) they're written by the
/// on-device model from your own history with someone; nothing leaves the phone. Without
/// it, a plain summary from the same facts.
@MainActor
enum Brief {
    static var aiAvailable: Bool {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            if case .available = SystemLanguageModel.default.availability { return true }
        }
        #endif
        return false
    }

    private static var cache: [String: String] = [:]

    /// The facts the model is allowed to use. Only what's already in the app.
    static func facts(_ p: Person, model: AppModel) -> String {
        var f: [String] = ["Today is \(Day.nice(Day.today)).", "Name: \(p.fullName)."]
        if !p.p.isEmpty { f.append("Title: \(p.p).") }
        if !p.c.isEmpty { f.append("Company: \(p.c).") }
        if !p.d.isEmpty { f.append("Connected on LinkedIn: \(Day.nice(p.d)).") }
        if let x = p.rx {
            if x.m > 0 { f.append("Messages exchanged: \(x.m), since \(Day.nice(x.f)).") }
            if !x.t.isEmpty { f.append(x.dir == "i" ? "Last message was from them, \(Day.ago(x.t))." : "Last message was from me, \(Day.ago(x.t)).") }
            if !x.s.isEmpty { f.append("Last message said: \"\(x.s)\"") }
            f.append("Relationship: \(Band.label(p.band)).")
        } else {
            f.append("We have never messaged on LinkedIn.")
        }
        if p.waiting { f.append("They are waiting on my reply.") }
        if let jc = p.jc, !jc.isEmpty {
            f.append("They started a new role around \(Day.nice(jc)).")
            if let was = p.pv?.first { f.append("Before that: \(was.p.isEmpty ? "a role" : was.p) at \(was.c).") }
        }
        if let c = p.circle { f.append("I keep them in my \(c.title.lowercased()) (\(c.cadence.lowercased()))\(p.over ? " and I'm overdue to reach out" : "").") }
        if let due = p.ed?.due, !due.isEmpty { f.append("I planned to follow up on \(Day.nice(due)).") }
        if let note = p.ed?.note, !note.isEmpty { f.append("My notes: \(String(note.suffix(700)))") }
        if let pl = model.places[p.k] { f.append("Based near \(pl.name).") }
        let meetings = CalendarService.shared.meetings.filter { $0.matched.contains(p.k) }
        if let m = meetings.first { f.append("We have a meeting \"\(m.title)\" on \(m.start.formatted(date: .abbreviated, time: .shortened)).") }
        return f.joined(separator: "\n")
    }

    /// A plain two-line brief without AI.
    static func template(_ p: Person, model: AppModel) -> String {
        var a = ""
        if let x = p.rx, !x.t.isEmpty {
            a = x.dir == "i" ? "\(p.f) wrote you \(Day.ago(x.t))" : "You last wrote \(Day.ago(x.t))"
            if x.m > 1 { a += ", \(x.m) messages in all" }
            a += "."
        } else {
            a = "You haven’t messaged \(p.f) yet; connected \(Day.nice(p.d))."
        }
        var b = ""
        if p.waiting { b = "They’re waiting on your reply." }
        else if p.moved { b = "New role\(p.c.isEmpty ? "" : " at \(p.c)"): a natural moment to say congratulations." }
        else if p.over, let c = p.circle { b = "Overdue for your \(c.title.lowercased()). A quick hello keeps it warm." }
        else if p.cooling { b = "You used to talk often; worth a check-in before it goes cold." }
        else if let due = p.ed?.due, !due.isEmpty { b = "You planned to follow up \(due <= Day.today ? "now" : "on \(Day.nice(due))")." }
        return [a, b].filter { !$0.isEmpty }.joined(separator: " ")
    }

    private static let style = "Use only the facts given and never invent details, names, dates or events. Write plain, warm, direct English. Do not use em dashes."

    static func ai(_ p: Person, model: AppModel) async -> String? {
        let key = "\(p.k)|\(p.touch)|\(p.rx?.t ?? "")|\(p.ed?.updated ?? "")"
        if let hit = cache[key] { return hit }
        let prompt = "Facts about someone in my network:\n\(facts(p, model: model))\n\nIn at most two short sentences, say where things stand with them and the single best reason to reach out now. Speak to me as \"you\"."
        guard let out = await respond(prompt, instructions: "You help a busy professional keep up with their network. " + style) else { return nil }
        cache[key] = out
        return out
    }

    static func draft(_ p: Person, purpose: String, model: AppModel) async -> String? {
        let me = (UserDefaults.standard.string(forKey: "name") ?? "").trimmingCharacters(in: .whitespaces)
        let prompt = "Facts about \(p.f):\n\(facts(p, model: model))\n\nWrite a short LinkedIn message from me to \(p.f) for this purpose: \(purpose). Under 70 words. Start with \"Hi \(p.f),\". Mention one specific shared detail from the facts if there is one. End with a light question or next step.\(me.isEmpty ? " Do not sign it." : " Sign it \(me.split(separator: " ").first.map(String.init) ?? me).") Reply with only the message."
        return await respond(prompt, instructions: "You write messages a professional will send under their own name. " + style)
    }

    private static func respond(_ prompt: String, instructions: String) async -> String? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            guard aiAvailable else { return nil }
            let session = LanguageModelSession(instructions: instructions)
            guard let r = try? await session.respond(to: prompt) else { return nil }
            let text = r.content.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: " — ", with: ". ").replacingOccurrences(of: "—", with: ", ")
            return text.isEmpty ? nil : text
        }
        #endif
        return nil
    }
}

/// The brief at the top of a profile.
struct BriefCard: View {
    @Environment(AppModel.self) private var model
    let person: Person
    @State private var aiText: String?
    @State private var loading = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: Brief.aiAvailable ? "apple.intelligence" : "text.alignleft")
                    .foregroundStyle(Brief.aiAvailable ? AnyShapeStyle(LinearGradient(colors: [Theme.amber, Theme.violet, Theme.info], startPoint: .leading, endPoint: .trailing)) : AnyShapeStyle(Theme.accent))
                Text("Brief").font(Theme.geist(.footnote, .semibold)).foregroundStyle(Theme.text2)
                Spacer()
                if loading { ProgressView().controlSize(.small) }
            }
            Text(aiText ?? Brief.template(person, model: model))
                .font(Theme.geist(.subheadline))
                .fixedSize(horizontal: false, vertical: true)
                .contentTransition(.opacity)
                .animation(.smooth, value: aiText)
        }
        .task(id: person.k + person.touch + (person.rx?.t ?? "") + (person.ed?.updated ?? "")) {
            guard Brief.aiAvailable else { return }
            loading = true
            aiText = await Brief.ai(person, model: model)
            loading = false
        }
    }
}
