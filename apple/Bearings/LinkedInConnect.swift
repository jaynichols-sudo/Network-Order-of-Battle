import Foundation
import AuthenticationServices
import UIKit

/// One-tap import for members in the EEA and Switzerland, through LinkedIn's official
/// Member Data Portability API. Everywhere else LinkedIn doesn't allow it, so the button
/// stays hidden and people use the export file.
///
/// A small helper (server/linkedin-connect) swaps LinkedIn's sign-in code for a token,
/// because that needs a secret the app can't hold. The data itself comes straight from
/// LinkedIn to the device.
enum LinkedInConnect {
    /// EU members plus Iceland, Liechtenstein, Norway (the EEA) and Switzerland.
    static let regions: Set<String> = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT",
                                       "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "CH"]
    static let domains = ["CONNECTIONS", "INBOX", "INVITATIONS"]
    /// The running sign-in; it has to be kept alive until LinkedIn answers.
    @MainActor private static var session: ASWebAuthenticationSession?
    @MainActor private static var presenter: Presenter?

    static var helper: URL? {
        guard let s = Bundle.main.object(forInfoDictionaryKey: "BearingsLinkedInConnectURL") as? String,
              s.hasPrefix("https://") else { return nil }
        return URL(string: s)
    }

    /// Shown only when the helper is set up and the device is in a region LinkedIn allows.
    static var available: Bool {
        helper != nil && regions.contains(Locale.current.region?.identifier ?? "")
    }

    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// Opens LinkedIn's consent screen and returns an access token.
    @MainActor
    static func signIn() async throws -> String {
        guard let helper else { throw Failure(message: "Connecting to LinkedIn isn’t set up in this version.") }
        let state = UUID().uuidString.replacingOccurrences(of: "-", with: "") + String(Int.random(in: 1000...9999))
        var start = URLComponents(url: helper.appendingPathComponent("start"), resolvingAgainstBaseURL: false)!
        start.queryItems = [URLQueryItem(name: "state", value: state)]
        let presenter = Presenter()
        Self.presenter = presenter
        defer { Self.session = nil; Self.presenter = nil }
        let callback: URL = try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(url: start.url!, callbackURLScheme: "bearings") { url, error in
                if let url { cont.resume(returning: url); return }
                if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
                    cont.resume(throwing: CancellationError()); return
                }
                cont.resume(throwing: Failure(message: error?.localizedDescription ?? "LinkedIn sign-in didn’t finish."))
            }
            session.presentationContextProvider = presenter
            session.prefersEphemeralWebBrowserSession = false
            Self.session = session
            if !session.start() { cont.resume(throwing: Failure(message: "Couldn’t open LinkedIn’s sign-in.")) }
        }
        // the helper puts the result in the fragment: #state=…&token=… or #state=…&error=…
        var parts = URLComponents()
        parts.query = callback.fragment
        let items = Dictionary((parts.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
        guard items["state"] == state else { throw Failure(message: "The LinkedIn sign-in didn’t match. Please try again.") }
        if let e = items["error"], !e.isEmpty {
            if e.contains("cancel") { throw CancellationError() }
            throw Failure(message: e)
        }
        guard let token = items["token"], !token.isEmpty else { throw Failure(message: "LinkedIn didn’t send access. Please try again.") }
        return token
    }

    /// Downloads connections, messages and invitations, page by page, as the export's columns.
    static func download(token: String, progress: @escaping @MainActor (String) -> Void) async throws -> [String: [[String: String]]] {
        var out: [String: [[String: String]]] = [:]
        for domain in domains {
            await progress(domain == "CONNECTIONS" ? "Getting your connections…" : domain == "INBOX" ? "Getting your messages…" : "Getting your invitations…")
            var rows: [[String: String]] = []
            var start = 0
            for _ in 0..<2000 {
                var c = URLComponents(string: "https://api.linkedin.com/rest/memberSnapshotData")!
                c.queryItems = [URLQueryItem(name: "q", value: "criteria"), URLQueryItem(name: "domain", value: domain), URLQueryItem(name: "start", value: String(start))]
                var req = URLRequest(url: c.url!)
                req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                req.setValue("202312", forHTTPHeaderField: "Linkedin-Version")
                req.setValue("2.0.0", forHTTPHeaderField: "X-Restli-Protocol-Version")
                let (data, resp) = try await URLSession.shared.data(for: req)
                let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
                let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
                // LinkedIn signals the end of the data with "No data found"
                if status == 404 || (json["message"] as? String ?? "").localizedCaseInsensitiveContains("no data found") { break }
                if status == 401 || status == 403 { throw Failure(message: "LinkedIn didn’t allow access to your data. Please connect again.") }
                guard status == 200 else { throw Failure(message: "LinkedIn returned an error (\(status)). Please try again in a minute.") }
                let elements = json["elements"] as? [[String: Any]] ?? []
                for el in elements {
                    for item in el["snapshotData"] as? [[String: Any]] ?? [] {
                        rows.append(item.mapValues { v in v as? String ?? (v is NSNull ? "" : "\(v)") })
                    }
                }
                let paging = json["paging"] as? [String: Any] ?? [:]
                let links = paging["links"] as? [[String: Any]] ?? []
                guard let next = links.first(where: { ($0["rel"] as? String) == "next" })?["href"] as? String,
                      let n = URLComponents(string: next)?.queryItems?.first(where: { $0.name == "start" })?.value,
                      let ni = Int(n), ni > start else { break }
                start = ni
            }
            out[domain] = rows
        }
        return out
    }

    private final class Presenter: NSObject, ASWebAuthenticationPresentationContextProviding {
        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            MainActor.assumeIsolated {
                UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
            }
        }
    }
}

extension AppModel {
    /// Signs in to LinkedIn and turns the member's data into an import plan, like a file would.
    func readFromLinkedIn(progress: @escaping @MainActor (String) -> Void) async throws -> ImportPlan {
        let token = try await LinkedInConnect.signIn()
        let domains = try await LinkedInConnect.download(token: token, progress: progress)
        await progress("Reading…")
        return try await engine.call("importSnapshot", [domains, "ios"], as: ImportPlan.self)
    }
}
