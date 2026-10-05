import SwiftUI
import Contacts
import UserNotifications

/// Reads the address book for the starter network: names, company, title, email.
enum StarterContacts {
    static func read() async -> [[String: String]] {
        await Task.detached(priority: .userInitiated) { () -> [[String: String]] in
            let keys: [CNKeyDescriptor] = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactOrganizationNameKey,
                                           CNContactJobTitleKey, CNContactEmailAddressesKey, CNContactTypeKey].map { $0 as CNKeyDescriptor }
            var all: [[String: String]] = []
            var work: [[String: String]] = []
            try? CNContactStore().enumerateContacts(with: CNContactFetchRequest(keysToFetch: keys)) { c, _ in
                if c.contactType == .organization { return }
                let f = c.givenName.trimmingCharacters(in: .whitespaces)
                let l = c.familyName.trimmingCharacters(in: .whitespaces)
                guard !f.isEmpty || !l.isEmpty else { return }
                let row = ["f": f, "l": l, "c": c.organizationName, "p": c.jobTitle, "e": (c.emailAddresses.first?.value as String?) ?? ""]
                all.append(row)
                if !c.organizationName.isEmpty || !c.jobTitle.isEmpty { work.append(row) }
            }
            // people with a company or title make a truer picture of a professional network
            return work.count >= 15 ? work : all
        }.value
    }
}

/// Reminds you when the LinkedIn export is probably in your inbox.
enum ExportReminder {
    static var requestedAt: Date? {
        let t = UserDefaults.standard.double(forKey: "exportRequested")
        return t > 0 ? Date(timeIntervalSince1970: t) : nil
    }

    static func requested() async {
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "exportRequested")
        await Notifications.shared.requestPermission()
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ["export-1", "export-2"])
        let first = UNMutableNotificationContent()
        first.title = "Your LinkedIn data may be ready"
        first.body = "Look for an email from LinkedIn, download the file, then share it to Bearings. The quick version usually arrives in about 10 minutes."
        first.sound = .default
        first.userInfo = ["refresh": true]
        try? await center.add(UNNotificationRequest(identifier: "export-1", content: first, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 20 * 60, repeats: false)))
        let second = UNMutableNotificationContent()
        second.title = "Your full LinkedIn archive should be in"
        second.body = "The full archive, with messages, takes up to a day. Open the email from LinkedIn and share the zip to Bearings to see who you talk to."
        second.sound = .default
        second.userInfo = ["refresh": true]
        var at = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        at = Calendar.current.date(bySettingHour: 9, minute: 30, second: 0, of: at) ?? at
        let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: at)
        try? await center.add(UNNotificationRequest(identifier: "export-2", content: second, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: "exportRequested")
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["export-1", "export-2"])
    }
}

enum UseCase: String, CaseIterable, Identifiable {
    case sales, recruiting, career, founder, government
    var id: String { rawValue }
    var title: String {
        switch self {
        case .sales: return "Sales and business development"
        case .recruiting: return "Recruiting and hiring"
        case .career: return "My career and job search"
        case .founder: return "Founder, investor or advisor"
        case .government: return "Government, defense or military"
        }
    }
    var detail: String {
        switch self {
        case .sales: return "Who you know at every account, and who’s gone quiet"
        case .recruiting: return "Senior people, job changes and who’s open to talk"
        case .career: return "Who can introduce you, and who just moved companies"
        case .founder: return "Warm paths to customers, investors and hires"
        case .government: return "Ranks, agencies and commands, sorted out for you"
        }
    }
    var icon: String {
        switch self {
        case .sales: return "chart.line.uptrend.xyaxis"
        case .recruiting: return "person.badge.plus"
        case .career: return "arrow.up.forward.circle"
        case .founder: return "lightbulb"
        case .government: return "star.circle"
        }
    }
    static var saved: UseCase? { UserDefaults.standard.string(forKey: "useCase").flatMap(UseCase.init(rawValue:)) }
}

struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var step = UserDefaults.standard.integer(forKey: "onboardStep")
    @State private var useCase: UseCase? = UseCase.saved
    @State private var compass = CompassData.empty
    @State private var working = false
    @State private var error = ""
    @State private var built: StarterResult?

    private var hasRealNetwork: Bool { !model.info.isSample && !model.info.isStarter }

    var body: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()
            Group {
                switch step {
                case 0: welcome
                case 1: purpose
                case 2: start
                default: linkedIn
                }
            }
            .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .move(edge: .leading).combined(with: .opacity)))
        }
        .animation(.smooth(duration: 0.4), value: step)
        .task(id: model.info.rev + model.info.mode) { compass = await model.compass() }
    }

    // MARK: steps

    private var welcome: some View {
        VStack(spacing: 22) {
            Spacer(minLength: 10)
            CompassView(data: compass, focus: .constant(nil), initials: "") { _ in }
                .allowsHitTesting(false)
                .frame(maxWidth: 340)
                .padding(.horizontal, 30)
            VStack(spacing: 10) {
                Text("Your network, mapped.")
                    .font(Theme.geist(.largeTitle, .bold))
                    .multilineTextAlignment(.center)
                Text("See everyone you know at a glance: who’s close, who’s waiting on you, and who just changed jobs.")
                    .font(Theme.geist(.body))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 28)
            Spacer()
            Label("No account. Nothing leaves your devices.", systemImage: "lock.fill")
                .font(Theme.geist(.footnote, .medium))
                .foregroundStyle(.secondary)
            primary("Get started") { step = hasRealNetwork ? 3 : 1 }
        }
        .padding(.bottom, 24)
    }

    private var purpose: some View {
        VStack(alignment: .leading, spacing: 18) {
            header("What do you use your network for?", "Bearings sets itself up to match. You can change this later.")
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(UseCase.allCases) { u in
                        Button {
                            Haptic.tap()
                            useCase = u
                        } label: {
                            HStack(spacing: 14) {
                                Image(systemName: u.icon)
                                    .font(.system(size: 18, weight: .semibold))
                                    .foregroundStyle(useCase == u ? .white : Theme.accent)
                                    .frame(width: 42, height: 42)
                                    .background(useCase == u ? Theme.accent : Theme.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(u.title).font(Theme.geist(.body, .semibold)).foregroundStyle(.primary)
                                    Text(u.detail).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                                }
                                .multilineTextAlignment(.leading)
                                Spacer(minLength: 0)
                                Image(systemName: useCase == u ? "checkmark.circle.fill" : "circle")
                                    .font(.title3)
                                    .foregroundStyle(useCase == u ? Theme.accent : Color(.tertiaryLabel))
                            }
                            .padding(14)
                            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(useCase == u ? Theme.accent : .clear, lineWidth: 1.5))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 24)
            }
            primary("Continue", disabled: useCase == nil) {
                applyUseCase()
                step = 2
            }
        }
        .padding(.bottom, 24)
    }

    private var start: some View {
        VStack(alignment: .leading, spacing: 18) {
            header("Start in seconds", "See your network right now from your iPhone contacts, then add LinkedIn for the full picture.")
            VStack(spacing: 12) {
                option(icon: "person.crop.circle.badge.checkmark", tint: Theme.accent, title: "Start with my contacts",
                       detail: "Maps the people already in your phone. Nothing is uploaded.", busy: working) {
                    buildFromContacts()
                }
                option(icon: "doc.zipper", tint: Theme.info, title: "I already have my LinkedIn file",
                       detail: "Open the zip from LinkedIn and see your whole network.") {
                    finish { model.showImport = true }
                }
            }
            .padding(.horizontal, 24)
            if !error.isEmpty {
                Text(error).font(Theme.geist(.subheadline)).foregroundStyle(Theme.bad).padding(.horizontal, 24)
            }
            Spacer()
            Button("Just look around a sample network") { finish {} }
                .font(Theme.geist(.subheadline, .semibold))
                .frame(maxWidth: .infinity)
                .padding(.bottom, 8)
        }
        .padding(.bottom, 24)
    }

    private var linkedIn: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let b = built {
                VStack(alignment: .leading, spacing: 6) {
                    Label("\(b.count.formatted()) people mapped", systemImage: "checkmark.circle.fill")
                        .font(Theme.geist(.headline))
                        .foregroundStyle(Theme.good)
                    Text("from your contacts, at \(b.companies.formatted()) companies.")
                        .font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 24)
                .padding(.top, 30)
                .transition(.opacity)
            }
            header(hasRealNetwork ? "Keep it fresh" : "Now get the full picture",
                   hasRealNetwork ? "Every few weeks, grab a new LinkedIn export. Bearings spots job changes and new connections." : "LinkedIn adds everyone you’re connected to, who you message, and who changed jobs. Ask for your data now; it arrives by email.",
                   top: built == nil)
            VStack(alignment: .leading, spacing: 14) {
                numbered(1, "Ask LinkedIn for your data", "Pick the larger archive so Bearings can see who you talk to.")
                numbered(2, "Wait for the email", "Usually about 10 minutes, up to a day for the full archive. We’ll remind you.")
                numbered(3, "Share the file to Bearings", "Open it from Mail or Files and choose Bearings.")
            }
            .padding(.horizontal, 24)
            Spacer()
            primary("Ask LinkedIn for my data") {
                if let u = URL(string: "https://www.linkedin.com/mypreferences/d/download-my-data") { openURL(u) }
                Task { await ExportReminder.requested() }
                finish {}
            }
            Button("I’ll do it later") { finish {} }
                .font(Theme.geist(.subheadline, .semibold))
                .frame(maxWidth: .infinity)
        }
        .padding(.bottom, 24)
    }

    // MARK: pieces

    private func header(_ title: String, _ text: String, top: Bool = true) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(Theme.geist(.largeTitle, .bold)).fixedSize(horizontal: false, vertical: true)
            Text(text).font(Theme.geist(.body)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 24)
        .padding(.top, top ? 40 : 4)
    }

    private func primary(_ title: String, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            Text(title).font(Theme.geist(.headline)).frame(maxWidth: .infinity).padding(.vertical, 6)
        }
        .prominentGlassButton()
        .controlSize(.large)
        .disabled(disabled)
        .padding(.horizontal, 24)
    }

    private func option(icon: String, tint: Color, title: String, detail: String, busy: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 50, height: 50)
                    .background(tint.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(Theme.geist(.headline)).foregroundStyle(.primary)
                    Text(detail).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                if busy { ProgressView() } else { Image(systemName: "chevron.right").foregroundStyle(.tertiary) }
            }
            .padding(16)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(working)
    }

    private func numbered(_ n: Int, _ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(n)")
                .font(Theme.mono(.subheadline, .semibold))
                .frame(width: 28, height: 28)
                .background(Theme.accent.opacity(0.18), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Theme.geist(.body, .semibold))
                Text(text).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
            }
        }
    }

    // MARK: actions

    private func applyUseCase() {
        guard let u = useCase else { return }
        UserDefaults.standard.set(u.rawValue, forKey: "useCase")
        Task {
            if u == .government { await model.setLens(true) }
            switch u {
            case .sales, .founder: if model.info.hasRel { model.sort = .warm }
            case .recruiting, .government: model.sort = .level
            case .career: model.sort = .new
            }
        }
    }

    private func buildFromContacts() {
        error = ""
        working = true
        Task {
            do {
                let r = try await model.startFromContacts()
                withAnimation { built = r }
                step = 3
            } catch {
                self.error = error.localizedDescription
            }
            working = false
        }
    }

    private func finish(then: @escaping () -> Void) {
        UserDefaults.standard.set(true, forKey: "onboarded")
        let showReveal = built != nil
        dismiss()
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 450_000_000)
            if showReveal { model.showPayoff = true }
            then()
        }
    }
}
