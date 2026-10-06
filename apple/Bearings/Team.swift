import SwiftUI
import UniformTypeIdentifiers

struct TeamPackInfo: Decodable, Identifiable, Hashable {
    var owner: String
    var made: String
    var count: Int
    var id: String { owner }
}

struct TeamAdded: Decodable { var owner: String; var count: Int }

extension AppModel {
    func teamPacks() async -> [TeamPackInfo] { (try? await engine.call("teamList", as: [TeamPackInfo].self)) ?? [] }

    /// Writes your pack to a file to share: who you know and how well, nothing else.
    func makeTeamPack() async -> URL? {
        let me = (prefs.string(forKey: "name") ?? "").trimmingCharacters(in: .whitespaces)
        guard let text = try? await engine.call("teamPack", [me.isEmpty ? "A teammate" : me], as: String.self) else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("Bearings team pack\(me.isEmpty ? "" : " - " + me).json")
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

/// Team packs: pool who you know with teammates, privately, for warm intro paths.
struct TeamView: View {
    @Environment(AppModel.self) private var model
    @State private var packs: [TeamPackInfo] = []
    @State private var myPack: URL?
    @State private var picking = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Find warm paths through your teammates’ networks too. Each person shares a pack, everyone adds the others’ packs, and Ways in shows who on the team knows someone at an account.")
                        .font(Theme.geist(.subheadline))
                    Label("A pack holds names, titles, companies and how well you know each person. Never notes, messages, emails or tags. Packs stay on each device; there’s no server.", systemImage: "lock.fill")
                        .font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
                }
                .padding(16)
                .card()

                VStack(spacing: 10) {
                    if let myPack {
                        ShareLink(item: myPack) {
                            Label("Share my pack", systemImage: "square.and.arrow.up")
                                .font(Theme.geist(.body, .semibold))
                                .frame(maxWidth: .infinity, minHeight: 48)
                                .foregroundStyle(Theme.onPrimary)
                                .background(Theme.primary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                    } else {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 48)
                    }
                    Button { if model.allow(.team) { picking = true } } label: {
                        Label("Add a teammate’s pack", systemImage: "plus")
                            .font(Theme.geist(.body, .semibold))
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .foregroundStyle(Theme.primary)
                            .background(Theme.soft, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }

                if !packs.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Your team").font(Theme.geist(.footnote, .semibold)).foregroundStyle(Theme.text2).padding(.top, 14).padding(.bottom, 4)
                        ForEach(Array(packs.enumerated()), id: \.element) { i, p in
                            if i > 0 { Theme.line.frame(height: 1) }
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(p.owner).font(Theme.geist(.subheadline, .semibold))
                                    Text("\(p.count.formatted()) \(p.count == 1 ? "person" : "people") · shared \(Day.nice(p.made))").font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
                                }
                                Spacer()
                                Button("Remove") { Task { await model.removeTeamPack(p.owner); packs = await model.teamPacks() } }
                                    .buttonStyle(PillButtonStyle(kind: .soft))
                            }
                            .padding(.vertical, 10)
                        }
                    }
                    .padding(.horizontal, 16).padding(.bottom, 4)
                    .card()
                }
            }
            .padding(16)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg)
        .navigationTitle("Team packs")
        .fileImporter(isPresented: $picking, allowedContentTypes: [.json]) { r in
            if case .success(let url) = r { Task { await model.addTeamPack(url); packs = await model.teamPacks() } }
        }
        .task(id: model.info.edits) {
            packs = await model.teamPacks()
            if myPack == nil { myPack = await model.makeTeamPack() }
        }
    }
}
