import Foundation
import CryptoKit
import Observation

/// Sends people, follow-ups and notes from Northfix to Microsoft Dynamics 365 (Dataverse).
/// Sign-in is OAuth 2.0 with PKCE against Microsoft Entra, straight from the device, as a
/// public client: no client secret, no Northfix server. Tokens live in the keychain.
/// Writes go to the Dataverse Web API v9.2.
@MainActor
@Observable
final class Dynamics {
    static let shared = Dynamics()
    static let callback = "bearings://oauth/dynamics"
    static let api = "v9.2"
    static let authMessage = "Your Dynamics 365 sign-in expired. Connect again in Settings."

    struct Auth: Codable {
        var access: String
        var refresh: String
        /// The environment host, like contoso.crm.dynamics.com
        var org: String
        var tenant: String
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
    var host: String { auth?.org ?? "" }

    init() { auth = Keychain.load(Auth.self, "dynamics") }

    func attach(_ store: CloudStore) async {
        self.store = store
        if case .data(let t) = await store.read("dynamics.json"), let t, let d = t.data(using: .utf8),
           let m = try? JSONDecoder().decode([String: Link].self, from: d) { links = m }
    }

    private func saveLinks() async {
        guard let store, let d = try? JSONEncoder().encode(links) else { return }
        try? await store.write("dynamics.json", String(decoding: d, as: UTF8.self))
    }

    func contactURL(_ k: String) -> URL? {
        guard let a = auth, let l = links[k] else { return nil }
        return URL(string: "https://\(a.org)/main.aspx?pagetype=entityrecord&etn=contact&id=\(l.contact)")
    }

    // MARK: sign in

    /// contoso.crm.dynamics.com from whatever the user pasted (a full URL works too).
    static func cleanOrg(_ s: String) -> String {
        var h = s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        for p in ["https://", "http://"] where h.hasPrefix(p) { h.removeFirst(p.count) }
        if let slash = h.firstIndex(of: "/") { h = String(h[..<slash]) }
        return h
    }

    static func cleanTenant(_ s: String) -> String {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? "organizations" : t
    }

    private static func scope(_ org: String) -> String { "https://\(org)/user_impersonation offline_access" }

    /// The Microsoft sign-in page. `tenant` is blank (any work account), a tenant ID or a domain.
    func authorizeURL(org: String, tenant: String, clientId: String) -> URL? {
        let o = Self.cleanOrg(org)
        guard !o.isEmpty else { return nil }
        verifier = Salesforce.randomString(64)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        var c = URLComponents()
        c.scheme = "https"
        c.host = "login.microsoftonline.com"
        c.path = "/\(Self.cleanTenant(tenant))/oauth2/v2.0/authorize"
        c.queryItems = [URLQueryItem(name: "client_id", value: clientId), URLQueryItem(name: "response_type", value: "code"),
                        URLQueryItem(name: "redirect_uri", value: Self.callback), URLQueryItem(name: "response_mode", value: "query"),
                        URLQueryItem(name: "scope", value: Self.scope(o)), URLQueryItem(name: "code_challenge", value: challenge),
                        URLQueryItem(name: "code_challenge_method", value: "S256"), URLQueryItem(name: "prompt", value: "select_account")]
        return c.url
    }

    func finishSignIn(callback: URL, org: String, tenant: String, clientId: String) async throws {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let err = items.first(where: { $0.name == "error_description" || $0.name == "error" })?.value {
            throw SFError(err.replacingOccurrences(of: "+", with: " "))
        }
        guard let code = items.first(where: { $0.name == "code" })?.value else { throw SFError("Microsoft didn’t send a sign-in code.") }
        let o = Self.cleanOrg(org), t = Self.cleanTenant(tenant)
        let tok = try await token(tenant: t, ["client_id": clientId, "grant_type": "authorization_code", "code": code,
                                              "redirect_uri": Self.callback, "code_verifier": verifier, "scope": Self.scope(o)])
        guard let access = tok["access_token"] as? String else { throw SFError("Microsoft didn’t return a token.") }
        let a = Auth(access: access, refresh: tok["refresh_token"] as? String ?? "", org: o, tenant: t, clientId: clientId)
        auth = a
        Keychain.save(a, "dynamics")
        // make sure the token works against this environment
        do { _ = try await call("GET", "/WhoAmI") } catch {
            disconnect()
            throw error
        }
    }

    func disconnect() {
        // Entra has no simple token revoke for public clients; forgetting the tokens ends the session here.
        auth = nil
        Keychain.delete("dynamics")
    }

    private func token(tenant: String, _ body: [String: String]) async throws -> [String: Any] {
        var r = URLRequest(url: URL(string: "https://login.microsoftonline.com/\(tenant)/oauth2/v2.0/token")!)
        r.httpMethod = "POST"
        r.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        r.httpBody = body.map { "\($0.key)=\($0.value.formEncoded)" }.joined(separator: "&").data(using: .utf8)
        let (data, resp) = try await URLSession.shared.data(for: r)
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
            let msg = (obj["error_description"] as? String) ?? (obj["error"] as? String) ?? "Microsoft sign-in failed."
            // Entra appends trace and correlation lines; the first line is the useful part
            throw SFError(msg.components(separatedBy: "\r\n").first ?? msg)
        }
        return obj
    }

    private func refreshToken() async throws {
        guard var a = auth, !a.refresh.isEmpty else { throw SFError(Self.authMessage) }
        let tok: [String: Any]
        do {
            tok = try await token(tenant: a.tenant, ["client_id": a.clientId, "grant_type": "refresh_token",
                                                     "refresh_token": a.refresh, "scope": Self.scope(a.org)])
        } catch { throw SFError(Self.authMessage) }
        guard let access = tok["access_token"] as? String else { throw SFError(Self.authMessage) }
        a.access = access
        // Entra rotates refresh tokens: keep the newest one
        if let r = tok["refresh_token"] as? String, !r.isEmpty { a.refresh = r }
        auth = a
        Keychain.save(a, "dynamics")
    }

    // MARK: Web API

    private func call(_ method: String, _ path: String, _ body: [String: Any]? = nil, returning: Bool = false, retry: Bool = true, attempt: Int = 0) async throws -> Any? {
        guard let a = auth else { throw SFError("Connect Dynamics 365 in Settings first.") }
        guard let url = URL(string: "https://\(a.org)/api/data/\(Self.api)" + path) else { throw SFError("That Dynamics 365 address doesn’t look right.") }
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.setValue("Bearer \(a.access)", forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        r.setValue("4.0", forHTTPHeaderField: "OData-MaxVersion")
        r.setValue("4.0", forHTTPHeaderField: "OData-Version")
        if returning { r.setValue("return=representation", forHTTPHeaderField: "Prefer") }
        // PATCH would otherwise create a record when the id is gone
        if method == "PATCH" { r.setValue("*", forHTTPHeaderField: "If-Match") }
        if let body { r.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, resp) = try await URLSession.shared.data(for: r)
        let http = resp as? HTTPURLResponse
        let code = http?.statusCode ?? 0
        if code == 401 && retry {
            try await refreshToken()
            return try await call(method, path, body, returning: returning, retry: false, attempt: attempt)
        }
        if code == 429 && attempt < 3 {
            let wait = min(Double(http?.value(forHTTPHeaderField: "Retry-After") ?? "") ?? Double(attempt + 1), 10)
            try await Task.sleep(nanoseconds: UInt64(max(wait, 0.5) * 1_000_000_000))
            return try await call(method, path, body, returning: returning, retry: retry, attempt: attempt + 1)
        }
        let obj = data.isEmpty ? nil : try? JSONSerialization.jsonObject(with: data)
        guard (200..<300).contains(code) else {
            if code == 401 { throw SFError(Self.authMessage) }
            if code == 404 { throw SFError.notFound }
            if code == 429 { throw SFError("Dynamics 365 is busy. Try again in a minute.") }
            let msg = (((obj as? [String: Any])?["error"] as? [String: Any])?["message"] as? String) ?? "Dynamics 365 error \(code)"
            throw SFError(msg)
        }
        return obj ?? NSNull()
    }

    /// GET a collection with an OData filter; returns its rows.
    private func rows(_ set: String, select: String, filter: String) async throws -> [[String: Any]] {
        let f = filter.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "+&=#")))!
        let res = try await call("GET", "/\(set)?$select=\(select)&$filter=\(f)&$top=1") as? [String: Any]
        return res?["value"] as? [[String: Any]] ?? []
    }

    /// An OData string literal.
    private static func lit(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "''") + "'" }

    private static func timestamp(_ day: String) -> String {
        // 9am local on the follow-up day
        let d = Day.date(day).map { $0.addingTimeInterval(9 * 3600) } ?? Date()
        return ISO8601DateFormatter().string(from: d)
    }

    // MARK: sync

    /// Creates or updates the person's contact (and account), their follow-up task and a note.
    func push(_ p: Person, profileURL: String) async throws {
        var link = links[p.k]
        if link == nil {
            var found: [[String: Any]] = []
            if !p.e.isEmpty { found = try await rows("contacts", select: "contactid,_parentcustomerid_value", filter: "emailaddress1 eq \(Self.lit(p.e))") }
            if found.isEmpty && !p.c.isEmpty && !p.l.isEmpty {
                found = try await rows("contacts", select: "contactid,_parentcustomerid_value",
                                       filter: "firstname eq \(Self.lit(p.f)) and lastname eq \(Self.lit(p.l)) and parentcustomerid_account/name eq \(Self.lit(p.c))")
            }
            if let c = found.first, let id = c["contactid"] as? String {
                link = Link(contact: id, account: c["_parentcustomerid_value"] as? String, synced: Day.today)
            }
        }
        var accountId = link?.account
        if accountId == nil && !p.c.isEmpty {
            let a = try await rows("accounts", select: "accountid", filter: "name eq \(Self.lit(p.c))")
            accountId = a.first?["accountid"] as? String
            if accountId == nil && createAccounts {
                let made = try await call("POST", "/accounts?$select=accountid", ["name": String(p.c.prefix(160))], returning: true) as? [String: Any]
                accountId = made?["accountid"] as? String
            }
        }
        var fields: [String: Any] = ["jobtitle": String(p.p.prefix(100))]
        if let accountId { fields["parentcustomerid_account@odata.bind"] = "/accounts(\(accountId))" }
        if !p.e.isEmpty { fields["emailaddress1"] = String(p.e.prefix(100)) }
        if var l = link {
            do {
                _ = try await call("PATCH", "/contacts(\(l.contact))", fields)
            } catch SFError.notFound {
                links[p.k] = nil
                return try await push(p, profileURL: profileURL)
            }
            l.account = accountId ?? l.account
            link = l
        } else {
            fields["firstname"] = String(p.f.prefix(50))
            fields["lastname"] = String((p.l.isEmpty ? "(unknown)" : p.l).prefix(50))
            if profileURL.hasPrefix("http") && profileURL.count <= 200 { fields["websiteurl"] = profileURL }
            fields["description"] = "LinkedIn: \(profileURL)\nAdded from Northfix on \(Day.nice(Day.today))."
            let made = try await call("POST", "/contacts?$select=contactid", fields, returning: true) as? [String: Any]
            guard let id = made?["contactid"] as? String else { throw SFError("Dynamics 365 didn’t create the contact.") }
            link = Link(contact: id, account: accountId, synced: Day.today)
        }
        guard var l = link else { throw SFError("Couldn’t link this person.") }

        // follow-up task
        let due = p.ed?.due ?? ""
        if !due.isEmpty && due != l.taskDue {
            if let t = l.task, (try? await call("PATCH", "/tasks(\(t))", ["scheduledend": Self.timestamp(due), "statecode": 0, "statuscode": 2])) != nil {
                l.taskDue = due
            } else {
                let task: [String: Any] = ["subject": String("Follow up with \(p.fullName)".prefix(200)), "description": "Follow-up set in Northfix.",
                                           "scheduledend": Self.timestamp(due), "regardingobjectid_contact_task@odata.bind": "/contacts(\(l.contact))"]
                let made = try await call("POST", "/tasks?$select=activityid", task, returning: true) as? [String: Any]
                l.task = made?["activityid"] as? String
                l.taskDue = due
            }
        } else if due.isEmpty, let t = l.task, l.taskDue != nil {
            _ = try? await call("PATCH", "/tasks(\(t))", ["statecode": 1, "statuscode": 5])
            l.taskDue = nil
        }

        // notes
        let note = (p.ed?.note ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let hash = String(note.hashValueStable)
        if !note.isEmpty && hash != l.noteHash {
            if let n = l.note, (try? await call("PATCH", "/annotations(\(n))", ["notetext": note])) != nil {
                l.noteHash = hash
            } else {
                let made = try await call("POST", "/annotations?$select=annotationid",
                                          ["subject": "Notes from Northfix", "notetext": note, "objectid_contact@odata.bind": "/contacts(\(l.contact))"],
                                          returning: true) as? [String: Any]
                if let id = made?["annotationid"] as? String {
                    l.note = id
                    l.noteHash = hash
                }
            }
        }
        l.synced = Day.today
        links[p.k] = l
        await saveLinks()
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
                if (error as? SFError)?.message == Self.authMessage { break }
            }
        }
        return (ok, failed, lastError)
    }

    /// After an edit, keep an already-linked person current in Dynamics 365.
    func afterEdit(_ k: String, model: AppModel) {
        guard connected, autoSync, links[k] != nil else { return }
        Task {
            guard let p = model.person(k) else { return }
            let url = await model.links(k)?.profile ?? p.u
            try? await push(p, profileURL: url)
        }
    }
}
