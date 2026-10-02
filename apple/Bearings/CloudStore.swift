import Foundation

/// Saves the app's JSON files in the user's private iCloud Drive container so
/// every Apple device on the same Apple ID sees the same network. Falls back to
/// on-device storage when iCloud is off. Uses the same container and folder
/// names as the earlier version of the app, so existing data carries over.
final class CloudStore: @unchecked Sendable {
    static let files = ["network.json", "edits.json", "review.json", "targets.json", "industries.json"]

    enum ReadResult { case data(String?), pending }

    private let containerId = "iCloud.com.jaynichols.networkoob"
    private let queue = DispatchQueue(label: "bearings.store", qos: .userInitiated)
    private var resolved = false
    private var cloudDocs: URL?
    private var query: NSMetadataQuery?
    private var lastOwnWrite = Date.distantPast
    var onRemoteChange: (() -> Void)?

    /// Whether files live in iCloud. Resolving the container can block, so call off the main thread.
    func isCloud() async -> Bool {
        await withCheckedContinuation { c in queue.async { c.resume(returning: self.base().1) } }
    }

    private func base() -> (URL, Bool) {
        let fm = FileManager.default
        if !resolved {
            resolved = true
            if fm.ubiquityIdentityToken != nil, let container = fm.url(forUbiquityContainerIdentifier: containerId) {
                let docs = container.appendingPathComponent("Documents", isDirectory: true)
                try? fm.createDirectory(at: docs, withIntermediateDirectories: true)
                cloudDocs = docs
            }
        }
        if let docs = cloudDocs { return (docs, true) }
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("NetworkOOB", isDirectory: true)
        try? fm.createDirectory(at: support, withIntermediateDirectories: true)
        return (support, false)
    }

    private func isCurrent(_ url: URL) -> Bool {
        guard let v = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]), let s = v.ubiquitousItemDownloadingStatus else { return true }
        return s == .current
    }

    func read(_ name: String) async -> ReadResult {
        await withCheckedContinuation { c in
            queue.async { c.resume(returning: self.readSync(name)) }
        }
    }

    private func readSync(_ name: String) -> ReadResult {
        let fm = FileManager.default
        let (dir, icloud) = base()
        let url = dir.appendingPathComponent(name)
        if icloud {
            let placeholder = dir.appendingPathComponent("." + name + ".icloud")
            let missing = !fm.fileExists(atPath: url.path) && fm.fileExists(atPath: placeholder.path)
            if missing || (fm.fileExists(atPath: url.path) && !isCurrent(url)) {
                try? fm.startDownloadingUbiquitousItem(at: url)
                let deadline = Date().addingTimeInterval(missing ? 20 : 6)
                while Date() < deadline {
                    if fm.fileExists(atPath: url.path) && isCurrent(url) { break }
                    Thread.sleep(forTimeInterval: 0.4)
                }
                if !fm.fileExists(atPath: url.path) { return .pending }
            }
        }
        var text: String?
        var err: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &err) { u in
            guard fm.fileExists(atPath: u.path) else { return }
            text = try? String(contentsOf: u, encoding: .utf8)
        }
        return .data(text)
    }

    func write(_ name: String, _ text: String) async throws {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            queue.async {
                let (dir, _) = self.base()
                let url = dir.appendingPathComponent(name)
                var coordErr: NSError?
                var writeErr: Error?
                self.lastOwnWrite = Date()
                NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: .forReplacing, error: &coordErr) { u in
                    do { try text.write(to: u, atomically: true, encoding: .utf8) } catch { writeErr = error }
                }
                if let e = coordErr ?? (writeErr as NSError?) { c.resume(throwing: e) } else { c.resume() }
            }
        }
    }

    /// Watches iCloud for changes made on another device.
    @MainActor func startWatching() {
        guard query == nil else { return }
        Task {
            guard await isCloud() else { return }
            let q = NSMetadataQuery()
            q.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
            q.predicate = NSPredicate(format: "%K LIKE %@", NSMetadataItemFSNameKey, "*.json")
            NotificationCenter.default.addObserver(forName: .NSMetadataQueryDidUpdate, object: q, queue: .main) { [weak self] _ in
                guard let self else { return }
                if Date().timeIntervalSince(self.lastOwnWrite) > 4 { self.onRemoteChange?() }
            }
            q.start()
            self.query = q
        }
    }
}
