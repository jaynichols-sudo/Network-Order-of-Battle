import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Namespace private var zoom

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.tab) {
            Tab(AppTab.home.title, systemImage: AppTab.home.icon, value: AppTab.home) {
                stack(.home) { HomeView() }
            }
            Tab(AppTab.people.title, systemImage: searchRole == nil ? AppTab.people.icon : "magnifyingglass", value: AppTab.people, role: searchRole) {
                stack(.people) { PeopleView(zoom: zoom) }
            }
            Tab(AppTab.companies.title, systemImage: AppTab.companies.icon, value: AppTab.companies) {
                stack(.companies) { CompaniesView() }
            }
            Tab(AppTab.explore.title, systemImage: AppTab.explore.icon, value: AppTab.explore) {
                stack(.explore) { ExploreView() }
            }
            Tab(AppTab.catchup.title, systemImage: AppTab.catchup.icon, value: AppTab.catchup) {
                stack(.catchup) { CatchUpView() }
            }
            .badge(model.info.deckCount)
        }
        .tabViewStyle(.sidebarAdaptable)
        .modifier(ModernTabBar())
        .overlay(alignment: .bottom) { ToastView() }
        .sheet(isPresented: $model.showImport) { ImportView() }
        .sheet(isPresented: $model.showSettings) { SettingsView() }
        .sheet(isPresented: $model.showAddTarget) { AddTargetView() }
        .sheet(isPresented: $model.showPayoff) { PayoffView() }
        .sheet(isPresented: $model.showShareCard) { ShareCardSheet() }
        .sheet(isPresented: $model.newEvent) { NewEventSheet() }
        .sheet(isPresented: $model.showQuickFind) { QuickFind() }
        .sheet(isPresented: $model.showWeekly) { WeeklyBriefView() }
        .sheet(item: Binding(get: { model.introQuery.map { IntroFinderView.Wrapped(id: $0) } }, set: { model.introQuery = $0?.id })) { w in
            IntroFinderView(query: w.id)
        }
        .sheet(item: $model.shareFile) { f in ActivityView(items: [f.url]).ignoresSafeArea() }
        .fullScreenCover(isPresented: $model.showOnboarding) { OnboardingView() }
    }

    /// On iOS 26 People becomes the search tab, which floats on its own beside the tab bar.
    private var searchRole: TabRole? {
        if #available(iOS 26.0, *) { return .search }
        return nil
    }

    @ViewBuilder
    private func stack<Content: View>(_ tab: AppTab, @ViewBuilder content: () -> Content) -> some View {
        NavigationStack(path: Binding(get: { model.paths[tab] ?? [] }, set: { model.paths[tab] = $0 })) {
            content()
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .person(let k):
                        if tab == .people {
                            ProfileView(k: k).navigationTransition(.zoom(sourceID: k, in: zoom))
                        } else {
                            ProfileView(k: k)
                        }
                    case .unit(let name): UnitView(name: name)
                    case .industry(let id): IndustryView(id: id)
                    case .meeting(let id): MeetingView(id: id)
                    case .trip(let id): TripView(id: id)
                    case .trips: TripsView()
                    case .event(let id): EventView(id: id)
                    }
                }
        }
    }
}

/// iOS 26: the tab bar tucks away while you scroll, and an active trip rides above it.
struct ModernTabBar: ViewModifier {
    @Environment(AppModel.self) private var model

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            if let trip = TripMode.current {
                content
                    .tabBarMinimizeBehavior(.onScrollDown)
                    .tabViewBottomAccessory { TripAccessory(trip: trip) }
            } else {
                content.tabBarMinimizeBehavior(.onScrollDown)
            }
        } else {
            content
        }
    }
}

struct ToastView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            if let t = model.toast {
                Text(t)
                    .font(Theme.geist(.subheadline, .medium))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .background(.regularMaterial, in: Capsule())
                    .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 90)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .onTapGesture { model.toast = nil }
            }
        }
        .animation(.spring(duration: 0.35), value: model.toast)
    }
}

/// The system share sheet, for backups and exports.
struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

/// Toolbar shared by the main screens: one account button instead of a row of icons.
struct MainToolbar: ToolbarContent {
    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) { AccountButton() }
    }
}

/// Your initials. Opens a menu with refresh, backup and settings.
struct AccountButton: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Menu {
            Button {
                model.showImport = true
            } label: {
                Label(model.info.isSample ? "Import connections" : "Refresh connections", systemImage: "square.and.arrow.down")
            }
            if !model.info.isSample {
                Button { Task { await model.backup() } } label: { Label("Back up notes", systemImage: "externaldrive") }
            }
            Divider()
            Button { model.showSettings = true } label: { Label("Settings", systemImage: "gearshape") }
        } label: {
            MeAvatar(initials: model.myInitials, size: 34)
        }
        .accessibilityLabel("Account, refresh and settings")
    }
}

/// Opens a LinkedIn or other web link, handing off to the LinkedIn app when installed.
struct LinkButton: View {
    let title: String
    let url: String
    var icon = "arrow.up.right.square"
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            if let u = URL(string: url) { Haptic.tap(); openURL(u) }
        } label: {
            Label(title, systemImage: icon)
        }
        .disabled(URL(string: url) == nil)
    }
}
