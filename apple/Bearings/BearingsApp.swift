import SwiftUI
import UIKit

@main
struct BearingsApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var phase
    @AppStorage("appearance") private var appearance = "system"

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .font(Theme.geist(.body))
                .tint(Theme.accent)
                .preferredColorScheme(appearance == "light" ? .light : appearance == "dark" ? .dark : nil)
                .task { await model.start() }
                .onOpenURL { url in
                    guard url.isFileURL else { return }
                    if url.pathExtension.lowercased() == "json" {
                        Task { await model.restore(url) }
                    } else {
                        model.pendingImportURL = url
                        model.showOnboarding = false
                        model.showImport = true
                    }
                }
                .onChange(of: phase) { _, p in
                    if p == .active, model.loaded {
                        Task {
                            await model.reload()
                            await model.drainWatch()
                        }
                    }
                }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Notifications.shared.register()
        WatchLink.shared.start()
        return true
    }
}
