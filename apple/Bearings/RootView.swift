import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.tab) {
            Tab(AppTab.home.title, systemImage: AppTab.home.icon, value: AppTab.home) {
                stack(.home) { HomeView() }
            }
            Tab(AppTab.people.title, systemImage: AppTab.people.icon, value: AppTab.people) {
                stack(.people) { PeopleView() }
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
        .overlay(alignment: .bottom) { ToastView() }
        .sheet(isPresented: $model.showImport) { ImportView() }
        .sheet(isPresented: $model.showSettings) { SettingsView() }
        .sheet(isPresented: $model.showAddTarget) { AddTargetView() }
        .sheet(isPresented: $model.showPayoff) { PayoffView() }
        .sheet(item: $model.shareFile) { f in ActivityView(items: [f.url]).ignoresSafeArea() }
        .fullScreenCover(isPresented: $model.showOnboarding) { OnboardingView() }
    }

    @ViewBuilder
    private func stack<Content: View>(_ tab: AppTab, @ViewBuilder content: () -> Content) -> some View {
        NavigationStack(path: Binding(get: { model.paths[tab] ?? [] }, set: { model.paths[tab] = $0 })) {
            content()
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .person(let k): ProfileView(k: k)
                    case .unit(let name): UnitView(name: name)
                    case .industry(let id): IndustryView(id: id)
                    case .meeting(let id): MeetingView(id: id)
                    case .trip(let id): TripView(id: id)
                    case .trips: TripsView()
                    }
                }
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

/// Toolbar buttons shared by the main screens.
struct MainToolbar: ToolbarContent {
    @Environment(AppModel.self) private var model

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button {
                model.showImport = true
            } label: {
                Label(model.info.isSample ? "Import connections" : "Refresh connections", systemImage: "square.and.arrow.down")
            }
            Button {
                model.showSettings = true
            } label: {
                Label("Settings", systemImage: "gearshape")
            }
        }
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
