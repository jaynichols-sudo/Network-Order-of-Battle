import SwiftUI
import UniformTypeIdentifiers

struct TeamPackInfo: Decodable, Hashable {
    var owner: String
    var made: String
    var count: Int
    /// The member ID for shares from the team server; empty for packs added by hand.
    var id: String
}

struct TeamAdded: Decodable { var owner: String; var count: Int }

extension AppModel {
    func teamPacks() async -> [TeamPackInfo] { (try? await engine.call("teamList", as: [TeamPackInfo].self)) ?? [] }

    /// Writes your pack to a file to share: who you know and how well, nothing else.
    func makeTeamPack() async -> URL? {
        let me = (prefs.string(forKey: "name") ?? "").trimmingCharacters(in: .whitespaces)
        guard let text = try? await engine.call("teamPack", [me.isEmpty ? "A teammate" : me], as: String.self) else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("Northfix team pack\(me.isEmpty ? "" : " - " + me).json")
        do { try text.write(to: url, atomically: true, encoding: .utf8); return url } catch { return nil }
    }

    func addTeamPack(_ url: URL) async {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        guard allow(.team) else { return }
        do {
            let text = try String(contentsOf: url, encoding: .utf8)
            let r = try await engine.call("addTeamPack", [text], as: TeamAdded.self)
            await saveFile("team", "team.json")
            Haptic.success()
            show("Added \(r.owner)’s \(r.count.formatted()) people to Ways in")
        } catch { show("Couldn’t add that pack: \(error.localizedDescription)") }
    }

    func removeTeamPack(_ owner: String) async {
        _ = try? await engine.call("removeTeamPack", [owner], as: [TeamPackInfo].self)
        await saveFile("team", "team.json")
    }

    /// A .json opened from Files or Mail: a team pack or a notes backup.
    func openJSON(_ url: URL) async {
        let access = url.startAccessingSecurityScopedResource()
        let head = (try? String(contentsOf: url, encoding: .utf8))?.prefix(200) ?? ""
        if access { url.stopAccessingSecurityScopedResource() }
        if head.contains("bearings-team-pack") { await addTeamPack(url) } else { await restore(url) }
    }
}

/// Northfix Team: start or join a team, invite people, sync, and see the team's combined reach.
/// Sharing a pack file by hand still works, for people who'd rather not use the team server.
struct TeamView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var team = TeamSync.shared
    @State private var overview: TeamOverview?
    @State private var starting = false
    @State private var joining: String?
    @State private var inviting = false
    @State private var confirmDelete = false
    @State private var confirmLeave = false
    @State private var error: String?
    @State private var width: CGFloat = 0

    var body: some View {
        ScrollView {
            AdaptiveColumns(width: width, ratio: 0.5, spacing: 14) {
                if team.joined { header; membersCard; if team.isAdmin { invitesCard } }
                else { pitch }
                if model.info.isSample && !team.joined {
                    Button { Task { await team.startDemo(model: model) } } label: {
                        Label("Preview with a sample team", systemImage: "sparkles").frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(PillButtonStyle(kind: .soft))
                }
                if team.demo {
                    Text("This is a made-up team on the sample network, so you can see how Team works.")
                        .font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
                    Button("End the preview") { Task { await team.endDemo(model: model) } }.buttonStyle(PillButtonStyle(kind: .soft))
                }
            } secondary: {
                if let o = overview, !o.members.isEmpty { TeamOverviewCards(overview: o) }
                if team.joined && !team.demo { leaveCard }
                DisclosureGroup {
                    PackShareSection()
                } label: {
                    Text("Share a file instead").font(Theme.geist(.subheadline, .semibold))
                }
                .padding(16).card()
            }
            .padding(16)
            .frame(maxWidth: Wide.pageWidth(width))
            .frame(maxWidth: .infinity)
        }
        .readWidth($width)
        .background(Theme.bg)
        .navigationTitle("Team")
        .refreshable { await team.sync(model: model) }
        .task(id: team.rev) { overview = try? await model.engine.call("teamOverview", as: TeamOverview.self) }
        .task {
            if team.joined && !team.demo { try? await team.refresh() }
            if let j = team.pendingJoin { joining = "bearings://team/join?code=\(j.code)&k=\(j.key)"; team.pendingJoin = nil }
        }
        .onChange(of: team.pendingJoin?.code) { _, _ in
            if let j = team.pendingJoin { joining = "bearings://team/join?code=\(j.code)&k=\(j.key)"; team.pendingJoin = nil }
        }
        .sheet(isPresented: $starting) { StartTeamSheet().environment(model) }
        .sheet(item: Binding(get: { joining.map { JoinLink(text: $0) } }, set: { joining = $0?.text })) { j in JoinTeamSheet(link: j.text).environment(model) }
        .sheet(isPresented: $inviting) { InviteSheet() }
        .alert("Something went wrong", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("OK") {} } message: { Text(error ?? "") }
    }

    private var pitch: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Pool who your team knows, privately.").font(Theme.serif(.title2, .semibold))
            Text("See who on your team knows someone at an account, the team’s federal map, everyone’s pursuits and the team watchlist.")
                .font(Theme.geist(.subheadline))
            Label("Everything is encrypted on your phone before it leaves. The Northfix server can’t read it. Teammates see names, titles, employers and how well you know each person. Never notes, messages, emails or tags.", systemImage: "lock.fill")
                .font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
            if team.configured {
                Button { starting = true } label: { Label("Start a team", systemImage: "person.3.fill").frame(maxWidth: .infinity, minHeight: 46) }
                    .buttonStyle(PillButtonStyle(kind: .primary))
                Button { joining = "" } label: { Label("Join with a link", systemImage: "link").frame(maxWidth: .infinity, minHeight: 46) }
                    .buttonStyle(PillButtonStyle(kind: .soft))
                Text("Free for 30 days for up to 5 people. Everyone on a team gets Northfix Pro.")
                    .font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
            }
        }
        .padding(16).card()
    }

    private var planLine: String {
        if team.readOnly { return "Read-only: the free trial has ended" }
        if team.plan == "active" { return "Team plan" }
        if team.plan == "past_due" { return "Team plan: payment is overdue" }
        if let end = team.trialEnds { let d = max(0, Calendar.current.dateComponents([.day], from: Date(), to: end).day ?? 0); return "Free trial, \(d) \(d == 1 ? "day" : "days") left" }
        return "Free trial"
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(team.teamName.isEmpty ? "Your team" : team.teamName).font(Theme.serif(.title, .semibold))
            Text("\(planLine). \(team.members.count) of \(team.seats) seats used.").font(Theme.geist(.subheadline)).foregroundStyle(Theme.text2)
            HStack {
                if team.busy { ProgressView().controlSize(.small); Text("Syncing").font(Theme.geist(.footnote)).foregroundStyle(Theme.text2) }
                else if let d = team.lastSync { Text("Synced \(d.formatted(.relative(presentation: .named)))").font(Theme.geist(.footnote)).foregroundStyle(Theme.text2) }
                Spacer()
                if !team.demo {
                    Button { Task { await team.sync(model: model) } } label: { Label("Sync now", systemImage: "arrow.triangle.2.circlepath") }
                        .buttonStyle(PillButtonStyle(kind: .soft)).disabled(team.busy)
                }
            }
            if let e = team.lastError { Text(e).font(Theme.geist(.footnote)).foregroundStyle(Theme.needs) }
            if team.isOwner && !team.demo { BillingRow() }
        }
        .padding(16).card()
    }

    private var membersCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Members").font(Theme.geist(.footnote, .semibold)).foregroundStyle(Theme.text2)
                Spacer()
                if team.isAdmin && !team.readOnly {
                    Button { inviting = true } label: { Label("Invite", systemImage: "person.badge.plus") }.buttonStyle(PillButtonStyle(kind: .primary))
                }
            }
            .padding(.vertical, 10)
            let counts = Dictionary((overview?.members ?? []).map { ($0.id, $0.count) }, uniquingKeysWith: { a, _ in a })
            ForEach(team.members) { m in
                Theme.line.frame(height: 1)
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(m.isMe && m.name != "You" ? "\(m.name) (you)" : m.name).font(Theme.geist(.subheadline, .semibold))
                        Text([m.title, m.role == "member" ? "" : m.role.capitalized].filter { !$0.isEmpty }.joined(separator: ", "))
                            .font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
                        Text(memberLine(m, count: counts[m.id])).font(Theme.geist(.caption)).foregroundStyle(Theme.text3)
                    }
                    Spacer()
                    if !m.isMe && canManage(m) && !team.demo { memberMenu(m) }
                }
                .padding(.vertical, 10)
                .accessibilityElement(children: .contain)
            }
        }
        .padding(.horizontal, 16).padding(.bottom, 6).card()
    }

    private func memberLine(_ m: TeamMember, count: Int?) -> String {
        var parts: [String] = []
        if let c = count { parts.append("\(c.formatted()) \(c == 1 ? "person" : "people")") }
        if let s = m.shared { parts.append("shared \(s.formatted(.relative(presentation: .named)))") } else { parts.append("hasn’t shared yet") }
        return parts.joined(separator: ", ")
    }

    private func canManage(_ m: TeamMember) -> Bool {
        if team.isOwner { return m.role != "owner" }
        return team.role == "admin" && m.role == "member"
    }

    private func memberMenu(_ m: TeamMember) -> some View {
        Menu {
            if team.isOwner {
                if m.role == "member" { Button("Make admin") { act { try await team.setRole(m.id, "admin") } } }
                if m.role == "admin" { Button("Make member") { act { try await team.setRole(m.id, "member") } } }
                Button("Make owner") { act { try await team.setRole(m.id, "owner") } }
            }
            Button("Remove from team", role: .destructive) { act { try await team.remove(m.id) } }
        } label: {
            Image(systemName: "ellipsis.circle").font(.title3).foregroundStyle(Theme.text2).frame(width: 44, height: 44)
        }
        .accessibilityLabel("Manage \(m.name)")
    }

    private var invitesCard: some View {
        Group {
            if !team.invites.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Open invites").font(Theme.geist(.footnote, .semibold)).foregroundStyle(Theme.text2).padding(.vertical, 10)
                    ForEach(team.invites) { i in
                        Theme.line.frame(height: 1)
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(i.code).font(Theme.mono(.subheadline, .semibold))
                                Text("\(i.role == "admin" ? "Admin" : "Member"), \(i.usesLeft) \(i.usesLeft == 1 ? "use" : "uses") left, until \(i.expires.formatted(date: .abbreviated, time: .omitted))")
                                    .font(Theme.geist(.caption)).foregroundStyle(Theme.text2)
                            }
                            Spacer()
                            if !team.demo {
                                ShareLink(item: team.link(for: i.code)) { Image(systemName: "square.and.arrow.up") }
                                    .buttonStyle(PillButtonStyle(kind: .soft)).accessibilityLabel("Share invite link")
                                Button("Revoke") { act { try await team.revoke(i.code) } }.buttonStyle(PillButtonStyle(kind: .soft))
                            }
                        }
                        .padding(.vertical, 8)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 6).card()
            }
        }
    }

    private var leaveCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            if team.isOwner {
                Button("Delete team", role: .destructive) { confirmDelete = true }
                Text("To leave instead, make someone else the owner first.").font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
            } else {
                Button("Leave team", role: .destructive) { confirmLeave = true }
            }
        }
        .padding(16).card()
        .confirmationDialog("Leave \(team.teamName)?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave team", role: .destructive) { act { try await team.leave(model: model) } }
        } message: { Text("Your share is deleted from the team server, and teammates’ people disappear from your Ways in.") }
        .confirmationDialog("Delete \(team.teamName)?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete team for everyone", role: .destructive) { act { try await team.deleteTeam(model: model) } }
        } message: { Text("Everything about this team is deleted from the server, for every member. This can’t be undone.") }
    }

    private func act(_ f: @escaping () async throws -> Void) {
        Task { do { try await f(); Haptic.success() } catch { self.error = error.localizedDescription } }
    }
}

private struct JoinLink: Identifiable { var text: String; var id: String { text } }

/// The team's combined reach, every pursuit, and the team watchlist.
struct TeamOverviewCards: View {
    let overview: TeamOverview

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 0) {
                stat("\(overview.people.formatted())", "people across the team")
                stat("\(overview.agencies.team)/\(overview.agencies.total)", "agencies with the team")
                stat("\(overview.agencies.mine)", "on your own")
            }
            .padding(.vertical, 14).card()
            Text("With the team, \(overview.coverage.team.covered) agencies are covered and \(overview.coverage.team.thin) are thin. On your own: \(overview.coverage.mine.covered) covered, \(overview.coverage.mine.thin) thin.")
                .font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)

            if !overview.pursuits.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Team pursuits").font(Theme.geist(.footnote, .semibold)).foregroundStyle(Theme.text2).padding(.vertical, 10)
                    ForEach(overview.pursuits, id: \.key) { p in
                        Theme.line.frame(height: 1)
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name).font(Theme.geist(.subheadline, .semibold))
                                Text([p.agency, p.stage, p.due.map { "due \(Day.nice($0))" } ?? "", p.value ?? ""].filter { !$0.isEmpty }.joined(separator: ", "))
                                    .font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
                                Text(p.mine ? "Yours" : p.owner).font(Theme.geist(.caption)).foregroundStyle(Theme.text3)
                            }
                            Spacer()
                            Text("\(p.filled)/\(p.roles)").font(Theme.mono(.footnote, .semibold)).padding(.horizontal, 8).padding(.vertical, 4)
                                .background(Theme.soft, in: Capsule())
                                .accessibilityLabel("\(p.filled) of \(p.roles) decision-maker seats filled")
                        }
                        .padding(.vertical, 10)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 6).card()
            }

            if !overview.targets.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Team watchlist").font(Theme.geist(.footnote, .semibold)).foregroundStyle(Theme.text2).padding(.vertical, 10)
                    ForEach(overview.targets.prefix(20)) { t in
                        Theme.line.frame(height: 1)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(t.name).font(Theme.geist(.subheadline, .semibold))
                            Text("Watched by \(ListFormatter.localizedString(byJoining: t.owners)). \(t.people == 0 ? "No one known yet" : "\(t.people) \(t.people == 1 ? "person" : "people") known").")
                                .font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
                            if !t.best.isEmpty {
                                Text("Best paths: " + t.best.map { "\($0.name) (\($0.owner == "You" ? "you know" : "\($0.owner) knows") \(bandWord($0.b)))" }.joined(separator: ", "))
                                    .font(Theme.geist(.caption)).foregroundStyle(Theme.text3)
                            }
                        }
                        .padding(.vertical, 10)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 6).card()
            }
        }
    }

    private func bandWord(_ b: String) -> String {
        switch b { case "strong": return "well"; case "warm": return "fairly well"; case "light": return "a little"; default: return "by name" }
    }

    private func stat(_ big: String, _ label: String) -> some View {
        VStack(spacing: 4) {
            Text(big).font(Theme.serif(.title2, .semibold))
            Text(label).font(Theme.geist(.caption)).foregroundStyle(Theme.text2).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

struct StartTeamSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var teamName = ""
    @State private var name = UserDefaults.standard.string(forKey: "name") ?? ""
    @State private var title = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section { TextField("Team name, like Federal BD", text: $teamName) } footer: { Text("Only your team sees this. It’s encrypted too.") }
                Section("You") {
                    TextField("Your name", text: $name).textContentType(.name)
                    TextField("Your title", text: $title).textContentType(.jobTitle)
                }
                if let error { Section { Text(error).foregroundStyle(Theme.needs) } }
            }
            .navigationTitle("Start a team")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Start") {
                            busy = true
                            Task {
                                do {
                                    try await TeamSync.shared.create(teamName: teamName.trimmed, myName: name.trimmed, myTitle: title.trimmed)
                                    await TeamSync.shared.sync(model: model)
                                    Haptic.success(); dismiss()
                                } catch { self.error = error.localizedDescription }
                                busy = false
                            }
                        }
                        .disabled(teamName.trimmed.isEmpty || name.trimmed.isEmpty)
                    }
                }
            }
        }
    }
}

struct JoinTeamSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State var link: String
    @State private var name = UserDefaults.standard.string(forKey: "name") ?? ""
    @State private var title = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section { TextField("Paste the invite link", text: $link, axis: .vertical).textInputAutocapitalization(.never).autocorrectionDisabled() }
                    footer: { Text(TeamSync.parse(link) == nil && !link.isEmpty ? "That doesn’t look like a Northfix invite." : "The link holds the team’s key. Anyone with it can join until it expires.") }
                Section("You") {
                    TextField("Your name", text: $name).textContentType(.name)
                    TextField("Your title", text: $title).textContentType(.jobTitle)
                }
                if let error { Section { Text(error).foregroundStyle(Theme.needs) } }
            }
            .navigationTitle("Join a team")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Join") {
                            guard let j = TeamSync.parse(link) else { return }
                            busy = true
                            Task {
                                do {
                                    try await TeamSync.shared.join(code: j.code, key: j.key, myName: name.trimmed, myTitle: title.trimmed)
                                    await TeamSync.shared.sync(model: model)
                                    Haptic.success(); dismiss()
                                } catch { self.error = error.localizedDescription }
                                busy = false
                            }
                        }
                        .disabled(TeamSync.parse(link) == nil || name.trimmed.isEmpty)
                    }
                }
            }
        }
    }
}

struct InviteSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var role = "member"
    @State private var uses = 10
    @State private var days = 14
    @State private var link: String?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if let link {
                    Section {
                        Text(link).font(Theme.mono(.footnote)).textSelection(.enabled)
                        ShareLink(item: link) { Label("Share the link", systemImage: "square.and.arrow.up") }
                        Button { UIPasteboard.general.string = link; Haptic.success() } label: { Label("Copy", systemImage: "doc.on.doc") }
                    } footer: { Text("The part after the # is the team key. Send it only to people you trust: anyone with the link can join until it expires.") }
                } else {
                    if TeamSync.shared.isOwner {
                        Picker("Joins as", selection: $role) { Text("Member").tag("member"); Text("Admin").tag("admin") }
                    }
                    Stepper("Up to \(uses) \(uses == 1 ? "person" : "people")", value: $uses, in: 1...50)
                    Stepper("Expires in \(days) \(days == 1 ? "day" : "days")", value: $days, in: 1...30)
                    if let error { Text(error).foregroundStyle(Theme.needs) }
                }
            }
            .navigationTitle("Invite people")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(link == nil ? "Cancel" : "Done") { dismiss() } }
                if link == nil {
                    ToolbarItem(placement: .confirmationAction) {
                        if busy { ProgressView() } else {
                            Button("Make link") {
                                busy = true
                                Task {
                                    do { link = try await TeamSync.shared.invite(role: role, uses: uses, days: days) } catch { self.error = error.localizedDescription }
                                    busy = false
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Owners: the plan, and buying seats on the web.
struct BillingRow: View {
    @Environment(\.openURL) private var openURL
    @State private var info: TeamSync.Billing?
    @State private var seats = 5
    @State private var error: String?

    var body: some View {
        Group {
            if let b = info, b.canCheckout {
                VStack(alignment: .leading, spacing: 8) {
                    Theme.line.frame(height: 1)
                    if b.plan == "active" {
                        Button("Manage seats and billing") { open { try await TeamSync.shared.portalURL() } }.buttonStyle(PillButtonStyle(kind: .soft))
                    } else {
                        Stepper("\(seats) seats", value: $seats, in: max(1, b.used)...200)
                        Button("Subscribe on the web") { open { try await TeamSync.shared.checkoutURL(seats: seats) } }.buttonStyle(PillButtonStyle(kind: .primary))
                        Text("Billed yearly per seat. Everyone on the team gets Northfix Pro.").font(Theme.geist(.caption)).foregroundStyle(Theme.text2)
                    }
                    if let error { Text(error).font(Theme.geist(.footnote)).foregroundStyle(Theme.needs) }
                }
            }
        }
        .task { info = try? await TeamSync.shared.billing(); seats = max(info?.used ?? 5, 5) }
    }

    private func open(_ f: @escaping () async throws -> URL?) {
        Task { do { if let u = try await f() { openURL(u) } } catch { self.error = error.localizedDescription } }
    }
}

/// Sharing a pack file by hand: no server at all.
struct PackShareSection: View {
    @Environment(AppModel.self) private var model
    @State private var packs: [TeamPackInfo] = []
    @State private var myPack: URL?
    @State private var picking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("No server at all: each person shares a pack file, and everyone adds the others’ packs.")
                .font(Theme.geist(.footnote)).foregroundStyle(Theme.text2).padding(.top, 8)
            HStack(spacing: 8) {
                if let myPack {
                    ShareLink(item: myPack) { Label("Share my pack", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity) }
                        .buttonStyle(PillButtonStyle(kind: .soft))
                }
                Button { if model.allow(.team) { picking = true } } label: { Label("Add a pack", systemImage: "plus").frame(maxWidth: .infinity) }
                    .buttonStyle(PillButtonStyle(kind: .soft))
            }
            ForEach(packs.filter { $0.id.isEmpty }, id: \.owner) { p in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.owner).font(Theme.geist(.subheadline, .semibold))
                        Text("\(p.count.formatted()) \(p.count == 1 ? "person" : "people"), shared \(Day.nice(p.made))").font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
                    }
                    Spacer()
                    Button("Remove") { Task { await model.removeTeamPack(p.owner); packs = await model.teamPacks() } }
                        .buttonStyle(PillButtonStyle(kind: .soft)).accessibilityLabel("Remove \(p.owner)’s pack")
                }
            }
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.json]) { r in
            if case .success(let url) = r { Task { await model.addTeamPack(url); packs = await model.teamPacks() } }
        }
        .task(id: model.info.edits) {
            packs = await model.teamPacks()
            if myPack == nil { myPack = await model.makeTeamPack() }
        }
    }
}

extension String { var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) } }
