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
                .macTextSize()
                .onAppear { MacWindow.configure() }
                .environment(model)
                .font(Theme.geist(.body))
                .tint(Theme.primary)
                .preferredColorScheme(appearance == "light" ? .light : appearance == "dark" ? .dark : nil)
                .task {
                    await model.start()
                    await TripMode.refresh(model: model)
                    await MeetingMode.refresh(model: model)
                    if !model.info.isSample { await WeeklyBrief.schedule() }
                    model.checkDownloads()
                    await model.drainNotesInbox()
                    await ReminderSync.shared.pullCompleted(model: model)
                    await MailSync.shared.sync(model: model)
                    await TeamSync.shared.autoSync(model: model)
                }
                .onOpenURL { url in
                    if url.scheme == "bearings" || url.scheme == "northfix" {
                        model.openDeepLink(url)
                        return
                    }
                    guard url.isFileURL else { return }
                    let ext = url.pathExtension.lowercased()
                    if ext == "json" {
                        Task { await model.openJSON(url) }
                    } else if AppModel.notesFileTypes.contains(ext) {
                        // meeting notes, a transcript, a PDF or a photo of a page
                        Task { await model.ingestNotesFile(url) }
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
                    await MeetingMode.refresh(model: model)
                            model.checkDownloads()
                            await model.drainNotesInbox()
                            await TeamSync.shared.autoSync(model: model)
                            await ReminderSync.shared.pullCompleted(model: model)
                    await MailSync.shared.sync(model: model)
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
                .keyboardShortcut("x", modifiers: [.command, .shift])
            Button("Back Up Notes…") { Task { await model.backup() } }
        }
        CommandGroup(replacing: .appSettings) {
            Button("Settings…") { model.showSettings = true }
                .keyboardShortcut(",")
        }
        CommandMenu("Go") {
            ForEach(Array(AppTab.allCases.enumerated()), id: \.offset) { i, t in
                if i < 9 {
                Button(t.title) { model.tab = t }
                    .keyboardShortcut(KeyEquivalent(Character(String(i + 1))))
                }
            }
            Divider()
            Button("Quick Find…") { model.showQuickFind = true }
                .keyboardShortcut("k")
            Button("Search People") { model.tab = .people; model.paths[.people] = [] }
                .keyboardShortcut("f")
            Button("Find a Way In…") { model.introQuery = "" }
                .keyboardShortcut("i", modifiers: [.command, .shift])
            Button("New Event…") { model.newEvent = true }
            Button("Explore") { model.go("explore") }
                .keyboardShortcut("e", modifiers: [.command, .shift])
            Button("Catch Up") { model.go("catchup") }
            Button("Trips") { model.tab = .home; model.paths[.home] = [.trips] }
                .keyboardShortcut("t", modifiers: [.command, .shift])
            Button("Add to Watchlist…") { model.tab = .companies; model.companiesMode = .watchlist; model.showAddTarget = true }
                .keyboardShortcut("w", modifiers: [.command, .shift])
        }
        CommandGroup(replacing: .help) {
            Button("Northfix Support") { if let u = URL(string: "https://northfix.app/support.html") { UIApplication.shared.open(u) } }
            Button("Privacy Policy") { if let u = URL(string: "https://northfix.app/privacy.html") { UIApplication.shared.open(u) } }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Notifications.shared.register()
        Diagnostics.shared.start()
        WatchLink.shared.start()
        ArrivalAlerts.shared.resume()
        return true
    }
}

/// The Mac window: big enough that Today, You, profiles and Team show two columns.
enum MacWindow {
    static func configure() {
        #if targetEnvironment(macCatalyst)
        let defaults = UserDefaults.standard
        for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
            scene.sizeRestrictions?.minimumSize = CGSize(width: 960, height: 660)
            // The first time, open big enough for the dashboard and two-pane layouts instead of
            // a phone-like window; after that macOS remembers whatever size you choose.
            // -macFill YES (screenshots) always fills the screen.
            let fill = defaults.bool(forKey: "macFill")
            guard fill || !defaults.bool(forKey: "macSized") else { continue }
            defaults.set(true, forKey: "macSized")
            let screen = scene.screen.bounds
            let size = fill ? screen.size : CGSize(width: min(screen.width * 0.86, 1600), height: min(screen.height * 0.86, 1050))
            let frame = CGRect(x: (screen.width - size.width) / 2, y: (screen.height - size.height) / 2, width: size.width, height: size.height)
            scene.requestGeometryUpdate(.Mac(systemFrame: frame)) { _ in }
        }
        #endif
    }
}
