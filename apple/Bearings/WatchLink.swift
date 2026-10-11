import Foundation
#if canImport(WatchConnectivity) && !targetEnvironment(macCatalyst)
import WatchConnectivity

/// Owns the iPhone side of the Apple Watch connection.
///
/// The web app hands over a JSON snapshot of the people worth acting on; it is
/// written to a file and sent with `transferFile`, which has no size limit and
/// is delivered in the background. Actions taken on the watch arrive as
/// `transferUserInfo` dictionaries and are queued in UserDefaults until the web
/// app drains them, so nothing is lost if the phone app was not running.
final class WatchLink: NSObject, WCSessionDelegate {
    static let shared = WatchLink()

    private let queueKey = "bearings.watch.actions"
    private let lastKey = "bearings.watch.lastPayload"
    var onAction: (() -> Void)?
    /// A "Quick note" from the watch while the phone is reachable: (text, reply with the result line).
    var onQuickNote: ((String, @escaping (String) -> Void) -> Void)?

    func start() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        if s.delegate == nil { s.delegate = self }
        if s.activationState != .activated { s.activate() }
    }

    // MARK: phone -> watch

    func send(json: String) {
        guard WCSession.isSupported() else { return }
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("watch", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("snapshot.json")
        do { try Data(json.utf8).write(to: url, options: .atomic) } catch { return }
        UserDefaults.standard.set(true, forKey: lastKey)
        flush()
    }

    /// Sends the latest snapshot, replacing any transfer still in flight.
    private func flush() {
        let s = WCSession.default
        guard s.activationState == .activated, s.isPaired, s.isWatchAppInstalled else { return }
        guard UserDefaults.standard.bool(forKey: lastKey) else { return }
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("watch", isDirectory: true)
        let src = dir.appendingPathComponent("snapshot.json")
        guard FileManager.default.fileExists(atPath: src.path) else { return }
        for t in s.outstandingFileTransfers { t.cancel() }
        if let old = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) {
            for f in old where f.lastPathComponent.hasPrefix("out-") { try? FileManager.default.removeItem(at: f) }
        }
        // transferFile needs a file that stays put until delivery; copy to a unique name.
        let out = dir.appendingPathComponent("out-\(Int(Date().timeIntervalSince1970)).json")
        try? FileManager.default.removeItem(at: out)
        guard (try? FileManager.default.copyItem(at: src, to: out)) != nil else { return }
        s.transferFile(out, metadata: ["kind": "snapshot", "v": 1])
        UserDefaults.standard.set(false, forKey: lastKey)
    }

    // MARK: watch -> phone

    func drain() -> [[String: Any]] {
        let d = UserDefaults.standard
        let list = d.array(forKey: queueKey) as? [[String: Any]] ?? []
        d.removeObject(forKey: queueKey)
        return list
    }

    private func enqueue(_ info: [String: Any]) {
        let d = UserDefaults.standard
        var list = d.array(forKey: queueKey) as? [[String: Any]] ?? []
        var clean: [String: Any] = [:]
        for (k, v) in info where v is String || v is NSNumber || v is Bool { clean[k] = v }
        list.append(clean)
        d.set(Array(list.suffix(500)), forKey: queueKey)
        DispatchQueue.main.async { self.onAction?() }
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if activationState == .activated { flush() }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) { session.activate() }

    func sessionWatchStateDidChange(_ session: WCSession) {
        if session.isWatchAppInstalled { UserDefaults.standard.set(true, forKey: lastKey); flush() }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        if userInfo["kind"] as? String == "hello" {
            // A freshly installed watch app asks for data.
            UserDefaults.standard.set(true, forKey: lastKey)
            DispatchQueue.main.async { self.flush() }
            return
        }
        enqueue(userInfo)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        self.session(session, didReceiveUserInfo: message)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        if message["kind"] as? String == "quicklog", let text = message["text"] as? String {
            if let handle = onQuickNote {
                DispatchQueue.main.async { handle(text) { line in replyHandler(["line": line]) } }
            } else {
                // the app hasn't finished starting: keep it for drainWatch
                enqueue(message)
                replyHandler(["line": "Saved. Bearings files it when it opens on your iPhone."])
            }
            return
        }
        self.session(session, didReceiveUserInfo: message)
        replyHandler([:])
    }

    func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
        try? FileManager.default.removeItem(at: fileTransfer.file.fileURL)
        if error != nil { UserDefaults.standard.set(true, forKey: lastKey) }
    }
}
#else
/// No Apple Watch on the Mac: the same API, doing nothing.
final class WatchLink {
    static let shared = WatchLink()
    var onAction: (() -> Void)?
    var onQuickNote: ((String, @escaping (String) -> Void) -> Void)?
    func start() {}
    func send(json: String) {}
    func drain() -> [[String: Any]] { [] }
}
#endif
