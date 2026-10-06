import SwiftUI

// The compass: you in the middle, everyone you know around you. Distance is how
// close you are, direction is their sector. A sweep arm lights people up as it
// passes; people waiting on you glow amber and new jobs pulse.

struct CompassData: Decodable {
    struct Wedge: Decodable, Identifiable, Hashable {
        var id: String, short: String, color: String
        var a0: Double, a1: Double
        var n: Int, close: Int, flagged: Int
        var mid: Double { (a0 + a1) / 2 }
        var span: Double { a1 - a0 }
    }
    struct Dot: Decodable {
        var k: String, a: Double, r: Double, c: String
        /// w waiting, o overdue, j new job, n new connection, s starred; empty (and left out) for everyone else
        var f: String
        enum K: String, CodingKey { case k, a, r, c, f }
        init(from d: Decoder) throws {
            let x = try d.container(keyedBy: K.self)
            k = try x.decode(String.self, forKey: .k)
            a = try x.decode(Double.self, forKey: .a)
            r = try x.decode(Double.self, forKey: .r)
            c = (try? x.decode(String.self, forKey: .c)) ?? "#8F89A8"
            f = (try? x.decodeIfPresent(String.self, forKey: .f)) ?? ""
        }
    }
    struct Ring: Decodable, Hashable { var r: Double; var label: String }
    struct Tally: Decodable, Hashable { var w = 0, o = 0, j = 0, n = 0, s = 0, close = 0 }
    var wedges: [Wedge]
    var dots: [Dot]
    var rings: [Ring]
    var rel: Bool
    var total: Int
    var tally: Tally
    static let empty = CompassData(wedges: [], dots: [], rings: [], rel: false, total: 0, tally: Tally())

    func wedge(at angle: Double) -> Wedge? {
        let tau = 2 * Double.pi
        for w in wedges {
            var a = angle
            while a < w.a0 { a += tau }
            while a >= w.a0 + tau { a -= tau }
            if a < w.a1 { return w }
        }
        return nil
    }
}

/// Dots grouped into a few hundred paths so a frame stays cheap with thousands of people.
final class CompassCache {
    struct Bucket { var color: Color; var angle: Double; var band: Double; var path: Path }
    var key = ""
    var buckets: [Bucket] = []
    var flagged: [(dot: CompassData.Dot, point: CGPoint, color: Color)] = []

    static let angleBuckets = 48
    static let bands = 6

    func build(_ data: CompassData, center: CGPoint, r: CGFloat, dot: CGFloat) {
        let k = "\(data.total)-\(data.dots.first?.k ?? "")-\(data.dots.last?.k ?? "")-\(Int(r))-\(Int(center.x))"
        guard k != key else { return }
        key = k
        var map: [String: Bucket] = [:]
        var flags: [(dot: CompassData.Dot, point: CGPoint, color: Color)] = []
        let tau = 2 * Double.pi
        for d in data.dots {
            let pt = CGPoint(x: center.x + CGFloat(cos(d.a) * d.r) * r, y: center.y + CGFloat(sin(d.a) * d.r) * r)
            if !d.f.isEmpty && flags.count < 500 {
                flags.append((d, pt, Color(hex: d.c)))
                continue
            }
            var norm = d.a.truncatingRemainder(dividingBy: tau)
            if norm < 0 { norm += tau }
            let ab = Int(norm / tau * Double(Self.angleBuckets)) % Self.angleBuckets
            let bb = min(Self.bands - 1, Int(d.r * Double(Self.bands)))
            let id = "\(d.c)|\(ab)|\(bb)"
            if map[id] == nil {
                map[id] = Bucket(color: Color(hex: d.c), angle: (Double(ab) + 0.5) / Double(Self.angleBuckets) * tau, band: Double(bb) / Double(Self.bands), path: Path())
            }
            map[id]?.path.addEllipse(in: CGRect(x: pt.x - dot, y: pt.y - dot, width: dot * 2, height: dot * 2))
        }
        buckets = Array(map.values)
        flagged = flags
    }
}

struct CompassView: View {
    let data: CompassData
    @Binding var focus: String?
    /// 0 to 1: how far out the dots have appeared (for the first-run reveal).
    var reveal: Double = 1
    var initials: String = ""
    /// Draw a single frame (for images): no animation, sweep parked at a flattering angle.
    var still = false
    /// Ping softly as the sweep passes people waiting on you (the first few turns only).
    var pings = false
    let onOpen: (String) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    @State private var cache = CompassCache()

    private var focused: CompassData.Wedge? { focus.flatMap { f in data.wedges.first { $0.id == f } } }

    var body: some View {
        GeometryReader { g in
            let side = min(g.size.width, g.size.height)
            let r = side / 2 - 6
            let center = CGPoint(x: g.size.width / 2, y: g.size.height / 2)
            let z = zoom(r: r)
            ZStack {
                Group {
                    if still {
                        Canvas { ctx, _ in draw(&ctx, center: center, r: r, t: 4.6) }
                    } else {
                        TimelineView(.animation(paused: reduceMotion)) { tl in
                            Canvas { ctx, _ in
                                draw(&ctx, center: center, r: r, t: tl.date.timeIntervalSinceReferenceDate)
                            }
                        }
                    }
                }
                .scaleEffect(z.scale)
                .offset(z.offset)
                you
                    .opacity(focused == nil ? 1 : 0)
            }
            .frame(width: g.size.width, height: g.size.height)
            .clipShape(Circle().inset(by: -2))
            .contentShape(Circle())
            .onTapGesture { loc in tap(loc, center: center, r: r, z: z) }
        }
        .aspectRatio(1, contentMode: .fit)
        .animation(.smooth(duration: 0.55), value: focus)
        .task(id: data.total) { await pingLoop() }
        .accessibilityElement()
        .accessibilityLabel(accessibilityText)
        .accessibilityHint("Tap a sector to zoom in, or a dot to open that person")
        .accessibilityActions {
            ForEach(data.wedges.sorted { $0.n > $1.n }.prefix(8)) { w in
                Button("Zoom in on \(w.id), \(w.n) people") { focus = w.id }
            }
            if focus != nil { Button("Show the whole network") { focus = nil } }
        }
    }

    private var accessibilityText: String {
        var s = "Your network compass: \(data.total.formatted()) people in \(data.wedges.count) sectors."
        if data.tally.w > 0 { s += " \(data.tally.w) waiting on your reply." }
        if data.tally.j > 0 { s += " \(data.tally.j) changed jobs." }
        if let f = focused { s += " Zoomed in on \(f.id)." }
        return s
    }

    private var you: some View {
        MeAvatar(initials: initials, size: 46, ring: 2)
            .shadow(color: Theme.amber.opacity(0.35), radius: 10)
    }

    // MARK: sound

    private func pingLoop() async {
        guard pings, !still, !reduceMotion else { return }
        let tau = 2 * Double.pi
        let norm: (Double) -> Double = { a in let x = a.truncatingRemainder(dividingBy: tau); return x < 0 ? x + tau : x }
        let targets = data.dots.filter { $0.f == "w" }.map { norm($0.a) }
        guard !targets.isEmpty else { return }
        try? await Task.sleep(nanoseconds: 1_200_000_000)
        for _ in 0..<3 {
            let s = norm(sweep(Date().timeIntervalSinceReferenceDate))
            let ahead = targets.map { t -> Double in var d = t - s; if d < 0.02 { d += tau }; return d }.min() ?? tau
            try? await Task.sleep(nanoseconds: UInt64(ahead / tau * 7 * 1_000_000_000))
            if Task.isCancelled { return }
            if focus == nil { SoundFX.ping() }
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            if Task.isCancelled { return }
        }
    }

    // MARK: zoom

    struct Zoom { var scale: CGFloat; var offset: CGSize }

    private func zoom(r: CGFloat) -> Zoom {
        guard let w = focused else { return Zoom(scale: 1, offset: .zero) }
        let scale = CGFloat(min(3.2, max(1.7, 1.6 / max(0.25, w.span))))
        let focusR = 0.6
        let px = CGFloat(cos(w.mid) * focusR) * r, py = CGFloat(sin(w.mid) * focusR) * r
        return Zoom(scale: scale, offset: CGSize(width: -px * scale, height: -py * scale))
    }

    // MARK: drawing

    private func point(_ c: CGPoint, _ a: Double, _ rr: CGFloat) -> CGPoint {
        CGPoint(x: c.x + CGFloat(cos(a)) * rr, y: c.y + CGFloat(sin(a)) * rr)
    }

    private func sweep(_ t: Double) -> Double {
        reduceMotion ? -Double.pi / 2 : (t.truncatingRemainder(dividingBy: 7) / 7) * 2 * Double.pi - Double.pi / 2
    }

    private func draw(_ ctx: inout GraphicsContext, center: CGPoint, r: CGFloat, t: Double) {
        let dotSize: CGFloat = data.total > 2500 ? 1.9 : data.total > 900 ? 2.4 : 3.1
        cache.build(data, center: center, r: r, dot: dotSize)
        let s = sweep(t)
        drawGrid(&ctx, center: center, r: r)
        if !reduceMotion { drawSweep(&ctx, center: center, r: r, sweep: s) }
        drawDots(&ctx, sweep: s)
        drawFlags(&ctx, t: t, dot: dotSize)
        drawLabels(&ctx, center: center, r: r)
    }

    private func drawGrid(_ ctx: inout GraphicsContext, center: CGPoint, r: CGFloat) {
        let faint = Color.primary.opacity(scheme == .dark ? 0.08 : 0.06)
        let disk = Path(ellipseIn: CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2))
        ctx.fill(disk, with: .radialGradient(Gradient(colors: [Theme.amber.opacity(scheme == .dark ? 0.10 : 0.07), .clear]), center: center, startRadius: 0, endRadius: r))
        for (i, ring) in data.rings.enumerated() {
            let rr = r * CGFloat(ring.r)
            let p = Path(ellipseIn: CGRect(x: center.x - rr, y: center.y - rr, width: rr * 2, height: rr * 2))
            let last = i == data.rings.count - 1
            ctx.stroke(p, with: .color(last ? Color.primary.opacity(0.18) : faint), style: StrokeStyle(lineWidth: last ? 1.2 : 1, dash: last ? [] : [3, 4]))
        }
        var spokes = Path()
        for w in data.wedges {
            spokes.move(to: point(center, w.a0, r * 0.12))
            spokes.addLine(to: point(center, w.a0, r))
        }
        ctx.stroke(spokes, with: .color(faint), lineWidth: 0.8)
        if let f = focused {
            var wedge = Path()
            wedge.move(to: center)
            wedge.addArc(center: center, radius: r, startAngle: .radians(f.a0), endAngle: .radians(f.a1), clockwise: false)
            wedge.closeSubpath()
            ctx.fill(wedge, with: .color(Color(hex: f.color).opacity(0.10)))
        }
    }

    private func drawSweep(_ ctx: inout GraphicsContext, center: CGPoint, r: CGFloat, sweep: Double) {
        var wedge = Path()
        wedge.move(to: center)
        wedge.addArc(center: center, radius: r, startAngle: .radians(sweep - 0.9), endAngle: .radians(sweep), clockwise: false)
        wedge.closeSubpath()
        let strength = scheme == .dark ? 0.20 : 0.16
        ctx.fill(wedge, with: .conicGradient(Gradient(stops: [
            .init(color: Theme.amber.opacity(0), location: 0),
            .init(color: Theme.amber.opacity(strength), location: 0.9 / (2 * Double.pi)),
            .init(color: Theme.amber.opacity(0), location: 0.9 / (2 * Double.pi) + 0.0001),
            .init(color: Theme.amber.opacity(0), location: 1),
        ]), center: center, angle: .radians(sweep - 0.9)))
        var arm = Path()
        arm.move(to: center)
        arm.addLine(to: point(center, sweep, r))
        ctx.stroke(arm, with: .linearGradient(Gradient(colors: [Theme.amber.opacity(0.1), Theme.amber.opacity(0.9)]), startPoint: center, endPoint: point(center, sweep, r)), lineWidth: 1.5)
    }

    /// 1 right behind the arm, fading over most of a turn.
    private func glow(_ angle: Double, sweep: Double) -> Double {
        if reduceMotion { return 1 }
        let tau = 2 * Double.pi
        var behind = (sweep - angle).truncatingRemainder(dividingBy: tau)
        if behind < 0 { behind += tau }
        return exp(-behind / 2.2)
    }

    private func drawDots(_ ctx: inout GraphicsContext, sweep: Double) {
        let base = scheme == .dark ? 0.42 : 0.5
        for b in cache.buckets where b.band < reveal {
            let dim = focused != nil && focused?.color != nil && !inFocus(b.angle) ? 0.25 : 1
            ctx.fill(b.path, with: .color(b.color.opacity((base + (1 - base) * glow(b.angle, sweep: sweep)) * dim)))
        }
    }

    private func inFocus(_ angle: Double) -> Bool {
        guard let f = focused else { return true }
        return data.wedge(at: angle)?.id == f.id
    }

    private func drawFlags(_ ctx: inout GraphicsContext, t: Double, dot: CGFloat) {
        for item in cache.flagged where item.dot.r < reveal {
            let p = item.point
            let dim = inFocus(item.dot.a) ? 1.0 : 0.3
            switch item.dot.f {
            case "w":
                let halo = dot * 3.4
                ctx.fill(Path(ellipseIn: CGRect(x: p.x - halo, y: p.y - halo, width: halo * 2, height: halo * 2)),
                         with: .radialGradient(Gradient(colors: [Theme.amber.opacity(0.55 * dim), Theme.amber.opacity(0)]), center: p, startRadius: 0, endRadius: halo))
                let s = dot * 1.5
                ctx.fill(Path(ellipseIn: CGRect(x: p.x - s, y: p.y - s, width: s * 2, height: s * 2)), with: .color(Theme.amber.opacity(dim)))
            case "o":
                let s = dot * 1.4
                ctx.fill(Path(ellipseIn: CGRect(x: p.x - s, y: p.y - s, width: s * 2, height: s * 2)), with: .color(Theme.violet.opacity(dim)))
                let o = s + 2.4
                ctx.stroke(Path(ellipseIn: CGRect(x: p.x - o, y: p.y - o, width: o * 2, height: o * 2)), with: .color(Theme.violet.opacity(0.75 * dim)), style: StrokeStyle(lineWidth: 1.3, dash: [2, 2]))
            case "j":
                let phase = reduceMotion ? 0.4 : ((t + Double(abs(item.dot.k.hashValue % 100)) / 50).truncatingRemainder(dividingBy: 2.2)) / 2.2
                let pr = dot * (1.6 + CGFloat(phase) * 4)
                ctx.stroke(Path(ellipseIn: CGRect(x: p.x - pr, y: p.y - pr, width: pr * 2, height: pr * 2)), with: .color(Theme.info.opacity((1 - phase) * 0.8 * dim)), lineWidth: 1.4)
                let s = dot * 1.4
                ctx.fill(Path(ellipseIn: CGRect(x: p.x - s, y: p.y - s, width: s * 2, height: s * 2)), with: .color(Theme.info.opacity(dim)))
            case "n":
                let s = dot * 1.4
                ctx.fill(Path(ellipseIn: CGRect(x: p.x - s, y: p.y - s, width: s * 2, height: s * 2)), with: .color(item.color.opacity(dim)))
                let o = s + 2
                ctx.stroke(Path(ellipseIn: CGRect(x: p.x - o, y: p.y - o, width: o * 2, height: o * 2)), with: .color(item.color.opacity(0.6 * dim)), lineWidth: 1)
            default:
                let s = dot * 1.3
                ctx.fill(Path(ellipseIn: CGRect(x: p.x - s, y: p.y - s, width: s * 2, height: s * 2)), with: .color(item.color.opacity(dim)))
                let o = s + 1.8
                ctx.stroke(Path(ellipseIn: CGRect(x: p.x - o, y: p.y - o, width: o * 2, height: o * 2)), with: .color(Theme.amber.opacity(0.9 * dim)), lineWidth: 1.2)
            }
        }
    }

    private func drawLabels(_ ctx: inout GraphicsContext, center: CGPoint, r: CGFloat) {
        guard focused == nil else { return }
        for ring in data.rings.dropLast() {
            let y = center.y - r * CGFloat(ring.r) + 2
            ctx.draw(Text(ring.label.uppercased()).font(.custom("GeistMono-Medium", fixedSize: 9)).foregroundStyle(Color.secondary.opacity(0.85)),
                     at: CGPoint(x: center.x + 4, y: y), anchor: .topLeading)
        }
        let big = data.wedges.sorted { $0.n > $1.n }.prefix(6)
        var placed: [CGRect] = []
        for w in big where w.span > 0.32 {
            let p = point(center, w.mid, r * 0.84)
            let label = ctx.resolve(Text(w.short).font(.custom("Geist-SemiBold", fixedSize: 11)).foregroundStyle(Color(hex: w.color)))
            let size = label.measure(in: CGSize(width: 200, height: 30))
            let rect = CGRect(x: p.x - size.width / 2 - 7, y: p.y - size.height / 2 - 3, width: size.width + 14, height: size.height + 6)
            if placed.contains(where: { $0.intersects(rect) }) { continue }
            placed.append(rect)
            let pill = Path(roundedRect: rect, cornerRadius: rect.height / 2)
            ctx.fill(pill, with: .color(Color(.systemBackground).opacity(scheme == .dark ? 0.8 : 0.9)))
            ctx.stroke(pill, with: .color(Color(hex: w.color).opacity(0.45)), lineWidth: 1)
            ctx.draw(label, at: CGPoint(x: rect.midX, y: rect.midY), anchor: .center)
        }
    }

    // MARK: taps

    private func tap(_ loc: CGPoint, center: CGPoint, r: CGFloat, z: Zoom) {
        // undo the zoom to find where the tap lands on the unscaled compass
        let lx = (loc.x - center.x - z.offset.width) / z.scale + center.x
        let ly = (loc.y - center.y - z.offset.height) / z.scale + center.y
        let reach = 20 / z.scale
        var best: String?
        var bestDist = reach
        for d in data.dots where d.r < reveal {
            let pt = point(center, d.a, r * CGFloat(d.r))
            let dist = hypot(pt.x - lx, pt.y - ly)
            if dist < bestDist && inFocus(d.a) { bestDist = dist; best = d.k }
        }
        let fromCenter = hypot(lx - center.x, ly - center.y)
        if focused == nil, fromCenter < 26 { return }
        // in the whole view, a tap picks a sector; zoomed in, it picks a person
        if focused != nil, let k = best { Haptic.tap(); onOpen(k); return }
        if fromCenter > r * 1.02 || (focused != nil && fromCenter < 30 / z.scale) { focus = nil; return }
        let angle = atan2(Double(ly - center.y), Double(lx - center.x))
        if let w = data.wedge(at: angle) {
            Haptic.tap()
            focus = (focus == w.id) ? nil : w.id
        }
    }
}

/// The Home card: compass, the signals that matter, and a strip of sectors.
struct CompassCard: View {
    @Environment(AppModel.self) private var model
    @State private var data = CompassData.empty
    @State private var focus: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ZStack(alignment: .topLeading) {
                CompassView(data: data, focus: $focus, initials: model.myInitials, pings: true) { k in model.open(.person(k)) }
                    .frame(maxWidth: 520)
                    .frame(maxWidth: .infinity)
                if focus != nil {
                    Button {
                        Haptic.tap()
                        focus = nil
                    } label: {
                        Label("Whole network", systemImage: "arrow.down.right.and.arrow.up.left")
                            .font(Theme.geist(.footnote, .semibold))
                            .padding(.horizontal, 12).padding(.vertical, 8)
                    }
                    .buttonStyle(.plain)
                    .glassCapsule()
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
                }
            }
            .overlay(alignment: .topTrailing) {
                if focus == nil {
                    Button {
                        Haptic.tap()
                        model.showShareCard = true
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 15, weight: .semibold))
                            .frame(width: 38, height: 38)
                    }
                    .buttonStyle(.plain)
                    .glassCircle()
                    .accessibilityLabel("Share a picture of your network")
                }
            }
            .animation(.smooth, value: focus)
            if let f = focus, let w = data.wedges.first(where: { $0.id == f }) {
                sectorPanel(w)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            } else {
                signals
            }
            sectors
        }
        .padding(16)
        .card(24)
        .task(id: "\(model.people.count)-\(model.info.lens)-\(model.info.edits)-\(model.info.rev)") {
            data = await model.compass()
        }
    }

    private var signals: some View {
        let t = data.tally
        return FlowLayout(spacing: 8) {
                SignalChip(value: t.w, label: "waiting on you", dot: Theme.amber, glow: true) { model.perform(CardAction(kind: "filter", sig: ["waiting"])) }
                if t.o > 0 {
                    SignalChip(value: t.o, label: "overdue", dot: Theme.violet, ring: true) { model.perform(CardAction(kind: "filter", sig: ["overdue"])) }
                }
                SignalChip(value: t.j, label: "new jobs", dot: Theme.info, ring: true) { model.perform(CardAction(kind: "filter", sig: ["jcw"])) }
                SignalChip(value: t.n, label: "new connections", dot: Theme.accent, ring: true) { model.perform(CardAction(kind: "filter", sig: ["new"])) }
                if data.rel {
                    SignalChip(value: t.close, label: "close", dot: Theme.good) {
                        var f = Filters(); f.rel = ["Close"]
                        model.searchText = ""; model.filters = f; model.paths[.people] = []; model.tab = .people
                    }
                }
        }
    }

    private var sectors: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(data.wedges.sorted { $0.n > $1.n }) { w in
                    Button {
                        Haptic.tap()
                        focus = focus == w.id ? nil : w.id
                    } label: {
                        HStack(spacing: 6) {
                            Circle().fill(Color(hex: w.color)).frame(width: 8, height: 8)
                            Text(w.short).font(Theme.geist(.footnote, .semibold))
                            Text(w.n.formatted()).font(Theme.mono(.footnote)).foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 10).padding(.vertical, 7)
                        .background(focus == w.id ? Color(hex: w.color).opacity(0.22) : Color(.tertiarySystemFill), in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 1)
        }
        .scrollClipDisabled()
    }

    private func sectorPanel(_ w: CompassData.Wedge) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Circle().fill(Color(hex: w.color)).frame(width: 10, height: 10)
                Text(w.id).font(Theme.geist(.title3, .bold))
                Spacer()
                Text(w.n.formatted()).font(Theme.mono(.title3)).foregroundStyle(.secondary)
            }
            Text(sectorLine(w)).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
            HStack {
                Button {
                    var f = Filters()
                    if ["DoD & Military", "Federal Civilian", "State & Local"].contains(w.id) { f.seg = [w.id]; f.ind = [model.constants.gov] } else { f.ind = [w.id] }
                    model.searchText = ""; model.filters = f; model.paths[.people] = []; model.tab = .people
                } label: {
                    Label("See everyone", systemImage: "person.2").frame(maxWidth: .infinity)
                }
                .prominentGlassButton()
                if !["DoD & Military", "Federal Civilian", "State & Local"].contains(w.id) {
                    Button {
                        model.open(.industry(w.id))
                    } label: {
                        Label("Companies", systemImage: "building.2").frame(maxWidth: .infinity)
                    }
                    .glassButton()
                }
            }
            .font(Theme.geist(.subheadline, .semibold))
            Text("Tap a dot to open someone.").font(Theme.geist(.footnote)).foregroundStyle(.tertiary)
        }
    }

    private func sectorLine(_ w: CompassData.Wedge) -> String {
        var parts: [String] = []
        if data.rel { parts.append(w.close == 0 ? "No one close yet" : "\(w.close) close") }
        if w.flagged > 0 { parts.append("\(w.flagged) worth a look now") }
        return parts.isEmpty ? "Closer to the middle means more senior." : parts.joined(separator: ", ") + "."
    }
}

struct SignalChip: View {
    let value: Int
    let label: String
    let dot: Color
    var glow = false
    var ring = false
    let action: () -> Void

    var body: some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            HStack(spacing: 8) {
                ZStack {
                    if glow { Circle().fill(dot.opacity(0.3)).frame(width: 16, height: 16).blur(radius: 2) }
                    if ring { Circle().stroke(dot.opacity(0.5), lineWidth: 1.2).frame(width: 14, height: 14) }
                    Circle().fill(dot).frame(width: 8, height: 8)
                }
                .frame(width: 16, height: 16)
                Text(value.formatted()).font(Theme.mono(.subheadline, .semibold))
                Text(label).font(Theme.geist(.subheadline, .medium)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(Color(.tertiarySystemFill), in: Capsule())
        }
        .buttonStyle(.plain)
        .opacity(value == 0 ? 0.5 : 1)
        .disabled(value == 0)
        .accessibilityLabel("\(value) \(label)")
    }
}
