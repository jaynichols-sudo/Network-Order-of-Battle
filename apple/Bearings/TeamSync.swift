import Foundation
import CryptoKit
import Observation

// Bearings Team: pool who your team knows through a small server that only ever sees ciphertext.
// The team key lives in the invite link after the "#", in this device's Keychain, and nowhere
// else. See docs/team.md for the format and the API.

struct TeamMember: Identifiable, Hashable {
    var id: String
    var role: String
    var name: String
    var title: String
    var joined: Date
    var shared: Date?
    var isMe: Bool
}

struct TeamInvite: Identifiable, Hashable {
    var code: String
    var role: String
    var usesLeft: Int
    var expires: Date
    var id: String { code }
}

struct TeamListItem: Decodable, Hashable { var owner: String; var made: String; var count: Int; var id: String; var pursuits: Int; var targets: Int }

struct TeamOverview: Decodable {
    struct Member: Decodable, Hashable { var owner: String; var id: String; var made: String; var count: Int; var strong: Int; var warm: Int; var agencies: Int; var pursuits: Int }
    struct Me: Decodable { var count: Int; var agencies: Int }
    struct Agencies: Decodable { var mine: Int; var team: Int; var total: Int }
    struct Totals: Decodable { var covered: Int; var thin: Int; var none: Int }
    struct Coverage: Decodable { var team: Totals; var mine: Totals }
    struct Seat: Decodable, Hashable { var role: String; var name: String; var p: String; var b: String }
    struct Pursuit: Decodable, Hashable, Identifiable {
        var owner: String; var mine: Bool; var id: String; var name: String; var agency: String; var stage: String
        var due: String?; var days: Int?; var value: String?; var filled: Int; var roles: Int; var people: [Seat]
        var key: String { "\(owner)|\(name)" }
    }
    struct Path: Decodable, Hashable { var owner: String; var name: String; var p: String; var b: String }
    struct Target: Decodable, Hashable, Identifiable { var name: String; var owners: [String]; var people: Int; var mine: Int; var team: Int; var best: [Path]; var id: String { name } }
    var members: [Member]
    var me: Me
    var people: Int
    var agencies: Agencies
    var coverage: Coverage
    var pursuits: [Pursuit]
    var targets: [Target]
}

@MainActor @Observable
final class TeamSync {
    static let shared = TeamSync()

    /// The team server, from the TEAM_URL build setting. Empty hides the server parts of Team.
    let baseURL: URL? = {
        guard let s = Bundle.main.object(forInfoDictionaryKey: "BearingsTeamURL") as? String,
              s.hasPrefix("https://"), let u = URL(string: s.trimmingCharacters(in: CharacterSet(charactersIn: "/"))) else { return nil }
        return u
    }()
    var configured: Bool { baseURL != nil }

    private struct Saved: Codable {
        var teamId: String
        var memberId: String
        var role: String
        var myName: String
        var myTitle: String
        var lastSync: Date?
        var teamName: String
        var plan: String
        var seats: Int
        var trialEnds: Date?
        var readOnly: Bool
    }
    private struct Secret: Codable { var token: String; var key: String }

    private var saved: Saved?
    private var secret: Secret?

    // what the Team screen shows
    var members: [TeamMember] = []
    var invites: [TeamInvite] = []
    var busy = false
    var lastError: String?
    /// Bumped whenever teammates' shares change, so screens that use them redraw.
    var rev = 0
    /// A link opened from Messages or Mail, waiting for your name before joining.
    var pendingJoin: (code: String, key: String)?
    /// The made-up team shown on the sample network and in screenshots.
    var demo = false

    var joined: Bool { saved != nil || demo }
    var teamName: String { saved?.teamName ?? (demo ? "Federal BD" : "") }
    var role: String { saved?.role ?? (demo ? "owner" : "") }
    var isAdmin: Bool { role == "owner" || role == "admin" }
    var isOwner: Bool { role == "owner" }
    var lastSync: Date? { saved?.lastSync ?? (demo ? Date() : nil) }
    var seats: Int { saved?.seats ?? 5 }
    var readOnly: Bool { saved?.readOnly ?? false }
    var plan: String { saved?.plan ?? "trial" }
    var trialEnds: Date? { saved?.trialEnds ?? (demo ? Date().addingTimeInterval(23 * 86400) : nil) }
    var myName: String { saved?.myName ?? "" }
    var myTitle: String { saved?.myTitle ?? "" }
    /// Everyone on an active team gets Bearings Pro.
    var grantsPro: Bool { saved != nil && !readOnly }

    private init() {
        if let d = UserDefaults.standard.data(forKey: "team.state") { saved = try? JSONDecoder().decode(Saved.self, from: d) }
        secret = Keychain.load(Secret.self, "team")
        if saved != nil && secret == nil { saved = nil }
    }

    private func persist() {
        if let s = saved, let d = try? JSONEncoder().encode(s) { UserDefaults.standard.set(d, forKey: "team.state") } else { UserDefaults.standard.removeObject(forKey: "team.state") }
        if let s = secret { Keychain.save(s, "team") } else { Keychain.delete("team") }
    }

    // MARK: crypto

    enum TeamError: LocalizedError {
        case server(String), notConfigured, badLink, cantRead
        var errorDescription: String? {
            switch self {
            case .server(let m): return m
            case .notConfigured: return "Team isn’t set up in this build yet."
            case .badLink: return "That doesn’t look like a Bearings team invite. Ask for a new link."
            case .cantRead: return "Couldn’t unlock a teammate’s share. Ask them to sync again."
            }
        }
    }

    static func newKey() -> String { SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }.base64URL }

    private func keyData() throws -> SymmetricKey {
        guard let k = secret?.key, let d = Data(base64URL: k), d.count == 32 else { throw TeamError.badLink }
        return SymmetricKey(data: d)
    }

    /// 0x01 | nonce | ciphertext | tag, of raw-DEFLATE'd UTF-8 JSON, as base64.
    static func seal(_ json: String, key: SymmetricKey) throws -> String {
        let raw = Data(json.utf8)
        let packed = (try? (raw as NSData).compressed(using: .zlib) as Data) ?? raw
        let box = try AES.GCM.seal(packed, using: key)
        guard let combined = box.combined else { throw TeamError.cantRead }
        return (Data([1]) + combined).base64EncodedString()
    }

    static func open(_ b64: String, key: SymmetricKey) throws -> String {
        guard let d = Data(base64Encoded: b64), d.count > 29, d.first == 1 else { throw TeamError.cantRead }
        let box = try AES.GCM.SealedBox(combined: d.dropFirst())
        let packed = try AES.GCM.open(box, using: key)
        let raw = (try? (packed as NSData).decompressed(using: .zlib) as Data) ?? packed
        guard let s = String(data: raw, encoding: .utf8) else { throw TeamError.cantRead }
        return s
    }

    private func seal(_ obj: [String: String]) throws -> String {
        let d = try JSONSerialization.data(withJSONObject: obj)
        return try Self.seal(String(decoding: d, as: UTF8.self), key: keyData())
    }

    private func openDict(_ b64: String?) -> [String: String] {
        guard let b64, let k = try? keyData(), let s = try? Self.open(b64, key: k),
              let o = try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any] else { return [:] }
        return o.compactMapValues { $0 as? String }
    }

    // MARK: the server

    private func call(_ method: String, _ path: String, _ body: [String: Any]? = nil, auth: Bool = true) async throws -> Any {
        guard let base = baseURL else { throw TeamError.notConfigured }
        var req = URLRequest(url: base.appendingPathComponent(path))
        req.httpMethod = method
        req.timeoutInterval = 30
        if auth, let t = secret?.token { req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        let obj = (try? JSONSerialization.jsonObject(with: data)) ?? [:]
        guard (200..<300).contains(status) else {
            let msg = (obj as? [String: Any])?["error"] as? String ?? "The team server didn’t answer. Try again in a minute."
            if status == 401 && auth { forget(); throw TeamError.server("You’re no longer on this team.") }
            throw TeamError.server(msg)
        }
        return obj
    }

    private func profile(_ name: String, _ title: String) throws -> String { try seal(["name": name, "title": title]) }

    /// Starts a team with you as its owner.
    func create(teamName: String, myName: String, myTitle: String) async throws {
        let key = Self.newKey()
        secret = Secret(token: "", key: key)
        do {
            let name = try seal(["name": teamName])
            let r = try await call("POST", "v1/teams", ["name": name, "profile": try profile(myName, myTitle)], auth: false) as? [String: Any]
            guard let token = r?["token"] as? String, let team = (r?["team"] as? [String: Any])?["id"] as? String,
                  let me = (r?["member"] as? [String: Any])?["id"] as? String else { throw TeamError.server("The team server sent something unexpected.") }
            secret = Secret(token: token, key: key)
            saved = Saved(teamId: team, memberId: me, role: "owner", myName: myName, myTitle: myTitle, lastSync: nil, teamName: teamName, plan: "trial", seats: 5, trialEnds: nil, readOnly: false)
            persist()
        } catch { secret = nil; throw error }
    }

    /// Reads a link like https://…/join/CODE#k=KEY or bearings://team/join?code=CODE&k=KEY.
    static func parse(_ text: String) -> (code: String, key: String)? {
        guard let u = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        var code = "", key = ""
        if u.scheme == "bearings" {
            let q = URLComponents(url: u, resolvingAgainstBaseURL: false)?.queryItems ?? []
            code = q.first { $0.name == "code" }?.value ?? ""
            key = q.first { $0.name == "k" }?.value ?? ""
        } else {
            let parts = u.pathComponents
            if let i = parts.firstIndex(of: "join"), i + 1 < parts.count { code = parts[i + 1] }
            if let f = u.fragment, f.hasPrefix("k=") { key = String(f.dropFirst(2)) }
        }
        guard !code.isEmpty, let d = Data(base64URL: key), d.count == 32 else { return nil }
        return (code, key)
    }

    func join(code: String, key: String, myName: String, myTitle: String) async throws {
        secret = Secret(token: "", key: key)
        do {
            _ = try await call("GET", "v1/invites/\(code)", auth: false)
            let r = try await call("POST", "v1/join", ["code": code, "profile": try profile(myName, myTitle)], auth: false) as? [String: Any]
            guard let token = r?["token"] as? String, let team = (r?["team"] as? [String: Any])?["id"] as? String,
                  let member = r?["member"] as? [String: Any], let me = member["id"] as? String else { throw TeamError.server("The team server sent something unexpected.") }
            secret = Secret(token: token, key: key)
            saved = Saved(teamId: team, memberId: me, role: member["role"] as? String ?? "member", myName: myName, myTitle: myTitle, lastSync: nil, teamName: "", plan: "trial", seats: 5, trialEnds: nil, readOnly: false)
            persist()
        } catch { secret = nil; throw error }
    }

    /// Team name, plan, members and open invites.
    func refresh() async throws {
        guard saved != nil else { return }
        let r = try await call("GET", "v1/team") as? [String: Any] ?? [:]
        let t = r["team"] as? [String: Any] ?? [:]
        saved?.teamName = openDict(t["name"] as? String)["name"] ?? saved?.teamName ?? ""
        saved?.plan = t["plan"] as? String ?? "trial"
        saved?.seats = t["seats"] as? Int ?? 5
        saved?.trialEnds = (t["trialEnds"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) }
        saved?.readOnly = t["readOnly"] as? Bool ?? false
        if let role = (r["me"] as? [String: Any])?["role"] as? String { saved?.role = role }
        let date = { (v: Any?) in (v as? Double).map { Date(timeIntervalSince1970: $0 / 1000) } }
        members = (r["members"] as? [[String: Any]] ?? []).map { m in
            let p = openDict(m["profile"] as? String)
            let id = m["id"] as? String ?? ""
            return TeamMember(id: id, role: m["role"] as? String ?? "member", name: p["name"] ?? "A teammate", title: p["title"] ?? "",
                              joined: date(m["joined"]) ?? Date(), shared: date(m["shareUpdated"]), isMe: id == saved?.memberId)
        }
        invites = (r["invites"] as? [[String: Any]] ?? []).map {
            TeamInvite(code: $0["code"] as? String ?? "", role: $0["role"] as? String ?? "member", usesLeft: $0["usesLeft"] as? Int ?? 0, expires: date($0["expires"]) ?? Date())
        }
        persist()
    }

    func link(for code: String) -> String {
        guard let base = baseURL, let k = secret?.key else { return "" }
        return "\(base.absoluteString)/join/\(code)#k=\(k)"
    }

    func invite(role: String, uses: Int, days: Int) async throws -> String {
        let r = try await call("POST", "v1/invites", ["role": role, "uses": uses, "days": days]) as? [String: Any]
        guard let code = r?["code"] as? String else { throw TeamError.server("Couldn’t make an invite.") }
        try? await refresh()
        return link(for: code)
    }

    func revoke(_ code: String) async throws { _ = try await call("DELETE", "v1/invites/\(code)"); try? await refresh() }
    func remove(_ id: String) async throws { _ = try await call("DELETE", "v1/members/\(id)"); try? await refresh() }
    func setRole(_ id: String, _ role: String) async throws { _ = try await call("PATCH", "v1/members/\(id)", ["role": role]); try? await refresh() }
    func rename(_ name: String) async throws { _ = try await call("PUT", "v1/team", ["name": try seal(["name": name])]); try? await refresh() }
    func updateMe(name: String, title: String) async throws {
        _ = try await call("PUT", "v1/me", ["profile": try profile(name, title)])
        saved?.myName = name; saved?.myTitle = title; persist(); try? await refresh()
    }

    /// Leaving deletes your share from the server and your copy of everyone else's.
    func leave(model: AppModel) async throws {
        if let me = saved?.memberId { _ = try await call("DELETE", "v1/members/\(me)") }
        forget()
        await clearShares(model: model)
    }

    func deleteTeam(model: AppModel) async throws {
        _ = try await call("DELETE", "v1/team")
        forget()
        await clearShares(model: model)
    }

    private func forget() {
        saved = nil; secret = nil; members = []; invites = []
        try? FileManager.default.removeItem(at: cacheURL)
        persist()
    }

    private func clearShares(model: AppModel) async {
        _ = try? await model.engine.call("setTeamShares", [[[String: String]]()], as: [TeamListItem].self)
        await model.saveFile("team", "team.json")
        rev += 1
    }

    struct Billing { var plan: String; var seats: Int; var used: Int; var trialEnds: Date?; var canCheckout: Bool }
    func billing() async throws -> Billing {
        let r = try await call("GET", "v1/billing") as? [String: Any] ?? [:]
        return Billing(plan: r["plan"] as? String ?? "trial", seats: r["seats"] as? Int ?? 5, used: r["used"] as? Int ?? 1,
                       trialEnds: (r["trialEnds"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) }, canCheckout: r["canCheckout"] as? Bool ?? false)
    }
    func checkoutURL(seats: Int) async throws -> URL? { URL(string: (try await call("POST", "v1/billing/checkout", ["seats": seats]) as? [String: Any])?["url"] as? String ?? "") }
    func portalURL() async throws -> URL? { URL(string: (try await call("POST", "v1/billing/portal", [:]) as? [String: Any])?["url"] as? String ?? "") }

    // MARK: sync

    private var cacheURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("team-shares.json")
    }
    private struct Cached: Codable { var updated: Double; var text: String }

    /// Uploads your share, downloads teammates' changed shares, and hands them to the engine.
    func sync(model: AppModel) async {
        guard saved != nil, !busy else { return }
        busy = true; lastError = nil
        defer { busy = false }
        do {
            try await refresh()
            let key = try keyData()
            if !readOnly && !model.info.isSample {
                let mine = try await model.engine.call("teamShare", [myName.isEmpty ? "A teammate" : myName], as: String.self)
                _ = try await call("PUT", "v1/share", ["body": try Self.seal(mine, key: key)])
            }
            let list = try await call("GET", "v1/shares") as? [[String: Any]] ?? []
            var cache = (try? JSONDecoder().decode([String: Cached].self, from: Data(contentsOf: cacheURL))) ?? [:]
            var next: [String: Cached] = [:]
            for s in list {
                guard let id = s["member"] as? String, id != saved?.memberId, let updated = s["updated"] as? Double else { continue }
                if let c = cache[id], c.updated == updated { next[id] = c; continue }
                let r = try await call("GET", "v1/shares/\(id)") as? [String: Any]
                if let body = r?["body"] as? String, let text = try? Self.open(body, key: key) { next[id] = Cached(updated: updated, text: text) }
            }
            cache = next
            if let d = try? JSONEncoder().encode(cache) { try? d.write(to: cacheURL, options: [.atomic, .completeFileProtection]) }
            _ = try await model.engine.call("setTeamShares", [cache.map { ["id": $0.key, "text": $0.value.text] }], as: [TeamListItem].self)
            await model.saveFile("team", "team.json")
            saved?.lastSync = Date()
            persist()
            rev += 1
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// On launch and when the app comes back: sync if it's been a while.
    func autoSync(model: AppModel) async {
        guard joined, !demo, Date().timeIntervalSince(lastSync ?? .distantPast) > 6 * 3600 else { return }
        await sync(model: model)
    }

    /// The made-up team for the sample network: three teammates who know people where you don't.
    func startDemo(model: AppModel) async {
        guard let shares = try? await model.engine.call("demoTeamShares", as: [[String: String]].self) else { return }
        _ = try? await model.engine.call("setTeamShares", [shares], as: [TeamListItem].self)
        demo = true
        let now = Date()
        members = [TeamMember(id: "me", role: "owner", name: "You", title: "Director of Federal Sales", joined: now.addingTimeInterval(-9 * 86400), shared: now, isMe: true)]
            + [("demo-0", "Pat Morgan", "Capture Manager", "admin"), ("demo-1", "Alex Reyes", "Account Executive", "member"), ("demo-2", "Sam Okafor", "Solutions Architect", "member")].enumerated().map { i, m in
                TeamMember(id: m.0, role: m.3, name: m.1, title: m.2, joined: now.addingTimeInterval(Double(-8 + i) * 86400), shared: now.addingTimeInterval(Double(-i) * 3600 * 5), isMe: false)
            }
        invites = [TeamInvite(code: "K7QW3RXT9M", role: "member", usesLeft: 9, expires: now.addingTimeInterval(12 * 86400))]
        rev += 1
    }

    func endDemo(model: AppModel) async {
        guard demo else { return }
        demo = false; members = []; invites = []
        await clearShares(model: model)
    }
}

extension Data {
    /// Reads base64url (no padding); the writer, `base64URL`, lives with the sign-in code.
    init?(base64URL s: String) {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        self.init(base64Encoded: b)
    }
}
