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
    @Environment(\.dismiss) private var dismiss

    static var available: Bool { MFMailComposeViewController.canSendMail() }

    func makeUIViewController(context: Context) -> MFMailComposeViewController {
        let vc = MFMailComposeViewController()
        vc.mailComposeDelegate = context.coordinator
        vc.setToRecipients([to])
        vc.setSubject("Bearings feedback")
        vc.setMessageBody(body, isHTML: false)
        for u in attachments { if let d = try? Data(contentsOf: u) { vc.addAttachmentData(d, mimeType: "application/json", fileName: u.lastPathComponent) } }
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
