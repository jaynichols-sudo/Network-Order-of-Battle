import SwiftUI
import UserNotifications
import UIKit
#if canImport(WatchConnectivity) && !targetEnvironment(macCatalyst)
import WatchConnectivity
#endif

// "Set up Northfix": a checklist on Today that gets people to the valuable parts (socials,
// calendar, home city, notifications, SAM.gov, the watch, AI tools) without making the first
// run any longer. It shows until everything is done or it's hidden, and lives on under
// You > Set up Northfix either way.

/// What the checklist remembers between launches.
enum SetupChecklist {
    static let aiToolsURL = URL(string: "https://northfix.app/ai.html")!

    /// Hidden from Today with the card's menu. The You tab still opens it.
    static var hidden: Bool {
        get { UserDefaults.standard.bool(forKey: "setupHidden") }
        set { UserDefaults.standard.set(newValue, forKey: "setupHidden") }
    }
    /// The AI tools row is done once it has been opened; there's nothing on the phone to check.
    static var aiToolsOpened: Bool {
        get { UserDefaults.standard.bool(forKey: "setupAIToolsOpened") }
        set { UserDefaults.standard.set(newValue, forKey: "setupAIToolsOpened") }
    }
    /// The SAM.gov row only makes sense for a federal network or a federal purpose.
    @MainActor static func federal(_ model: AppModel) -> Bool {
        model.info.lens || model.info.lensAuto || UseCase.saved == .government
    }
}

struct SetupStep: Identifiable {
    let id: String
    let title: String
    let detail: String
    let icon: String
    let done: Bool
    let action: () -> Void
}

/// The checklist. On Today it's a card with a menu; in the You sheet it lists every row.
struct SetupCard: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var phase
    /// Every row, done or not, and no Hide menu: the You tab's view of the same list.
    var full = false
    /// Runs before a row's action, so a sheet can close first.
    var before: (() -> Void)? = nil

    @State private var hidden = SetupChecklist.hidden
    @State private var showDone = false
    @State private var socialsOn = false
    @State private var notifyOn = false
    @State private var calendarOn = CalendarService.shared.enabled && CalendarService.shared.authorized
    @State private var homeSet = !CalendarService.shared.homeName.isEmpty
    @State private var samKey = SamSettings.hasKey
    @State private var watchPaired = false
    @State private var aiOpened = SetupChecklist.aiToolsOpened
    @State private var checks = 0

    private var steps: [SetupStep] {
        var out: [SetupStep] = []
        out.append(SetupStep(id: "linkedin", title: "LinkedIn connections", detail: "Everyone you’re connected to, who you message, and who changed jobs.",
                             icon: "square.and.arrow.down", done: !model.info.isSample && !model.info.isStarter) {
            model.showImport = true
        })
        out.append(SetupStep(id: "socials", title: "Facebook and other socials", detail: "Add a Facebook, Instagram, Snapchat or TikTok download to see everyone you know.",
                             icon: "person.3.sequence", done: socialsOn) {
            model.open(.socials)
        })
        out.append(SetupStep(id: "calendar", title: "Calendar", detail: "A brief before meetings with people you know, and trips spotted from your calendar.",
                             icon: "calendar", done: calendarOn) {
            Task { await turnOnCalendar() }
        })
        out.append(SetupStep(id: "home", title: "Home city", detail: "Tells trips from local meetings, and who you know when you land somewhere.",
                             icon: "house", done: homeSet) {
            model.showSettings = true
        })
        out.append(SetupStep(id: "notify", title: "Notifications", detail: "Follow-up reminders, the Monday brief, and a nudge when a meeting ends.",
                             icon: "bell", done: notifyOn) {
            Task { await turnOnNotifications() }
        })
        if SetupChecklist.federal(model) {
            out.append(SetupStep(id: "sam", title: "SAM.gov key", detail: "New notices at the agencies where you know people, with your own free key.",
                                 icon: "building.columns", done: samKey) {
                model.showSettings = true
            })
        }
        #if !targetEnvironment(macCatalyst)
        out.append(SetupStep(id: "watch", title: "Apple Watch", detail: "The week’s five and meeting notes on your wrist.",
                             icon: "applewatch", done: watchPaired) {
            openWatchApp()
        })
        #endif
        #if targetEnvironment(macCatalyst)
        out.append(SetupStep(id: "ai", title: "Northfix for AI tools", detail: "Ask Claude or ChatGPT about your network, from this Mac.",
                             icon: "sparkles.rectangle.stack", done: aiOpened) {
            SetupChecklist.aiToolsOpened = true
            aiOpened = true
            UIApplication.shared.open(SetupChecklist.aiToolsURL)
        })
        #endif
        return out
    }

    var body: some View {
        let all = steps
        let done = all.filter(\.done).count
        let open = all.filter { !$0.done }
        if full || (!hidden && !open.isEmpty) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Set up Northfix").font(Theme.geist(.headline, .bold)).foregroundStyle(.primary)
                    Spacer()
                    if full || done == 0 {
                        Text("\(done) of \(all.count) done").font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
                            .contentTransition(.numericText(value: Double(done)))
                    }
                    ProgressRing(done: done, total: all.count, size: 18, line: 2.5)
                    if !full {
                        Menu {
                            Button("Hide", systemImage: "eye.slash") {
                                Haptic.tap()
                                SetupChecklist.hidden = true
                                withAnimation(Motion.spring) { hidden = true }
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(Theme.text2)
                                .frame(width: 28, height: 28)
                                .contentShape(Rectangle())
                        }
                        .accessibilityLabel("More")
                    }
                }
                .padding(.top, 14).padding(.bottom, 4)

                let shown = full || showDone ? all : open
                ForEach(Array(shown.enumerated()), id: \.element.id) { i, s in
                    if i > 0 { Theme.line.frame(height: 1) }
                    row(s)
                }
                if !full && done > 0 {
                    Theme.line.frame(height: 1)
                    Button {
                        Haptic.tap()
                        withAnimation(Motion.spring) { showDone.toggle() }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "checkmark.circle.fill").font(.footnote.weight(.semibold)).foregroundStyle(Theme.good)
                            Text(showDone ? "Hide what’s done" : "\(done) of \(all.count) done")
                                .font(Theme.geist(.footnote, .medium)).foregroundStyle(Theme.text2)
                            Spacer(minLength: 0)
                            Image(systemName: showDone ? "chevron.up" : "chevron.down").font(.caption2.weight(.semibold)).foregroundStyle(Theme.text3)
                        }
                        .padding(.vertical, 10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 6)
            .card()
            .animation(Motion.spring, value: done)
            .task(id: "\(model.info.mode)-\(model.info.rev)-\(model.socialRev)-\(checks)") { await refresh() }
            .onChange(of: phase) { _, p in if p == .active { checks += 1 } }
            .onChange(of: model.showSettings) { _, on in if !on { checks += 1 } }
        }
    }

    private func row(_ s: SetupStep) -> some View {
        Button {
            Haptic.tap()
            if let before {
                before()
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 450_000_000)
                    s.action()
                }
            } else {
                s.action()
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: s.done ? "checkmark.circle.fill" : s.icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(s.done ? Theme.good : Theme.primary)
                    .frame(width: 30, height: 30)
                    .background(s.done ? Theme.goodSoft : Theme.soft, in: Circle())
                VStack(alignment: .leading, spacing: 1) {
                    Text(s.title)
                        .font(Theme.geist(.subheadline, .semibold))
                        .foregroundStyle(s.done ? Theme.text3 : .primary)
                        .strikethrough(s.done, color: Theme.text3)
                        .lineLimit(1)
                    if !s.done {
                        Text(s.detail)
                            .font(Theme.geist(.footnote))
                            .foregroundStyle(Theme.text2)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 4)
                if !s.done {
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.text3)
                }
            }
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(s.done)
        .accessibilityLabel(s.done ? "\(s.title), done" : s.title)
    }

    // MARK: checks

    /// Reads what's set up now. Cheap, and run again when the app comes back to the front.
    private func refresh() async {
        calendarOn = CalendarService.shared.enabled && CalendarService.shared.authorized
        homeSet = !CalendarService.shared.homeName.isEmpty
        samKey = SamSettings.hasKey
        aiOpened = SetupChecklist.aiToolsOpened
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notifyOn = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
        #if canImport(WatchConnectivity) && !targetEnvironment(macCatalyst)
        watchPaired = WCSession.isSupported() && WCSession.default.activationState == .activated && WCSession.default.isPaired
        #endif
        let d = await model.socials()
        socialsOn = d.platforms.contains { $0.n > 0 }
    }

    // MARK: actions

    private func turnOnCalendar() async {
        let ok = await CalendarService.shared.requestAccess()
        if ok {
            await CalendarService.shared.scan(model: model, force: true)
            calendarOn = true
        } else {
            model.show("Allow Calendars for Northfix in Settings to turn this on")
            openSystemSettings()
        }
    }

    private func turnOnNotifications() async {
        UserDefaults.standard.set(true, forKey: "notify")
        let center = UNUserNotificationCenter.current()
        let status = await center.notificationSettings().authorizationStatus
        if status == .denied {
            model.show("Allow notifications for Northfix in Settings to turn this on")
            openSystemSettings()
            return
        }
        await Notifications.shared.requestPermission()
        let after = await center.notificationSettings().authorizationStatus
        notifyOn = after == .authorized || after == .provisional
        if notifyOn { Notifications.shared.schedule(model: model) }
    }

    private func openWatchApp() {
        // the Watch app, where a watch is paired; Northfix shows up on it on its own
        guard let u = URL(string: "itms-watchs://") else { return }
        UIApplication.shared.open(u, options: [:]) { ok in
            if !ok { model.show("Pair an Apple Watch in the Watch app. Northfix shows up on it on its own.") }
        }
    }

    private func openSystemSettings() {
        if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) }
    }
}

/// You > Set up Northfix: the whole list, done rows included, so hiding the card isn't final.
struct SetupSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Each of these adds something to Today. None of them is required, and nothing leaves your devices.")
                        .font(Theme.geist(.subheadline)).foregroundStyle(Theme.text2)
                        .padding(.horizontal, 6)
                    SetupCard(full: true, before: { dismiss() })
                }
                .padding(16)
            }
            .background(Theme.bg)
            .navigationTitle("Set up Northfix")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
