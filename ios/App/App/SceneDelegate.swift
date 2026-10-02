import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Bridge view controller that registers the app's own native plugins.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(CloudStorePlugin())
    }
}

/// Stores the app's JSON files in the user's private iCloud Drive container so
/// every Apple device signed in to the same Apple ID sees the same network.
/// Falls back to on-device storage when iCloud is off or unavailable.
@objc(CloudStorePlugin)
public class CloudStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CloudStorePlugin"
    public let jsName = "CloudStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise)
    ]

    private let containerId = "iCloud.com.jaynichols.networkoob"
    private let queue = DispatchQueue(label: "com.jaynichols.networkoob.cloudstore", qos: .userInitiated)
    private var resolved = false
    private var cloudDocs: URL?
    private var query: NSMetadataQuery?

    override public func load() {
        queue.async {
            let (_, icloud) = self.baseURL()
            if icloud {
                DispatchQueue.main.async { self.startQuery() }
            }
        }
    }

    /// Must run off the main thread: resolving the ubiquity container can block.
    private func baseURL() -> (URL, Bool) {
        let fm = FileManager.default
        if !resolved {
            resolved = true
            if fm.ubiquityIdentityToken != nil,
               let container = fm.url(forUbiquityContainerIdentifier: containerId) {
                let docs = container.appendingPathComponent("Documents", isDirectory: true)
                try? fm.createDirectory(at: docs, withIntermediateDirectories: true)
                cloudDocs = docs
            }
        }
        if let docs = cloudDocs { return (docs, true) }
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NetworkOOB", isDirectory: true)
        try? fm.createDirectory(at: support, withIntermediateDirectories: true)
        return (support, false)
    }

    private func validName(_ name: String) -> Bool {
        return !name.isEmpty && name.range(of: "^[A-Za-z0-9._-]+$", options: .regularExpression) != nil && !name.hasPrefix(".")
    }

    private func isCurrent(_ url: URL) -> Bool {
        guard let values = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]),
              let status = values.ubiquitousItemDownloadingStatus else { return true }
        return status == .current
    }

    @objc func status(_ call: CAPPluginCall) {
        queue.async {
            let (_, icloud) = self.baseURL()
            call.resolve([
                "icloud": icloud,
                "signedIn": FileManager.default.ubiquityIdentityToken != nil
            ])
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), validName(name) else {
            call.reject("Invalid file name")
            return
        }
        queue.async {
            let fm = FileManager.default
            let (base, icloud) = self.baseURL()
            let url = base.appendingPathComponent(name)
            if icloud {
                let placeholder = base.appendingPathComponent("." + name + ".icloud")
                let missingLocally = !fm.fileExists(atPath: url.path) && fm.fileExists(atPath: placeholder.path)
                if missingLocally || (fm.fileExists(atPath: url.path) && !self.isCurrent(url)) {
                    try? fm.startDownloadingUbiquitousItem(at: url)
                    let deadline = Date().addingTimeInterval(missingLocally ? 20 : 6)
                    while Date() < deadline {
                        if fm.fileExists(atPath: url.path) && self.isCurrent(url) { break }
                        Thread.sleep(forTimeInterval: 0.4)
                    }
                    if !fm.fileExists(atPath: url.path) {
                        call.resolve(["data": NSNull(), "pending": true, "icloud": true])
                        return
                    }
                }
            }
            var coordError: NSError?
            var readError: Error?
            var text: String?
            NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &coordError) { readURL in
                guard fm.fileExists(atPath: readURL.path) else { return }
                do { text = try String(contentsOf: readURL, encoding: .utf8) } catch { readError = error }
            }
            if let err = coordError ?? (readError as NSError?) {
                call.reject("Could not read \(name): \(err.localizedDescription)")
                return
            }
            var result: [String: Any] = ["icloud": icloud, "pending": false]
            result["data"] = text ?? NSNull()
            call.resolve(result)
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), validName(name), let data = call.getString("data") else {
            call.reject("Invalid write request")
            return
        }
        queue.async {
            let (base, icloud) = self.baseURL()
            let url = base.appendingPathComponent(name)
            var coordError: NSError?
            var writeError: Error?
            NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) { writeURL in
                do { try data.write(to: writeURL, atomically: true, encoding: .utf8) } catch { writeError = error }
            }
            if let err = coordError ?? (writeError as NSError?) {
                call.reject("Could not save \(name): \(err.localizedDescription)")
                return
            }
            call.resolve(["icloud": icloud])
        }
    }

    /// Watches the iCloud Documents folder and tells the web layer when another device changed a file.
    private func startQuery() {
        let q = NSMetadataQuery()
        q.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
        q.predicate = NSPredicate(format: "%K LIKE %@", NSMetadataItemFSNameKey, "*.json")
        NotificationCenter.default.addObserver(self, selector: #selector(queryChanged(_:)), name: .NSMetadataQueryDidUpdate, object: q)
        q.start()
        query = q
    }

    @objc private func queryChanged(_ note: Notification) {
        notifyListeners("changed", data: [:])
    }
}
