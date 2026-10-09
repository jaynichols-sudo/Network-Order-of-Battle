import SwiftUI
import AppIntents
import CoreLocation

// Talk to Bearings: log a conversation in one breath, or ask a plain question.
// Both work in the app, from Siri and from the Action button.

struct QuickLogResult: Decodable {
    struct Who: Decodable, Hashable { var k: String; var name: String }
    var people: [Who]
    var days: Int
    var due: String?
}

struct AskResult: Decodable {
    struct Hit: Decodable, Hashable, Identifiable { var k: String; var why: String; var id: String { k } }
    var kind: String
    var answer: String
    var people: [Hit]
    var place: String?
}

extension AppModel {
    /// Reads a spoken or typed note. With `save`, files it on everyone named and sets the follow-up.
    func quickLog(_ text: String, save: Bool) async -> QuickLogResult {
        let r = (try? await engine.call("quickLog", [text, false], as: QuickLogResult.self)) ?? QuickLogResult(people: [], days: 0)
        guard save, !r.people.isEmpty else { return r }
        for (i, p) in r.people.enumerated() {
            await edit(p.k, call: "addNote", [p.k, String(text.prefix(480)), "Voice"])
            await edit(p.k, call: "touch", [p.k])
            if i == 0, r.days > 0 { await followUp(p.k, days: r.days, quiet: true) }
        }
        Signature.done()
        return r
    }

    func ask(_ q: String) async -> AskResult {
        var r = (try? await engine.call("ask", [q], as: AskResult.self)) ?? AskResult(kind: "none", answer: "", people: [])
        if r.kind == "city", let place = r.place {
            // places live on the phone, so nearby questions are answered here
            if let hit = try? await CLGeocoder().geocodeAddressString(place).first, let loc = hit.location {
                let city = [hit.locality ?? place.capitalized, hit.administrativeArea].compactMap { $0 }.joined(separator: ", ")
                let trip = CalendarService.Trip(id: "ask", city: city, lat: loc.coordinate.latitude, lon: loc.coordinate.longitude, start: Date(), end: Date(), source: "you")
                let near = CalendarService.shared.nearby(trip, model: self, miles: 40)
                r.people = near.prefix(15).map { AskResult.Hit(k: $0.0.k, why: "\(Int($0.2.rounded())) mi · \($0.0.subtitle)") }
                r.answer = near.isEmpty ? "No one placed near \(city) yet." : "\(near.count) \(near.count == 1 ? "person" : "people") within 40 miles of \(city)."
            } else {
                r.answer = "Couldn’t find \(place) on the map."
            }
        }
        return r
    }

    func logLine(_ r: QuickLogResult) -> String {
        guard let first = r.people.first else { return "I couldn’t find anyone you know in that. Say their full name." }
        let names = ListFormatter.localizedString(byJoining: r.people.map(\.name))
        let due = r.days > 0 ? " Follow-up set for \(Day.nice(Day.plus(r.days)))." : ""
        return "Saved to \(names).\(due)" + (r.people.count > 1 ? " The follow-up is on \(first.name)." : "")
    }
}

/// "Quick note": say or type what happened; Bearings files it.
struct QuickLogSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var preview: QuickLogResult?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text("What happened?").font(Theme.serif(.title2, .semibold))
                TextField("Just met Dan Sitkins at the expo. He wants pricing for two sites by Friday.", text: $text, axis: .vertical)
                    .lineLimit(4...10)
                    .focused($focused)
                    .padding(14)
                    .background(Theme.card2, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                Label("Tap the microphone on the keyboard to say it instead.", systemImage: "mic")
                    .font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                if let p = preview {
                    VStack(alignment: .leading, spacing: 6) {
                        if p.people.isEmpty {
                            Text("No one you know named yet. Use their full name.").font(Theme.geist(.footnote)).foregroundStyle(Theme.needs)
                        } else {
                            ForEach(p.people, id: \.k) { w in
                                if let person = model.person(w.k) {
                                    HStack(spacing: 10) {
                                        Avatar(person: person, size: 30)
                                        Text(person.fullName).font(Theme.geist(.subheadline, .semibold))
                                    }
                                }
                            }
                            if p.days > 0 {
                                Label("Follow up \(Day.nice(Day.plus(p.days)))", systemImage: "bell").font(Theme.geist(.footnote)).foregroundStyle(Theme.violet)
                            }
                        }
                    }
                    .transition(.opacity)
                }
                Spacer()
            }
            .padding(20)
            .animation(Motion.gentle, value: preview?.people.map(\.k) ?? [])
            .navigationTitle("Quick note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            let r = await model.quickLog(text, save: true)
                            model.show(model.logLine(r))
                            dismiss()
                        }
                    }
                    .disabled(preview?.people.isEmpty ?? true)
                }
            }
            .task(id: text) {
                try? await Task.sleep(nanoseconds: 350_000_000)
                preview = text.count > 4 ? await model.quickLog(text, save: false) : nil
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Ask Bearings: plain questions answered from your own network, on the device.
struct AskView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var q = ""
    @State private var result: AskResult?
    @State private var busy = false
    @FocusState private var focused: Bool

    private var suggestions: [String] {
        var s = ["Who’s waiting on me?", "Who changed jobs lately?", "Who’s likely to move soon?"]
        if let t = model.targets.first { s.insert("Who do I know at \(t.name)?", at: 1); s.append("Who can get me into \(t.name)?") }
        if let trip = CalendarService.shared.trips.first { s.insert("Who should I see in \(trip.city.split(separator: ",").first ?? "")?", at: 0) }
        return s
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        Image(systemName: "sparkle.magnifyingglass").foregroundStyle(Theme.accent)
                        TextField("Ask about your network", text: $q)
                            .focused($focused)
                            .submitLabel(.search)
                            .onSubmit { run() }
                    }
                }
                if let r = result {
                    Section {
                        if !r.answer.isEmpty { Text(r.answer).font(Theme.serif(.title3, .semibold)) }
                        ForEach(r.people) { h in
                            if let p = model.person(h.k) {
                                Button {
                                    dismiss()
                                    model.open(.person(h.k))
                                } label: {
                                    VStack(alignment: .leading, spacing: 3) {
                                        PersonRow(person: p, lens: model.info.lens)
                                        if !h.why.isEmpty { Text(h.why).font(Theme.geist(.footnote)).foregroundStyle(.secondary).lineLimit(2) }
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                } else {
                    Section("Try") {
                        ForEach(suggestions, id: \.self) { s in
                            Button(s) { q = s; run() }
                        }
                    }
                }
            }
            .overlay { if busy { ProgressView() } }
            .navigationTitle("Ask Bearings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onAppear { focused = true }
        }
    }

    private func run() {
        let t = q.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        busy = true
        Task { result = await model.ask(t); busy = false }
    }
}

// MARK: - Siri and the Action button

struct QuickLogIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a conversation"
    static var description = IntentDescription("Say what happened and with whom. Bearings adds a note to that person, marks you in touch, and sets a follow-up if you mention one.")
    @Parameter(title: "What happened?", requestValueDialog: "What happened, and with whom?") var text: String

    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        let m = AppModel.shared
        await m.start()
        let r = await m.quickLog(text, save: true)
        return .result(dialog: IntentDialog(stringLiteral: m.logLine(r)))
    }
}

struct AskBearingsIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask Bearings"
    static var description = IntentDescription("Ask a plain question about your network, like “Who do I know at DISA?”")
    @Parameter(title: "Question", requestValueDialog: "What would you like to know?") var question: String

    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        let m = AppModel.shared
        await m.start()
        let r = await m.ask(question)
        let names = r.people.prefix(4).compactMap { m.person($0.k)?.fullName }
        let tail = names.isEmpty ? "" : " " + ListFormatter.localizedString(byJoining: names) + (r.people.count > 4 ? ", and more." : ".")
        return .result(dialog: IntentDialog(stringLiteral: (r.answer.isEmpty ? "Here’s what I found." : r.answer) + tail))
    }
}
