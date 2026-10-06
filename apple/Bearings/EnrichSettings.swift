import SwiftUI

/// Settings: connect your own ZoomInfo or Seamless.AI account.
struct EnrichSettingsSection: View {
    @Environment(AppModel.self) private var model
    @State private var provider = EnrichProvider.current
    @State private var user = SecretStore.get("enrich.zoominfo.user") ?? ""
    @State private var pass = ""
    @State private var key = ""
    @State private var testing = false
    @State private var status = ""
    @State private var seamlessSignedIn = SeamlessAuth.signedIn
    @State private var showKey = !SeamlessAuth.available

    var body: some View {
        Section {
            Picker("Provider", selection: $provider) {
                ForEach(EnrichProvider.allCases) { Text($0.title).tag($0) }
            }
            .onChange(of: provider) { _, v in
                if v != .off && !model.allow(.enrich) { provider = .off; return }
                EnrichProvider.current = v
                status = ""
            }
            if provider == .zoominfo {
                TextField("API username", text: $user)
                    .textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField(SecretStore.get("enrich.zoominfo.pass") == nil ? "API password" : "API password (saved)", text: $pass)
                    .textContentType(.password)
                Button(testing ? "Checking…" : "Save and test") { saveZoomInfo() }.disabled(testing || user.isEmpty)
            } else if provider == .seamless {
                if SeamlessAuth.available {
                    if seamlessSignedIn {
                        LabeledContent("Seamless.AI", value: "Signed in")
                        Button("Sign out of Seamless.AI", role: .destructive) { SeamlessAuth.signOut(); seamlessSignedIn = false; status = "Signed out." }
                    } else {
                        Button(testing ? "Opening Seamless.AI…" : "Sign in with Seamless.AI") {
                            testing = true
                            status = ""
                            Task {
                                do { try await SeamlessAuth.signIn(); seamlessSignedIn = true; status = "Connected to Seamless.AI." }
                                catch is CancellationError {}
                                catch { status = error.localizedDescription }
                                testing = false
                            }
                        }
                        .disabled(testing)
                    }
                }
                DisclosureGroup("Use an API key instead", isExpanded: $showKey) {
                    SecureField(SecretStore.get("enrich.seamless.key") == nil ? "API key" : "API key (saved)", text: $key)
                    Button("Save key") {
                        SecretStore.set("enrich.seamless.key", key.trimmingCharacters(in: .whitespacesAndNewlines))
                        key = ""
                        status = "Saved. Look someone up from their profile to check it."
                    }
                    .disabled(key.isEmpty)
                }
            }
            if !status.isEmpty { Text(status).font(Theme.geist(.footnote)).foregroundStyle(Theme.text2) }
            if provider != .off && provider.configured {
                Button("Remove saved credentials", role: .destructive) {
                    SecretStore.set("enrich.zoominfo.user", nil); SecretStore.set("enrich.zoominfo.pass", nil); SecretStore.set("enrich.seamless.key", nil)
                    SeamlessAuth.signOut(); seamlessSignedIn = false
                    user = ""; status = "Removed."
                }
            }
        } header: {
            Text("ZoomInfo and Seamless.AI")
        } footer: {
            Text(provider == .seamless
                 ? "Uses your own Seamless.AI account: sign in on Seamless.AI’s page (Bearings never sees your password). Each person looked up uses one of your research credits. Only the names, companies and titles you choose to look up are sent to Seamless.AI. Your sign-in stays in this device’s Keychain."
                 : "Uses your own account to fill in work email, phone, current title and city for the people you choose. Only their names and companies are sent to the provider, and only when you ask. Your login stays in this device’s Keychain and is never synced. ZoomInfo’s API needs API access on your contract.")
        }
    }

    private func saveZoomInfo() {
        let u = user.trimmingCharacters(in: .whitespacesAndNewlines)
        let p = pass.isEmpty ? (SecretStore.get("enrich.zoominfo.pass") ?? "") : pass
        testing = true
        status = ""
        Task {
            do {
                _ = try await ZoomInfo.token(user: u, pass: p, fresh: true)
                SecretStore.set("enrich.zoominfo.user", u)
                SecretStore.set("enrich.zoominfo.pass", p)
                pass = ""
                status = "Connected to ZoomInfo."
            } catch {
                status = error.localizedDescription
            }
            testing = false
        }
    }
}

/// On a person's details page: look them up, and what was found.
struct EnrichPersonSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let person: Person
    @State private var busy = false

    var body: some View {
        let e = model.enriched[person.k]
        let provider = EnrichProvider.current
        if e != nil || provider != .off {
            Section {
                if let e {
                    if let email = e.email { row("Email", email, "envelope") { if let u = URL(string: "mailto:\(email)") { openURL(u) } } }
                    if let phone = e.phone { row("Phone", phone, "phone") { call(phone) } }
                    if let m = e.mobile { row("Mobile", m, "iphone") { call(m) } }
                    if !e.location.isEmpty { LabeledContent("City", value: e.location) }
                    if let t = e.title, let c = e.company, !(t == person.p && c == person.c) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(e.sourceName) shows a different role").font(Theme.geist(.footnote, .semibold)).foregroundStyle(Theme.info)
                            Text("\(t) at \(c)").font(Theme.geist(.subheadline))
                        }
                    }
                }
                if provider != .off {
                    Button(busy ? "Looking up…" : e == nil ? "Look up with \(provider.title)" : "Look up again") {
                        busy = true
                        Task { _ = await model.enrich([person.k]); busy = false }
                    }
                    .disabled(busy)
                }
            } header: {
                Text(e.map { "From \($0.sourceName), \(Day.nice($0.at))" } ?? "Enrich")
            } footer: {
                if e == nil && provider == .seamless { Text("Uses one Seamless.AI research credit.") }
            }
        }
    }

    private func row(_ label: String, _ value: String, _ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            LabeledContent { Text(value).foregroundStyle(Theme.primary) } label: { Label(label, systemImage: icon) }
        }
        .contextMenu { Button("Copy") { UIPasteboard.general.string = value } }
    }

    private func call(_ number: String) {
        let digits = number.filter { $0.isNumber || $0 == "+" }
        if let u = URL(string: "tel:\(digits)") { openURL(u) }
    }
}
