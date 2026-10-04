import Foundation
import CryptoKit
import Security
import Observation

/// Sends people, follow-ups and notes from Bearings to Salesforce.
/// Sign-in is OAuth 2.0 with PKCE straight from the device: no Bearings server,
/// no stored password. Tokens live in the iPhone keychain.
@MainActor
@Observable
final class Salesforce {
    static let shared = Salesforce()
    static let callback = "bearings://oauth/salesforce"
    static let api = "v61.0"

    struct Auth: Codable {
        var access: String
        var refresh: String
        var instance: String
        var domain: String
        var clientId: String
    }

    struct Link: Codable {
        var contact: String
        var account: String?
        var task: String?
        var taskDue: String?
        var note: String?
        var noteHash: String?
        var synced: String
    }

    private(set) var auth: Auth?
    private(set) var links: [String: Link] = [:]
    private(set) var busy = false
    var progress = ""
    @ObservationIgnored private var verifier = ""
    @ObservationIgnored private var store: CloudStore?

    var connected: Bool { auth != nil }
    var autoSync: Bool { UserDefaults.standard.object(forKey: "sfAuto") as? Bool ?? true }
    var createAccounts: Bool { UserDefaults.standard.object(forKey: "sfAccounts") as? Bool ?? true }
    var host: String { auth.map { URL(string: $0.instance)?.host ?? $0.instance } ?? "" }

    init() { auth = Keychain.load(Auth.self, "salesforce") }

    func attach(_ store: CloudStore) async {
        self.store = store
        if case .data(let t) = await store.read("salesforce.json"), let t, let d = t.data(using: .utf8),
           let m = try? JSONDecoder().decode([String: Link].self, from: d) { links = m }
    }

    private func saveLinks() async {
        guard let store, let d = try? JSONEncoder().encode(links) else { return }
        try? await store.write("salesforce.json", String(decoding: d, as: UTF8.self))
    }

    func contactURL(_ k: String) -> URL? {
        guard let a = auth, let l = links[k] else { return nil }
        return URL(string: "\(a.instance)/\(l.contact)")
    }

    // MARK: sign in

    /// The page to open for sign-in. `domain` is login.salesforce.com, test.salesforce.com or your My Domain.
    func authorizeURL(domain: String, clientId: String) -> URL? {
        verifier = Self.randomString(64)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        var c = URLComponents()
        c.scheme = "https"
        c.host = Self.cleanDomain(domain)
        c.path = "/services/oauth2/authorize"
        c.queryItems = [URLQueryItem(name: "response_type", value: "code"), URLQueryItem(name: "client_id", value: clientId),
                        URLQueryItem(name: "redirect_uri", value: Self.callback), URLQueryItem(name: "code_challenge", value: challenge),
                        URLQueryItem(name: "code_challenge_method", value: "S256"), URLQueryItem(name: "scope", value: "api refresh_token"),
                        URLQueryItem(name: "prompt", value: "login consent")]
        return c.url
    }

    static func cleanDomain(_ d: String) -> String {
        var s = d.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        for p in ["https://", "http://"] where s.hasPrefix(p) { s.removeFirst(p.count) }
        while s.hasSuffix("/") { s.removeLast() }
        return s.isEmpty ? "login.salesforce.com" : s
    }

    func finishSignIn(callback: URL, domain: String, clientId: String) async throws {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let err = items.first(where: { $0.name == "error_description" || $0.name == "error" })?.value {
            throw SFError(err.replacingOccurrences(of: "+", with: " "))
        }
        guard let code = items.first(where: { $0.name == "code" })?.value else { throw SFError("Salesforce didn’t send a sign-in code.") }
        let body = ["grant_type": "authorization_code", "code": code, "client_id": clientId, "redirect_uri": Self.callback, "code_verifier": verifier]
        let tok = try await token(domain: Self.cleanDomain(domain), body)
        guard let access = tok["access_token"] as? String, let instance = tok["instance_url"] as? String else { throw SFError("Salesforce didn’t return a token.") }
        let a = Auth(access: access, refresh: tok["refresh_token"] as? String ?? "", instance: instance, domain: Self.cleanDomain(domain), clientId: clientId)
        auth = a
        Keychain.save(a, "salesforce")
    }

    func disconnect() {
        if let a = auth, !a.refresh.isEmpty {
            var r = URLRequest(url: URL(string: "https://\(a.domain)/services/oauth2/revoke")!)
            r.httpMethod = "POST"
            r.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            r.httpBody = "token=\(a.refresh.formEncoded)".data(using: .utf8)
            Task { _ = try? await URLSession.shared.data(for: r) }
        }
        auth = nil
        Keychain.delete("salesforce")
    }

    private func token(domain: String, _ body: [String: String]) async throws -> [String: Any] {
        var r = URLRequest(url: URL(string: "https://\(domain)/services/oauth2/token")!)
        r.httpMethod = "POST"
        r.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        r.httpBody = body.map { "\($0.key)=\($0.value.formEncoded)" }.joined(separator: "&").data(using: .utf8)
        let (data, resp) = try await URLSession.shared.data(for: r)
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
            throw SFError((obj["error_description"] as? String) ?? (obj["error"] as? String) ?? "Salesforce sign-in failed.")
        }
        return obj
    }

    private func refreshToken() async throws {
        guard var a = auth, !a.refresh.isEmpty else { throw SFError("Your Salesforce sign-in expired. Connect again in Settings.") }
        let tok = try await token(domain: a.domain, ["grant_type": "refresh_token", "refresh_token": a.refresh, "client_id": a.clientId])
        guard let access = tok["access_token"] as? String else { throw SFError("Couldn’t renew the Salesforce sign-in.") }
        a.access = access
        if let i = tok["instance_url"] as? String { a.instance = i }
        auth = a
        Keychain.save(a, "salesforce")
    }

    // MARK: REST

    private func call(_ method: String, _ path: String, _ body: [String: Any]? = nil, retry: Bool = true) async throws -> Any? {
        guard let a = auth else { throw SFError("Connect Salesforce in Settings first.") }
        var r = URLRequest(url: URL(string: a.instance + "/services/data/\(Self.api)" + path)!)
        r.httpMethod = method
        r.setValue("Bearer \(a.access)", forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body { r.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, resp) = try await URLSession.shared.data(for: r)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 && retry {
            try await refreshToken()
            return try await call(method, path, body, retry: false)
        }
        let obj = data.isEmpty ? nil : try? JSONSerialization.jsonObject(with: data)
        guard (200..<300).contains(code) else {
            if code == 404 { throw SFError.notFound }
            let msg = ((obj as? [[String: Any]])?.first?["message"] as? String) ?? "Salesforce error \(code)"
            throw SFError(msg)
        }
        return obj ?? NSNull()
    }

    private func query(_ soql: String) async throws -> [[String: Any]] {
        let q = soql.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "+&=")))!
        let res = try await call("GET", "/query?q=\(q)") as? [String: Any]
        return res?["records"] as? [[String: Any]] ?? []
    }

    private static func lit(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'") + "'"
    }

    // MARK: sync

    /// Creates or updates the person's Contact (and Account), their follow-up Task and a Note.
    @discardableResult
    func push(_ p: Person, profileURL: String) async throws -> Link {
        var link = links[p.k]
        if link == nil {
            var found: [[String: Any]] = []
            if !p.e.isEmpty { found = try await query("SELECT Id, AccountId FROM Contact WHERE Email = \(Self.lit(p.e)) LIMIT 1") }
            if found.isEmpty && !p.c.isEmpty {
                found = try await query("SELECT Id, AccountId FROM Contact WHERE FirstName = \(Self.lit(p.f)) AND LastName = \(Self.lit(p.l)) AND Account.Name = \(Self.lit(p.c)) LIMIT 1")
            }
            if let c = found.first, let id = c["Id"] as? String {
                link = Link(contact: id, account: c["AccountId"] as? String, synced: Day.today)
            }
        }
        var accountId = link?.account
        if accountId == nil && !p.c.isEmpty {
            let a = try await query("SELECT Id FROM Account WHERE Name = \(Self.lit(p.c)) LIMIT 1")
            accountId = a.first?["Id"] as? String
            if accountId == nil && createAccounts {
                let made = try await call("POST", "/sobjects/Account", ["Name": String(p.c.prefix(255))]) as? [String: Any]
                accountId = made?["id"] as? String
            }
        }
        var fields: [String: Any] = ["Title": String(p.p.prefix(128))]
        if let accountId { fields["AccountId"] = accountId }
        if !p.e.isEmpty { fields["Email"] = p.e }
        if var l = link {
            do {
                _ = try await call("PATCH", "/sobjects/Contact/\(l.contact)", fields)
            } catch SFError.notFound {
                links[p.k] = nil
                return try await push(p, profileURL: profileURL)
            }
            l.account = accountId ?? l.account
            link = l
        } else {
            fields["FirstName"] = String(p.f.prefix(40))
            fields["LastName"] = String((p.l.isEmpty ? "(unknown)" : p.l).prefix(80))
            fields["Description"] = "LinkedIn: \(profileURL)\nAdded from Bearings on \(Day.nice(Day.today))."
            let made = try await call("POST", "/sobjects/Contact", fields) as? [String: Any]
            guard let id = made?["id"] as? String else { throw SFError("Salesforce didn’t create the contact.") }
            link = Link(contact: id, account: accountId, synced: Day.today)
        }
        guard var l = link else { throw SFError("Couldn’t link this person.") }

        // follow-up task
        let due = p.ed?.due ?? ""
        if !due.isEmpty && due != l.taskDue {
            let task: [String: Any] = ["Subject": "Follow up with \(p.fullName)", "ActivityDate": due, "WhoId": l.contact, "Status": "Not Started", "Description": "Follow-up set in Bearings."]
            if let t = l.task, (try? await call("PATCH", "/sobjects/Task/\(t)", ["ActivityDate": due, "Status": "Not Started"])) != nil {
                l.taskDue = due
            } else {
                let made = try await call("POST", "/sobjects/Task", task) as? [String: Any]
                l.task = made?["id"] as? String
                l.taskDue = due
            }
        } else if due.isEmpty, let t = l.task, l.taskDue != nil {
            _ = try? await call("PATCH", "/sobjects/Task/\(t)", ["Status": "Completed"])
            l.taskDue = nil
        }

        // notes
        let note = (p.ed?.note ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let hash = String(note.hashValueStable)
        if !note.isEmpty && hash != l.noteHash {
            let html = note.split(separator: "\n", omittingEmptySubsequences: false)
                .map { "<p>" + String($0).replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;") + "</p>" }
                .joined()
            let content = Data(html.utf8).base64EncodedString()
            if let n = l.note, (try? await call("PATCH", "/sobjects/ContentNote/\(n)", ["Content": content])) != nil {
                l.noteHash = hash
            } else {
                let made = try await call("POST", "/sobjects/ContentNote", ["Title": "Notes from Bearings", "Content": content]) as? [String: Any]
                if let id = made?["id"] as? String {
                    _ = try? await call("POST", "/sobjects/ContentDocumentLink", ["ContentDocumentId": id, "LinkedEntityId": l.contact, "ShareType": "V"])
                    l.note = id
                    l.noteHash = hash
                }
            }
        }
        l.synced = Day.today
        links[p.k] = l
        await saveLinks()
        return l
    }

    /// Sends everyone you've starred, given a follow-up, or written notes about.
    func syncAll(model: AppModel) async -> (ok: Int, failed: Int, error: String?) {
        guard connected, !busy else { return (0, 0, nil) }
        busy = true
        defer { busy = false; progress = "" }
        let list = model.people.filter { p in p.x == nil && (p.starred || !(p.ed?.due ?? "").isEmpty || !(p.ed?.note ?? "").isEmpty || links[p.k] != nil) }
        var ok = 0, failed = 0, lastError: String?
        for (i, p) in list.enumerated() {
            progress = "\(i + 1) of \(list.count)"
            await model.loadFull(p.k)
            let full = model.person(p.k) ?? p
            let url = await model.links(p.k)?.profile ?? p.u
            do { try await push(full, profileURL: url); ok += 1 } catch {
                failed += 1
                lastError = error.localizedDescription
                if (error as? SFError)?.message.contains("expired") == true { break }
            }
        }
        return (ok, failed, lastError)
    }

    /// After an edit, keep an already-linked person current in Salesforce.
    func afterEdit(_ k: String, model: AppModel) {
        guard connected, autoSync, links[k] != nil else { return }
        Task {
            guard let p = model.person(k) else { return }
            let url = await model.links(k)?.profile ?? p.u
            _ = try? await push(p, profileURL: url)
        }
    }

    static func randomString(_ n: Int) -> String {
        let chars = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        var g = SystemRandomNumberGenerator()
        return String((0..<n).map { _ in chars[Int(g.next() % UInt64(chars.count))] })
    }
}

struct SFError: LocalizedError, Equatable {
    let message: String
    init(_ m: String) { message = m }
    static let notFound = SFError("not found")
    var errorDescription: String? { message }
    static func ~= (a: SFError, b: Error) -> Bool { (b as? SFError) == a }
}

extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

extension String {
    var formEncoded: String {
        addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? self
    }
    /// A hash that stays the same between launches (Swift's hashValue doesn't).
    var hashValueStable: UInt64 {
        var h: UInt64 = 1469598103934665603
        for b in utf8 { h = (h ^ UInt64(b)) &* 1099511628211 }
        return h
    }
}

/// Small keychain wrapper for the Salesforce tokens.
enum Keychain {
    static func save<T: Encodable>(_ value: T, _ account: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.jaynichols.networkoob.auth", kSecAttrAccount as String: account]
        SecItemDelete(q as CFDictionary)
        var add = q
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func load<T: Decodable>(_ type: T.Type, _ account: String) -> T? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.jaynichols.networkoob.auth", kSecAttrAccount as String: account,
                                kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return try? JSONDecoder().decode(T.self, from: d)
    }

    static func delete(_ account: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.jaynichols.networkoob.auth", kSecAttrAccount as String: account]
        SecItemDelete(q as CFDictionary)
    }
}
