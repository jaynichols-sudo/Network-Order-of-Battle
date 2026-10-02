import Foundation
import WatchConnectivity
import WidgetKit

/// Holds the snapshot sent from the iPhone and sends watch actions back.
/// Changes are applied locally right away so the watch feels instant; the
/// iPhone applies them for real and the next snapshot confirms them.
@MainActor
final class WatchStore: NSObject, ObservableObject {
    static let shared = WatchStore()

    @Published private(set) var snap: WatchSnapshot?
    @Published private(set) var reachableOnce = false

    private var fileURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("snapshot.json")
    }

    override init() {
        super.init()
        if let data = try? Data(contentsOf: fileURL), let s = try? JSONDecoder().decode(WatchSnapshot.self, from: data) {
            snap = s
        }
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    // MARK: lists

    var people: [WatchPerson] { snap?.people ?? [] }
    var today: String { Day.today }

    var waiting: [WatchPerson] { people.filter { $0.has("w") }.sorted { ($0.lt ?? "") > ($1.lt ?? "") } }
    var dueNow: [WatchPerson] { people.filter { ($0.due ?? "9") <= today }.sorted { ($0.due ?? "") < ($1.due ?? "") } }
    var upcoming: [WatchPerson] { people.filter { ($0.due ?? "") > today }.sorted { ($0.due ?? "") < ($1.due ?? "") } }
    var cooling: [WatchPerson] { people.filter { $0.has("c") }.sorted { ($0.sc ?? 0) > ($1.sc ?? 0) } }
    var moved: [WatchPerson] { people.filter { $0.has("j") } }
    var fresh: [WatchPerson] { people.filter { $0.has("n") } }
    var anniversaries: [WatchPerson] { people.filter { $0.has("a") }.sorted { ($0.yr ?? 0) > ($1.yr ?? 0) } }
    var starred: [WatchPerson] { people.filter { $0.starred }.sorted { $0.n < $1.n } }
    var closest: [WatchPerson] { people.filter { $0.b == "strong" || $0.b == "warm" }.sorted { ($0.sc ?? 0) > ($1.sc ?? 0) } }

    func person(_ k: String) -> WatchPerson? { people.first { $0.k == k } }

    // MARK: actions

    func markReplied(_ p: WatchPerson) {
        mutate(p.k) { $0.f.removeAll { $0 == "w" } }
        send(["kind": "replied", "k": p.k])
    }

    func followUp(_ p: WatchPerson, days: Int) {
        mutate(p.k) { q in
            q.due = days > 0 ? Day.plus(days) : nil
            if days > 0, !q.f.contains("d") { q.f.append("d") }
        }
        send(["kind": "follow", "k": p.k, "days": days])
    }

    func setStar(_ p: WatchPerson, _ on: Bool) {
        mutate(p.k) { $0.st = on ? 1 : nil }
        send(["kind": "star", "k": p.k, "on": on])
    }

    func addNote(_ p: WatchPerson, _ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        mutate(p.k) { q in
            let line = "\(Day.today) (watch): \(t)"
            q.no = (q.no.map { $0 + "\n" } ?? "") + line
        }
        send(["kind": "note", "k": p.k, "text": String(t.prefix(500))])
    }

    private func mutate(_ k: String, _ change: (inout WatchPerson) -> Void) {
        guard var s = snap, let i = s.people.firstIndex(where: { $0.k == k }) else { return }
        change(&s.people[i])
        apply(s, save: true)
    }

    private func send(_ info: [String: Any]) {
        guard WCSession.isSupported() else { return }
        var payload = info
        payload["at"] = Date().timeIntervalSince1970
        WCSession.default.transferUserInfo(payload)
    }

    // MARK: storage

    fileprivate func receive(fileAt url: URL) {
        guard let data = try? Data(contentsOf: url), let s = try? JSONDecoder().decode(WatchSnapshot.self, from: data) else { return }
        apply(s, save: true)
    }

    private func apply(_ s: WatchSnapshot, save: Bool) {
        snap = s
        if save, let data = try? JSONEncoder().encode(s) { try? data.write(to: fileURL, options: .atomic) }
        GlanceStore.save(Glance.from(s))
        WidgetCenter.shared.reloadAllTimelines()
    }

    fileprivate func activated() {
        reachableOnce = true
        if snap == nil { send(["kind": "hello"]) }
    }
}

extension WatchStore: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated else { return }
        Task { @MainActor in self.activated() }
    }

    nonisolated func session(_ session: WCSession, didReceive file: WCSessionFile) {
        // The file is removed when this method returns, so copy it first.
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".json")
        guard (try? FileManager.default.copyItem(at: file.fileURL, to: tmp)) != nil else { return }
        Task { @MainActor in
            self.receive(fileAt: tmp)
            try? FileManager.default.removeItem(at: tmp)
            BackgroundTasks.finishIfIdle()
        }
    }
}
