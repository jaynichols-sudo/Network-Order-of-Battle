import Foundation
import MetricKit
import MessageUI
import SwiftUI
import UIKit

/// Collects crash and hang reports from iOS (MetricKit) so "Send feedback" can include them.
/// Reports stay on the device until you choose to send one.
final class Diagnostics: NSObject, MXMetricManagerSubscriber, @unchecked Sendable {
    static let shared = Diagnostics()
    private let dir: URL = {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Diagnostics", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    func start() { MXMetricManager.shared.add(self) }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for p in payloads {
            let name = "diag-\(Int(Date().timeIntervalSince1970))-\(UUID().uuidString.prefix(6)).json"
            try? p.jsonRepresentation().write(to: dir.appendingPathComponent(name))
        }
        prune()
    }

    private func prune() {
        let files = ((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.creationDateKey])) ?? [])
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
        for f in files.dropFirst(5) { try? FileManager.default.removeItem(at: f) }
    }

    var reports: [URL] {
        ((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []).sorted { $0.lastPathComponent > $1.lastPathComponent }
    }

    @MainActor func summary(model: AppModel) -> String {
        let info = Bundle.main.infoDictionary ?? [:]
        let v = info["CFBundleShortVersionString"] as? String ?? "", b = info["CFBundleVersion"] as? String ?? ""
        return """
        Bearings \(v) (\(b))
        \(UIDevice.current.model), iOS \(UIDevice.current.systemVersion)
        Network: \(model.info.isSample ? "sample" : "\(model.info.count) people"), \(model.places.count) placed, saved to \(model.isCloud ? "iCloud" : "device")
        Crash reports attached: \(reports.count)
        """
    }
}

/// Mail composer with the diagnostics attached.
struct FeedbackMail: UIViewControllerRepresentable {
    let to: String
    let body: String
    let attachments: [URL]
    var screenshot: UIImage? = nil
    @Environment(\.dismiss) private var dismiss

    static var available: Bool { MFMailComposeViewController.canSendMail() }

    func makeUIViewController(context: Context) -> MFMailComposeViewController {
        let vc = MFMailComposeViewController()
        vc.mailComposeDelegate = context.coordinator
        vc.setToRecipients([to])
        vc.setSubject("Bearings feedback")
        vc.setMessageBody(body, isHTML: false)
        for u in attachments { if let d = try? Data(contentsOf: u) { vc.addAttachmentData(d, mimeType: "application/json", fileName: u.lastPathComponent) } }
        if let d = screenshot?.jpegData(compressionQuality: 0.8) { vc.addAttachmentData(d, mimeType: "image/jpeg", fileName: "screen.jpg") }
        return vc
    }
    func updateUIViewController(_ vc: MFMailComposeViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(dismiss: dismiss) }

    final class Coordinator: NSObject, MFMailComposeViewControllerDelegate {
        let dismiss: DismissAction
        init(dismiss: DismissAction) { self.dismiss = dismiss }
        func mailComposeController(_ controller: MFMailComposeViewController, didFinishWith result: MFMailComposeResult, error: Error?) { dismiss() }
    }
}


// MARK: - Shake to send feedback

extension Notification.Name { static let deviceDidShake = Notification.Name("bearings.shake") }

extension UIWindow {
    open override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        if motion == .motionShake { NotificationCenter.default.post(name: .deviceDidShake, object: self) }
        super.motionEnded(motion, with: event)
    }
}

enum ScreenGrab {
    @MainActor static func keyWindow() -> UIImage? {
        guard let w = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap(\.windows).first(where: { $0.isKeyWindow }) else { return nil }
        return UIGraphicsImageRenderer(bounds: w.bounds).image { _ in w.drawHierarchy(in: w.bounds, afterScreenUpdates: false) }
    }
}

/// "Something off?" Shake the phone (or tap Send feedback) and the current screen comes along.
struct FeedbackSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let screenshot: UIImage?
    @State private var text = ""
    @State private var include = true
    @State private var composing = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("What happened, or what would make this better?", text: $text, axis: .vertical)
                        .lineLimit(4...10)
                }
                if let screenshot {
                    Section {
                        Toggle("Include this screen", isOn: $include)
                        if include {
                            Image(uiImage: screenshot).resizable().scaledToFit().frame(maxHeight: 260)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .frame(maxWidth: .infinity)
                        }
                    } footer: { Text("Check the screen first: it may show names from your network.") }
                }
            }
            .navigationTitle("Send feedback")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Next") {
                        if FeedbackMail.available { composing = true }
                        else {
                            let body = (text + "\n\n—\n" + Diagnostics.shared.summary(model: model)).addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
                            if let u = URL(string: "mailto:\(AppInfo.supportEmail)?subject=Bearings%20feedback&body=\(body)") { UIApplication.shared.open(u) }
                            dismiss()
                        }
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && screenshot == nil)
                }
            }
            .sheet(isPresented: $composing, onDismiss: { dismiss() }) {
                FeedbackMail(to: AppInfo.supportEmail, body: text + "\n\n—\n" + Diagnostics.shared.summary(model: model),
                             attachments: Diagnostics.shared.reports, screenshot: include ? screenshot : nil)
            }
        }
        .presentationDetents([.medium, .large])
    }
}

struct FeedbackRequest: Identifiable { let id = UUID(); let screenshot: UIImage? }

extension View {
    /// Shake anywhere to send feedback with the current screen.
    func shakeForFeedback(_ request: Binding<FeedbackRequest?>) -> some View {
        onReceive(NotificationCenter.default.publisher(for: .deviceDidShake)) { _ in
            guard request.wrappedValue == nil, UserDefaults.standard.object(forKey: "shakeFeedback") as? Bool ?? true else { return }
            Haptic.tap()
            request.wrappedValue = FeedbackRequest(screenshot: ScreenGrab.keyWindow())
        }
    }
}
