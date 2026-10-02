import SwiftUI
import UniformTypeIdentifiers

struct ImportView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var picking = false
    @State private var reading = false
    @State private var saving = false
    @State private var plan: ImportPlan?
    @State private var fileName = ""
    @State private var error = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(model.info.isSample
                         ? "Three steps. Everything stays private to you."
                         : "New people are added, job changes are noted, and anyone no longer in the file is kept but marked as removed.")
                        .foregroundStyle(.secondary)
                        .listRowBackground(Color.clear)
                }
                Section {
                    step(1, "Ask LinkedIn for your data", "On LinkedIn’s “Get a copy of your data” page, choose the larger archive (it includes messages, so Bearings can tell who you talk to) or just Connections, then tap Request archive.")
                    step(2, "Wait for the email", "LinkedIn usually sends a download link within about 10 minutes. The full archive can take up to a day.")
                    step(3, "Bring the file here", "Download the zip and choose it below, or open it from Mail or Files and share it to Bearings.")
                    Button {
                        if let u = URL(string: "https://www.linkedin.com/mypreferences/d/download-my-data") { openURL(u) }
                    } label: { Label("Open LinkedIn’s data page", systemImage: "arrow.up.right.square") }
                }
                Section {
                    Button {
                        picking = true
                    } label: {
                        HStack {
                            Image(systemName: "doc.zipper").font(.title2)
                            VStack(alignment: .leading) {
                                Text("Choose your LinkedIn file").fontWeight(.semibold)
                                Text("The .zip from LinkedIn, or the Connections.csv inside it").font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 6)
                    }
                    .disabled(reading || saving)
                    if reading { HStack { ProgressView(); Text("Reading \(fileName)…") } }
                    if !error.isEmpty { Text(error).foregroundStyle(Theme.bad) }
                }
                if let plan {
                    Section {
                        Grid(horizontalSpacing: 12, verticalSpacing: 12) {
                            GridRow {
                                stat(plan.stats.total, "Connections", .primary)
                                stat(plan.stats.added, plan.stats.first ? "Loaded" : "New", Theme.bad)
                            }
                            GridRow {
                                stat(plan.stats.changed, "Job changes", Theme.info)
                                stat(plan.stats.removed, "No longer listed", .secondary)
                            }
                        }
                        if let rel = plan.stats.rel {
                            Label("\(rel.formatted()) people with messages, invitations or endorsements", systemImage: "bubble.left.and.bubble.right")
                                .foregroundStyle(Theme.violet)
                        } else {
                            Text("Tip: request the full LinkedIn archive (not just Connections) to see who you talk to and who’s waiting on a reply.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        Button {
                            commit(plan)
                        } label: {
                            HStack {
                                if saving { ProgressView() }
                                Text(saving ? (model.isCloud ? "Saving to iCloud…" : "Saving…") : "Save to my network").fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(saving)
                    } header: { Text("From \(fileName)") }
                }
            }
            .navigationTitle(model.info.isSample ? "Import your connections" : "Refresh your network")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .fileImporter(isPresented: $picking, allowedContentTypes: [.zip, .commaSeparatedText, .plainText]) { result in
                if case .success(let url) = result { read(url) }
            }
            .task {
                if let url = model.pendingImportURL {
                    model.pendingImportURL = nil
                    read(url)
                }
            }
        }
    }

    private func step(_ n: Int, _ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(n)")
                .font(Theme.geist(.subheadline, .bold))
                .frame(width: 26, height: 26)
                .background(Theme.accent.opacity(0.2), in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(Theme.geist(.body, .semibold))
                Text(text).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }

    private func stat(_ v: Int, _ l: String, _ c: Color) -> some View {
        VStack(spacing: 2) {
            Text(v.formatted()).font(Theme.geist(.title2, .bold)).foregroundStyle(c).monospacedDigit()
            Text(l).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func read(_ url: URL) {
        fileName = url.lastPathComponent
        error = ""
        plan = nil
        reading = true
        Task {
            do { plan = try await model.readImport(url) } catch { self.error = error.localizedDescription }
            reading = false
        }
    }

    private func commit(_ p: ImportPlan) {
        saving = true
        Task {
            do {
                try await model.commitImport(p)
                dismiss()
            } catch {
                self.error = "Save failed: \(error.localizedDescription)"
            }
            saving = false
        }
    }
}

struct PayoffView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var p: Payoff?

    var body: some View {
        NavigationStack {
            List {
                if let p {
                    Section {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Here’s your network").geist(.title, .bold)
                            Text("\(p.total.formatted()) people at \(p.companies.formatted()) companies.").foregroundStyle(.secondary)
                            AvatarStack(people: model.persons(p.sample), size: 36)
                        }
                        .listRowBackground(Color.clear)
                    }
                    Section {
                        Grid(horizontalSpacing: 12, verticalSpacing: 12) {
                            GridRow { big(p.execs, "Executives"); big(p.dirs, "Directors") }
                            GridRow { big(p.industries, "Industries"); big(p.companies, "Companies") }
                        }
                        .padding(.vertical, 6)
                    }
                    if !p.top.isEmpty {
                        Section("Where you know the most people") {
                            let maxN = max(1, p.top.first?.count ?? 1)
                            ForEach(p.top) { t in
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack { Text(t.name); Spacer(); Text(t.count.formatted()).foregroundStyle(.secondary).monospacedDigit() }
                                    GeometryReader { g in
                                        Capsule().fill(Color(hex: t.color ?? "#999")).frame(width: g.size.width * CGFloat(t.count) / CGFloat(maxN))
                                    }
                                    .frame(height: 5)
                                }
                            }
                        }
                    }
                    Section {
                        Button {
                            dismiss()
                            model.tab = .explore
                        } label: { Text("See it on a map").frame(maxWidth: .infinity).fontWeight(.semibold) }
                        .buttonStyle(.borderedProminent)
                        .listRowBackground(Color.clear)
                    }
                }
            }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Look around") { dismiss() } } }
            .task { p = await model.payoff() }
        }
    }

    private func big(_ v: Int, _ l: String) -> some View {
        VStack(spacing: 2) {
            Text(v.formatted()).font(Theme.geist(.title, .bold)).monospacedDigit()
            Text(l).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
