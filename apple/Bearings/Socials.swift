import SwiftUI
import UniformTypeIdentifiers

// Across your socials: Facebook, Instagram, Snapchat and TikTok data downloads, read on the
// phone and merged with LinkedIn into one picture of who you're connected to, and where.

enum SocialPlatform: String, CaseIterable, Identifiable {
    case facebook, instagram, snapchat, tiktok
    var id: String { rawValue }
    var name: String { ["facebook": "Facebook", "instagram": "Instagram", "snapchat": "Snapchat", "tiktok": "TikTok"][rawValue]! }
    var color: Color {
        switch self {
        case .facebook: return Color(hex: "#1877F2")
        case .instagram: return Color(hex: "#E1306C")
        case .snapchat: return Color(hex: "#F7C600")
        case .tiktok: return Color(hex: "#25F4EE")
        }
    }
    var letter: String { ["facebook": "f", "instagram": "ig", "snapchat": "sc", "tiktok": "tt"][rawValue]! }
    /// Where to ask for the download, and what to tick.
    var how: String {
        switch self {
        case .facebook: return "Facebook: Settings & privacy, Settings, Download your information. Choose “Specific types of information”, tick Friends and followers, format JSON."
        case .instagram: return "Instagram: Accounts Center, Your information and permissions, Download your information. Tick Followers and following, format JSON."
        case .snapchat: return "Snapchat: Settings, My Data. Tick Friends, and choose JSON."
        case .tiktok: return "TikTok: Settings and privacy, Account, Download your data. Choose JSON, and request the file."
        }
    }
    var url: URL? {
        switch self {
        case .facebook: return URL(string: "https://accountscenter.facebook.com/info_and_permissions/dyi")
        case .instagram: return URL(string: "https://accountscenter.instagram.com/info_and_permissions/dyi")
        case .snapchat: return URL(string: "https://accounts.snapchat.com/accounts/downloadmydata")
        case .tiktok: return URL(string: "https://www.tiktok.com/setting/download-your-data")
        }
    }
    func profileURL(_ handle: String) -> URL? {
        let h = handle.trimmingCharacters(in: CharacterSet(charactersIn: "@ "))
        switch self {
        case .facebook: return URL(string: "https://www.facebook.com/search/people/?q=" + (h.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? h))
        case .instagram: return URL(string: "https://www.instagram.com/\(h)")
        case .snapchat: return URL(string: "https://www.snapchat.com/add/\(h)")
        case .tiktok: return URL(string: "https://www.tiktok.com/@\(h)")
        }
    }
}

struct SocialsData: Decodable {
    struct Platform: Decodable, Hashable, Identifiable { var id: String; var name: String; var n: Int }
    struct Entry: Decodable, Hashable, Identifiable {
        var id: String
        var k: String
        var name: String
        var on: [String]
        var h: [String: String]
        var linkedin: Bool
        var mutual: Int
        var ties: Int
        var since: String
    }
    var platforms: [Platform]
    var linkedin: Int
    var unique: Int
    var both: Int
    var socialOnly: Int
    var handlesOnly: Int
    var strongest: [Entry]
    var people: [Entry]
    static let empty = SocialsData(platforms: [], linkedin: 0, unique: 0, both: 0, socialOnly: 0, handlesOnly: 0, strongest: [], people: [])
}

extension AppModel {
    func socials() async -> SocialsData { (try? await engine.call("socials", as: SocialsData.self)) ?? .empty }

    /// Reads a data download (zip or JSON) and merges it in. Only the friends and followers files are read.
    func importSocial(_ p: SocialPlatform, url: URL) async {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
            var files: [String: String] = [:]
            let data = try Data(contentsOf: url, options: .mappedIfSafe)
            if url.pathExtension.lowercased() == "zip" || data.prefix(2) == Data([0x50, 0x4B]) {
                let zip = try ZipReader(data: data)
                let wanted = zip.entries.filter { e in
                    let n = e.name.lowercased()
                    guard n.hasSuffix(".json"), e.size < 60_000_000 else { return false }
                    switch p {
                    case .facebook: return n.contains("friend")
                    case .instagram: return n.contains("follow")
                    case .snapchat: return n.contains("friend")
                    case .tiktok: return n.contains("user_data") || n.contains("follow") || n.contains("fans")
                    }
                }
                for e in wanted.prefix(40) { files[e.name] = String(decoding: try zip.extract(e), as: UTF8.self) }
            } else {
                files[url.lastPathComponent] = String(decoding: data, as: UTF8.self)
            }
            guard !files.isEmpty else { show("No \(p.name) friends or followers in that file. Request the download in JSON format."); return }
            struct Result: Decodable { var entries: Int; var matched: Int; var added: Int }
            let r = try await engine.call("importSocial", [p.rawValue, files], as: Result.self)
            await saveFile("social", "social.json")
            socialRev += 1
            await refreshAll()
            Signature.done()
            show("\(p.name): \(r.entries.formatted()) connections, \(r.matched.formatted()) already in your network")
        } catch {
            show("Couldn’t read that \(p.name) file: \(error.localizedDescription)")
        }
    }

    func clearSocial(_ p: SocialPlatform) async {
        _ = try? await engine.call("clearSocial", [p.rawValue], as: Bool.self)
        await saveFile("social", "social.json")
        socialRev += 1
        await refreshAll()
    }
}

/// The whole picture across LinkedIn and your socials.
struct SocialsView: View {
    @Environment(AppModel.self) private var model
    @State private var d = SocialsData.empty
    @State private var importing: SocialPlatform?
    @State private var filter: String = "all"
    @State private var showing: SocialsData.Entry?

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    Text("EVERYONE YOU’RE CONNECTED TO").font(Theme.eyebrow).tracking(1.1).foregroundStyle(Theme.text2)
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(d.unique.formatted()).font(Theme.serif(.largeTitle, .semibold))
                        Text("people across \(1 + d.platforms.filter { $0.n > 0 }.count) networks").font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                    }
                    bars
                    if d.both > 0 {
                        Text("\(d.both.formatted()) of your LinkedIn connections you also know socially. \(d.socialOnly.formatted()) people you know only off LinkedIn.")
                            .font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 6)
            }
            Section {
                ForEach(SocialPlatform.allCases) { p in platformRow(p) }
            } header: { Text("Your downloads") } footer: {
                Text("Each app lets you download your own data. Bearings reads only the friends and followers lists, on this iPhone, and never signs in to any of them. Facebook and Snapchat include names; Instagram and TikTok only usernames, which Bearings matches by handle.")
            }
            if !d.strongest.isEmpty {
                Section {
                    ForEach(d.strongest.prefix(15)) { e in entryRow(e) }
                } header: { Text("Connected everywhere") } footer: { Text("Three or more places. Usually your real relationships.") }
            }
            if !d.people.isEmpty {
                Section {
                    Picker("Show", selection: $filter) {
                        Text("All").tag("all")
                        Text("Not on LinkedIn").tag("off")
                        ForEach(SocialPlatform.allCases) { Text($0.name).tag($0.rawValue) }
                    }
                    .pickerStyle(.menu)
                    ForEach(filtered.prefix(300)) { e in entryRow(e) }
                } header: { Text("Everyone") }
            }
        }
        .navigationTitle("Across your socials")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(model.socialRev)-\(model.info.rev)") { d = await model.socials() }
        .fileImporter(isPresented: Binding(get: { importing != nil }, set: { if !$0 { importing = nil } }), allowedContentTypes: [.zip, .json]) { r in
            if case .success(let url) = r, let p = importing { Task { await model.importSocial(p, url: url); d = await model.socials() } }
        }
        .sheet(item: $showing) { e in SocialPersonSheet(e: e).environment(AppModel.shared) }
    }

    private var filtered: [SocialsData.Entry] {
        switch filter {
        case "all": return d.people
        case "off": return d.people.filter { !$0.linkedin }
        default: return d.people.filter { $0.on.contains(filter) }
        }
    }

    /// LinkedIn plus each platform as proportional bars, so the shape reads at a glance.
    private var bars: some View {
        let rows: [(String, Int, Color)] = [("LinkedIn", d.linkedin, Theme.info)] + d.platforms.compactMap { p in
            SocialPlatform(rawValue: p.id).map { (p.name, p.n, $0.color) }
        }
        let top = max(1, rows.map(\.1).max() ?? 1)
        return VStack(spacing: 6) {
            ForEach(rows, id: \.0) { r in
                HStack(spacing: 8) {
                    Text(r.0).font(Theme.geist(.caption, .semibold)).frame(width: 70, alignment: .leading)
                    GeometryReader { g in
                        Capsule().fill(r.2.opacity(r.1 == 0 ? 0.15 : 0.85)).frame(width: max(4, g.size.width * CGFloat(r.1) / CGFloat(top)))
                    }
                    .frame(height: 8)
                    Text(r.1 == 0 ? "–" : r.1.formatted()).font(Theme.mono(.caption)).foregroundStyle(.secondary).frame(width: 48, alignment: .trailing)
                }
            }
        }
    }

    private func platformRow(_ p: SocialPlatform) -> some View {
        let n = d.platforms.first { $0.id == p.rawValue }?.n ?? 0
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                badge(p, size: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text(p.name).font(Theme.geist(.subheadline, .semibold))
                    Text(n > 0 ? "\(n.formatted()) connections" : "Not added yet").font(Theme.geist(.caption)).foregroundStyle(.secondary)
                }
                Spacer()
                Button(n > 0 ? "Update" : "Add file") { importing = p }.buttonStyle(PillButtonStyle(kind: n > 0 ? .soft : .primary))
            }
            if n == 0 {
                Text(p.how).font(Theme.geist(.caption)).foregroundStyle(.secondary)
                if let u = p.url { Link("Request your \(p.name) download", destination: u).font(Theme.geist(.caption, .semibold)) }
            }
        }
        .padding(.vertical, 4)
        .swipeActions { if n > 0 { Button("Remove", role: .destructive) { Task { await model.clearSocial(p); d = await model.socials() } } } }
    }

    private func entryRow(_ e: SocialsData.Entry) -> some View {
        Button {
            if e.linkedin { model.open(.person(e.k)) } else { showing = e }
        } label: {
            HStack(spacing: 10) {
                if let p = model.person(e.k) { Avatar(person: p, size: 34) }
                else {
                    Text(String(e.name.replacingOccurrences(of: "@", with: "").prefix(1)).uppercased())
                        .font(Theme.geist(.subheadline, .bold)).foregroundStyle(.white)
                        .frame(width: 34, height: 34).background(Circle().fill(Theme.text3))
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(e.name).font(Theme.geist(.subheadline, .semibold)).foregroundStyle(.primary).lineLimit(1)
                    HStack(spacing: 4) {
                        if e.linkedin { Text("in").font(.system(size: 10, weight: .bold)).foregroundStyle(.white).frame(width: 18, height: 18).background(Theme.info, in: RoundedRectangle(cornerRadius: 4)) }
                        ForEach(e.on, id: \.self) { s in if let p = SocialPlatform(rawValue: s) { badge(p, size: 18) } }
                    }
                }
                Spacer()
                if e.ties >= 3 { Text("\(e.ties) places").font(Theme.geist(.caption, .semibold)).foregroundStyle(Theme.good) }
            }
        }
        .buttonStyle(.plain)
    }

    func badge(_ p: SocialPlatform, size: CGFloat) -> some View {
        Text(p.letter).font(.system(size: size * 0.45, weight: .heavy, design: .rounded)).foregroundStyle(p == .snapchat ? .black : .white)
            .frame(width: size, height: size).background(p.color, in: RoundedRectangle(cornerRadius: size * 0.25, style: .continuous))
            .accessibilityLabel(p.name)
    }
}

/// Someone you know only off LinkedIn: where you're connected, and ways to reach them.
struct SocialPersonSheet: View {
    @Environment(\.dismiss) private var dismiss
    let e: SocialsData.Entry
    @State private var saving = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(e.name).font(Theme.serif(.title, .semibold))
                        if !e.since.isEmpty { Text("Connected since \(Day.nice(e.since))").font(Theme.geist(.footnote)).foregroundStyle(.secondary) }
                    }
                }
                Section("Connected on") {
                    ForEach(e.on, id: \.self) { s in
                        if let p = SocialPlatform(rawValue: s) {
                            if let h = e.h[s], let u = p.profileURL(h) {
                                Link(destination: u) { LabeledContent(p.name, value: "@" + h) }
                            } else if let u = p.profileURL(e.name) {
                                Link(destination: u) { LabeledContent(p.name, value: "Find") }
                            }
                        }
                    }
                }
                Section {
                    if let u = URL(string: "https://www.linkedin.com/search/results/people/?keywords=" + (e.name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")), !e.name.hasPrefix("@") {
                        Link(destination: u) { Label("Find them on LinkedIn", systemImage: "magnifyingglass") }
                    }
                    if !e.name.hasPrefix("@") {
                        Button { saving = true } label: { Label("Add to Contacts", systemImage: "person.crop.circle.badge.plus") }
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $saving) { NewContactView(name: e.name).ignoresSafeArea() }
        }
        .presentationDetents([.medium, .large])
    }
}

/// On a profile: where else you're connected with this person.
struct SocialBadgesRow: View {
    let social: PersonSocial

    var body: some View {
        let on = SocialPlatform.allCases.filter { social.on[$0.rawValue] != nil }
        if !on.isEmpty {
            HStack(spacing: 8) {
                Text("Also on").font(Theme.geist(.caption)).foregroundStyle(.secondary)
                ForEach(on) { p in
                    let h = social.h[p.rawValue] ?? ""
                    if let u = p.profileURL(h.isEmpty ? "" : h), !h.isEmpty {
                        Link(destination: u) { chip(p) }
                    } else { chip(p) }
                }
            }
        }
    }

    private func chip(_ p: SocialPlatform) -> some View {
        Text(p.name).font(Theme.geist(.caption, .semibold)).foregroundStyle(p == .snapchat ? .black : .white)
            .padding(.horizontal, 8).padding(.vertical, 3).background(p.color, in: Capsule())
    }
}

struct PersonSocial: Decodable, Hashable {
    struct On: Decodable, Hashable { var since: String?; var mutual: Bool? }
    var on: [String: On]
    var h: [String: String]
}
