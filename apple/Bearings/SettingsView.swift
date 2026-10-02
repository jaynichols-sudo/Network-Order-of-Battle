import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage("name") private var name = ""
    @AppStorage("salesnav") private var salesNav = false
    @AppStorage("notify") private var notify = true
    @AppStorage("haptics") private var haptics = true
    @State private var restoring = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Appearance", selection: $appearance) {
                        Text("Automatic").tag("system")
                        Text("Light").tag("light")
                        Text("Dark").tag("dark")
                    }
                    TextField("Your first name (for the greeting)", text: $name)
                        .textContentType(.givenName)
                }
                Section {
                    Picker("Federal and military view", selection: Binding(
                        get: { model.lensPref.map { $0 ? "on" : "off" } ?? "auto" },
                        set: { v in Task { await model.setLens(v == "auto" ? nil : v == "on") } })) {
                        Text("Automatic\(model.info.lensAuto ? " (on)" : " (off)")").tag("auto")
                        Text("On").tag("on")
                        Text("Off").tag("off")
                    }
                    Toggle("I use Sales Navigator", isOn: $salesNav)
                    Toggle("Reminders", isOn: $notify)
                        .onChange(of: notify) { _, on in
                            Task {
                                if on { await Notifications.shared.requestPermission() }
                                Notifications.shared.schedule(model: model)
                            }
                        }
                    Toggle("Haptics", isOn: $haptics)
                } header: {
                    Text("Your network")
                } footer: {
                    Text("The federal view adds branch, rank, agency and federal segments. Reminders cover follow-ups you set, plus a weekly nudge to refresh.")
                }
                Section {
                    Button(model.info.isSample ? "Import connections" : "Refresh connections") {
                        dismiss()
                        model.showImport = true
                    }
                    Button("Export everyone as a spreadsheet") { Task { await model.exportCSV(keys: nil) } }
                    Button("Back up your notes") { Task { await model.backup() } }
                    Button("Restore from a backup") { restoring = true }
                    LabeledContent("Saved to", value: model.isCloud ? "iCloud, synced across your Apple devices" : "This device")
                    if !model.lastBackup.isEmpty { LabeledContent("Last backup", value: Day.nice(model.lastBackup)) }
                } header: {
                    Text("Your data")
                } footer: {
                    Text("A backup holds your stars, notes, follow-ups, corrections and watchlist. Restoring adds back anything missing and keeps your newer changes.")
                }
                Section {
                    Button("Show the welcome tour") {
                        dismiss()
                        model.showOnboarding = true
                    }
                    Button("Contact support") {
                        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
                        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? ""
                        let device = UIDevice.current.model + " " + UIDevice.current.systemVersion
                        let body = "\n\n—\nBearings \(v) (\(b)), \(device)"
                        var c = URLComponents(string: "mailto:" + AppInfo.supportEmail)!
                        c.queryItems = [URLQueryItem(name: "subject", value: "Bearings support"), URLQueryItem(name: "body", value: body)]
                        if let u = c.url { openURL(u) }
                    }
                } footer: {
                    Text("Private by design: no account and no server. Your network lives on your devices and in your own iCloud. Industry, seniority, branch and rank are worked out from each person’s title and company. Fix anything that’s off from their profile.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .fileImporter(isPresented: $restoring, allowedContentTypes: [.json]) { r in
                if case .success(let url) = r { Task { await model.restore(url) } }
            }
            .onChange(of: name) { _, _ in Task { await model.refreshAll() } }
        }
    }
}

struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var page = 0

    private let pages: [(String, String, String)] = [
        ("location.north.circle.fill", "See who you know, and where they are now", "Bearings turns your LinkedIn connections into a map you can search, sort and act on. Spot job changes, find who you know at any company, and never lose track of a follow-up."),
        ("arrowshape.turn.up.left.circle.fill", "Know who’s waiting on you", "Add your LinkedIn messages and Bearings shows who wrote last, which relationships are going cold, and who you’re closest to."),
        ("lock.circle.fill", "Private by design", "No account and no server. Your network stays on your devices and in your own iCloud."),
    ]

    var body: some View {
        VStack(spacing: 0) {
            TabView(selection: $page) {
                ForEach(Array(pages.enumerated()), id: \.offset) { i, p in
                    VStack(spacing: 22) {
                        Spacer()
                        Image(systemName: p.0)
                            .font(.system(size: 88))
                            .foregroundStyle(Theme.amber, Theme.violet)
                            .symbolRenderingMode(.palette)
                        Text(p.1).geist(.title, .bold).multilineTextAlignment(.center)
                        Text(p.2).font(Theme.geist(.body)).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        Spacer()
                    }
                    .padding(.horizontal, 32)
                    .tag(i)
                }
            }
            .tabViewStyle(.page)
            .indexViewStyle(.page(backgroundDisplayMode: .always))
            VStack(spacing: 12) {
                Button {
                    if page < pages.count - 1 { withAnimation { page += 1 } }
                    else { finish(import: true) }
                } label: {
                    Text(page < pages.count - 1 ? "Continue" : "Import my connections")
                        .font(Theme.geist(.headline))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                Button("Look around with sample data first") { finish(import: false) }
                    .font(Theme.geist(.subheadline, .semibold))
            }
            .padding(24)
        }
    }

    private func finish(import doImport: Bool) {
        UserDefaults.standard.set(true, forKey: "onboarded")
        dismiss()
        if doImport { model.showImport = true }
    }
}
