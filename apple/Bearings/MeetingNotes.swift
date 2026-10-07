import SwiftUI
import UIKit
import UniformTypeIdentifiers

// Meeting notes from anywhere: a Plaud transcript or summary, an Apple Note, a reMarkable
// page (handwriting read on the phone), or a file. Bearings finds the people you know in
// it and the action items, then files a short note on each person and turns the action
// items into reminders. The full text stays where it came from.

struct NotesReading: Decodable {
    struct Mention: Decodable, Hashable { var k: String; var name: String; var n: Int }
    struct Action: Decodable, Hashable { var text: String; var k: String }
    var title: String
    var summary: String
    var people: [Mention]
    var actions: [Action]
    var words: Int
}

struct NotesDraft: Identifiable {
    let id = UUID()
    var source: String
    var reading: NotesReading
    /// Opened from someone's profile: they're included even if the notes don't name them.
    var forPerson: String?
}

extension AppModel {
    func ingestNotes(_ text: String, source: String, forPerson: String? = nil) async {
        guard let r = try? await engine.call("readNotes", [text], as: NotesReading.self) else {
            show("Couldn’t read those notes")
            return
        }
        if r.words < 3 { show("There’s no text in that to file"); return }
        notesDraft = NotesDraft(source: source, reading: r, forPerson: forPerson)
    }

    func ingestNotesFile(_ url: URL, forPerson: String? = nil) async {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        show("Reading \(url.lastPathComponent)…")
        guard let text = await NoteText.from(url: url), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            show("Couldn’t find any text in \(url.lastPathComponent)")
            return
        }
        let extra = url.pathExtension.lowercased() == "pdf" ? NoteText.pdfCreator(url) : ""
        await ingestNotes(text, source: NotesInbox.guessSource(text, fileName: url.lastPathComponent + " " + extra), forPerson: forPerson)
    }

    /// Notes shared from other apps while Bearings was closed.
    func drainNotesInbox() async {
        guard loaded, notesDraft == nil, let item = NotesInbox.drain().last else { return }
        await ingestNotes(item.text, source: item.source)
    }

    static let notesFileTypes: Set<String> = ["txt", "text", "md", "markdown", "rtf", "pdf", "png", "jpg", "jpeg", "heic", "tiff", "tif", "gif", "webp"]
}

struct MeetingNotesSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let draft: NotesDraft

    @State private var people: [String] = []
    @State private var picked: Set<String> = []
    @State private var actions: [NotesReading.Action] = []
    @State private var doActions: Set<Int> = []
    @State private var inTouch = true
    @State private var useReminders = true
    @State private var adding = false
    @State private var saving = false
    @State private var title = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Meeting", text: $title)
                        .font(Theme.geist(.headline, .semibold))
                    if !draft.reading.summary.isEmpty {
                        Text(draft.reading.summary).font(Theme.geist(.subheadline)).foregroundStyle(Theme.text2)
                    }
                } header: {
                    Label("\(draft.source) · \(draft.reading.words.formatted()) words", systemImage: icon)
                }

                Section {
                    ForEach(people, id: \.self) { k in
                        if let p = model.person(k) {
                            Button {
                                if picked.contains(k) { picked.remove(k) } else { picked.insert(k) }
                                Haptic.tap()
                            } label: {
                                HStack(spacing: 12) {
                                    Avatar(person: p, size: 36)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(p.fullName).font(Theme.geist(.subheadline, .semibold)).foregroundStyle(.primary)
                                        Text(mentionLine(k, p)).font(Theme.geist(.footnote)).foregroundStyle(Theme.text2).lineLimit(1)
                                    }
                                    Spacer()
                                    Image(systemName: picked.contains(k) ? "checkmark.circle.fill" : "circle")
                                        .font(.title3)
                                        .foregroundStyle(picked.contains(k) ? Theme.good : Theme.text3)
                                        .contentTransition(.symbolEffect(.replace))
                                }
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(picked.contains(k) ? [.isButton, .isSelected] : .isButton)
                        }
                    }
                    Button { adding = true } label: { Label("Add someone", systemImage: "plus") }
                } header: {
                    Text(people.isEmpty ? "Who was there?" : "People you know in these notes")
                } footer: {
                    Text("Each person gets a short note with the date, the meeting and the summary.")
                }

                if !actions.isEmpty {
                    Section {
                        ForEach(Array(actions.enumerated()), id: \.offset) { i, a in
                            Button {
                                if doActions.contains(i) { doActions.remove(i) } else { doActions.insert(i) }
                                Haptic.tap()
                            } label: {
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: doActions.contains(i) ? "checkmark.square.fill" : "square")
                                        .foregroundStyle(doActions.contains(i) ? Theme.primary : Theme.text3)
                                        .padding(.top, 2)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(a.text).font(Theme.geist(.subheadline)).foregroundStyle(.primary).multilineTextAlignment(.leading)
                                        if let p = model.person(a.k.isEmpty ? (picked.first ?? "") : a.k) {
                                            Text("With \(p.fullName)").font(Theme.geist(.caption)).foregroundStyle(Theme.text2)
                                        }
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                        Toggle("Add them to Apple Reminders", isOn: $useReminders)
                    } header: {
                        Text("Action items")
                    } footer: {
                        Text(useReminders ? "Each one goes on your Bearings list in Reminders, due in three days." : "Each one becomes a follow-up in Bearings for the person it mentions.")
                    }
                }

                Section {
                    Toggle("I was in touch with them today", isOn: $inTouch)
                }
            }
            .navigationTitle("Meeting notes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { Task { await save() } }
                        .disabled(picked.isEmpty || saving)
                }
            }
            .sheet(isPresented: $adding) {
                PersonPicker { k in
                    if !people.contains(k) { people.append(k) }
                    picked.insert(k)
                }
                .environment(AppModel.shared)
            }
            .onAppear(perform: setUp)
        }
    }

    private var icon: String {
        switch draft.source {
        case "Plaud": return "waveform"
        case "reMarkable": return "pencil.and.scribble"
        default: return "doc.text"
        }
    }

    private func mentionLine(_ k: String, _ p: Person) -> String {
        let n = draft.reading.people.first { $0.k == k }?.n ?? 0
        let role = [p.p, p.c].filter { !$0.isEmpty }.joined(separator: ", ")
        return n > 0 ? "Mentioned \(n == 1 ? "once" : "\(n) times")\(role.isEmpty ? "" : " · " + role)" : role
    }

    private func setUp() {
        guard people.isEmpty && title.isEmpty else { return }
        title = draft.reading.title.isEmpty ? "Meeting" : draft.reading.title
        people = draft.reading.people.map(\.k)
        if let k = draft.forPerson, !people.contains(k) { people.insert(k, at: 0) }
        picked = Set(people)
        actions = draft.reading.actions
        doActions = Set(actions.indices)
        useReminders = ReminderSync.shared.enabled || ReminderSync.shared.authorized
    }

    private func save() async {
        saving = true
        let source = draft.source
        let line = draft.reading.summary.isEmpty ? title : "\(title). \(draft.reading.summary)"
        for k in people where picked.contains(k) {
            await model.addNote(k, String(line.prefix(480)), source: source)
            if inTouch { await model.touched(k) }
        }
        var added = 0
        let due = Calendar.current.date(byAdding: .day, value: 3, to: Date()) ?? Date()
        for (i, a) in actions.enumerated() where doActions.contains(i) {
            let k = a.k.isEmpty ? picked.first : a.k
            let name = k.flatMap { model.person($0)?.fullName }
            if useReminders {
                if await ReminderSync.shared.addTask(name.map { "\($0): \(a.text)" } ?? a.text, k: k, due: due) { added += 1 }
            } else if let k {
                await model.followUp(k, days: 3, quiet: true)
                added += 1
            }
        }
        Signature.done()
        let n = picked.count
        model.show("Saved to \(n) \(n == 1 ? "person" : "people")\(added > 0 ? ", \(added) to-do\(added == 1 ? "" : "s") added" : "")")
        dismiss()
    }
}

/// "Add meeting notes": paste, or pick a file (text, PDF, a photo of a page).
struct AddNotesPrompt: ViewModifier {
    @Environment(AppModel.self) private var model
    @Binding var isPresented: Bool
    var forPerson: String? = nil
    @State private var picking = false

    func body(content: Content) -> some View {
        content
            .confirmationDialog("Add meeting notes", isPresented: $isPresented, titleVisibility: .visible) {
                if UIPasteboard.general.hasStrings {
                    Button("Paste from the clipboard") {
                        if let t = UIPasteboard.general.string { Task { await model.ingestNotes(t, source: NotesInbox.guessSource(t), forPerson: forPerson) } }
                    }
                }
                Button("Choose a file or photo") { picking = true }
            } message: {
                Text("A Plaud summary, an Apple Note, a reMarkable page or any notes. Bearings finds the people you know and the action items. You can also share notes to Bearings from those apps.")
            }
            .fileImporter(isPresented: $picking, allowedContentTypes: NoteText.types) { r in
                if case .success(let url) = r { Task { await model.ingestNotesFile(url, forPerson: forPerson) } }
            }
    }
}

struct AddNotesButton<Content: View>: View {
    var forPerson: String? = nil
    @ViewBuilder let label: () -> Content
    @State private var asking = false

    var body: some View {
        Button(action: { asking = true }, label: label)
            .modifier(AddNotesPrompt(isPresented: $asking, forPerson: forPerson))
    }
}
