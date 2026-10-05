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
                .task {
                    await model.start()
                    await TripMode.refresh(model: model)
                }
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
                            await TripMode.refresh(model: model)
                        }
                    }
                }
        }
        .commands { BearingsCommands(model: model) }
    }
}

/// Menus and keyboard shortcuts for the Mac and for iPad with a keyboard.
struct BearingsCommands: Commands {
    let model: AppModel

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("Import LinkedIn Export…") { model.showImport = true }
                .keyboardShortcut("o")
            Button("Export People…") { Task { await model.exportCSV(keys: model.results.map(\.k)) } }
                .keyboardShortcut("e", modifiers: [.command, .shift])
            Button("Back Up Notes…") { Task { await model.backup() } }
        }
        CommandGroup(replacing: .appSettings) {
            Button("Settings…") { model.showSettings = true }
                .keyboardShortcut(",")
        }
        CommandMenu("Go") {
            ForEach(Array(AppTab.allCases.enumerated()), id: \.offset) { i, t in
                Button(t.title) { model.tab = t }
                    .keyboardShortcut(KeyEquivalent(Character(String(i + 1))))
            }
            Divider()
            Button("Search People") { model.tab = .people; model.paths[.people] = [] }
                .keyboardShortcut("f")
            Button("Trips") { model.tab = .home; model.paths[.home] = [.trips] }
                .keyboardShortcut("t", modifiers: [.command, .shift])
            Button("Add to Watchlist…") { model.tab = .companies; model.companiesMode = .watchlist; model.showAddTarget = true }
                .keyboardShortcut("w", modifiers: [.command, .shift])
        }
        CommandGroup(replacing: .help) {
            Button("Bearings Support") { if let u = URL(string: "https://www.jaynichols.net/bearings/support.html") { UIApplication.shared.open(u) } }
            Button("Privacy Policy") { if let u = URL(string: "https://www.jaynichols.net/bearings/privacy.html") { UIApplication.shared.open(u) } }
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
