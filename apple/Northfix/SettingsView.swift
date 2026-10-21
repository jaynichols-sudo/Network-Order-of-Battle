import SwiftUI
import EventKit
import AuthenticationServices
import UniformTypeIdentifiers

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage("name") private var name = ""
    @AppStorage("salesnav") private var salesNav = false
    @AppStorage("notify") private var notify = true
    @AppStorage("askAfterMeeting") private var askAfterMeeting = true
    @AppStorage("haptics") private var haptics = true
    @AppStorage("sounds") private var sounds = true
    @AppStorage("contactPhotos") private var contactPhotos = true
    @State private var restoring = false
    @State private var feedback = false
    @State private var homeText = UserDefaults.standard.string(forKey: "homeName") ?? ""
    @State private var arrivals = ArrivalAlerts.enabled
    @State private var remindersOn = ReminderSync.shared.enabled && ReminderSync.shared.authorized

    var body: some View {
        NavigationStack {
            Form {
                generalSection
                networkSection
                contactsSection
                calendarSection
                MailSettingsSection()
                CRMSettingsSection()
                EnrichSettingsSection()
                SamSettingsSection()
                dataSection
                aboutSection
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .fileImporter(isPresented: $restoring, allowedContentTypes: [.json]) { r in
                if case .success(let url) = r { Task { await model.restore(url) } }
            }
            .onChange(of: name) { _, _ in Task { await model.refreshAll() } }
            .sheet(item: Binding(get: { model.paywallFeature }, set: { model.paywallFeature = $0 })) { f in PaywallView(feature: f).environment(AppModel.shared) }
            .sheet(isPresented: $feedback) {
                FeedbackMail(to: AppInfo.supportEmail, body: "\n\n\n—\n" + Diagnostics.shared.summary(model: model), attachments: Diagnostics.shared.reports)
                    .ignoresSafeArea()
            }
        }
    }

    private var lensChoice: Binding<String> {
        Binding(
            get: { model.lensPref.map { $0 ? "on" : "off" } ?? "auto" },
            set: { v in Task { await model.setLens(v == "auto" ? nil : v == "on") } })
    }

    private var generalSection: some View {
        Section {
            MyPhotoRow()
            TextField("Your name", text: $name)
                .textContentType(.name)
            Picker("Appearance", selection: $appearance) {
                Text("Automatic").tag("system")
                Text("Light").tag("light")
                Text("Dark").tag("dark")
            }
            AppIconPicker()
        }
    }

    private var networkSection: some View {
        Section {
            Toggle("Watchlist news on Today", isOn: Binding(get: { UserDefaults.standard.object(forKey: "watchNews") as? Bool ?? true },
                                                          set: { UserDefaults.standard.set($0, forKey: "watchNews") }))
            Picker("Federal and military view", selection: lensChoice) {
                Text(model.info.lensAuto ? "Automatic (on)" : "Automatic (off)").tag("auto")
                Text("On").tag("on")
                Text("Off").tag("off")
            }
            Toggle("I use Sales Navigator", isOn: $salesNav)
            Toggle("Reminders", isOn: $notify)
                .onChange(of: notify) { _, on in reschedule(on) }
            Toggle("Haptics", isOn: $haptics)
            Toggle("Sounds", isOn: $sounds)
            Toggle("Monday brief", isOn: Binding(get: { WeeklyBrief.enabled }, set: { on in WeeklyBrief.enabled = on; Task { await WeeklyBrief.schedule() } }))
        } header: {
            Text("Your network")
        } footer: {
            Text("The federal view adds branch, rank, agency and federal segments. Reminders cover follow-ups you set, plus a weekly nudge to refresh.")
        }
    }

    private var contactsSection: some View {
        Section {
            Button(model.locating ? "Matching…" : "Match with my Contacts") { Task { await model.locate() } }
                .disabled(model.locating || model.info.isSample)
            Toggle("Use their Contacts photo", isOn: $contactPhotos)
                .onChange(of: contactPhotos) { _, _ in PhotoStore.shared.replaceAllKeepingFiles() }
            if model.contactsMatched > 0 {
                LabeledContent("Matched", value: "\(model.contactsMatched.formatted()) people, \(PhotoStore.shared.count.formatted()) with photos")
            }
        } header: {
            Text("iPhone Contacts")
        } footer: {
            Text("Matching connections to your Contacts, by email or name, gives Northfix their photo and a rough location for the Map. It all happens on this device. It runs again after each LinkedIn refresh.")
        }
    }

    private var calendarSection: some View {
        Section {
            Toggle("Meeting prep and trips", isOn: Binding(
                get: { CalendarService.shared.enabled && CalendarService.shared.authorized },
                set: { on in
                    Task {
                        if on { _ = await CalendarService.shared.requestAccess() } else { CalendarService.shared.enabled = false }
                        await CalendarService.shared.scan(model: model, force: true)
                    }
                }))
            if CalendarService.shared.enabled && CalendarService.shared.authorized {
                NavigationLink {
                    CalendarPicker()
                } label: {
                    LabeledContent("Calendars", value: CalendarPicker.summary)
                }
                Toggle("Ask about meetings when they end", isOn: Binding(
                    get: { askAfterMeeting },
                    set: { on in
                        askAfterMeeting = on
                        Task { await CalendarService.shared.scan(model: model, force: true) }
                    }))
            }
            NavigationLink {
                TripFeedSettings()
            } label: {
                LabeledContent(CalendarService.shared.hasFeed ? "TripIt feed" : "Add a TripIt feed", value: CalendarService.shared.hasFeed ? "On" : "")
            }
            Toggle("Follow-ups in Apple Reminders", isOn: Binding(
                get: { remindersOn },
                set: { on in
                    Task {
                        if on {
                            let ok = await ReminderSync.shared.requestAccess()
                            ReminderSync.shared.enabled = ok
                            remindersOn = ok
                            if !ok { model.show("Allow Reminders for Northfix in Settings to turn this on") }
                        } else {
                            ReminderSync.shared.enabled = false
                            remindersOn = false
                        }
                    }
                }))
            Toggle("Next meeting on the Lock Screen", isOn: Binding(
                get: { MeetingMode.enabled },
                set: { on in
                    MeetingMode.enabled = on
                    Task { await MeetingMode.refresh(model: model) }
                }))
            Toggle("Trip mode on the Lock Screen", isOn: Binding(
                get: { TripMode.enabled },
                set: { on in
                    TripMode.enabled = on
                    Task { await TripMode.refresh(model: model) }
                }))
            #if !targetEnvironment(macCatalyst)
            Toggle("Arrival alerts", isOn: Binding(
                get: { arrivals },
                set: { on in
                    if on && !model.allow(.arrivals) { return }
                    arrivals = on
                    ArrivalAlerts.shared.setEnabled(on)
                }))
            #endif
            TextField("Home city, like Greensboro, NC", text: $homeText)
                .submitLabel(.done)
                .onSubmit {
                    Task {
                        if await CalendarService.shared.setHome(homeText) {
                            homeText = CalendarService.shared.homeName
                            await CalendarService.shared.scan(model: model, force: true)
                        } else { model.show("Couldn’t find “\(homeText)”") }
                    }
                }
        } header: {
            Text("Calendar")
        } footer: {
            Text("Northfix reads your calendar on this device to brief you before meetings with people you know (what you talked about last time, on the Lock Screen and your watch), and to spot trips more than 75 miles from home. When a meeting with them ends, it asks how it went. Reply in the notification, on your iPhone or watch, and the note goes on their profile. In Trip mode, a trip shows on your Lock Screen two days ahead with who you know nearby. With arrival alerts, landing in a city away from home tells you who you know there (choose “Always” for location when asked). With Reminders on, follow-ups go on a Northfix list in Apple Reminders, and checking one off there marks it done here. Nothing is uploaded.")
        }
    }

    private func reschedule(_ on: Bool) {
        Task {
            if on { await Notifications.shared.requestPermission() }
            Notifications.shared.schedule(model: model)
        }
    }

    private var dataSection: some View {
        Section {
            Button(model.info.isSample ? "Import connections" : "Refresh connections") {
                dismiss()
                model.showImport = true
            }
            Button("Export everyone as a spreadsheet") { Task { await model.exportCSV(keys: nil) } }
            Button("Back up your notes") { Task { await model.backup() } }
            Button("Restore from a backup") { restoring = true }
            LabeledContent("Saved to", value: model.isCloud ? "iCloud, synced across your Apple devices" : "This device")
            if !model.lastBackup.isEmpty {
                LabeledContent("Last backup", value: Day.nice(model.lastBackup))
            }
        } header: {
            Text("Your data")
        } footer: {
            Text("A backup holds your stars, notes, follow-ups, corrections and watchlist. Restoring adds back anything missing and keeps your newer changes.")
        }
    }

    private var aboutSection: some View {
        Section {
            Button("Show the welcome tour") {
                dismiss()
                model.showOnboarding = true
            }
            Button("Send feedback") {
                if FeedbackMail.available { feedback = true } else { contactSupport() }
            }
            if let product = Pro.shared.product {
                if Pro.shared.owned {
                    LabeledContent("Northfix Pro", value: "Unlocked. Thank you!")
                } else {
                    Button("Get Northfix Pro (\(product.displayPrice))") { Task { _ = await Pro.shared.buy() } }
                    Button("Restore purchase") { Task { await Pro.shared.restore() } }
                }
            }
        } footer: {
            Text("Private by design: no account and no server. Your network lives on your devices and in your own iCloud. Industry, seniority, branch and rank are worked out from each person’s title and company. Fix anything that’s off from their profile.")
        }
    }

    private func contactSupport() {
        let info = Bundle.main.infoDictionary ?? [:]
        let v = info["CFBundleShortVersionString"] as? String ?? ""
        let b = info["CFBundleVersion"] as? String ?? ""
        let device = UIDevice.current.model + " " + UIDevice.current.systemVersion
        let body = "\n\n—\nNorthfix \(v) (\(b)), \(device)\n" + Diagnostics.shared.summary(model: model)
        guard var c = URLComponents(string: "mailto:" + AppInfo.supportEmail) else { return }
        c.queryItems = [URLQueryItem(name: "subject", value: "Northfix support"), URLQueryItem(name: "body", value: body)]
        if let u = c.url { openURL(u) }
    }
}

struct SalesforceGuide: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Salesforce needs a “connected app” in your org before any app can sign in. A Salesforce admin does this once, in about five minutes.")
                }
                Section("In Salesforce Setup") {
                    step(1, "Open App Manager", "Setup, then App Manager, then New Connected App (or New External Client App).")
                    step(2, "Name it", "Northfix. Add your email as the contact.")
                    step(3, "Turn on OAuth", "Tick Enable OAuth Settings. Callback URL: bearings://oauth/salesforce")
                    step(4, "Pick scopes", "Manage user data via APIs (api), and Perform requests at any time (refresh_token, offline_access).")
                    step(5, "Security", "Tick Require Proof Key for Code Exchange (PKCE). Untick Require Secret for Web Server Flow.")
                    step(6, "Copy the key", "Save, wait a few minutes, then copy the Consumer Key into Northfix.")
                }
                Section {
                    Text("Northfix creates or updates a Contact (and its Account), a follow-up Task when you set one, and a Note with your notes. It only touches records it created or matched by email, or by name and company.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Set up Salesforce")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func step(_ n: Int, _ t: String, _ d: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(n)").font(.subheadline.weight(.bold)).frame(width: 24, height: 24).background(Theme.accent.opacity(0.2), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(t).fontWeight(.semibold)
                Text(d).font(.subheadline).foregroundStyle(.secondary).textSelection(.enabled)
            }
        }
    }
}


/// Pick which calendars Northfix reads for meeting prep and trips.
struct CalendarPicker: View {
    @Environment(AppModel.self) private var model
    @State private var off = CalendarService.shared.hiddenCalendars
    private let groups = CalendarService.shared.calendarGroups()

    static var summary: String {
        let all = CalendarService.shared.calendarGroups().flatMap(\.calendars)
        let off = CalendarService.shared.hiddenCalendars
        let on = all.filter { !off.contains($0.calendarIdentifier) }.count
        return on == all.count ? "All" : "\(on) of \(all.count)"
    }

    var body: some View {
        List {
            Section {
                Text("Northfix reads these calendars on your iPhone to brief you before meetings and spot trips. To add a calendar like an iCloud “All Work” calendar, make sure it’s turned on in the Calendar app first.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(groups, id: \.source) { g in
                Section(g.source) {
                    ForEach(g.calendars, id: \.calendarIdentifier) { c in
                        Toggle(isOn: Binding(
                            get: { !off.contains(c.calendarIdentifier) },
                            set: { on in if on { off.remove(c.calendarIdentifier) } else { off.insert(c.calendarIdentifier) } }
                        )) {
                            HStack(spacing: 10) {
                                Circle().fill(Color(cgColor: c.cgColor)).frame(width: 10, height: 10)
                                Text(c.title)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Calendars")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: off) { _, v in
            CalendarService.shared.hiddenCalendars = v
            Task { await CalendarService.shared.scan(model: model, force: true) }
        }
    }
}
