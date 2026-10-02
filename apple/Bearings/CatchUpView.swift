import SwiftUI

struct CatchUpView: View {
    @Environment(AppModel.self) private var model
    @State private var mode = "week"
    @State private var queue: [String] = []
    @State private var index = 0
    @State private var drag: CGSize = .zero
    @State private var loading = true

    var body: some View {
        VStack(spacing: 16) {
            Picker("Deck", selection: $mode) {
                Text("Since last refresh").tag("week")
                Text("Everyone").tag("all")
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)

            if loading {
                Spacer(); ProgressView(); Spacer()
            } else if index >= queue.count {
                Spacer()
                ContentUnavailableView(mode == "week" ? "All caught up" : "You’ve seen everyone",
                                       systemImage: "checkmark.circle",
                                       description: Text(mode == "week" ? "New connections and job changes from your next refresh will show up here." : "Every person in your network has been through here."))
                Spacer()
            } else {
                Text("\((queue.count - index).formatted()) to go")
                    .font(Theme.geist(.subheadline, .medium)).foregroundStyle(.secondary)
                ZStack {
                    ForEach(Array(queue[index..<min(queue.count, index + 3)].enumerated()).reversed(), id: \.element) { i, k in
                        if let p = model.person(k) {
                            DeckCard(person: p, lens: model.info.lens)
                                .offset(i == 0 ? drag : CGSize(width: 0, height: CGFloat(i) * 10))
                                .scaleEffect(i == 0 ? 1 : 1 - CGFloat(i) * 0.04)
                                .rotationEffect(.degrees(i == 0 ? Double(drag.width / 18) : 0))
                                .overlay(alignment: .topLeading) { if i == 0 { stamp("Star", Theme.amber, drag.width / 90).padding(20) } }
                                .overlay(alignment: .topTrailing) { if i == 0 { stamp("Skip", .secondary, -drag.width / 90).padding(20) } }
                                .gesture(DragGesture()
                                    .onChanged { drag = $0.translation }
                                    .onEnded { v in
                                        if v.translation.width > 110 { decide(star: true) }
                                        else if v.translation.width < -110 { decide(star: false) }
                                        else { withAnimation(.spring) { drag = .zero } }
                                    }, isEnabled: i == 0)
                                .onTapGesture { if i == 0 { model.open(.person(k)) } }
                                .allowsHitTesting(i == 0)
                        }
                    }
                }
                .padding(.horizontal, 24)
                .frame(maxHeight: 460)
                HStack(spacing: 28) {
                    Button { decide(star: false) } label: {
                        Image(systemName: "xmark").font(.title2.weight(.semibold)).frame(width: 64, height: 64)
                    }
                    .buttonStyle(.bordered).clipShape(Circle())
                    .accessibilityLabel("Skip")
                    Button { decide(star: true) } label: {
                        Image(systemName: "star.fill").font(.title2.weight(.semibold)).frame(width: 64, height: 64)
                    }
                    .buttonStyle(.borderedProminent).clipShape(Circle())
                    .accessibilityLabel("Star")
                }
                Text("Swipe right to star, left to skip. Tap a card for details.")
                    .font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
        }
        .padding(.vertical)
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Catch Up")
        .toolbar { MainToolbar() }
        .task(id: "\(mode)-\(model.info.lastImport)-\(model.info.mode)") { await build() }
    }

    private func build() async {
        loading = true
        queue = await model.deck(mode)
        index = 0
        drag = .zero
        loading = false
    }

    private func stamp(_ text: String, _ color: Color, _ amount: CGFloat) -> some View {
        Text(text.uppercased())
            .font(.title3.weight(.heavy))
            .foregroundStyle(color)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(color, lineWidth: 3))
            .rotationEffect(.degrees(-8))
            .opacity(Double(max(0, min(1, amount))))
    }

    private func decide(star: Bool) {
        guard index < queue.count else { return }
        let k = queue[index]
        withAnimation(.easeIn(duration: 0.22)) { drag = CGSize(width: star ? 600 : -600, height: 40) }
        Task {
            try? await Task.sleep(nanoseconds: 220_000_000)
            index += 1
            drag = .zero
            await model.reviewed(k, mode: mode, star: star)
        }
    }
}

struct DeckCard: View {
    let person: Person
    let lens: Bool

    var body: some View {
        let c = person.cl
        let chips = (lens ? [c.seg, c.agency, c.branch.isEmpty ? "" : (c.grade.isEmpty ? c.branch : "\(c.branch) \(c.grade)"), c.status, c.fn]
                     : [c.ind == "Unclassified" ? "" : c.ind, c.sen, c.fn, c.status == "Veteran / Retired" ? "Veteran" : ""])
            .filter { !$0.isEmpty }
        let unique = chips.enumerated().filter { i, v in chips.firstIndex(of: v) == i }.map(\.element).prefix(5)
        VStack(alignment: .leading, spacing: 14) {
            Avatar(person: person, size: 72)
            VStack(alignment: .leading, spacing: 4) {
                Text(person.fullName).geist(.title2, .bold)
                if !person.p.isEmpty { Text(person.p).font(Theme.geist(.body)).foregroundStyle(.secondary) }
                if !person.c.isEmpty { Text(person.c).font(Theme.geist(.body, .semibold)) }
                if let t = person.rx?.t, !t.isEmpty {
                    Text("Last message \(Day.ago(t)), \(Band.label(person.band).lowercased())").font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                }
            }
            FlowLayout(spacing: 6) {
                ForEach(Array(unique), id: \.self) { t in
                    Text(t).font(Theme.geist(.footnote, .medium))
                        .padding(.horizontal, 9).padding(.vertical, 5)
                        .background(Color(.tertiarySystemFill), in: Capsule())
                }
            }
            Spacer(minLength: 0)
            Group {
                if let was = person.pv?.first {
                    Text("**New job.** Was \(was.p.isEmpty ? "unknown title" : was.p) at \(was.c.isEmpty ? "unknown company" : was.c)")
                        .foregroundStyle(Theme.info)
                } else if person.isNew {
                    Text("**New connection.** Connected \(Day.nice(person.d))").foregroundStyle(Theme.accent)
                } else {
                    Text("Connected \(Day.nice(person.d))").foregroundStyle(.secondary)
                }
            }
            .font(Theme.geist(.subheadline))
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .padding(22)
        .frame(maxWidth: 420, maxHeight: 440, alignment: .topLeading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(0.08), radius: 16, y: 6)
    }
}
