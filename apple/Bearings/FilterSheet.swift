import SwiftUI

/// Wraps chips onto as many lines as they need.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, maxX: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > width { x = 0; y += row + spacing; row = 0 }
            x += s.width + spacing
            maxX = max(maxX, x)
            row = max(row, s.height)
        }
        return CGSize(width: min(width, maxX), height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX && x + s.width > bounds.maxX { x = bounds.minX; y += row + spacing; row = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            row = max(row, s.height)
        }
    }
}

struct FilterSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var facets: Facets?

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            Form {
                if let f = facets {
                    chipSection("Quick picks", f.sig, \.sig)
                    if !f.rel.isEmpty { chipSection("How well you know them", f.rel, \.rel) }
                    chipSection("Industry", f.ind, \.ind)
                    chipSection("Seniority", f.sen, \.sen)
                    chipSection("What they do", f.fn, \.fn)
                    Section("Company") {
                        Picker("Company", selection: $model.filters.company) {
                            Text("All companies").tag("")
                            if !model.filters.company.isEmpty && !f.company.contains(where: { $0.value == model.filters.company }) {
                                Text(model.filters.company).tag(model.filters.company)
                            }
                            ForEach(f.company) { c in Text("\(c.value) (\(c.count))").tag(c.value) }
                        }
                        .pickerStyle(.navigationLink)
                    }
                    if model.info.lens {
                        chipSection("Federal segment", f.seg, \.seg)
                        chipSection("Military branch", f.branch, \.branch)
                        chipSection("Service", f.status, \.status)
                        chipSection("Rank or grade", f.tier, \.tier)
                        Section("Agency or command") {
                            Picker("Agency or command", selection: $model.filters.agency) {
                                Text("All agencies and commands").tag("")
                                ForEach(f.agency) { c in Text("\(c.value) (\(c.count))").tag(c.value) }
                            }
                            .pickerStyle(.navigationLink)
                        }
                    }
                    if !f.cert.isEmpty { chipSection("Certifications", f.cert, \.cert) }
                    Section("Connected") {
                        Picker("Connected", selection: $model.filters.since) {
                            ForEach(model.constants.since, id: \.self) { pair in
                                Text(pair.last ?? "").tag(pair.first ?? "")
                            }
                        }
                        Toggle("Include people no longer in your export", isOn: $model.filters.removed)
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Clear all") { model.filters = Filters() }
                        .disabled(model.filters.isEmpty)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(facets.map { "Show \($0.total.formatted())" } ?? "Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .task(id: model.filters) { facets = await model.facets() }
        }
        .presentationDetents([.large])
    }

    private func chipSection(_ title: String, _ items: [FacetItem], _ path: WritableKeyPath<Filters, Set<String>>) -> some View {
        Section(title) {
            if items.isEmpty {
                Text("None in this view").foregroundStyle(.secondary)
            } else {
                FlowLayout {
                    ForEach(items) { it in
                        let on = model.filters[keyPath: path].contains(it.value)
                        Chip(text: it.label, count: it.count, color: it.color.map { Color(hex: $0) }, on: on) {
                            Haptic.tap()
                            var f = model.filters
                            if on { f[keyPath: path].remove(it.value) } else { f[keyPath: path].insert(it.value) }
                            model.filters = f
                        }
                        .opacity(it.count == 0 && !on ? 0.45 : 1)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }
}
