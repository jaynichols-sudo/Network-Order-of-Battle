import UIKit
import SwiftUI
import UniformTypeIdentifiers

/// "Share to Bearings" from Plaud, Apple Notes, reMarkable, Mail or Files. Reads the
/// text (or the handwriting) on the device, leaves it for Bearings, and says so. Bearings
/// then matches it to the people you know the next time it opens.
final class ShareViewController: UIViewController {
    private let state = ShareState()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        let host = UIHostingController(rootView: ShareCard(state: state) { [weak self] in self?.finish() })
        host.view.backgroundColor = .clear
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        Task { await read() }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }

    private func read() async {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        var texts: [String] = []
        var names: [String] = []
        for item in items {
            if let t = item.attributedContentText?.string.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty { texts.append(t) }
            for provider in item.attachments ?? [] {
                if let (t, name) = await load(provider) {
                    texts.append(t)
                    names.append(name)
                }
            }
        }
        // the same words can arrive twice (as the share's text and as an attachment)
        var seen = Set<String>()
        let text = texts.filter { seen.insert($0.prefix(200).lowercased()).inserted }.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
        await MainActor.run {
            if text.count < 3 {
                state.phase = .empty
            } else {
                NotesInbox.add(text, source: NotesInbox.guessSource(text, fileName: names.joined(separator: " ")))
                state.words = text.split(whereSeparator: \.isWhitespace).count
                state.phase = .saved
            }
        }
    }

    /// One attachment as text: a file (text, PDF, picture) read on the device, or plain text.
    private func load(_ p: NSItemProvider) async -> (String, String)? {
        for type in [UTType.pdf, .image, .rtf, .plainText] where p.hasItemConformingToTypeIdentifier(type.identifier) {
            if let url = await copy(p, type: type) {
                defer { try? FileManager.default.removeItem(at: url) }
                var name = url.lastPathComponent
                if type == .pdf { name += " " + NoteText.pdfCreator(url) }
                if let t = await NoteText.from(url: url)?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty { return (t, name) }
            }
            if type == .plainText, let s = await string(p) { return (s, "") }
        }
        return nil
    }

    /// The file behind an attachment, copied somewhere it outlives the callback.
    private func copy(_ p: NSItemProvider, type: UTType) async -> URL? {
        await withCheckedContinuation { cont in
            p.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
                guard let url else { cont.resume(returning: nil); return }
                let dest = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-" + url.lastPathComponent)
                do { try FileManager.default.copyItem(at: url, to: dest); cont.resume(returning: dest) } catch { cont.resume(returning: nil) }
            }
        }
    }

    private func string(_ p: NSItemProvider) async -> String? {
        await withCheckedContinuation { cont in
            p.loadItem(forTypeIdentifier: UTType.plainText.identifier) { item, _ in
                if let s = item as? String { cont.resume(returning: s) }
                else if let d = item as? Data { cont.resume(returning: String(data: d, encoding: .utf8)) }
                else if let u = item as? URL { cont.resume(returning: try? String(contentsOf: u, encoding: .utf8)) }
                else { cont.resume(returning: nil) }
            }
        }
    }
}

@MainActor
final class ShareState: ObservableObject {
    enum Phase { case reading, saved, empty }
    @Published var phase: Phase = .reading
    @Published var words = 0
}

struct ShareCard: View {
    @ObservedObject var state: ShareState
    let done: () -> Void

    var body: some View {
        VStack {
            Spacer()
            VStack(spacing: 14) {
                Image(systemName: state.phase == .empty ? "questionmark.circle" : state.phase == .saved ? "checkmark.circle.fill" : "text.viewfinder")
                    .font(.system(size: 40, weight: .semibold))
                    .foregroundStyle(state.phase == .saved ? Color(red: 0.24, green: 0.83, blue: 0.64) : Color(red: 1, green: 0.69, blue: 0.13))
                    .symbolEffect(.bounce, value: state.phase == .saved)
                Text(title).font(.title3.weight(.bold)).multilineTextAlignment(.center)
                Text(detail).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                if state.phase == .reading {
                    ProgressView()
                } else {
                    Button(action: done) {
                        Text("Done").font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color(red: 0.16, green: 0.14, blue: 0.28))
                }
            }
            .padding(24)
            .frame(maxWidth: 420)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .padding(20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.25).ignoresSafeArea())
        .animation(.smooth, value: state.phase)
    }

    private var title: String {
        switch state.phase {
        case .reading: return "Reading…"
        case .saved: return "Added to Bearings"
        case .empty: return "Nothing to add"
        }
    }

    private var detail: String {
        switch state.phase {
        case .reading: return "Reading it on this iPhone. Handwriting takes a few seconds."
        case .saved: return "\(state.words.formatted()) words. Open Bearings and it will match them to the people you know."
        case .empty: return "Bearings couldn’t find any text in that. Try sharing the notes as text or a PDF."
        }
    }
}
