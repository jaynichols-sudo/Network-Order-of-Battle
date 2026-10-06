import Foundation
import AuthenticationServices
import UIKit

/// Sign-ins that go through Bearings' small helper (server/connect): LinkedIn's data portability
/// API and Seamless.AI. The helper only swaps the sign-in code for a token, because that step
/// needs a secret the app can't hold. Data goes straight between the provider and the device.
enum ConnectHelper {
    static var base: URL? {
        guard let s = Bundle.main.object(forInfoDictionaryKey: "BearingsConnectURL") as? String,
              s.hasPrefix("https://") else { return nil }
        return URL(string: s.hasSuffix("/") ? String(s.dropLast()) : s)
    }

    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// The running sign-in; it has to be kept alive until the provider answers.
    @MainActor private static var session: ASWebAuthenticationSession?
    @MainActor private static var presenter: Presenter?

    /// Opens the provider's sign-in and returns what the helper sends back (token, refresh, expires).
    @MainActor
    static func authorize(_ route: String, name: String) async throws -> [String: String] {
        guard let base else { throw Failure(message: "Signing in to \(name) isn’t set up in this version.") }
        let state = UUID().uuidString.replacingOccurrences(of: "-", with: "") + String(Int.random(in: 1000...9999))
        var start = URLComponents(url: base.appendingPathComponent(route).appendingPathComponent("start"), resolvingAgainstBaseURL: false)!
        start.queryItems = [URLQueryItem(name: "state", value: state)]
        let p = Presenter()
        presenter = p
        defer { session = nil; presenter = nil }
        let callback: URL = try await withCheckedThrowingContinuation { cont in
            let s = ASWebAuthenticationSession(url: start.url!, callbackURLScheme: "bearings") { url, error in
                if let url { cont.resume(returning: url); return }
                if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
                    cont.resume(throwing: CancellationError()); return
                }
                cont.resume(throwing: Failure(message: error?.localizedDescription ?? "\(name) sign-in didn’t finish."))
            }
            s.presentationContextProvider = p
            s.prefersEphemeralWebBrowserSession = false
            session = s
            if !s.start() { cont.resume(throwing: Failure(message: "Couldn’t open \(name)’s sign-in.")) }
        }
        // the helper puts the result in the fragment: #state=…&token=… or #state=…&error=…
        var parts = URLComponents()
        parts.query = callback.fragment
        let items = Dictionary((parts.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
        guard items["state"] == state else { throw Failure(message: "The \(name) sign-in didn’t match. Please try again.") }
        if let e = items["error"], !e.isEmpty {
            if e.lowercased().contains("cancel") || e.lowercased().contains("denied") { throw CancellationError() }
            throw Failure(message: e)
        }
        return items
    }

    private final class Presenter: NSObject, ASWebAuthenticationPresentationContextProviding {
        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            MainActor.assumeIsolated {
                UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
            }
        }
    }
}

/// "Sign in with Seamless.AI": OAuth tokens kept in the Keychain and refreshed through the helper.
enum SeamlessAuth {
    static var available: Bool { ConnectHelper.base != nil }
    static var signedIn: Bool { !(SecretStore.get("enrich.seamless.refresh") ?? "").isEmpty || !(SecretStore.get("enrich.seamless.access") ?? "").isEmpty }

    @MainActor
    static func signIn() async throws {
        let items = try await ConnectHelper.authorize("seamless", name: "Seamless.AI")
        guard let token = items["token"], !token.isEmpty else { throw ConnectHelper.Failure(message: "Seamless.AI didn’t send access. Please try again.") }
        save(access: token, refresh: items["refresh"], expiresIn: Double(items["expires"] ?? "") ?? 10800)
    }

    static func signOut() {
        SecretStore.set("enrich.seamless.access", nil)
        SecretStore.set("enrich.seamless.refresh", nil)
        SecretStore.set("enrich.seamless.until", nil)
    }

    private static func save(access: String, refresh: String?, expiresIn: Double) {
        SecretStore.set("enrich.seamless.access", access)
        if let refresh, !refresh.isEmpty { SecretStore.set("enrich.seamless.refresh", refresh) }
        SecretStore.set("enrich.seamless.until", String(Date().timeIntervalSince1970 + expiresIn - 120))
    }

    /// A current access token, refreshed through the helper when it has run out; nil when not signed in.
    static func accessToken() async throws -> String? {
        guard let access = SecretStore.get("enrich.seamless.access"), !access.isEmpty else { return nil }
        let until = Double(SecretStore.get("enrich.seamless.until") ?? "") ?? 0
        if Date().timeIntervalSince1970 < until { return access }
        guard let refresh = SecretStore.get("enrich.seamless.refresh"), !refresh.isEmpty, let base = ConnectHelper.base else { return access }
        var req = URLRequest(url: base.appendingPathComponent("seamless").appendingPathComponent("refresh"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["refresh_token": refresh])
        let (status, body) = try await EnrichClient.json(req)
        guard status == 200, let b = body as? [String: Any], let a = b["access_token"] as? String else {
            signOut()
            throw ConnectHelper.Failure(message: "Your Seamless.AI sign-in expired. Sign in again in Settings.")
        }
        save(access: a, refresh: b["refresh_token"] as? String, expiresIn: (b["expires_in"] as? Double) ?? 10800)
        return a
    }
}
