import SwiftUI
import UIKit

/// Ready-made messages to start from. Pick one, edit it, then copy it and jump
/// to their LinkedIn profile, email it, or share it anywhere. Nothing is sent for you.
struct MessageSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    let k: String
    var trip: (city: String, when: String)?
    var meeting: String?
    var intro: String?
    var event: String?
    @State private var drafts: [DraftMessage] = []
    @State private var picked = ""
    @State private var text = ""
    @State private var profile = ""
    @State private var writing = false

    private func writeWithAI(_ p: Person) {
        writing = true
        let purpose = drafts.first(where: { $0.id == picked })?.label ?? "Just checking in"
        Task {
            if let t = await Brief.draft(p, purpose: purpose, model: model) {
                withAnimation { text = t }
                Haptic.success()
            } else {
                model.show("Couldn’t write a draft right now")
            }
            writing = false
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                if !drafts.isEmpty {
                    Section("Start from") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(drafts) { d in
                                    Chip(text: d.label, on: picked == d.id) {
                                        picked = d.id
                                        text = d.text
                                    }
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
                if Brief.aiAvailable, let p = model.person(k) {
                    Section {
                        Button {
                            writeWithAI(p)
                        } label: {
                            HStack {
                                Label(writing ? "Writing…" : "Write it for me", systemImage: "apple.intelligence")
                                Spacer()
                                if writing { ProgressView() }
                            }
                        }
                        .disabled(writing)
                    } footer: {
                        Text("Apple Intelligence writes a personal version from your history together. It runs on this iPhone; nothing is sent anywhere.")
                    }
                }
                Section {
                    TextEditor(text: $text)
                        .frame(minHeight: 180)
                        .font(Theme.geist(.body))
                } header: {
                    Text("Your message")
                } footer: {
                    Text("Edit it to sound like you. LinkedIn doesn’t let other apps send messages, so Bearings copies the text and opens their profile. Tap Message there and paste.")
                }
                Section {
                    if !profile.isEmpty {
                        Button {
                            UIPasteboard.general.string = text
                            Haptic.success()
                            if let u = URL(string: profile) { openURL(u) }
                            dismiss()
                        } label: { Label("Copy and open LinkedIn", systemImage: "arrow.up.right.square") }
                    }
                    if let e = model.person(k)?.e, !e.isEmpty, let u = mailURL(e) {
                        Button { openURL(u); dismiss() } label: { Label("Email instead", systemImage: "envelope") }
                    }
                    ShareLink(item: text) { Label("Share", systemImage: "square.and.arrow.up") }
                    Button {
                        UIPasteboard.general.string = text
                        model.show("Copied")
                    } label: { Label("Copy", systemImage: "doc.on.doc") }
                }
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .navigationTitle("Message \(model.person(k)?.f ?? "")")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .task {
                drafts = await model.messages(k, trip: trip, meeting: meeting, intro: intro, event: event)
                if let first = drafts.first { picked = first.id; text = first.text }
                profile = await model.links(k)?.profile ?? ""
            }
        }
    }

    private func mailURL(_ email: String) -> URL? {
        var c = URLComponents(string: "mailto:" + email)
        c?.queryItems = [URLQueryItem(name: "body", value: text)]
        return c?.url
    }
}
