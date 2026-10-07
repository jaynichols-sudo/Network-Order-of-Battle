import SwiftUI

// The recommended mix: B's editorial page (white, a serif headline, one clear thing at a
// time), C's daily five (a short list you finish), and A's night sky kept for the
// signature moments (the compass card, Explore, the Lens, first run, dark mode).

/// Today's five as segments: filled for done, the next one pulsing softly.
struct ProgressStrip: View {
    let done: Int
    let total: Int

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<max(total, 1), id: \.self) { i in
                Capsule()
                    .fill(i < done ? Color.primary : Theme.hairline)
                    .frame(height: 4)
            }
        }
        .animation(Motion.spring, value: done)
        .accessibilityElement()
        .accessibilityLabel("\(done) of \(total) done")
    }
}

/// A still field of stars for night-sky cards and screens.
struct StarField: View {
    var count = 70
    var seed: UInt64 = 11

    var body: some View {
        Canvas { ctx, size in
            var rng = SeededRandom(seed: seed)
            for i in 0..<count {
                let x = rng.next() * size.width, y = rng.next() * size.height
                let r = 0.4 + rng.next() * (i % 9 == 0 ? 1.4 : 0.8)
                let o = 0.25 + rng.next() * 0.6
                ctx.fill(Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)), with: .color(.white.opacity(o)))
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

extension View {
    /// A night-sky card: deep purple, a scatter of stars, dark appearance inside.
    func nightCard(_ radius: CGFloat = 22) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return self
            .environment(\.colorScheme, .dark)
            .background {
                ZStack {
                    shape.fill(LinearGradient(colors: [Color(hex: "#1A1430"), Theme.night], startPoint: .topTrailing, endPoint: .bottomLeading))
                    StarField().clipShape(shape)
                }
            }
            .overlay(shape.strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
            .shadow(color: Color(hex: "#140F28").opacity(0.18), radius: 16, y: 10)
    }
}

/// The daily five, one person at a time: why them, what you last talked about, a draft,
/// and one button. "Later" sends them to the back of the line.
struct DailyFiveCard: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduce
    let picks: [WeeklyPick]
    @State private var later: [String] = []
    @State private var memory: MemoryInfo?
    @State private var draft = ""
    @State private var writing: WeeklyPick?
    @State private var celebrate: Date?

    private var open: [WeeklyPick] {
        let o = picks.filter { !model.weeklyDone($0.k) }
        return o.filter { !later.contains($0.k) } + later.compactMap { k in o.first { $0.k == k } }
    }

    var body: some View {
        if !picks.isEmpty {
            let done = picks.count - open.count
            VStack(alignment: .leading, spacing: 8) {
                Group {
                    if let w = open.first, let p = model.person(w.k) {
                        focus(w, p).id(w.k)
                            .transition(reduce ? .opacity : .asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity),
                                                                        removal: .move(edge: .leading).combined(with: .opacity)))
                    } else {
                        finished.transition(.scale(scale: 0.92).combined(with: .opacity))
                    }
                }
                .overlay { Celebration(fire: celebrate).padding(-40) }
                if open.count > 1 {
                    Button { model.showWeekly = true } label: {
                        Text(nextLine).font(Theme.geist(.footnote)).foregroundStyle(Theme.text3)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens this week’s brief")
                }
            }
            .animation(Motion.spring, value: open.map(\.k))
            .onChange(of: done) { old, new in
                if new == picks.count && old < new { celebrate = Date(); Haptic.success() }
            }
            .sheet(item: $writing) { w in MessageSheet(k: w.k).environment(AppModel.shared) }
            .task(id: "\(open.first?.k ?? "")-\(model.info.edits)") {
                memory = nil; draft = ""
                guard let k = open.first?.k else { return }
                memory = await model.memory(k)
                draft = await model.messages(k).first?.text ?? ""
            }
        }
    }

    private var nextLine: String {
        let rest = model.persons(open.dropFirst().map(\.k))
        let names = rest.prefix(2).map(\.fullName)
        let more = rest.count - names.count
        if more > 0 { return "Next: \(names.joined(separator: ", ")) and \(more) more" }
        return "Next: " + ListFormatter.localizedString(byJoining: names)
    }

    private func eyebrow(_ kind: String) -> (String, Color) {
        switch kind {
        case "reply": return ("WAITING ON YOU", Theme.needs)
        case "congrats": return ("NEW ROLE", Theme.good)
        case "new": return ("NEW CONNECTION", Theme.info)
        default: return ("WORTH A NOTE", Theme.violet)
        }
    }

    private func action(_ kind: String) -> String {
        switch kind {
        case "reply": return "Reply"
        case "congrats": return "Congratulate"
        case "new": return "Say thanks"
        default: return "Write"
        }
    }

    private func focus(_ w: WeeklyPick, _ p: Person) -> some View {
        let (tag, color) = eyebrow(w.kind)
        let recall = (memory?.line).flatMap { $0.isEmpty ? nil : $0 } ?? w.why
        return VStack(alignment: .leading, spacing: 12) {
            Button { model.open(.person(w.k)) } label: {
                HStack(spacing: 14) {
                    Avatar(person: p, size: 64).zoomSource(person: w.k)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(tag).font(Theme.eyebrow).tracking(1.1).foregroundStyle(color)
                        Text(p.fullName).font(Theme.serif(.title2, .semibold)).foregroundStyle(.primary).lineLimit(2)
                        if !p.subtitle.isEmpty {
                            Text(p.subtitle).font(Theme.geist(.footnote)).foregroundStyle(Theme.text2).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Text(recall)
                .font(Theme.geist(.subheadline))
                .foregroundStyle(.primary.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 12).padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.card2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

            if !draft.isEmpty {
                Text("“\(draft)”")
                    .font(Theme.serif(.body))
                    .lineLimit(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
            }

            HStack(spacing: 8) {
                Button { Haptic.tap(); writing = w } label: {
                    Text(action(w.kind)).frame(maxWidth: .infinity)
                }
                .buttonStyle(BigPillStyle(filled: true))
                .layoutPriority(2)
                Button {
                    Haptic.tap()
                    withAnimation(Motion.spring) { later.removeAll { $0 == w.k }; later.append(w.k) }
                } label: {
                    Text("Later").frame(maxWidth: .infinity)
                }
                .buttonStyle(BigPillStyle(filled: false))
                .disabled(open.count < 2)
            }
        }
        .padding(16)
        .card(22)
        .animation(Motion.gentle, value: draft)
    }

    private var finished: some View {
        VStack(spacing: 8) {
            Image(systemName: "checkmark.seal.fill").font(.system(size: 34)).foregroundStyle(Theme.good)
                .symbolEffect(.bounce, value: celebrate)
            Text("This week’s five are done.").font(Theme.serif(.title3, .semibold))
            Text("Fresh picks arrive Monday morning.").font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 26)
        .card(22)
    }
}

/// The tall pill buttons on the daily five card.
struct BigPillStyle: ButtonStyle {
    var filled: Bool
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.geist(.subheadline, .semibold))
            .lineLimit(1)
            .frame(minHeight: 46)
            .foregroundStyle(filled ? Color(.systemBackground) : Color.primary)
            .background {
                if filled { Capsule().fill(Color.primary) } else { Capsule().strokeBorder(Theme.hairline, lineWidth: 1.5) }
            }
            .opacity(enabled ? (configuration.isPressed ? 0.85 : 1) : 0.4)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(Motion.bouncy, value: configuration.isPressed)
    }
}
