import SwiftUI
import AuthenticationServices
import CryptoKit
import UIKit

// Email as a source: who you emailed, when, and the subject line. Never the message body.
// Outlook (Microsoft 365 or Outlook.com) through Microsoft Graph with Mail.ReadBasic, which
// can't see bodies at all, and Gmail with the gmail.metadata scope, which can't either.
// Sign-in is OAuth with PKCE straight between the phone and the provider; no Bearings server.

enum MailProvider: String, Codable, CaseIterable, Identifiable {
    case outlook, gmail
    var id: String { rawValue }
    var name: String { self == .outlook ? "Outlook" : "Gmail" }
    var icon: String { self == .outlook ? "envelope.badge" : "envelope" }

    /// The app's registered client ID, from the build (empty until it's registered).
    var clientID: String {
        let key = self == .outlook ? "BearingsMSClientID" : "BearingsGoogleClientID"
        return ((Bundle.main.object(forInfoDictionaryKey: key) as? String) ?? "").trimmingCharacters(in: .whitespaces)
    }
    var available: Bool { !clientID.isEmpty && !clientID.hasPrefix("$(") }

    var authURL: String { self == .outlook ? "https://login.microsoftonline.com/common/oauth2/v2.0/authorize" : "https://accounts.google.com/o/oauth2/v2/auth" }
    var tokenURL: String { self == .outlook ? "https://login.microsoftonline.com/common/oauth2/v2.0/token" : "https://oauth2.googleapis.com/token" }
    var scope: String { self == .outlook ? "offline_access User.Read Mail.ReadBasic" : "https://www.googleapis.com/auth/gmail.metadata" }
    /// Microsoft: the mobile redirect registered for the bundle. Google: the iOS client's reversed ID.
    var scheme: String {
        switch self {
        case .outlook: return "msauth.com.jaynichols.networkoob"
        case .gmail: return "com.googleusercontent.apps." + clientID.replacingOccurrences(of: ".apps.googleusercontent.com", with: "")
        }
    }
    var redirect: String { self == .outlook ? scheme + "://auth" : scheme + ":/oauth2redirect" }
}

struct MailToken: Codable {
    var access: String
    var refresh: String
    var expires: Date
    var address: String
}

struct MailRow: Encodable {
    var name: String
    var email: String
    var date: String
    var dir: String
    var subject: String
}

@MainActor @Observable
final class MailSync {
    static let shared = MailSync()

    var connected: [MailProvider: String] = [:]
    var lastSync: Date? = UserDefaults.standard.object(forKey: "mail.lastSync") as? Date
    var lastMatched: Int = UserDefaults.standard.integer(forKey: "mail.lastMatched")
    var busy = false
    var note = ""

    private var session: ASWebAuthenticationSession?
    private let anchor = Anchor()

    init() {
        for p in MailProvider.allCases { if let t = Keychain.load(MailToken.self, "mail." + p.rawValue) { connected[p] = t.address } }
    }

    var anyConnected: Bool { !connected.isEmpty }

    // MARK: sign in

    func connect(_ p: MailProvider, model: AppModel) async {
        guard p.available else { note = "\(p.name) isn’t set up in this version yet."; return }
        do {
            let verifier = Self.randomString(64)
            let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
            let state = Self.randomString(24)
            var c = URLComponents(string: p.authURL)!
            c.queryItems = [
                .init(name: "client_id", value: p.clientID), .init(name: "response_type", value: "code"),
                .init(name: "redirect_uri", value: p.redirect), .init(name: "scope", value: p.scope),
                .init(name: "state", value: state), .init(name: "code_challenge", value: challenge),
                .init(name: "code_challenge_method", value: "S256"),
            ] + (p == .gmail ? [.init(name: "access_type", value: "offline"), .init(name: "prompt", value: "consent")] : [.init(name: "prompt", value: "select_account")])
            let callback: URL = try await withCheckedThrowingContinuation { cont in
                let s = ASWebAuthenticationSession(url: c.url!, callbackURLScheme: p.scheme) { url, error in
                    if let url { cont.resume(returning: url); return }
                    if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin { cont.resume(throwing: CancellationError()); return }
                    cont.resume(throwing: MailError("\(p.name) sign-in didn’t finish."))
                }
                s.presentationContextProvider = anchor
                session = s
                if !s.start() { cont.resume(throwing: MailError("Couldn’t open \(p.name)’s sign-in.")) }
            }
            session = nil
            let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let get = { (n: String) in items.first { $0.name == n }?.value }
            guard get("state") == state else { throw MailError("The \(p.name) sign-in didn’t match. Please try again.") }
            if let e = get("error_description") ?? get("error") { throw MailError(e) }
            guard let code = get("code") else { throw MailError("\(p.name) didn’t send a sign-in code.") }
            var tok = try await tokenRequest(p, ["grant_type": "authorization_code", "code": code, "code_verifier": verifier, "redirect_uri": p.redirect])
            tok.address = try await address(p, tok.access)
            Keychain.save(tok, "mail." + p.rawValue)
            connected[p] = tok.address
            Haptic.success()
            await sync(model: model, force: true)
        } catch is CancellationError {
        } catch {
            note = error.localizedDescription
        }
    }

    func disconnect(_ p: MailProvider, model: AppModel) async {
        Keychain.delete("mail." + p.rawValue)
        connected[p] = nil
        if connected.isEmpty {
            // forget what email told us, so turning it off really turns it off
            _ = try? await model.engine.call("clearMail", as: [String: Int].self)
            await model.saveFile("edits", "edits.json")
            await model.refreshAll()
            lastSync = nil; UserDefaults.standard.removeObject(forKey: "mail.lastSync")
        }
    }

    // MARK: sync

    /// Reads the last weeks of mail headers and hands them to the engine. Quietly, at most every few hours.
    func sync(model: AppModel, force: Bool = false) async {
        guard anyConnected, !busy, !model.info.isSample else { return }
        if !force, let l = lastSync, Date().timeIntervalSince(l) < 3 * 3600 { return }
        busy = true; note = ""
        defer { busy = false }
        let since = lastSync.map { $0.addingTimeInterval(-2 * 86400) } ?? Date().addingTimeInterval(-75 * 86400)
        var rows: [MailRow] = []
        for (p, _) in connected {
            do {
                var tok = try await fresh(p)
                if p == .outlook { rows += try await outlook(tok.access, me: tok.address, since: since) }
                else { rows += try await gmail(tok.access, me: tok.address, since: since) }
                tok = Keychain.load(MailToken.self, "mail." + p.rawValue) ?? tok
            } catch {
                note = "\(p.name): \(error.localizedDescription)"
            }
        }
        guard !rows.isEmpty else { if note.isEmpty { markSynced(0) }; return }
        struct Result: Decodable { var matched: Int; var changed: Int }
        if let r = try? await model.engine.call("applyMail", [rows.map(\.dict)], as: Result.self) {
            if r.changed > 0 {
                await model.saveFile("edits", "edits.json")
                await model.refreshAll()
            }
            markSynced(r.matched)
        }
    }

    private func markSynced(_ matched: Int) {
        lastSync = Date(); UserDefaults.standard.set(lastSync, forKey: "mail.lastSync")
        if matched > 0 || lastMatched == 0 { lastMatched = matched; UserDefaults.standard.set(matched, forKey: "mail.lastMatched") }
    }

    // MARK: Outlook (Microsoft Graph, Mail.ReadBasic)

    private func outlook(_ token: String, me: String, since: Date) async throws -> [MailRow] {
        let iso = ISO8601DateFormatter().string(from: since)
        var next: String? = "https://graph.microsoft.com/v1.0/me/messages?$select=subject,from,toRecipients,ccRecipients,receivedDateTime,isDraft&$top=250&$orderby=receivedDateTime%20desc&$filter=receivedDateTime%20ge%20\(iso)"
        var rows: [MailRow] = []
        var pages = 0
        while let u = next, pages < 16, let url = URL(string: u) {
            pages += 1
            let j = try await getJSON(url, token)
            for m in (j["value"] as? [[String: Any]]) ?? [] {
                if (m["isDraft"] as? Bool) == true { continue }
                let subject = m["subject"] as? String ?? ""
                let date = m["receivedDateTime"] as? String ?? ""
                let from = Self.graphAddr(m["from"])
                let to = ((m["toRecipients"] as? [Any]) ?? []).map(Self.graphAddr) + ((m["ccRecipients"] as? [Any]) ?? []).map(Self.graphAddr)
                rows += Self.rows(from: from, to: to, me: me, date: date, subject: subject)
            }
            next = j["@odata.nextLink"] as? String
        }
        return rows
    }

    private static func graphAddr(_ v: Any?) -> (String, String) {
        let e = (v as? [String: Any])?["emailAddress"] as? [String: Any]
        return ((e?["name"] as? String) ?? "", (e?["address"] as? String) ?? "")
    }

    // MARK: Gmail (gmail.metadata)

    private func gmail(_ token: String, me: String, since: Date) async throws -> [MailRow] {
        var ids: [String] = []
        for label in ["INBOX", "SENT"] {
            var pageToken: String?
            var n = 0
            repeat {
                var c = URLComponents(string: "https://gmail.googleapis.com/gmail/v1/users/me/messages")!
                c.queryItems = [.init(name: "labelIds", value: label), .init(name: "maxResults", value: "200")] + (pageToken.map { [.init(name: "pageToken", value: $0)] } ?? [])
                let j = try await getJSON(c.url!, token)
                let got = ((j["messages"] as? [[String: Any]]) ?? []).compactMap { $0["id"] as? String }
                ids += got
                n += got.count
                pageToken = j["nextPageToken"] as? String
                // the list is newest first; stop once a page reaches past the window
                if let last = got.last, let d = try? await gmailDate(last, token), d < since { break }
            } while pageToken != nil && n < 600
        }
        var rows: [MailRow] = []
        let unique = Array(Set(ids)).prefix(1200)
        try await withThrowingTaskGroup(of: [MailRow].self) { g in
            var it = unique.makeIterator()
            func add() { if let id = it.next() { g.addTask { try await self.gmailRows(id, token, me: me, since: since) } } }
            for _ in 0..<8 { add() }
            while let r = try await g.next() { rows += r; add() }
        }
        return rows
    }

    private func gmailDate(_ id: String, _ token: String) async throws -> Date {
        let j = try await getJSON(URL(string: "https://gmail.googleapis.com/gmail/v1/users/me/messages/\(id)?format=minimal")!, token)
        return Date(timeIntervalSince1970: (Double(j["internalDate"] as? String ?? "") ?? 0) / 1000)
    }

    nonisolated private func gmailRows(_ id: String, _ token: String, me: String, since: Date) async throws -> [MailRow] {
        let u = "https://gmail.googleapis.com/gmail/v1/users/me/messages/\(id)?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject"
        let j = try await Self.fetchJSON(URL(string: u)!, token)
        let when = Date(timeIntervalSince1970: (Double(j["internalDate"] as? String ?? "") ?? 0) / 1000)
        guard when >= since else { return [] }
        let headers = ((j["payload"] as? [String: Any])?["headers"] as? [[String: Any]]) ?? []
        func h(_ n: String) -> String { headers.first { ($0["name"] as? String)?.caseInsensitiveCompare(n) == .orderedSame }?["value"] as? String ?? "" }
        let from = Self.parseAddresses(h("From")).first ?? ("", "")
        let to = Self.parseAddresses(h("To")) + Self.parseAddresses(h("Cc"))
        return Self.rows(from: from, to: to, me: me, date: ISO8601DateFormatter().string(from: when), subject: h("Subject"))
    }

    /// "Jane Doe <jane@x.com>, bob@y.com" → [(name, email)]
    nonisolated static func parseAddresses(_ s: String) -> [(String, String)] {
        var out: [(String, String)] = []
        var cur = "", quoted = false
        for ch in s + "," {
            if ch == "\"" { quoted.toggle(); cur.append(ch); continue }
            if ch == "," && !quoted {
                let t = cur.trimmingCharacters(in: .whitespaces); cur = ""
                guard !t.isEmpty else { continue }
                if let lt = t.lastIndex(of: "<"), let gt = t.lastIndex(of: ">"), lt < gt {
                    let name = t[..<lt].trimmingCharacters(in: CharacterSet(charactersIn: " \""))
                    out.append((name, String(t[t.index(after: lt)..<gt])))
                } else { out.append(("", t)) }
                continue
            }
            cur.append(ch)
        }
        return out
    }

    // MARK: shared

    /// One row per person: whoever wrote to you, or everyone you wrote to. Skips robots and mass mail.
    nonisolated static func rows(from: (String, String), to: [(String, String)], me: String, date: String, subject: String) -> [MailRow] {
        let mine = from.1.lowercased() == me.lowercased()
        let robot = { (e: String) -> Bool in
            let l = e.lowercased()
            return ["noreply", "no-reply", "donotreply", "do-not-reply", "notification", "mailer-daemon", "postmaster", "newsletter", "updates@", "info@", "news@", "marketing", "bounce"].contains { l.contains($0) }
        }
        if mine {
            guard to.count <= 12 else { return [] }
            return to.filter { !$0.1.isEmpty && $0.1.lowercased() != me.lowercased() && !robot($0.1) }
                .map { MailRow(name: $0.0, email: $0.1, date: date, dir: "o", subject: subject) }
        }
        guard !from.1.isEmpty, !robot(from.1), to.count <= 20 else { return [] }
        return [MailRow(name: from.0, email: from.1, date: date, dir: "i", subject: subject)]
    }

    private func address(_ p: MailProvider, _ token: String) async throws -> String {
        if p == .outlook {
            let j = try await getJSON(URL(string: "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName")!, token)
            return (j["mail"] as? String) ?? (j["userPrincipalName"] as? String) ?? ""
        }
        let j = try await getJSON(URL(string: "https://gmail.googleapis.com/gmail/v1/users/me/profile")!, token)
        return j["emailAddress"] as? String ?? ""
    }

    private func fresh(_ p: MailProvider) async throws -> MailToken {
        guard var t = Keychain.load(MailToken.self, "mail." + p.rawValue) else { throw MailError("Not connected.") }
        if t.expires > Date().addingTimeInterval(120) { return t }
        let n = try await tokenRequest(p, ["grant_type": "refresh_token", "refresh_token": t.refresh])
        t.access = n.access; t.expires = n.expires
        if !n.refresh.isEmpty { t.refresh = n.refresh }
        Keychain.save(t, "mail." + p.rawValue)
        return t
    }

    private func tokenRequest(_ p: MailProvider, _ form: [String: String]) async throws -> MailToken {
        var req = URLRequest(url: URL(string: p.tokenURL)!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var f = form; f["client_id"] = p.clientID
        if p == .outlook { f["scope"] = p.scope }
        var c = URLComponents(); c.queryItems = f.map { URLQueryItem(name: $0.key, value: $0.value) }
        req.httpBody = c.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B").data(using: .utf8)
        let (d, _) = try await URLSession.shared.data(for: req)
        let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] ?? [:]
        guard let access = j["access_token"] as? String else {
            throw MailError((j["error_description"] as? String).map { String($0.prefix(160)) } ?? "\(p.name) sign-in expired. Connect it again in Settings.")
        }
        let secs = (j["expires_in"] as? Double) ?? Double(j["expires_in"] as? String ?? "") ?? 3600
        return MailToken(access: access, refresh: j["refresh_token"] as? String ?? "", expires: Date().addingTimeInterval(secs), address: "")
    }

    private func getJSON(_ url: URL, _ token: String) async throws -> [String: Any] { try await Self.fetchJSON(url, token) }

    nonisolated private static func fetchJSON(_ url: URL, _ token: String) async throws -> [String: Any] {
        var req = URLRequest(url: url)
        req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        let (d, r) = try await URLSession.shared.data(for: req)
        let code = (r as? HTTPURLResponse)?.statusCode ?? 0
        guard code < 300 else {
            if code == 401 { throw MailError("Sign-in expired. Connect it again in Settings.") }
            if code == 403 { throw MailError("Your organization doesn’t allow this app to read mail headers.") }
            throw MailError("The mail service answered \(code).")
        }
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] ?? [:]
    }

    private static func randomString(_ n: Int) -> String {
        let chars = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        return String((0..<n).map { _ in chars.randomElement()! })
    }

    private final class Anchor: NSObject, ASWebAuthenticationPresentationContextProviding {
        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            MainActor.assumeIsolated {
                UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
            }
        }
    }
}

struct MailError: LocalizedError {
    let message: String
    init(_ m: String) { message = m }
    var errorDescription: String? { message }
}

extension MailRow {
    var dict: [String: String] { ["name": name, "email": email, "date": date, "dir": dir, "subject": subject] }
}

extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

/// Settings: connect Outlook or Gmail.
struct MailSettingsSection: View {
    @Environment(AppModel.self) private var model
    private var mail: MailSync { MailSync.shared }

    var body: some View {
        Section {
            ForEach(MailProvider.allCases) { p in
                if let who = mail.connected[p] {
                    HStack {
                        Label { VStack(alignment: .leading, spacing: 2) { Text(p.name); Text(who).font(.caption).foregroundStyle(.secondary) } } icon: { Image(systemName: p.icon) }
                        Spacer()
                        Button("Disconnect", role: .destructive) { Task { await mail.disconnect(p, model: model) } }
                            .buttonStyle(.borderless)
                    }
                } else {
                    Button { Task { await mail.connect(p, model: model) } } label: { Label("Connect \(p.name)", systemImage: p.icon) }
                        .disabled(!p.available || mail.busy)
                }
            }
            if mail.anyConnected {
                Button { Task { await mail.sync(model: model, force: true) } } label: {
                    HStack {
                        Label(mail.busy ? "Checking…" : "Check now", systemImage: "arrow.clockwise")
                        Spacer()
                        if let l = mail.lastSync {
                            Text("\(mail.lastMatched) people · \(l.formatted(.relative(presentation: .named)))").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .disabled(mail.busy)
            }
            if !mail.note.isEmpty { Text(mail.note).font(.footnote).foregroundStyle(Theme.bad) }
        } header: {
            Text("Email")
        } footer: {
            Text(MailProvider.allCases.contains { $0.available }
                 ? "Bearings reads only who you emailed, when, and the subject line, never the message itself. It uses this to remember your last conversation and to spot who’s waiting on you. Nothing goes to a Bearings server."
                 : "Email isn’t switched on in this version yet.")
        }
    }
}
