import SwiftUI
import UIKit

// The Lens: a drop of Liquid Glass resting on the compass. Drag it across your network
// and it magnifies whatever is under it, names the people there, and ticks softly as
// you pass each one. Let go on someone and their profile zooms out of the glass.

struct CompassLens: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduce
    let data: CompassData
    let initials: String
    let onOpen: (String) -> Void

    @AppStorage("lensUsed") private var used = false
    @State private var pos: CGPoint?          // nil: resting in its dock
    @State private var target: String?        // the person right under the center
    @State private var under: [String] = []   // everyone inside the glass, most interesting first
    @State private var tick = UISelectionFeedbackGenerator()
    @State private var breathe = false

    private let magnify: CGFloat = 2.6
    private let open: CGFloat = 58
    private let docked: CGFloat = 24

    var body: some View {
        GeometryReader { g in
            let side = min(g.size.width, g.size.height)
            let r = side / 2 - 6
            let center = CGPoint(x: g.size.width / 2, y: g.size.height / 2)
            let dock = CGPoint(x: center.x + r * 0.80, y: center.y + r * 0.80)
            let active = pos != nil
            let p = pos ?? dock
            let radius = active ? open : docked

            ZStack {
                // what the glass shows: the same compass, magnified around the lens
                if active {
                    // redrawn at full size rather than scaled, so the dots stay sharp
                    let W = g.size.width * magnify, H = g.size.height * magnify
                    CompassView(data: data, focus: .constant(nil), initials: initials, labels: false) { _ in }
                        .frame(width: W, height: H)
                        .position(x: W / 2 + p.x - p.x * magnify, y: H / 2 + p.y - p.y * magnify)
                        .frame(width: g.size.width, height: g.size.height)
                        .mask(Circle().frame(width: radius * 2, height: radius * 2).position(p))
                        .allowsHitTesting(false)
                        .transition(.opacity)
                }

                // the glass itself
                Circle()
                    .fill(Color.clear)
                    .frame(width: radius * 2, height: radius * 2)
                    .overlay {
                        if !active {
                            Image(systemName: "plus.magnifyingglass")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Theme.primary)
                                .symbolEffect(.breathe, isActive: !used && !reduce)
                        } else if target != nil {
                            Circle().stroke(Theme.amber.opacity(0.9), lineWidth: 1.5).frame(width: 18, height: 18)
                        }
                    }
                    .lensGlass(active: active)
                    .contentShape(Circle())
                    .gesture(drag(center: center, r: r, size: g.size))
                    .zoomSource(person: target ?? "-")
                    .position(p)
                    .accessibilityHidden(true)

                // who's under the glass
                if active, !under.isEmpty {
                    Text(caption)
                        .font(Theme.geist(.footnote, .semibold))
                        .lineLimit(1)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .liquidGlass(Capsule())
                        .fixedSize()
                        .position(x: min(max(p.x, 90), g.size.width - 90), y: max(16, p.y - radius - 22))
                        .contentTransition(.opacity)
                        .animation(.easeOut(duration: 0.15), value: caption)
                        .transition(.opacity.combined(with: .scale(scale: 0.9)))
                        .allowsHitTesting(false)
                }
            }
            .coordinateSpace(.named("lens"))
            .animation(Motion.spring, value: active)
            .animation(.snappy(duration: 0.22), value: target)
        }
        .aspectRatio(1, contentMode: .fit)
        .onAppear { tick.prepare() }
    }

    private var caption: String {
        let names = under.prefix(2).compactMap { model.person($0)?.fullName }
        let more = under.count - names.count
        return names.joined(separator: ", ") + (more > 0 ? " +\(more)" : "")
    }

    private func drag(center: CGPoint, r: CGFloat, size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named("lens"))
            .onChanged { v in
                // keep the lens over the compass
                var q = v.location
                let dx = q.x - center.x, dy = q.y - center.y
                let d = (dx * dx + dy * dy).squareRoot()
                if d > r { q = CGPoint(x: center.x + dx / d * r, y: center.y + dy / d * r) }
                if pos == nil { used = true; tick.prepare() }
                pos = q
                look(at: q, center: center, r: r)
            }
            .onEnded { _ in
                if let k = target {
                    Haptic.star()
                    onOpen(k)
                }
                withAnimation(Motion.bouncy) { pos = nil }
                target = nil
                under = []
            }
    }

    /// Finds who is inside the glass, and who is right under its center.
    private func look(at q: CGPoint, center: CGPoint, r: CGFloat) {
        let reach = open / magnify            // the lens radius in compass points
        let hit = 9 / magnify                 // close enough to the center to pick someone
        var inside: [(k: String, d: CGFloat, flag: Bool)] = []
        for dot in data.dots {
            let x = center.x + CGFloat(cos(dot.a) * dot.r) * r
            let y = center.y + CGFloat(sin(dot.a) * dot.r) * r
            let d = ((x - q.x) * (x - q.x) + (y - q.y) * (y - q.y)).squareRoot()
            if d <= reach { inside.append((dot.k, d, !dot.f.isEmpty)) }
        }
        inside.sort { a, b in a.d < b.d }
        let nearest = inside.first.flatMap { $0.d <= hit ? $0.k : nil }
        if nearest != target {
            target = nearest
            if nearest != nil { tick.selectionChanged() }
        }
        // the person under the center first, then people with something going on, then the rest
        under = inside.sorted { a, b in
            if a.k == nearest { return true }
            if b.k == nearest { return false }
            if a.flag != b.flag { return a.flag }
            return a.d < b.d
        }.map(\.k)
    }
}

private extension View {
    /// Clear Liquid Glass for the lens on iOS 26; a ring with a highlight before.
    @ViewBuilder func lensGlass(active: Bool) -> some View {
        if #available(iOS 26.0, *) {
            self
                .glassEffect(active ? Glass.clear.interactive() : Glass.regular.interactive(), in: Circle())
                .shadow(color: .black.opacity(active ? 0.22 : 0.12), radius: active ? 16 : 6, y: active ? 8 : 3)
        } else {
            self
                .background {
                    Circle().fill(active ? Color.clear : Theme.card)
                }
                .overlay {
                    Circle().strokeBorder(LinearGradient(colors: [.white.opacity(0.9), .white.opacity(0.15), Theme.amber.opacity(0.5)],
                                                         startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: active ? 2.5 : 1.5)
                }
                .shadow(color: .black.opacity(active ? 0.22 : 0.12), radius: active ? 16 : 6, y: active ? 8 : 3)
        }
    }
}
