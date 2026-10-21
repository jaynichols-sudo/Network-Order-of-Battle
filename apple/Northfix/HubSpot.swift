import Foundation
import Observation

/// Sends people, follow-ups and notes from Northfix to HubSpot.
/// Sign-in is an access token the user pastes in (a HubSpot service key or a private app
/// token). There's no Northfix server and no client secret on the device. The token lives
/// in the keychain. Uses HubSpot's date-versioned REST APIs (see `apiVersion`).
@MainActor
@Observable
final class HubSpot {
    static let shared = HubSpot()
    static let base = "https://api.hubapi.com"
    static let authMessage = "HubSpot didn’t accept your access token. It may have been revoked or rotated. Paste a new one in Settings."

    /// HubSpot API version. Since March 30, 2026 HubSpot versions its REST APIs by date
    /// (`/crm/objects/2026-09/contacts` instead of `/crm/v3/objects/contacts`). A new version
    /// ships every March and September; each one is "Current" for six months and then
    /// "Supported" (critical fixes only) for at least twelve more. The old v3/v4 paths stop
    /// working in September 2027.
    /// Revisit: when 2027-03 ships (expected March 2027), read its changelog, bump this and
    /// re-check every path in `Path`. Do not let this fall more than 18 months behind.
    /// https://developers.hubspot.com/docs/api-reference/legacy/migration-guide
    /// https://developers.hubspot.com/blog/date-based-api-versioning-migration-playbook
    static let apiVersion = "2026-09"

    /// Every HubSpot path the app uses, built here and nowhere else.
    /// Migrated from the legacy v3 objects / v4 associations paths on 2026-10-13. The request
    /// and response bodies are unchanged for each of these endpoints; only the path moved.
    enum Path {
        /// Object type names HubSpot accepts in these paths ("contacts", "companies", "notes", "tasks").
        /// `/crm/v3/objects/{type}` and `/crm/v3/objects/{type}/{id}` became `/crm/objects/{ver}/{type}[/{id}]`.
        /// https://developers.hubspot.com/docs/api-reference/latest/crm/objects/contacts/guide
        /// https://developers.hubspot.com/docs/api-reference/latest/crm/activities/notes/guide
        /// https://developers.hubspot.com/docs/api-reference/latest/crm/activities/tasks/guide
        static func objects(_ type: String, _ id: String? = nil) -> String {
            let p = "/crm/objects/\(apiVersion)/\(type)"
            return id.map { p + "/\($0)" } ?? p
        }

        /// `/crm/v3/objects/{type}/search` became `/crm/objects/{ver}/{type}/search`.
        /// Body (filterGroups / filters / properties / limit) and response (results) are the same.
        /// https://developers.hubspot.com/docs/api-reference/latest/crm/search-the-crm
        static func search(_ type: String) -> String { objects(type) + "/search" }

        /// List a record's associations to another object type.
        /// `/crm/v4/objects/{from}/{id}/associations/{to}` became `/crm/objects/{ver}/{from}/{id}/associations/{to}`.
        /// The response still lists `results[].toObjectId`. The 2026-09 guide doesn't document the
        /// `limit` query parameter the v4 endpoint took, so callers shouldn't rely on it.
        /// https://developers.hubspot.com/docs/api-reference/latest/crm/associations/associate-records/guide
        static func associations(_ from: String, _ id: String, to: String) -> String {
            objects(from, id) + "/associations/\(to)"
        }

        /// Create the default (unlabeled) association between two records.
        /// `/crm/v4/objects/{from}/{id}/associations/default/{to}/{toId}` became
        /// `/crm/objects/{ver}/{from}/{id}/associations/default/{to}/{toId}`.
        /// https://developers.hubspot.com/docs/api-reference/latest/crm/associations/associate-records/guide
        static func defaultAssociation(_ from: String, _ id: String, to: String, _ toId: String) -> String {
            objects(from, id) + "/associations/default/\(to)/\(toId)"
        }

        /// One property definition. `/crm/v3/properties/{type}/{name}` became `/crm/properties/{ver}/{type}/{name}`.
        /// https://developers.hubspot.com/docs/api-reference/latest/crm/properties/get-property
        static func property(_ type: String, _ name: String) -> String { "/crm/properties/\(apiVersion)/\(type)/\(name)" }

        /// Account details (portalId, uiDomain). `/account-info/v3/details` became `/account-info/{ver}/details`.
        /// https://developers.hubspot.com/docs/api-reference/latest/account/account-information/get-account-details
        static var accountDetails: String { "/account-info/\(apiVersion)/details" }
    }

    // HubSpot-defined association types (unchanged in 2026-09)
    // https://developers.hubspot.com/docs/api-reference/latest/crm/associations/associate-records/guide
    static let contactToCompany = 279
    static let noteToContact = 202
    static let taskToContact = 204

    struct Auth: Codable {
        var token: String
        var portal: String
        var ui: String
        /// True when the account has the hs_linkedin_url contact property.
        var linkedin: Bool
    }

    struct Link: Codable {
        var contact: String
        var company: String?
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
    @ObservationIgnored private var store: CloudStore?

    var connected: Bool { auth != nil }
    var autoSync: Bool { UserDefaults.standard.object(forKey: "sfAuto") as? Bool ?? true }
    var createAccounts: Bool { UserDefaults.standard.object(forKey: "sfAccounts") as? Bool ?? true }
    var host: String {
        guard let a = auth else { return "" }
        return a.portal.isEmpty ? "HubSpot" : "Account \(a.portal)"
    }

    init() { auth = Keychain.load(Auth.self, "hubspot") }

    func attach(_ store: CloudStore) async {
        self.store = store
        if case .data(let t) = await store.read("hubspot.json"), let t, let d = t.data(using: .utf8),
           let m = try? JSONDecoder().decode([String: Link].self, from: d) { links = m }
    }

    private func saveLinks() async {
        guard let store, let d = try? JSONEncoder().encode(links) else { return }
        try? await store.write("hubspot.json", String(decoding: d, as: UTF8.self))
    }

    func contactURL(_ k: String) -> URL? {
        guard let a = auth, !a.portal.isEmpty, let l = links[k] else { return nil }
        return URL(string: "https://\(a.ui)/contacts/\(a.portal)/record/0-1/\(l.contact)")
    }

    // MARK: sign in

    /// Checks the pasted token and saves it to the keychain.
    func connect(token raw: String) async throws {
        var t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.lowercased().hasPrefix("bearer ") { t = String(t.dropFirst(7)).trimmingCharacters(in: .whitespaces) }
        guard !t.isEmpty else { throw SFError("Paste your HubSpot access token first.") }
        var a = Auth(token: t, portal: "", ui: "app.hubspot.com", linkedin: false)
        // the token must be able to read contacts
        _ = try await call("GET", Path.objects("contacts") + "?limit=1", token: t)
        if let info = try? await call("GET", Path.accountDetails, token: t) as? [String: Any] {
            if let n = info["portalId"] as? NSNumber { a.portal = n.stringValue } else if let s = info["portalId"] as? String { a.portal = s }
            if let ui = info["uiDomain"] as? String, !ui.isEmpty { a.ui = ui }
        }
        // the LinkedIn URL property isn't in every account
        if (try? await call("GET", Path.property("contacts", "hs_linkedin_url"), token: t)) != nil { a.linkedin = true }
        auth = a
        Keychain.save(a, "hubspot")
    }

    func disconnect() {
        auth = nil
        Keychain.delete("hubspot")
    }

    // MARK: REST

    private func call(_ method: String, _ path: String, _ body: [String: Any]? = nil, token: String? = nil, attempt: Int = 0) async throws -> Any? {
        guard let tok = token ?? auth?.token else { throw SFError("Connect HubSpot in Settings first.") }
        var r = URLRequest(url: URL(string: Self.base + path)!)
        r.httpMethod = method
        r.setValue("Bearer \(tok)", forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body { r.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, resp) = try await URLSession.shared.data(for: r)
        let http = resp as? HTTPURLResponse
        let code = http?.statusCode ?? 0
        if code == 429 && attempt < 3 {
            // rate limited: wait as long as HubSpot asks (a few seconds at most), then try again
            let wait = min(Double(http?.value(forHTTPHeaderField: "Retry-After") ?? "") ?? Double(attempt + 1), 10)
            try await Task.sleep(nanoseconds: UInt64(max(wait, 0.5) * 1_000_000_000))
            return try await call(method, path, body, token: token, attempt: attempt + 1)
        }
        let obj = data.isEmpty ? nil : try? JSONSerialization.jsonObject(with: data)
        guard (200..<300).contains(code) else {
            if code == 401 { throw SFError(Self.authMessage) }
            if code == 404 { throw SFError.notFound }
            if code == 429 { throw SFError("HubSpot is busy. Try again in a minute.") }
            var msg = ((obj as? [String: Any])?["message"] as? String) ?? "HubSpot error \(code)"
            if code == 403 { msg = "Your HubSpot token is missing a permission. " + msg }
            throw SFError(msg)
        }
        return obj ?? NSNull()
    }

    /// One record of `type` where every property equals its value.
    private func find(_ type: String, _ filters: [(String, String)], properties: [String] = []) async throws -> [String: Any]? {
        let f: [[String: Any]] = filters.map { ["propertyName": $0.0, "operator": "EQ", "value": $0.1] }
        let body: [String: Any] = ["filterGroups": [["filters": f]], "properties": properties, "limit": 1]
        let res = try await call("POST", Path.search(type), body) as? [String: Any]
        return (res?["results"] as? [[String: Any]])?.first
    }

    private static func id(_ v: Any?) -> String? {
        if let s = v as? String { return s }
        if let n = v as? NSNumber { return n.stringValue }
        return nil
    }

    private static func assoc(_ to: String, _ type: Int) -> [[String: Any]] {
        [["to": ["id": to], "types": [["associationCategory": "HUBSPOT_DEFINED", "associationTypeId": type]]]]
    }

    private static func timestamp(_ day: String) -> String {
        // 9am local on the follow-up day
        let d = Day.date(day).map { $0.addingTimeInterval(9 * 3600) } ?? Date()
        return ISO8601DateFormatter().string(from: d)
    }

    // MARK: sync

    /// Creates or updates the person's contact (and company), their follow-up task and a note.
    func push(_ p: Person, profileURL: String) async throws {
        guard let a = auth else { throw SFError("Connect HubSpot in Settings first.") }
        let linkedin = a.linkedin && profileURL.hasPrefix("http") ? profileURL : ""
        var link = links[p.k]
        if link == nil {
            var found: [String: Any]?
            if !p.e.isEmpty { found = try await find("contacts", [("email", p.e)]) }
            if found == nil && !linkedin.isEmpty { found = try await find("contacts", [("hs_linkedin_url", linkedin)]) }
            if found == nil && !p.c.isEmpty && !p.l.isEmpty {
                found = try await find("contacts", [("firstname", p.f), ("lastname", p.l), ("company", p.c)])
            }
            if let c = found, let id = Self.id(c["id"]) {
                var company: String?
                // only the first result is used, so no `limit` here (see Path.associations)
                if let r = try? await call("GET", Path.associations("contacts", id, to: "companies")) as? [String: Any] {
                    company = ((r["results"] as? [[String: Any]])?.first).flatMap { Self.id($0["toObjectId"]) }
                }
                link = Link(contact: id, company: company, synced: Day.today)
            }
        }
        var companyId = link?.company
        if companyId == nil && !p.c.isEmpty {
            let co = try await find("companies", [("name", p.c)])
            companyId = Self.id(co?["id"])
            if companyId == nil && createAccounts {
                let made = try await call("POST", Path.objects("companies"), ["properties": ["name": p.c]]) as? [String: Any]
                companyId = Self.id(made?["id"])
            }
        }
        var props: [String: Any] = ["jobtitle": p.p]
        if !p.c.isEmpty { props["company"] = p.c }
        if !p.e.isEmpty { props["email"] = p.e }
        if !linkedin.isEmpty { props["hs_linkedin_url"] = linkedin }
        if var l = link {
            do {
                _ = try await call("PATCH", Path.objects("contacts", l.contact), ["properties": props])
            } catch SFError.notFound {
                links[p.k] = nil
                return try await push(p, profileURL: profileURL)
            }
            if let c = companyId, c != l.company {
                _ = try? await call("PUT", Path.defaultAssociation("contacts", l.contact, to: "companies", c))
                l.company = c
            }
            link = l
        } else {
            props["firstname"] = p.f
            props["lastname"] = p.l.isEmpty ? "(unknown)" : p.l
            var body: [String: Any] = ["properties": props]
            if let c = companyId { body["associations"] = Self.assoc(c, Self.contactToCompany) }
            let made = try await call("POST", Path.objects("contacts"), body) as? [String: Any]
            guard let id = Self.id(made?["id"]) else { throw SFError("HubSpot didn’t create the contact.") }
            link = Link(contact: id, company: companyId, synced: Day.today)
        }
        guard var l = link else { throw SFError("Couldn’t link this person.") }

        // follow-up task
        let due = p.ed?.due ?? ""
        if !due.isEmpty && due != l.taskDue {
            if let t = l.task, (try? await call("PATCH", Path.objects("tasks", t), ["properties": ["hs_timestamp": Self.timestamp(due), "hs_task_status": "NOT_STARTED"]])) != nil {
                l.taskDue = due
            } else {
                let task: [String: Any] = ["properties": ["hs_timestamp": Self.timestamp(due), "hs_task_subject": "Follow up with \(p.fullName)",
                                                          "hs_task_body": "Follow-up set in Northfix.", "hs_task_status": "NOT_STARTED", "hs_task_type": "TODO"],
                                           "associations": Self.assoc(l.contact, Self.taskToContact)]
                let made = try await call("POST", Path.objects("tasks"), task) as? [String: Any]
                l.task = Self.id(made?["id"])
                l.taskDue = due
            }
        } else if due.isEmpty, let t = l.task, l.taskDue != nil {
            _ = try? await call("PATCH", Path.objects("tasks", t), ["properties": ["hs_task_status": "COMPLETED"]])
            l.taskDue = nil
        }

        // notes
        let note = (p.ed?.note ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let hash = String(note.hashValueStable)
        if !note.isEmpty && hash != l.noteHash {
            let html = note.split(separator: "\n", omittingEmptySubsequences: false)
                .map { "<p>" + String($0).replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;") + "</p>" }
                .joined()
            let body = "<p><strong>Notes from Northfix</strong></p>" + html
            if let n = l.note, (try? await call("PATCH", Path.objects("notes", n), ["properties": ["hs_note_body": body]])) != nil {
                l.noteHash = hash
            } else {
                let made = try await call("POST", Path.objects("notes"), ["properties": ["hs_timestamp": ISO8601DateFormatter().string(from: Date()), "hs_note_body": body],
                                                                          "associations": Self.assoc(l.contact, Self.noteToContact)]) as? [String: Any]
                if let id = Self.id(made?["id"]) {
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

    /// After an edit, keep an already-linked person current in HubSpot.
    func afterEdit(_ k: String, model: AppModel) {
        guard connected, autoSync, links[k] != nil else { return }
        Task {
            guard let p = model.person(k) else { return }
            let url = await model.links(k)?.profile ?? p.u
            try? await push(p, profileURL: url)
        }
    }
}
