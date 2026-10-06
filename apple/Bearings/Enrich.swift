import Foundation
import Security

/// Optional enrichment from the user's own ZoomInfo or Seamless.AI account: work email,
/// phone, current title and location for the people they choose. This is the one feature
/// that sends anything off the device: the names and companies being looked up go to that
/// provider, only when the user asks. Credentials stay in this device's Keychain.

struct Enriched: Codable, Hashable {
    var src: String
    var at: String
    var email: String?
    var phone: String?
    var mobile: String?
    var title: String?
    var company: String?
    var city: String?
    var state: String?
    var country: String?

    var sourceName: String { src == "zoominfo" ? "ZoomInfo" : src == "seamless" ? "Seamless.AI" : src == "file" ? "your enrichment file" : src }
    var location: String { [city, state].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: ", ") }

    /// A city on the map, when it's one Bearings knows (US cities offline).
    var place: PersonPlace? {
        guard let city, !city.isEmpty else { return nil }
        let st = state.map { s in s.count == 2 ? s.uppercased() : (PlaceIndex.usStates[s.lowercased()] ?? "") } ?? ""
        let us = country == nil || country!.isEmpty || ["us", "usa", "united states", "united states of america"].contains(country!.lowercased())
        guard us, let c = PlaceIndex.shared.city(city, admin: st) ?? (st.isEmpty ? nil : PlaceIndex.shared.city(city)) else { return nil }
        return PersonPlace(name: [city, st].filter { !$0.isEmpty }.joined(separator: ", "), lat: c.0, lon: c.1, prec: "city", src: src)
    }
}

enum EnrichProvider: String, CaseIterable, Identifiable {
    case off, zoominfo, seamless
    var id: String { rawValue }
    var title: String { self == .zoominfo ? "ZoomInfo" : self == .seamless ? "Seamless.AI" : "Off" }

    static var current: EnrichProvider {
        get { EnrichProvider(rawValue: UserDefaults.standard.string(forKey: "enrichProvider") ?? "") ?? .off }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: "enrichProvider") }
    }

    var configured: Bool {
        switch self {
        case .off: return false
        case .zoominfo:
            let user = !(SecretStore.get("enrich.zoominfo.user") ?? "").isEmpty
            let pass = !(SecretStore.get("enrich.zoominfo.pass") ?? "").isEmpty
            let pki = !(SecretStore.get("enrich.zoominfo.client") ?? "").isEmpty && !(SecretStore.get("enrich.zoominfo.key") ?? "").isEmpty
            return user && (pass || pki)
        case .seamless: return SeamlessAuth.signedIn || !(SecretStore.get("enrich.seamless.key") ?? "").isEmpty
        }
    }
}

/// Small Keychain wrapper for provider credentials: this device only, never synced, readable after first unlock.
enum SecretStore {
    private static let service = "com.jaynichols.networkoob.enrich"

    static func set(_ key: String, _ value: String?) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
        SecItemDelete(base as CFDictionary)
        guard let value, !value.isEmpty else { return }
        var add = base
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func get(_ key: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key,
                                kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }
}

struct EnrichFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// What a provider gets for each person: name, company, title and the LinkedIn link.
struct EnrichQuery {
    var k: String
    var first: String
    var last: String
    var company: String
    var title: String
    var email: String
    var linkedIn: String
}

enum EnrichClient {
    static func run(_ provider: EnrichProvider, _ people: [EnrichQuery]) async throws -> [String: Enriched] {
        switch provider {
        case .zoominfo: return try await ZoomInfo.enrich(people)
        case .seamless: return try await Seamless.enrich(people)
        case .off: throw EnrichFailure(message: "Choose ZoomInfo or Seamless.AI in Settings first.")
        }
    }

    static func json(_ req: URLRequest) async throws -> (Int, Any) {
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        return (status, (try? JSONSerialization.jsonObject(with: data)) ?? [:])
    }

    static func str(_ o: Any?) -> String? {
        if let s = o as? String { let t = s.trimmingCharacters(in: .whitespacesAndNewlines); return t.isEmpty ? nil : t }
        if let n = o as? NSNumber { return n.stringValue }
        return nil
    }
}

// MARK: ZoomInfo (Enterprise API: username and password give a JWT for an hour)

enum ZoomInfo {
    private static var jwt: (token: String, until: Date)?

    /// Signs in with a username and either a password or, for PKI accounts, a client ID and private key.
    static func token(user: String? = nil, pass: String? = nil, client: String? = nil, key: String? = nil, fresh: Bool = false) async throws -> String {
        if !fresh, let j = jwt, j.until > Date() { return j.token }
        let user = user ?? SecretStore.get("enrich.zoominfo.user") ?? ""
        let pass = pass ?? SecretStore.get("enrich.zoominfo.pass") ?? ""
        let client = client ?? SecretStore.get("enrich.zoominfo.client") ?? ""
        let key = key ?? SecretStore.get("enrich.zoominfo.key") ?? ""
        let pki = !client.isEmpty && !key.isEmpty
        guard !user.isEmpty, pki || !pass.isEmpty
        else { throw EnrichFailure(message: "Add your ZoomInfo API username and password, or client ID and private key, in Settings.") }
        var req = URLRequest(url: URL(string: "https://api.zoominfo.com/authenticate")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if pki {
            req.setValue("Bearer \(try ZoomInfoPKI.clientJWT(user: user, client: client, pem: key))", forHTTPHeaderField: "Authorization")
        } else {
            req.httpBody = try JSONSerialization.data(withJSONObject: ["username": user, "password": pass])
        }
        let (status, body) = try await EnrichClient.json(req)
        guard status == 200, let t = (body as? [String: Any])?["jwt"] as? String else {
            throw EnrichFailure(message: status == 401 || status == 403
                ? (pki ? "ZoomInfo didn’t accept that client ID and key. Check they belong to this username."
                       : "ZoomInfo didn’t accept that username and password. API access may need to be turned on for your account.")
                : "Couldn’t sign in to ZoomInfo (\(status)).")
        }
        jwt = (t, Date().addingTimeInterval(55 * 60))
        return t
    }

    static let fields = ["id", "firstName", "lastName", "email", "phone", "mobilePhone", "jobTitle", "companyName", "city", "state", "country"]

    static func enrich(_ people: [EnrichQuery]) async throws -> [String: Enriched] {
        var out: [String: Enriched] = [:]
        let today = Day.today
        for start in stride(from: 0, to: people.count, by: 25) {
            let chunk = Array(people[start..<min(people.count, start + 25)])
            let input: [[String: String]] = chunk.map { q in
                var m = ["firstName": q.first, "lastName": q.last, "companyName": q.company]
                if !q.email.isEmpty { m["emailAddress"] = q.email }
                return m
            }
            var req = URLRequest(url: URL(string: "https://api.zoominfo.com/enrich/contact")!)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
            req.httpBody = try JSONSerialization.data(withJSONObject: ["matchPersonInput": input, "outputFields": fields])
            var (status, body) = try await EnrichClient.json(req)
            if status == 401 {
                req.setValue("Bearer \(try await token(fresh: true))", forHTTPHeaderField: "Authorization")
                (status, body) = try await EnrichClient.json(req)
            }
            guard status == 200 else {
                let msg = ((body as? [String: Any])?["message"] as? String) ?? ""
                throw EnrichFailure(message: status == 429 ? "ZoomInfo’s rate limit was reached. Try again in a minute." : "ZoomInfo returned an error (\(status)). \(msg)")
            }
            let results = ((body as? [String: Any])?["data"] as? [String: Any])?["result"] as? [[String: Any]] ?? []
            for (i, r) in results.enumerated() where i < chunk.count {
                guard let d = (r["data"] as? [[String: Any]])?.first else { continue }
                let company = EnrichClient.str(d["companyName"]) ?? EnrichClient.str((d["company"] as? [String: Any])?["name"])
                out[chunk[i].k] = Enriched(src: "zoominfo", at: today, email: EnrichClient.str(d["email"]), phone: EnrichClient.str(d["phone"]),
                                           mobile: EnrichClient.str(d["mobilePhone"]), title: EnrichClient.str(d["jobTitle"]), company: company,
                                           city: EnrichClient.str(d["city"]), state: EnrichClient.str(d["state"]), country: EnrichClient.str(d["country"]))
            }
        }
        return out
    }
}

/// ZoomInfo's PKI sign-in: a short-lived token signed on this device with the account's private key (RS256).
enum ZoomInfoPKI {
    static func clientJWT(user: String, client: String, pem: String, now: Date = Date()) throws -> String {
        let key = try privateKey(pem)
        let iat = Int(now.timeIntervalSince1970)
        let header = ["alg": "RS256", "typ": "JWT"]
        let claims: [String: Any] = ["aud": "enterprise_api", "iss": "api-client@zoominfo.com", "username": user,
                                     "client_id": client, "iat": iat, "exp": iat + 300]
        let h = b64url(try JSONSerialization.data(withJSONObject: header, options: .sortedKeys))
        let c = b64url(try JSONSerialization.data(withJSONObject: claims, options: .sortedKeys))
        let input = Data("\(h).\(c)".utf8)
        var err: Unmanaged<CFError>?
        guard let sig = SecKeyCreateSignature(key, .rsaSignatureMessagePKCS1v15SHA256, input as CFData, &err) as Data? else {
            throw EnrichFailure(message: "Couldn’t sign with that private key.")
        }
        return "\(h).\(c).\(b64url(sig))"
    }

    /// Accepts a PEM private key in PKCS#8 ("BEGIN PRIVATE KEY") or PKCS#1 ("BEGIN RSA PRIVATE KEY") form.
    static func privateKey(_ pem: String) throws -> SecKey {
        let body = pem.components(separatedBy: .newlines).filter { !$0.hasPrefix("-----") }.joined()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard var der = Data(base64Encoded: body, options: .ignoreUnknownCharacters), !der.isEmpty else {
            throw EnrichFailure(message: "That doesn’t look like a private key. Paste the whole key, including the BEGIN and END lines.")
        }
        if pem.contains("BEGIN PRIVATE KEY"), let inner = pkcs8Inner(der) { der = inner }
        let attrs: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeRSA, kSecAttrKeyClass as String: kSecAttrKeyClassPrivate]
        var err: Unmanaged<CFError>?
        guard let key = SecKeyCreateWithData(der as CFData, attrs as CFDictionary, &err) else {
            throw EnrichFailure(message: "Couldn’t read that private key. ZoomInfo PKI keys are RSA keys in PEM form.")
        }
        return key
    }

    /// PKCS#8 wraps the PKCS#1 key: SEQUENCE { INTEGER, SEQUENCE { algorithm }, OCTET STRING { key } }.
    static func pkcs8Inner(_ d: Data) -> Data? {
        let b = [UInt8](d)
        var i = 0
        func length() -> Int? {
            guard i < b.count else { return nil }
            let first = Int(b[i]); i += 1
            if first < 0x80 { return first }
            let n = first & 0x7f
            guard n > 0, n <= 4, i + n <= b.count else { return nil }
            var len = 0
            for _ in 0..<n { len = (len << 8) | Int(b[i]); i += 1 }
            return len
        }
        func expect(_ tag: UInt8) -> Int? {
            guard i < b.count, b[i] == tag else { return nil }
            i += 1
            return length()
        }
        guard expect(0x30) != nil else { return nil }          // outer SEQUENCE
        guard let vl = expect(0x02) else { return nil }; i += vl // version
        guard let al = expect(0x30) else { return nil }; i += al // algorithm
        guard let kl = expect(0x04), i + kl <= b.count else { return nil }
        return Data(b[i..<(i + kl)])
    }

    static func b64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

// MARK: Seamless.AI (API key; research is asynchronous: start it, then poll)

enum Seamless {
    static let base = "https://api.seamless.ai/api/client/v1"

    static func request(_ path: String, method: String = "GET", body: Any? = nil, key: String? = nil) async throws -> URLRequest {
        var req = URLRequest(url: URL(string: base + path)!)
        // signed in with Seamless (OAuth) wins; an API key is the fallback for admins
        if key == nil, let bearer = try await SeamlessAuth.accessToken() {
            req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        } else {
            guard let key = key ?? SecretStore.get("enrich.seamless.key"), !key.isEmpty else { throw EnrichFailure(message: "Sign in with Seamless.AI in Settings first.") }
            req.setValue(key, forHTTPHeaderField: "Token")
        }
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
        return req
    }

    static func enrich(_ people: [EnrichQuery]) async throws -> [String: Enriched] {
        var out: [String: Enriched] = [:]
        let today = Day.today
        for start in stride(from: 0, to: people.count, by: 100) {
            let chunk = Array(people[start..<min(people.count, start + 100)])
            let contacts: [[String: String]] = chunk.map { q in
                var m = ["contactName": "\(q.first) \(q.last)".trimmingCharacters(in: .whitespaces), "companyName": q.company]
                if !q.title.isEmpty { m["title"] = q.title }
                if !q.email.isEmpty { m["email"] = q.email }
                if !q.linkedIn.isEmpty { m["liProfileUrl"] = q.linkedIn }
                return m
            }
            let (status, body) = try await EnrichClient.json(try await request("/contacts/research", method: "POST", body: ["contacts": contacts]))
            guard status == 200 || status == 202, let ids = (body as? [String: Any])?["requestIds"] as? [String] else {
                throw EnrichFailure(message: status == 401 ? "Seamless.AI didn’t accept that API key." : status == 402 || status == 403
                    ? "Seamless.AI says this needs more credits or API access on your plan." : "Seamless.AI returned an error (\(status)).")
            }
            var owner: [String: String] = [:]
            for (i, id) in ids.enumerated() where i < chunk.count { owner[id] = chunk[i].k }
            var waiting = Set(ids)
            for _ in 0..<30 where !waiting.isEmpty {
                try await Task.sleep(nanoseconds: 2_000_000_000)
                let q = waiting.sorted().joined(separator: ",").addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
                let (st, b) = try await EnrichClient.json(try await request("/contacts/research/poll?requestIds=\(q)"))
                guard st == 200 else { continue }
                for item in (b as? [String: Any])?["data"] as? [[String: Any]] ?? [] {
                    guard let id = item["requestId"] as? String else { continue }
                    let s = (item["status"] as? String ?? "").lowercased()
                    if s == "pending" || s == "processing" || s == "in_progress" { continue }
                    waiting.remove(id)
                    guard let k = owner[id], let c = item["contact"] as? [String: Any] else { continue }
                    let loc = c["contactLocation"] as? [String: Any]
                    out[k] = Enriched(src: "seamless", at: today, email: EnrichClient.str(c["email"]), phone: EnrichClient.str(c["contactPhone1"]),
                                      mobile: nil, title: EnrichClient.str(c["title"]), company: EnrichClient.str(c["company"]),
                                      city: EnrichClient.str(loc?["city"]), state: EnrichClient.str(loc?["stateAbbr"]) ?? EnrichClient.str(loc?["state"]),
                                      country: EnrichClient.str(loc?["country"]))
                }
            }
        }
        return out
    }
}

extension AppModel {
    /// Looks people up with the chosen provider, keeps what it finds, and puts the new cities on the map.
    func enrich(_ keys: [String]) async -> Int? {
        guard allow(.enrich) else { return nil }
        let provider = EnrichProvider.current
        guard provider.configured else {
            show("Add your ZoomInfo or Seamless.AI account in Settings first.")
            showSettings = true
            return nil
        }
        let qs = persons(keys).map { p in
            EnrichQuery(k: p.k, first: p.f, last: p.l, company: p.c, title: p.p, email: p.e, linkedIn: p.u)
        }
        do {
            let found = try await EnrichClient.run(provider, qs)
            await saveEnriched(found)
            show(found.isEmpty ? "\(provider.title) didn’t find a match." : "\(provider.title) found \(found.count.formatted()) of \(qs.count.formatted())")
            return found.count
        } catch {
            show(error.localizedDescription)
            return nil
        }
    }
}

/// An enrichment CSV from any provider, matched to people by the engine.
struct EnrichFileMatch: Decodable {
    struct Row: Decodable { var email, phone, mobile, title, company, city, state, country: String? }
    var rows: Int
    var matched: Int
    var people: [String: Row]
}

extension AppModel {
    func importEnrichment(_ url: URL) async {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
            let text = try String(contentsOf: url, encoding: .utf8)
            let m = try await engine.call("matchEnrichment", [text], as: EnrichFileMatch.self)
            var found: [String: Enriched] = [:]
            for (k, r) in m.people {
                found[k] = Enriched(src: "file", at: Day.today, email: r.email, phone: r.phone, mobile: r.mobile, title: r.title,
                                    company: r.company, city: r.city, state: r.state, country: r.country)
            }
            await saveEnriched(found)
            Haptic.success()
            show("Matched \(m.matched.formatted()) of \(m.rows.formatted()) people in the file")
        } catch {
            show("Couldn’t read that file: \(error.localizedDescription)")
        }
    }
}
