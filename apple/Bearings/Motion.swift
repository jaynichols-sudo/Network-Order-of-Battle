import SwiftUI

// Bearings' motion language. One idea runs through it: things come from somewhere.
// People zoom out of the row you tapped, dots bloom outward from you, numbers count up
// to where they are, cards ease in as they scroll into view. Springs, not linear tweens.
// Everything here checks Reduce Motion and falls back to a plain fade or nothing.

enum Motion {
    /// The house spring: quick to start, settles without wobble.
    static let spring = Animation.spring(response: 0.42, dampingFraction: 0.86)
    /// A livelier spring for small things that should feel physical (presses, toggles).
    static let bouncy = Animation.spring(response: 0.32, dampingFraction: 0.62)
    static let gentle = Animation.smooth(duration: 0.6)
}

// MARK: - Pressing

/// Squishes slightly while pressed and springs back, like a physical key.
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.97
    @Environment(\.accessibilityReduceMotion) private var reduce

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduce ? scale : 1)
            .brightness(configuration.isPressed ? -0.02 : 0)
            .animation(Motion.bouncy, value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == PressableStyle {
    static var pressable: PressableStyle { PressableStyle() }
    static func pressable(_ scale: CGFloat) -> PressableStyle { PressableStyle(scale: scale) }
}

// MARK: - Arriving

/// Slides up and fades in the first time it appears, staggered by `index`.
struct Cascade: ViewModifier {
    let index: Int
    var distance: CGFloat = 16
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduce

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown || reduce ? 0 : distance)
            .scaleEffect(shown || reduce ? 1 : 0.985, anchor: .top)
            .onAppear {
                guard !shown else { return }
                if reduce { withAnimation(.easeOut(duration: 0.2)) { shown = true }; return }
                withAnimation(Motion.spring.delay(0.05 + Double(min(index, 10)) * 0.055)) { shown = true }
            }
    }
}

/// Cards settle into place as they scroll in from the edges of the screen.
struct EdgeSettle: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduce

    func body(content: Content) -> some View {
        if reduce {
            content
        } else {
            content.scrollTransition(.interactive, axis: .vertical) { view, phase in
                view
                    .scaleEffect(phase.isIdentity ? 1 : 0.94, anchor: phase.value < 0 ? .bottom : .top)
                    .opacity(phase.isIdentity ? 1 : 0.55)
                    .blur(radius: phase.isIdentity ? 0 : 1.5)
            }
        }
    }
}

extension View {
    func cascade(_ index: Int, distance: CGFloat = 16) -> some View { modifier(Cascade(index: index, distance: distance)) }
    func edgeSettle() -> some View { modifier(EdgeSettle()) }
}

// MARK: - Numbers

/// A number that counts up to its value (and rolls when it changes).
struct CountingText: View, Animatable {
    var value: Double
    var animatableData: Double { get { value } set { value = newValue } }

    var body: some View {
        Text(Int(value.rounded()).formatted())
    }
}

/// Counts from zero the first time it appears, then follows `value`.
struct CountUp: View {
    let value: Int
    var font: Font = Theme.geist(.title2, .bold)
    var color: Color = .primary
    var delay: Double = 0.15
    @State private var shown: Double = 0
    @State private var started = false
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        CountingText(value: shown)
            .font(font)
            .foregroundStyle(color)
            .monospacedDigit()
            .accessibilityLabel(value.formatted())
            .onAppear { start() }
            .onChange(of: value) { _, v in withAnimation(Motion.spring) { shown = Double(v) } }
    }

    private func start() {
        guard !started else { return }
        started = true
        if reduce || value == 0 { shown = Double(value); return }
        withAnimation(.easeOut(duration: min(1.4, 0.5 + Double(value).squareRoot() / 40)).delay(delay)) { shown = Double(value) }
    }
}

// MARK: - Progress

/// A ring that fills as the week's five get done.
struct ProgressRing: View {
    let done: Int
    let total: Int
    var size: CGFloat = 22
    var line: CGFloat = 3

    var body: some View {
        let f = total == 0 ? 0 : Double(done) / Double(total)
        ZStack {
            Circle().stroke(Theme.soft, lineWidth: line)
            Circle()
                .trim(from: 0, to: f)
                .stroke(f >= 1 ? Theme.good : Theme.needs, style: StrokeStyle(lineWidth: line, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if f >= 1 {
                Image(systemName: "checkmark")
                    .font(.system(size: size * 0.42, weight: .heavy))
                    .foregroundStyle(Theme.good)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .frame(width: size, height: size)
        .animation(Motion.spring, value: done)
        .accessibilityHidden(true)
    }
}

// MARK: - Celebration

/// A short burst of confetti in the brand colors, fired when `trigger` changes to true.
struct Celebration: View {
    let fire: Date?
    @Environment(\.accessibilityReduceMotion) private var reduce

    private struct Bit { var angle: Double; var speed: Double; var spin: Double; var color: Color; var w: CGFloat; var h: CGFloat }
    private static let colors: [Color] = [Theme.amber, Theme.violet, Theme.good, Theme.info, Color(hex: "#FF7A7F")]
    private static let bits: [Bit] = (0..<70).map { i in
        var g = SeededRandom(seed: UInt64(i * 7919 + 13))
        return Bit(angle: -Double.pi / 2 + (g.next() - 0.5) * 2.2, speed: 380 + g.next() * 420, spin: (g.next() - 0.5) * 14,
                   color: colors[i % colors.count], w: 5 + CGFloat(g.next()) * 5, h: 8 + CGFloat(g.next()) * 7)
    }

    var body: some View {
        if let fire, !reduce {
            TimelineView(.animation) { tl in
                let t = tl.date.timeIntervalSince(fire)
                Canvas { ctx, size in
                    guard t < 2.2 else { return }
                    let origin = CGPoint(x: size.width / 2, y: size.height * 0.35)
                    for b in Self.bits {
                        let x = origin.x + cos(b.angle) * b.speed * t
                        let y = origin.y + sin(b.angle) * b.speed * t + 900 * t * t / 2
                        let fade = max(0, 1 - t / 2.2)
                        var c = ctx
                        c.opacity = fade
                        c.translateBy(x: x, y: y)
                        c.rotate(by: .radians(b.spin * t))
                        c.fill(Path(roundedRect: CGRect(x: -b.w / 2, y: -b.h / 2, width: b.w, height: b.h), cornerRadius: 1.5), with: .color(b.color))
                    }
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}

/// Small deterministic random numbers, so the confetti looks the same every time.
struct SeededRandom {
    private var s: UInt64
    init(seed: UInt64) { s = seed &* 6364136223846793005 &+ 1442695040888963407 }
    mutating func next() -> Double {
        s = s &* 6364136223846793005 &+ 1442695040888963407
        return Double((s >> 33) & 0xFFFFFF) / Double(0xFFFFFF)
    }
}

// MARK: - Aurora

/// A slow, drifting light behind Today's headline: the brand's plum and amber, faint in
/// light mode, a night sky in dark. Holds still under Reduce Motion.
struct Aurora: View {
    var tint: Color? = nil
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduce)) { tl in
            let t = reduce ? 0 : tl.date.timeIntervalSinceReferenceDate
            MeshGradient(width: 3, height: 3, points: points(t), colors: colors)
        }
        .accessibilityHidden(true)
    }

    private func points(_ t: Double) -> [SIMD2<Float>] {
        func w(_ speed: Double, _ phase: Double, _ amp: Double) -> Float { Float(sin(t * speed + phase) * amp) }
        return [
            [0, 0], [0.5 + w(0.21, 0, 0.12), 0], [1, 0],
            [0, 0.5 + w(0.17, 1, 0.12)], [0.5 + w(0.23, 2, 0.18), 0.45 + w(0.19, 3, 0.16)], [1, 0.5 + w(0.15, 4, 0.12)],
            [0, 1], [0.5 + w(0.13, 5, 0.14), 1], [1, 1],
        ]
    }

    private var colors: [Color] {
        let dark = scheme == .dark
        let a = Theme.amber, p = tint ?? (dark ? Color(hex: "#5B3FD0") : Color(hex: "#7556E8")), base = Theme.bg
        if dark {
            return [Color(hex: "#1A1233"), p.opacity(0.55), Color(hex: "#120F22"),
                    a.opacity(0.28), Color(hex: "#2A1E55"), p.opacity(0.35),
                    base, base, base]
        }
        return [a.opacity(0.22), p.opacity(0.14), Color.white,
                p.opacity(0.10), a.opacity(0.16), p.opacity(0.18),
                base, base, base]
    }
}

// MARK: - Shimmer and tilt

/// A sheen that sweeps across the view every few seconds (for the main paywall button).
struct Shimmer: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduce

    func body(content: Content) -> some View {
        content.overlay {
            if !reduce {
                TimelineView(.animation(minimumInterval: 1 / 30)) { tl in
                    let t = tl.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 3.2) / 1.1
                    GeometryReader { g in
                        LinearGradient(colors: [.clear, .white.opacity(0.35), .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: g.size.width * 0.45)
                            .rotationEffect(.degrees(18))
                            .offset(x: -g.size.width * 0.6 + CGFloat(min(t, 1)) * g.size.width * 1.7)
                    }
                    .blendMode(.plusLighter)
                }
                .allowsHitTesting(false)
                .mask(content)
            }
        }
    }
}

/// Tilts in 3D toward your finger with a holographic sheen, then springs flat on release.
struct HoloTilt: ViewModifier {
    var maxAngle: Double = 14
    @State private var drag: CGSize = .zero
    @State private var size: CGSize = .zero
    @Environment(\.accessibilityReduceMotion) private var reduce

    func body(content: Content) -> some View {
        let nx = size.width > 0 ? max(-1, min(1, drag.width / (size.width / 2))) : 0
        let ny = size.height > 0 ? max(-1, min(1, drag.height / (size.height / 2))) : 0
        content
            .overlay {
                LinearGradient(colors: [Color(hex: "#FF7AD9").opacity(0.0), Color(hex: "#7EE8FF").opacity(0.30), Color(hex: "#FFE27A").opacity(0.28), Color(hex: "#B48CFF").opacity(0.0)],
                               startPoint: UnitPoint(x: 0.0 + nx * 0.5, y: 0.0 + ny * 0.5), endPoint: UnitPoint(x: 1.0 + nx * 0.5, y: 1.0 + ny * 0.5))
                    .blendMode(.overlay)
                    .opacity(drag == .zero ? 0.25 : 0.9)
                    .allowsHitTesting(false)
            }
            .background(GeometryReader { g in Color.clear.onAppear { size = g.size } })
            .rotation3DEffect(.degrees(reduce ? 0 : -ny * maxAngle), axis: (x: 1, y: 0, z: 0), perspective: 0.6)
            .rotation3DEffect(.degrees(reduce ? 0 : nx * maxAngle), axis: (x: 0, y: 1, z: 0), perspective: 0.6)
            .shadow(color: .black.opacity(0.25), radius: 22, x: -nx * 10, y: 14 - ny * 6)
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { v in drag = CGSize(width: v.location.x - size.width / 2, height: v.location.y - size.height / 2) }
                .onEnded { _ in withAnimation(Motion.bouncy) { drag = .zero } })
            .animation(.interactiveSpring(response: 0.25, dampingFraction: 0.8), value: drag)
    }
}

extension View {
    func shimmer() -> some View { modifier(Shimmer()) }
    func holoTilt(_ maxAngle: Double = 14) -> some View { modifier(HoloTilt(maxAngle: maxAngle)) }
}

// MARK: - Liquid Glass

extension View {
    /// Liquid Glass that reacts to touch on iOS 26 and later; the old pill or card look elsewhere.
    @ViewBuilder func liquidGlass<S: Shape>(_ shape: S, tint: Color? = nil, fallback: Color = Theme.card) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(tint.map { Glass.regular.tint($0).interactive() } ?? Glass.regular.interactive(), in: shape)
        } else {
            self.background(fallback, in: shape)
        }
    }

    /// Lets nearby glass shapes blend into each other and morph as they appear (iOS 26+).
    @ViewBuilder func glassGroup(spacing: CGFloat = 12) -> some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { self }
        } else {
            self
        }
    }

    /// A glass identity so a chip morphs rather than pops when it comes and goes (iOS 26+).
    @ViewBuilder func glassID<ID: Hashable & Sendable>(_ id: ID, in ns: Namespace.ID) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffectID(id, in: ns)
        } else {
            self
        }
    }
}

// MARK: - Zoom transitions

/// The namespace and tab that zoom transitions use, so any row can be a source.
private struct ZoomKey: EnvironmentKey { static let defaultValue: Namespace.ID? = nil }
private struct ZoomTabKey: EnvironmentKey { static let defaultValue: AppTab = .home }

extension EnvironmentValues {
    var zoomNamespace: Namespace.ID? {
        get { self[ZoomKey.self] }
        set { self[ZoomKey.self] = newValue }
    }
    var zoomTab: AppTab {
        get { self[ZoomTabKey.self] }
        set { self[ZoomTabKey.self] = newValue }
    }
}

enum ZoomID {
    static func person(_ tab: AppTab, _ k: String) -> String { "\(tab.rawValue)|p|\(k)" }
    static func unit(_ tab: AppTab, _ name: String) -> String { "\(tab.rawValue)|u|\(name)" }
    static func explore(_ tab: AppTab) -> String { "\(tab.rawValue)|explore" }
}

/// Marks a view as where a zoom transition starts.
struct ZoomSource: ViewModifier {
    let id: (AppTab) -> String
    @Environment(\.zoomNamespace) private var ns
    @Environment(\.zoomTab) private var tab

    func body(content: Content) -> some View {
        if let ns {
            content.matchedTransitionSource(id: id(tab), in: ns)
        } else {
            content
        }
    }
}

extension View {
    func zoomSource(person k: String) -> some View { modifier(ZoomSource { ZoomID.person($0, k) }) }
    func zoomSource(unit name: String) -> some View { modifier(ZoomSource { ZoomID.unit($0, name) }) }
    func zoomSourceExplore() -> some View { modifier(ZoomSource { ZoomID.explore($0) }) }
}
