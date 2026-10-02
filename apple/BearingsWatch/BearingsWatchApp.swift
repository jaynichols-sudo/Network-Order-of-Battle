import SwiftUI
import WatchKit
import WatchConnectivity

@main
struct BearingsWatchApp: App {
    @WKApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var store = WatchStore.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
        }
    }
}

/// Lets the system wake the app in the background to receive a new snapshot.
final class AppDelegate: NSObject, WKApplicationDelegate {
    func applicationDidFinishLaunching() {
        Task { @MainActor in _ = WatchStore.shared }
    }

    func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        for task in backgroundTasks {
            if let wc = task as? WKWatchConnectivityRefreshBackgroundTask {
                Task { @MainActor in
                    _ = WatchStore.shared
                    BackgroundTasks.hold(wc)
                }
            } else {
                task.setTaskCompletedWithSnapshot(false)
            }
        }
    }
}

/// Completes WatchConnectivity background tasks once nothing is pending.
@MainActor
enum BackgroundTasks {
    private static var pending: [WKWatchConnectivityRefreshBackgroundTask] = []

    static func hold(_ t: WKWatchConnectivityRefreshBackgroundTask) {
        pending.append(t)
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            finishAll()
        }
        finishIfIdle()
    }

    static func finishIfIdle() {
        if !WCSession.default.hasContentPending { finishAll() }
    }

    private static func finishAll() {
        let list = pending
        pending.removeAll()
        list.forEach { $0.setTaskCompletedWithSnapshot(false) }
    }
}
