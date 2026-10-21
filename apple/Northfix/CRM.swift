import SwiftUI
import AuthenticationServices

/// The CRMs Northfix can send people to. Each one talks to the user's own CRM straight
/// from the device; tokens stay in the keychain and there's no Northfix server in between.
/// More than one can be connected at once.
enum CRM: String, CaseIterable, Identifiable {
    case salesforce, hubspot, dynamics

    var id: String { rawValue }

    var title: String {
        switch self {
        case .salesforce: return "Salesforce"
        case .hubspot: return "HubSpot"
        case .dynamics: return "Dynamics 365"
        }
    }

    /// For buttons: "Send to Dynamics".
    var short: String { self == .dynamics ? "Dynamics" : title }

    var icon: String {
        switch self {
        case .salesforce: return "cloud"
        case .hubspot: return "circle.hexagongrid"
        case .dynamics: return "square.grid.2x2"
        }
    }

    @MainActor
    var connected: Bool {
        switch self {
        case .salesforce: return Salesforce.shared.connected
        case .hubspot: return HubSpot.shared.connected
        case .dynamics: return Dynamics.shared.connected
        }
    }

    @MainActor
    var host: String {
        switch self {
        case .salesforce: return Salesforce.shared.host
        case .hubspot: return HubSpot.shared.host
        case .dynamics: return Dynamics.shared.host
        }
    }

    @MainActor
    var progress: String {
        switch self {
        case .salesforce: return Salesforce.shared.progress
        case .hubspot: return HubSpot.shared.progress
        case .dynamics: return Dynamics.shared.progress
        }
    }

    private var lastSyncKey: String { "crmLastSync." + rawValue }

    /// The day of the last successful send, or "" if never.
    var lastSync: String {
        get { UserDefaults.standard.string(forKey: lastSyncKey) ?? "" }
        nonmutating set { UserDefaults.standard.set(newValue, forKey: lastSyncKey) }
    }

    /// Sends one person (contact, company, follow-up task and notes).
    @MainActor
    func send(_ p: Person, profileURL: String) async throws {
        switch self {
        case .salesforce: try await Salesforce.shared.push(p, profileURL: profileURL)
        case .hubspot: try await HubSpot.shared.push(p, profileURL: profileURL)
        case .dynamics: try await Dynamics.shared.push(p, profileURL: profileURL)
        }
        lastSync = Day.today
    }

    /// Sends everyone starred, with a follow-up, with notes, or already linked.
    @MainActor
    func syncAll(model: AppModel) async -> (ok: Int, failed: Int, error: String?) {
        let r: (ok: Int, failed: Int, error: String?)
        switch self {
        case .salesforce: r = await Salesforce.shared.syncAll(model: model)
        case .hubspot: r = await HubSpot.shared.syncAll(model: model)
        case .dynamics: r = await Dynamics.shared.syncAll(model: model)
        }
        if r.ok > 0 { lastSync = Day.today }
        return r
    }

    @MainActor
    func contactURL(_ k: String) -> URL? {
        switch self {
        case .salesforce: return Salesforce.shared.contactURL(k)
        case .hubspot: return HubSpot.shared.contactURL(k)
        case .dynamics: return Dynamics.shared.contactURL(k)
        }
    }

    @MainActor
    func disconnect() {
        switch self {
        case .salesforce: Salesforce.shared.disconnect()
        case .hubspot: HubSpot.shared.disconnect()
        case .dynamics: Dynamics.shared.disconnect()
        }
    }

    @MainActor
    static var connectedOnes: [CRM] { allCases.filter { $0.connected } }

    /// Loads each CRM's saved links from iCloud.
    @MainActor
    static func attach(_ store: CloudStore) async {
        await Salesforce.shared.attach(store)
        await HubSpot.shared.attach(store)
        await Dynamics.shared.attach(store)
    }

    /// After an edit, keep already-linked people current in every connected CRM.
    @MainActor
    static func afterEdit(_ k: String, model: AppModel) {
        Salesforce.shared.afterEdit(k, model: model)
        HubSpot.shared.afterEdit(k, model: model)
        Dynamics.shared.afterEdit(k, model: model)
    }
}

// MARK: - Settings

/// Settings, CRM: each CRM with connect, last sync, Sync now and disconnect.
struct CRMSettingsSection: View {
    @Environment(AppModel.self) private var model
    @AppStorage("sfAuto") private var autoSync = true
    @AppStorage("sfAccounts") private var createAccounts = true
    @State private var working: CRM?

    var body: some View {
        Section {
            ForEach(CRM.allCases) { crm in
                if crm.connected { connectedRows(crm) } else {
                    NavigationLink { connectView(crm) } label: { Label("Connect \(crm.title)", systemImage: crm.icon) }
                }
            }
            if !CRM.connectedOnes.isEmpty {
                Toggle("Keep linked people up to date", isOn: $autoSync)
                Toggle("Create missing accounts", isOn: $createAccounts)
            }
        } header: {
            Text("CRM")
        } footer: {
            Text("Sends contacts, follow-up tasks and notes from Northfix to your CRM. Northfix talks to your CRM directly from this device. There’s no Northfix server in between, and your sign-in is kept in the keychain.")
        }
    }

    @ViewBuilder private func connectedRows(_ crm: CRM) -> some View {
        LabeledContent(crm.title, value: crm.host)
        LabeledContent("Last sync", value: crm.lastSync.isEmpty ? "Not yet" : Day.nice(crm.lastSync))
        Button(working == crm ? "Sending… \(crm.progress)" : "Sync now") {
            working = crm
            Task {
                let r = await crm.syncAll(model: model)
                working = nil
                model.show(r.failed == 0 ? "Sent \(r.ok) \(r.ok == 1 ? "person" : "people") to \(crm.title)" : "Sent \(r.ok), \(r.failed) failed. \(r.error ?? "")")
            }
        }
        .disabled(working != nil)
        Button("Disconnect \(crm.title)", role: .destructive) { crm.disconnect() }
    }

    @ViewBuilder private func connectView(_ crm: CRM) -> some View {
        switch crm {
        case .salesforce: SalesforceConnectView()
        case .hubspot: HubSpotConnectView()
        case .dynamics: DynamicsConnectView()
        }
    }
}

struct SalesforceConnectView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.webAuthenticationSession) private var webAuth
    @AppStorage("sfDomain") private var sfDomain = "login.salesforce.com"
    @AppStorage("sfClientId") private var sfClientId = ""
    @State private var guide = false
    @State private var working = false

    var body: some View {
        Form {
            Section {
                Picker("Salesforce login", selection: Binding(get: { ["login.salesforce.com", "test.salesforce.com"].contains(sfDomain) ? sfDomain : "custom" },
                                                               set: { sfDomain = $0 == "custom" ? "" : $0 })) {
                    Text("Production").tag("login.salesforce.com")
                    Text("Sandbox").tag("test.salesforce.com")
                    Text("My Domain").tag("custom")
                }
                if !["login.salesforce.com", "test.salesforce.com"].contains(sfDomain) {
                    TextField("yourcompany.my.salesforce.com", text: $sfDomain)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                }
                TextField("Connected app consumer key", text: $sfClientId)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                Button(working ? "Connecting…" : "Connect Salesforce") { if model.allow(.salesforce) { connect() } }
                    .disabled(sfClientId.trimmingCharacters(in: .whitespaces).isEmpty || working)
                Button("How to set this up") { guide = true }
            } footer: {
                Text("You sign in with Salesforce directly. Northfix never sees your password.")
            }
        }
        .navigationTitle("Salesforce")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $guide) { SalesforceGuide().environment(AppModel.shared) }
    }

    private func connect() {
        let id = sfClientId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = Salesforce.shared.authorizeURL(domain: sfDomain, clientId: id) else { return }
        working = true
        Task {
            defer { working = false }
            do {
                let cb = try await webAuth.authenticate(using: url, callbackURLScheme: "bearings")
                try await Salesforce.shared.finishSignIn(callback: cb, domain: sfDomain, clientId: id)
                Haptic.success()
                model.show("Connected to Salesforce")
                dismiss()
            } catch {
                if (error as NSError).code != 1 { model.show("Salesforce: \(error.localizedDescription)") }
            }
        }
    }
}

struct HubSpotConnectView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var token = ""
    @State private var working = false

    var body: some View {
        Form {
            Section {
                SecureField("Access token", text: $token)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                Button(working ? "Checking…" : "Connect HubSpot") { if model.allow(.salesforce) { connect() } }
                    .disabled(token.trimmingCharacters(in: .whitespaces).isEmpty || working)
            } footer: {
                Text("Paste a HubSpot service key or private app token. The token stays in the keychain on this device.")
            }
            Section("In HubSpot") {
                GuideStep(n: 1, title: "Make a key", detail: "Go to Development, then Keys, then Service keys, and choose Create service key. (Or Settings, Integrations, Private apps.) You need to be a super admin or have developer tools access.")
                GuideStep(n: 2, title: "Pick scopes", detail: "crm.objects.contacts.read and .write, crm.objects.companies.read and .write. Add crm.schemas.contacts.read so Northfix can save LinkedIn URLs.")
                GuideStep(n: 3, title: "Copy the token", detail: "Create it, copy the token, and paste it above.")
            }
            Section {
                Text("Northfix creates or updates a contact (and its company), a follow-up task when you set one, and a note with your notes. It matches existing contacts by email, LinkedIn URL, or name and company.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("HubSpot")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func connect() {
        working = true
        Task {
            defer { working = false }
            do {
                try await HubSpot.shared.connect(token: token)
                token = ""
                Haptic.success()
                model.show("Connected to HubSpot")
                dismiss()
            } catch { model.show("HubSpot: \(error.localizedDescription)") }
        }
    }
}

struct DynamicsConnectView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.webAuthenticationSession) private var webAuth
    @AppStorage("dynOrg") private var org = ""
    @AppStorage("dynTenant") private var tenant = ""
    @AppStorage("dynClientId") private var clientId = ""
    @State private var working = false

    var body: some View {
        Form {
            Section {
                TextField("contoso.crm.dynamics.com", text: $org)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                TextField("Application (client) ID", text: $clientId)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Tenant ID or domain (optional)", text: $tenant)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                Button(working ? "Connecting…" : "Connect Dynamics 365") { if model.allow(.salesforce) { connect() } }
                    .disabled(Dynamics.cleanOrg(org).isEmpty || clientId.trimmingCharacters(in: .whitespaces).isEmpty || working)
            } footer: {
                Text("You sign in with Microsoft directly. Northfix never sees your password. Leave the tenant blank unless your admin registered the app for your organization only.")
            }
            Section("In Microsoft Entra (an admin, once)") {
                GuideStep(n: 1, title: "Register an app", detail: "Entra admin center, then App registrations, then New registration. Name it Northfix.")
                GuideStep(n: 2, title: "Add the redirect", detail: "Platform: Mobile and desktop applications. Redirect URI: bearings://oauth/dynamics")
                GuideStep(n: 3, title: "Add the permission", detail: "API permissions, Add a permission, Dynamics CRM, Delegated, user_impersonation. Grant consent if your org requires it.")
                GuideStep(n: 4, title: "Copy the ID", detail: "Copy the Application (client) ID into Northfix. No client secret is needed.")
            }
            Section {
                Text("Northfix creates or updates a contact (and its account), a follow-up task when you set one, and a note with your notes. It matches existing contacts by email, or by name and account.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Dynamics 365")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func connect() {
        let id = clientId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = Dynamics.shared.authorizeURL(org: org, tenant: tenant, clientId: id) else { return }
        working = true
        Task {
            defer { working = false }
            do {
                let cb = try await webAuth.authenticate(using: url, callbackURLScheme: "bearings")
                try await Dynamics.shared.finishSignIn(callback: cb, org: org, tenant: tenant, clientId: id)
                Haptic.success()
                model.show("Connected to Dynamics 365")
                dismiss()
            } catch {
                if (error as NSError).code != 1 { model.show("Dynamics 365: \(error.localizedDescription)") }
            }
        }
    }
}

/// A numbered setup step.
struct GuideStep: View {
    let n: Int
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(n)").font(.subheadline.weight(.bold)).frame(width: 24, height: 24).background(Theme.accent.opacity(0.2), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(title).fontWeight(.semibold)
                Text(detail).font(.subheadline).foregroundStyle(.secondary).textSelection(.enabled)
            }
        }
    }
}
