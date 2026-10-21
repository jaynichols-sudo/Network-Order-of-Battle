import SwiftUI

struct CatchUpView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var mode = "week"
    @State private var queue: [String] = []
    @State private var index = 0
    @State private var drag: CGSize = .zero
    @State private var loading = true
    @State private var armed = 0
    @State private var done = 0
    @State private var starred = 0

    var body: some View {
        VStack(spacing: 14) {
            Picker("Deck", selection: $mode) {
                Text("Since last refresh").tag("week")
                Text("Everyone").tag("all")
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)

            if loading {
                Spacer(); ProgressView(); Spacer()
            } else if index >= queue.count {
                if done > 0 {
                    CatchUpFinished(done: done, starred: starred) { restartSession() }
                } else {
                    Spacer()
                    ContentUnavailableView(mode == "week" ? "All caught up" : "You’ve seen everyone",
                                           systemImage: "checkmark.circle",
                                           description: Text(mode == "week" ? "New connections and job changes from your next refresh will show up here." : "Every person in your network has been through here."))
                    Spacer()
                }
            } else {
                progress
                ZStack {
                    ForEach(Array(visible.enumerated()).reversed(), id: \.element) { i, k in
                        card(k, depth: i)
                    }
                }
                .padding(.horizontal, 20)
                .frame(maxHeight: .infinity)
                buttons
            }
        }
        .padding(.vertical)
        .background(Theme.bg)
        .navigationTitle("Catch Up")
        .task(id: "\(mode)-\(model.info.lastImport)-\(model.info.mode)") { await build() }
    }

    private var visible: [String] { Array(queue[index..<min(queue.count, index + 3)]) }

    private var progress: some View {
        VStack(spacing: 6) {
            HStack {
                Text("\(index + 1) of \(queue.count)").font(Theme.mono(.footnote, .semibold))
                Spacer()
                if starred > 0 {
                    Label("\(starred)", systemImage: "star.fill").font(Theme.mono(.footnote, .semibold)).foregroundStyle(Theme.amber)
                }
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color(.tertiarySystemFill))
                    Capsule().fill(Theme.accent).frame(width: g.size.width * CGFloat(index) / CGFloat(max(1, queue.count)))
                }
            }
            .frame(height: 5)
            .animation(.smooth, value: index)
        }
        .padding(.horizontal, 24)
    }

    private var buttons: some View {
        HStack(spacing: 26) {
            Button { decide(star: false) } label: {
                Image(systemName: "xmark").font(.system(size: 22, weight: .bold)).foregroundStyle(.secondary)
                    .frame(width: 64, height: 64).glassCircle()
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Skip")
            Button { if index < queue.count { model.open(.person(queue[index])) } } label: {
                Image(systemName: "person.text.rectangle").font(.system(size: 18, weight: .semibold)).foregroundStyle(.secondary)
                    .frame(width: 48, height: 48).glassCircle()
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open profile")
            Button { decide(star: true) } label: {
                Image(systemName: "star.fill").font(.system(size: 24, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 72, height: 72).glassCircle(tint: Theme.amber)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Star")
        }
        .padding(.bottom, 6)
    }

    @ViewBuilder private func card(_ k: String, depth i: Int) -> some View {
        if let p = model.person(k) {
            let top = i == 0
            let lift = top ? min(1, abs(drag.width) / 120) : 0
            DeckCard(person: p, lens: model.info.lens)
                .offset(top ? drag : CGSize(width: 0, height: CGFloat(i) * 14))
                .scaleEffect(top ? 1 + lift * 0.02 : 1 - CGFloat(i) * 0.05)
                .rotationEffect(.degrees(top ? Double(drag.width / 16) : 0), anchor: .bottom)
                .overlay(alignment: .topLeading) { if top { stamp("Star", Theme.amber, drag.width / 90).padding(24) } }
                .overlay(alignment: .topTrailing) { if top { stamp("Skip", .secondary, -drag.width / 90).padding(24) } }
                .gesture(swipe, isEnabled: top)
                .onTapGesture { if top { model.open(.person(k)) } }
                .accessibilityElement(children: .combine)
                .accessibilityHint(top ? "Swipe right to star, left to skip" : "")
                .accessibilityAction(named: "Star") { if top { decide(star: true) } }
                .accessibilityAction(named: "Skip") { if top { decide(star: false) } }
                .accessibilityHidden(!top)
                .allowsHitTesting(top)
                .zIndex(Double(10 - i))
                .transition(.identity)
        }
    }

    private var swipe: some Gesture {
        DragGesture()
            .onChanged { v in
                drag = v.translation
                let side = v.translation.width > 110 ? 1 : v.translation.width < -110 ? -1 : 0
                if side != armed {
                    armed = side
                    if side != 0 { Haptic.tap() }
                }
            }
            .onEnded { v in
                armed = 0
                // a quick flick counts even if the card didn't travel far
                let fling = v.predictedEndTranslation.width
                if v.translation.width > 110 || fling > 320 { decide(star: true, from: v.predictedEndTranslation) }
                else if v.translation.width < -110 || fling < -320 { decide(star: false, from: v.predictedEndTranslation) }
                else { withAnimation(.spring(response: 0.38, dampingFraction: 0.62)) { drag = .zero } }
            }
    }

    private func build() async {
        loading = true
        queue = await model.deck(mode)
        index = 0
        done = 0
        starred = 0
        drag = .zero
        loading = false
    }

    private func restartSession() {
        done = 0
        starred = 0
    }

    private func stamp(_ text: String, _ color: Color, _ amount: CGFloat) -> some View {
        Text(text.uppercased())
            .font(.custom("Geist-Bold", fixedSize: 22))
            .foregroundStyle(color)
            .padding(.horizontal, 12).padding(.vertical, 4)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(color, lineWidth: 3))
            .rotationEffect(.degrees(text == "Star" ? -10 : 10))
            .opacity(Double(max(0, min(1, amount))))
            .scaleEffect(0.8 + 0.2 * max(0, min(1, amount)))
    }

    private func decide(star: Bool, from fling: CGSize? = nil) {
        guard index < queue.count else { return }
        let k = queue[index]
        let dx: CGFloat = star ? 700 : -700
        let dy = fling.map { max(-300, min(300, $0.height)) } ?? 60
        withAnimation(reduceMotion ? .linear(duration: 0.15) : .easeOut(duration: 0.28)) { drag = CGSize(width: dx, height: dy) }
        done += 1
        if star && !(model.person(k)?.starred ?? false) { starred += 1 }
        Task {
            try? await Task.sleep(nanoseconds: 260_000_000)
            var t = Transaction()
            t.disablesAnimations = true
            withTransaction(t) {
                index += 1
                drag = .zero
            }
            await model.reviewed(k, mode: mode, star: star)
        }
    }
}

/// The end of a deck: a moment of credit, then somewhere useful to go.
struct CatchUpFinished: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let done: Int
    let starred: Int
    let onClose: () -> Void
    @State private var burst = false

    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            ZStack {
                ForEach(0..<14, id: \.self) { i in
                    let a = Double(i) / 14 * 2 * Double.pi
                    Circle()
                        .fill([Theme.amber, Theme.info, Theme.good, Theme.violet][i % 4])
                        .frame(width: 8, height: 8)
                        .offset(x: burst ? CGFloat(cos(a)) * 92 : 0, y: burst ? CGFloat(sin(a)) * 92 : 0)
                        .opacity(burst ? 0 : 1)
                }
                Circle().fill(Theme.amber.opacity(0.16)).frame(width: 120, height: 120).scaleEffect(burst ? 1 : 0.6)
                Image(systemName: "checkmark")
                    .font(.system(size: 46, weight: .bold))
                    .foregroundStyle(Theme.amber)
                    .symbolEffect(.bounce, value: burst)
            }
            .frame(height: 200)
            Text("\(done) \(done == 1 ? "person" : "people") caught up")
                .font(Theme.geist(.title, .bold))
                .multilineTextAlignment(.center)
            Text(starred > 0 ? "You starred \(starred). They’re easy to find in People, and on your watch." : "Nothing starred this round. Your network’s up to date.")
                .font(Theme.geist(.body))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            VStack(spacing: 10) {
                if starred > 0 {
                    Button {
                        model.perform(CardAction(kind: "filter", sig: ["star"]))
                        onClose()
                    } label: { Text("See who you starred").frame(maxWidth: .infinity) }
                    .prominentGlassButton()
                    .controlSize(.large)
                }
                Button {
                    model.paths[.home] = []
                    onClose()
                } label: { Text("Back to Today").frame(maxWidth: .infinity) }
                .glassButton()
                .controlSize(.large)
            }
            .font(Theme.geist(.body, .semibold))
            .padding(.horizontal, 40)
            .padding(.top, 8)
            Spacer()
        }
        .onAppear {
            Haptic.success()
            withAnimation(reduceMotion ? .none : .easeOut(duration: 0.9)) { burst = true }
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
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                Avatar(person: person, size: 96)
                Spacer()
                Circle().fill(Color(hex: person.color)).frame(width: 10, height: 10).padding(6)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(person.fullName).font(Theme.serif(.largeTitle, .semibold)).minimumScaleFactor(0.6).lineLimit(2)
                if !person.p.isEmpty { Text(person.p).font(Theme.geist(.title3)).foregroundStyle(.secondary).lineLimit(3) }
                if !person.c.isEmpty { Text(person.c).font(Theme.geist(.title3, .semibold)) }
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
            .font(Theme.geist(.body))
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .padding(24)
        .frame(maxWidth: 460, maxHeight: 600, alignment: .topLeading)
        .card(32)
        .overlay(RoundedRectangle(cornerRadius: 32, style: .continuous).strokeBorder(Color.primary.opacity(0.06), lineWidth: 1))
        .shadow(color: .black.opacity(0.12), radius: 24, y: 10)
    }
}
