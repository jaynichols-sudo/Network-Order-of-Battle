import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Namespace private var zoom
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        @Bindable var model = model
        Group {
            // Two TabViews instead of one with a condition inside: a conditional tab list left
            // the iPhone blank. Wide screens get the Workspace section in their sidebar.
            if sizeClass == .regular {
                TabView(selection: $model.tab) {
                    mainTabs
                    TabSection("Workspace") { workspaceTabs }
                }
            } else {
                TabView(selection: $model.tab) { mainTabs }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .modifier(ModernTabBar())
        .overlay(alignment: .bottom) { ToastView() }
        .sheet(isPresented: $model.showImport) { ImportView().environment(AppModel.shared) }
        .sheet(isPresented: $model.showSettings) { SettingsView().environment(AppModel.shared) }
        .sheet(isPresented: $model.showSetup) { SetupSheet().environment(AppModel.shared) }
        .sheet(isPresented: $model.showAddTarget) { AddTargetView().environment(AppModel.shared) }
        .sheet(isPresented: $model.showPayoff) { PayoffView().environment(AppModel.shared) }
        .sheet(isPresented: $model.showShareCard) { ShareCardSheet().environment(AppModel.shared) }
        .sheet(isPresented: $model.newEvent) {
            Group { if Pro.shared.unlocked { NewEventSheet() } else { PaywallView(feature: .events) } }.environment(AppModel.shared)
        }
        .sheet(isPresented: $model.showYear) { YearInReviewView().environment(AppModel.shared) }
        .sheet(isPresented: $model.showPaywall) { PaywallView().environment(AppModel.shared) }
        .sheet(item: $model.paywallFeature) { f in PaywallView(feature: f).environment(AppModel.shared) }
        .sheet(isPresented: $model.showQuickFind) { QuickFind().environment(AppModel.shared) }
        .sheet(isPresented: $model.showWeekly) { WeeklyBriefView().environment(AppModel.shared) }
        .sheet(item: Binding(get: { model.introQuery.map { IntroFinderView.Wrapped(id: $0) } }, set: { model.introQuery = $0?.id })) { w in
            Group { if Pro.shared.unlocked { IntroFinderView(query: w.id) } else { PaywallView(feature: .waysIn) } }.environment(AppModel.shared)
        }
        .sheet(item: $model.notesDraft) { d in MeetingNotesSheet(draft: d).environment(AppModel.shared) }
        .sheet(isPresented: $model.showAsk) { AskView().environment(AppModel.shared) }
        .sheet(isPresented: $model.showQuickLog) { QuickLogSheet().environment(AppModel.shared) }
        .sheet(item: $model.feedback) { f in FeedbackSheet(screenshot: f.screenshot).environment(AppModel.shared) }
        .shakeForFeedback($model.feedback)
        .sheet(item: $model.shareFile) { f in ActivityView(items: [f.url]).ignoresSafeArea().environment(AppModel.shared) }
        .alert("Found your LinkedIn export", isPresented: Binding(get: { model.foundExport != nil }, set: { if !$0 { model.foundExport = nil } })) {
            Button("Import it") {
                model.pendingImportURL = model.foundExport
                model.foundExport = nil
                model.showImport = true
            }
            Button("Not now", role: .cancel) { model.foundExport = nil }
        } message: {
            Text("\(model.foundExport?.lastPathComponent ?? "A LinkedIn file") is in your Downloads. Only what changed is updated, and your notes stay put.")
        }
        .fullScreenCover(isPresented: $model.showOnboarding) { OnboardingView().environment(AppModel.shared) }
    }

    @TabContentBuilder<AppTab> private var mainTabs: some TabContent<AppTab> {
        Tab(AppTab.home.title, systemImage: AppTab.home.icon, value: AppTab.home) {
            stack(.home) { HomeView() }
        }
        Tab(AppTab.people.title, systemImage: searchRole == nil ? AppTab.people.icon : "magnifyingglass", value: AppTab.people, role: searchRole) {
            stack(.people) { PeopleView(zoom: zoom) }
        }
        Tab(AppTab.companies.title, systemImage: AppTab.companies.icon, value: AppTab.companies) {
            stack(.companies) { CompaniesView() }
        }
        Tab(AppTab.you.title, systemImage: AppTab.you.icon, value: AppTab.you) {
            stack(.you) { YouView() }
        }
    }

    /// Mac and iPad sidebar only.
    @TabContentBuilder<AppTab> private var workspaceTabs: some TabContent<AppTab> {
        Tab(AppTab.explore.title, systemImage: AppTab.explore.icon, value: AppTab.explore) { stack(.explore) { ExploreView() } }
        Tab(AppTab.pursuits.title, systemImage: AppTab.pursuits.icon, value: AppTab.pursuits) { stack(.pursuits) { PursuitsView() } }
        Tab(AppTab.opportunities.title, systemImage: AppTab.opportunities.icon, value: AppTab.opportunities) { stack(.opportunities) { OpportunitiesView() } }
        Tab(AppTab.socials.title, systemImage: AppTab.socials.icon, value: AppTab.socials) { stack(.socials) { SocialsView() } }
        Tab(AppTab.trips.title, systemImage: AppTab.trips.icon, value: AppTab.trips) { stack(.trips) { TripsView() } }
        Tab(AppTab.team.title, systemImage: AppTab.team.icon, value: AppTab.team) { stack(.team) { TeamView() } }
    }

    /// On iOS 26 People becomes the search tab, which floats on its own beside the tab bar.
    private var searchRole: TabRole? {
        if #available(iOS 26.0, *) { return .search }
        return nil
    }

    @ViewBuilder
    private func stack<Content: View>(_ tab: AppTab, @ViewBuilder content: () -> Content) -> some View {
        if [.people, .companies, .you].contains(tab) {
            WideSplit(tab: tab, zoom: zoom, content: content)
        } else {
            plainStack(tab, content: content)
        }
    }

    private func plainStack<Content: View>(_ tab: AppTab, @ViewBuilder content: () -> Content) -> some View {
        NavigationStack(path: Binding(get: { model.paths[tab] ?? [] }, set: { model.paths[tab] = $0 })) {
            content().routes(tab: tab, zoom: zoom)
        }
        .environment(\.zoomNamespace, zoom)
        .environment(\.zoomTab, tab)
    }
}

extension View {
    /// Every screen a tab can push.
    func routes(tab: AppTab, zoom: Namespace.ID) -> some View {
        navigationDestination(for: Route.self) { route in RouteDestination(route: route, tab: tab, zoom: zoom) }
    }
}

struct RouteDestination: View {
    let route: Route
    let tab: AppTab
    let zoom: Namespace.ID

    var body: some View {
                    switch route {
                    case .person(let k):
                        ProfileView(k: k).navigationTransition(.zoom(sourceID: ZoomID.person(tab, k), in: zoom))
                    case .unit(let name):
                        UnitView(name: name).navigationTransition(.zoom(sourceID: ZoomID.unit(tab, name), in: zoom))
                    case .industry(let id): IndustryView(id: id)
                    case .meeting(let id): MeetingView(id: id)
                    case .trip(let id): TripView(id: id)
                    case .trips: TripsView()
                    case .event(let id): EventView(id: id)
                    case .explore:
                        ExploreView().navigationTransition(.zoom(sourceID: ZoomID.explore(tab), in: zoom))
                    case .catchup: CatchUpView()
                    case .events: EventsList()
                    case .about(let k): PersonAboutView(k: k)
                    case .team: TeamView()
                    case .org(let name): OrgChartView(name: name)
                    case .pursuits: PursuitsView()
                    case .pursuit(let id): PursuitView(id: id)
                    case .moves: MovesView()
                    case .intros: IntrosView()
                    case .socials: SocialsView()
                    case .opportunities: OpportunitiesView()
                    case .opportunity(let id): OpportunityView(id: id)
                    }
    }
}

/// People, Companies and You on a wide window (Mac, iPad in landscape): the list stays on the
/// left and whatever you open fills the right, like Mail or Notes. On a narrow window it's the
/// usual push navigation. Either way the tab's path in the model is the one source of truth.
struct WideSplit<Content: View>: View {
    @Environment(AppModel.self) private var model
    let tab: AppTab
    let zoom: Namespace.ID
    @ViewBuilder var content: Content
    @State private var width: CGFloat = 0

    private var path: [Route] { model.paths[tab] ?? [] }

    var body: some View {
        Group {
            if width >= Wide.splitThreshold {
                HStack(spacing: 0) {
                    // the list: anything it opens goes to the right-hand pane instead of pushing here
                    NavigationStack(path: Binding<[Route]>(get: { [] }, set: { new in
                        if let r = new.last { model.paths[tab] = [r] }
                    })) {
                        content.routes(tab: tab, zoom: zoom)
                    }
                    .frame(width: Wide.listWidth(width))
                    Rectangle().fill(Theme.hairline).frame(width: 1).ignoresSafeArea()
                    NavigationStack(path: Binding<[Route]>(get: { Array(path.dropFirst()) }, set: { rest in
                        if let first = path.first { model.paths[tab] = [first] + rest }
                    })) {
                        Group {
                            if let first = path.first {
                                DetailPane(route: first, tab: tab, zoom: zoom).id(first)
                            } else {
                                DetailPlaceholder(tab: tab)
                            }
                        }
                        .routes(tab: tab, zoom: zoom)
                    }
                    .frame(maxWidth: .infinity)
                }
                .environment(\.inSplit, true)
            } else {
                NavigationStack(path: Binding<[Route]>(get: { path }, set: { model.paths[tab] = $0 })) {
                    content.routes(tab: tab, zoom: zoom)
                }
            }
        }
        .environment(\.zoomNamespace, zoom)
        .environment(\.zoomTab, tab)
        .readWidth($width)
        .task(id: "\(width >= Wide.splitThreshold)-\(model.loaded)-\(model.results.count)") { openFirst() }
    }

    /// Like Mail, a wide window opens the first item instead of leaving the right pane blank.
    private func openFirst() {
        guard width >= Wide.splitThreshold, model.loaded, path.isEmpty else { return }
        switch tab {
        case .people: if let k = model.results.first?.k { model.paths[tab] = [.person(k)] }
        case .companies: if let t = model.targets.first { model.paths[tab] = [.unit(t.name)] }
        case .you: model.paths[tab] = [.catchup]
        default: break
        }
    }
}

/// What fills the right-hand pane. A person gets their profile and their details side by side,
/// so a wide pane is used instead of one narrow column; screens built as lists keep a readable
/// width and center, like System Settings.
struct DetailPane: View {
    let route: Route
    let tab: AppTab
    let zoom: Namespace.ID
    @State private var width: CGFloat = 0

    var body: some View {
        Group {
            switch route {
            case .person(let k) where width >= 1000:
                HStack(spacing: 0) {
                    ProfileView(k: k)
                        .frame(width: min(720, (width * 0.54).rounded()))
                    Rectangle().fill(Theme.hairline).frame(width: 1)
                    PersonAboutView(k: k)
                        .frame(maxWidth: .infinity)
                }
            case .person:
                RouteDestination(route: route, tab: tab, zoom: zoom)
            default:
                RouteDestination(route: route, tab: tab, zoom: zoom)
                    .frame(maxWidth: 1060)
                    .frame(maxWidth: .infinity)
                    .background(Color(.systemGroupedBackground))
            }
        }
        .readWidth($width)
    }
}

/// The right-hand pane before anything is picked.
struct DetailPlaceholder: View {
    @Environment(AppModel.self) private var model
    let tab: AppTab

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle().fill(Theme.amber.opacity(0.12)).frame(width: 120, height: 120)
                Circle().strokeBorder(Theme.amber.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [3, 5])).frame(width: 170, height: 170)
                Image(systemName: icon).font(.system(size: 42, weight: .light)).foregroundStyle(Theme.amber)
            }
            .padding(.bottom, 6)
            Text(title).font(Theme.serif(.title2, .semibold))
            Text(line).font(Theme.geist(.subheadline)).foregroundStyle(Theme.text2)
                .multilineTextAlignment(.center).frame(maxWidth: 360)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg)
    }

    private var icon: String {
        switch tab { case .people: return "person.crop.circle"; case .companies: return "building.2"; default: return "sparkles" }
    }
    private var title: String {
        switch tab { case .people: return "Pick someone"; case .companies: return "Pick a company"; default: return "Pick something to open" }
    }
    private var line: String {
        switch tab {
        case .people: return "\(model.people.count.formatted()) people in your network. Choose one on the left to see where you stand."
        case .companies: return "Choose a company or agency on the left to see who you know there and your ways in."
        default: return "Your pursuits, intros, team and settings open here."
        }
    }
}

private struct InSplitKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    /// True inside the two-pane layout, so screens can trim chrome they don't need there.
    var inSplit: Bool {
        get { self[InSplitKey.self] }
        set { self[InSplitKey.self] = newValue }
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
