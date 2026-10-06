import SwiftUI

/// Pinned searches on Home, each with a live count and a few faces.
struct SavedSearchStrip: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if !model.savedSearches.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("Your lists").font(Theme.geist(.title3, .bold))
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(model.savedSearches) { s in SavedSearchCard(search: s) }
                    }
                    .padding(.horizontal, 1)
                }
                .scrollClipDisabled()
            }
        }
    }
}

struct SavedSearchCard: View {
    @Environment(AppModel.self) private var model
    let search: SavedSearch
    @State private var keys: [String] = []

    var body: some View {
        Button { model.apply(search) } label: {
            VStack(alignment: .leading, spacing: 8) {
                Text(search.name).font(Theme.geist(.subheadline, .semibold)).foregroundStyle(.primary).lineLimit(2).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Text(keys.count.formatted()).font(Theme.mono(.title2, .semibold)).foregroundStyle(.primary).contentTransition(.numericText())
                let ps = model.persons(Array(keys.prefix(4)))
                if !ps.isEmpty { AvatarStack(people: ps, size: 22) } else { Text("No one yet").font(Theme.geist(.caption)).foregroundStyle(.secondary) }
            }
            .padding(12)
            .frame(width: 150, height: 132, alignment: .topLeading)
            .card(18)
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button(role: .destructive) { Task { await model.deleteSearch(search) } } label: { Label("Unpin", systemImage: "pin.slash") }
        }
        .task(id: "\(search.id)-\(model.info.rev)-\(model.info.edits)-\(model.people.count)") {
            keys = await model.run(search)
        }
    }
}

/// "Pin this search" from the People toolbar; the alert lives on the screen so it survives the menu closing.
struct PinSearchAlert: ViewModifier {
    @Environment(AppModel.self) private var model
    @Binding var asking: Bool
    @State private var name = ""

    func body(content: Content) -> some View {
        content
            .onChange(of: asking) { _, on in
                if on { name = model.searchText.isEmpty ? "" : model.searchText.prefix(1).uppercased() + model.searchText.dropFirst() }
            }
            .alert("Name this list", isPresented: $asking) {
                TextField("Navy O-5 and up", text: $name)
                Button("Pin to Today") {
                    let n = name.trimmingCharacters(in: .whitespaces)
                    Task { await model.saveSearch(named: n.isEmpty ? "My list" : n) }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("It stays up to date every time you refresh.")
            }
    }
}
