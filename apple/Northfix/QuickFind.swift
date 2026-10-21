import SwiftUI

/// ⌘K: type a name, company or title and jump straight to them.
struct QuickFind: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var q = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Find someone", text: $q)
                    .font(Theme.geist(.title3))
                    .textFieldStyle(.plain)
                    .focused($focused)
                    .autocorrectionDisabled()
                    .onSubmit { if let p = results.first { open(p.k) } }
                if !q.isEmpty { Button { q = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }.buttonStyle(.plain).accessibilityLabel("Clear") }
            }
            .padding(16)
            Divider()
            List(results) { p in
                Button { open(p.k) } label: { PersonRow(person: p, lens: model.info.lens) }
                    .buttonStyle(.plain)
            }
            .listStyle(.plain)
            .overlay {
                if q.count < 2 {
                    Text("Names, companies or titles. Press Return to open the top match.")
                        .font(Theme.geist(.subheadline)).foregroundStyle(.secondary).multilineTextAlignment(.center).padding()
                }
            }
        }
        .frame(minWidth: 420, minHeight: 420)
        .onAppear { focused = true }
    }

    private var results: [Person] {
        let t = q.lowercased().trimmingCharacters(in: .whitespaces)
        guard t.count >= 2 else { return [] }
        return Array(model.people.filter { $0.x == nil && ($0.fullName.lowercased().contains(t) || $0.c.lowercased().contains(t) || $0.p.lowercased().contains(t)) }
            .sorted { ($0.fullName.lowercased().hasPrefix(t) ? 0 : 1, -$0.score) < ($1.fullName.lowercased().hasPrefix(t) ? 0 : 1, -$1.score) }
            .prefix(30))
    }

    private func open(_ k: String) {
        dismiss()
        model.tab = .people
        model.paths[.people] = [.person(k)]
    }
}
