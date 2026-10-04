import SwiftUI
import CoreSpotlight
import UIKit

@main
struct BearingsApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @State private var model = AppModel.shared
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
                    if url.scheme == "bearings" {
                        model.openDeepLink(url)
                        return
                    }
                    guard url.isFileURL else { return }
                    if url.pathExtension.lowercased() == "json" {
                        Task { await model.restore(url) }
                    } else {
                        model.pendingImportURL = url
                        model.showOnboarding = false
                        model.showImport = true
                    }
                }
                .onContinueUserActivity(CSSearchableItemActionType) { a in
                    if let k = a.userInfo?[CSSearchableItemActivityIdentifier] as? String {
                        model.tab = .people
                        model.paths[.people] = [.person(k)]
                    }
                }
                .onChange(of: phase) { _, p in
                    if p == .active, model.loaded {
                        Task {
                            await model.reload()
                            await model.drainWatch()
                            await CalendarService.shared.scan(model: model, force: true)
                        }
                    }
                }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Notifications.shared.register()
        Diagnostics.shared.start()
        WatchLink.shared.start()
        return true
    }
}
