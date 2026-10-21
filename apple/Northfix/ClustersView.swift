import SwiftUI

/// Constellation of your network: people gather around their company or
/// command, and the groups sit by industry around you in the middle.
/// Pinch to zoom, drag to pan, tap a group to fly in, tap a person to open them.
/// The year slider replays how the network grew.
struct ClustersView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var data: ClustersData?
    @State private var zoom: CGFloat = 1
    @State private var pan: CGSize = .zero
    @GestureState private var pinch: CGFloat = 1
    @GestureState private var drag: CGSize = .zero
    @State private var focus: Int?
    @State private var year: Double = 0
    @State private var playing = false
    @State private var fitScale: CGFloat = 1
    @State private var fitCenter: CGPoint = .zero
    @State private var settle: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("People cluster around their company or command. Pinch to zoom, tap a group to fly in, tap a person to open them.")
                .font(Theme.geist(.footnote)).foregroundStyle(.secondary)
            canvas
                .frame(height: 520)
                .card(18)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(alignment: .topLeading) { focusChip }
            if let d = data, d.maxYear > d.minYear { replay(d) }
            if let i = focus, let d = data, i < d.hubs.count { hubPanel(d.hubs[i]) }
        }
        .task(id: "\(model.people.count)-\(model.info.lens)-\(model.info.edits)") {
            settle = 0
            data = await model.clusters()
            if let d = data { year = Double(d.maxYear) }
            if reduceMotion { settle = 1 } else { withAnimation(.spring(response: 1.1, dampingFraction: 0.78)) { settle = 1 } }
        }
    }

    private var canvas: some View {
        GeometryReader { g in
            let size = g.size
            let scale = fitScale * zoom * pinch
            let offset = CGSize(width: pan.width + drag.width - fitCenter.x * scale, height: pan.height + drag.height - fitCenter.y * scale)
            SettleCanvas(settle: settle) { ctx, sz, t in
                guard let d = data else { return }
                draw(&ctx, d: d, size: sz, scale: scale * (0.12 + 0.88 * t), offset: CGSize(width: offset.width * t, height: offset.height * t), fade: t)
            }
            .contentShape(Rectangle())
            .highPriorityGesture(
                MagnifyGesture()
                    .updating($pinch) { v, s, _ in s = v.magnification }
                    .onEnded { v in zoom = min(12, max(0.5, zoom * v.magnification)) }
                    .simultaneously(with: DragGesture(minimumDistance: 4)
                        .updating($drag) { v, s, _ in s = v.translation }
                        .onEnded { v in pan.width += v.translation.width; pan.height += v.translation.height })
            )
            .onTapGesture { loc in tap(loc, size: size, scale: scale, offset: offset) }
            .onAppear { fitScale = fit(size) }
            .onChange(of: size) { _, s in fitScale = fit(s) }
            .onChange(of: data?.hubs.count) { _, _ in fitScale = fit(size) }
        }
        .accessibilityElement()
        .accessibilityLabel("Clusters of \(data?.people.count ?? 0) people in \(data?.hubs.count ?? 0) groups")
    }

    private func fit(_ size: CGSize) -> CGFloat {
        guard let d = data, !d.hubs.isEmpty else { return 1 }
        var x0 = -60.0, x1 = 60.0, y0 = -60.0, y1 = 60.0
        for h in d.hubs {
            let ext = h.R + 9 * ceil(Double(h.n) / 10) + 20
            x0 = min(x0, h.x - ext); x1 = max(x1, h.x + ext); y0 = min(y0, h.y - ext); y1 = max(y1, h.y + ext)
        }
        fitCenter = CGPoint(x: (x0 + x1) / 2, y: (y0 + y1) / 2)
        return min(size.width / CGFloat(x1 - x0), size.height / CGFloat(y1 - y0)) * 0.96
    }

    private func screen(_ x: Double, _ y: Double, size: CGSize, scale: CGFloat, offset: CGSize) -> CGPoint {
        CGPoint(x: size.width / 2 + CGFloat(x) * scale + offset.width, y: size.height / 2 + CGFloat(y) * scale + offset.height)
    }

    private func visibleCount(_ d: ClustersData, hub i: Int) -> Int {
        let cut = Int(year)
        return d.people.reduce(0) { $0 + ($1.h == i && ($1.y0 == 0 || $1.y0 <= cut) ? 1 : 0) }
    }

    private func draw(_ ctx: inout GraphicsContext, d: ClustersData, size: CGSize, scale: CGFloat, offset: CGSize, fade: CGFloat) {
        ctx.opacity = Double(max(0, min(1, fade * 1.4)))
        let center = screen(0, 0, size: size, scale: scale, offset: offset)
        let cut = Int(year)
        let line = Color.secondary.opacity(scheme == .dark ? 0.22 : 0.18)
        // spokes from you to each group
        var spokes = Path()
        for h in d.hubs { spokes.move(to: center); spokes.addLine(to: screen(h.x, h.y, size: size, scale: scale, offset: offset)) }
        ctx.stroke(spokes, with: .color(line), lineWidth: 0.6)
        // group halos
        for (i, h) in d.hubs.enumerated() {
            let p = screen(h.x, h.y, size: size, scale: scale, offset: offset)
            let r = CGFloat(h.R) * scale
            let c = Color(hex: h.color)
            let halo = Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2))
            ctx.fill(halo, with: .radialGradient(Gradient(colors: [c.opacity(focus == i ? 0.42 : 0.28), c.opacity(0.08)]), center: p, startRadius: 0, endRadius: max(1, r)))
            ctx.stroke(halo, with: .color(c.opacity(focus == i ? 0.8 : 0.35)), lineWidth: focus == i ? 1.5 : 0.8)
        }
        // people, batched by color
        let dotR = max(1.4, min(4.5, 2.2 * scale * 1.4))
        var byColor: [String: Path] = [:]
        var starred = Path()
        for p in d.people where p.y0 == 0 || p.y0 <= cut {
            let s = screen(p.x, p.y, size: size, scale: scale, offset: offset)
            guard s.x > -10, s.y > -10, s.x < size.width + 10, s.y < size.height + 10 else { continue }
            byColor[p.c, default: Path()].addEllipse(in: CGRect(x: s.x - dotR, y: s.y - dotR, width: dotR * 2, height: dotR * 2))
            if p.star { starred.addEllipse(in: CGRect(x: s.x - dotR - 1.5, y: s.y - dotR - 1.5, width: dotR * 2 + 3, height: dotR * 2 + 3)) }
        }
        for (c, path) in byColor { ctx.fill(path, with: .color(Color(hex: c))) }
        ctx.stroke(starred, with: .color(Theme.amber), lineWidth: 1.2)
        // you
        ctx.fill(Path(ellipseIn: CGRect(x: center.x - 7, y: center.y - 7, width: 14, height: 14)), with: .color(Theme.amber))
        ctx.stroke(Path(ellipseIn: CGRect(x: center.x - 11, y: center.y - 11, width: 22, height: 22)), with: .color(Theme.amber.opacity(0.5)), lineWidth: 2)
        // labels for groups big enough to read
        // labels: biggest groups first, skipping any that would overlap one already placed
        var placed: [CGRect] = []
        let order = d.hubs.indices.sorted { d.hubs[$0].n > d.hubs[$1].n }
        for (rank, i) in order.enumerated() {
            let h = d.hubs[i]
            let r = CGFloat(h.R) * scale
            guard rank < 6 || r > 22 || focus == i || scale > 1.8 else { continue }
            let n = visibleCount(d, hub: i)
            guard n > 0 else { continue }
            let p = screen(h.x, h.y, size: size, scale: scale, offset: offset)
            let name = h.name.count > 24 ? String(h.name.prefix(23)) + "…" : h.name
            let label = ctx.resolve(Text(name).font(.custom("Geist-SemiBold", fixedSize: 11)).foregroundStyle(.primary)
                + Text("  \(n)").font(.custom("GeistMono-Medium", fixedSize: 10)).foregroundStyle(.secondary))
            let ts = label.measure(in: CGSize(width: 240, height: 30))
            let anchor = CGPoint(x: p.x, y: p.y - r - 8)
            let rect = CGRect(x: anchor.x - ts.width / 2 - 8, y: anchor.y - ts.height - 5, width: ts.width + 16, height: ts.height + 8)
            if focus != i && placed.contains(where: { $0.insetBy(dx: -4, dy: -3).intersects(rect) }) { continue }
            placed.append(rect)
            ctx.fill(Path(roundedRect: rect, cornerRadius: rect.height / 2), with: .color(Color(.systemBackground).opacity(scheme == .dark ? 0.75 : 0.88)))
            ctx.stroke(Path(roundedRect: rect, cornerRadius: rect.height / 2), with: .color(Color(hex: h.color).opacity(0.5)), lineWidth: 1)
            ctx.draw(label, at: CGPoint(x: rect.midX, y: rect.midY), anchor: .center)
        }
    }

    private func tap(_ loc: CGPoint, size: CGSize, scale: CGFloat, offset: CGSize) {
        guard let d = data else { return }
        // a person, when zoomed in enough to tell them apart
        if scale > 0.9 {
            var best: String?
            var bestDist: CGFloat = 14
            for p in d.people where p.y0 == 0 || p.y0 <= Int(year) {
                let s = screen(p.x, p.y, size: size, scale: scale, offset: offset)
                let dist = hypot(s.x - loc.x, s.y - loc.y)
                if dist < bestDist { bestDist = dist; best = p.k }
            }
            if let k = best { Haptic.tap(); model.open(.person(k)); return }
        }
        // otherwise a group
        for (i, h) in d.hubs.enumerated() {
            let p = screen(h.x, h.y, size: size, scale: scale, offset: offset)
            let reach = (CGFloat(h.R) + 9 * CGFloat(ceil(Double(h.n) / 10)) + 10) * scale
            if hypot(p.x - loc.x, p.y - loc.y) < max(reach, 22) { fly(to: i, d: d, size: size); return }
        }
    }

    private func fly(to i: Int, d: ClustersData, size: CGSize) {
        Haptic.tap()
        let h = d.hubs[i]
        let span = (CGFloat(h.R) + 9 * CGFloat(ceil(Double(h.n) / 10)) + 40) * 2
        let target = min(6, min(size.width, size.height) / span)
        withAnimation(reduceMotion ? nil : .smooth(duration: 0.55)) {
            focus = i
            zoom = target / fitScale
            pan = CGSize(width: -(CGFloat(h.x) - fitCenter.x) * target, height: -(CGFloat(h.y) - fitCenter.y) * target)
        }
    }

    @ViewBuilder private var focusChip: some View {
        if focus != nil || zoom != 1 || pan != .zero {
            Button {
                withAnimation(.smooth(duration: 0.5)) { focus = nil; zoom = 1; pan = .zero }
            } label: {
                Label("Whole network", systemImage: "arrow.down.right.and.arrow.up.left")
                    .font(Theme.geist(.footnote, .semibold))
                    .padding(.horizontal, 10).padding(.vertical, 6)
            }
            .buttonStyle(.plain)
            .glassCapsule()
            .padding(10)
        }
    }

    private func replay(_ d: ClustersData) -> some View {
        HStack(spacing: 12) {
            Button {
                playing ? (playing = false) : startReplay(d)
            } label: {
                Image(systemName: playing ? "pause.fill" : "play.fill").frame(width: 22)
            }
            .buttonStyle(.bordered)
            .accessibilityLabel(playing ? "Pause" : "Replay how your network grew")
            Slider(value: $year, in: Double(d.minYear)...Double(d.maxYear), step: 1)
            Text(String(Int(year))).font(.callout.monospacedDigit().weight(.semibold)).frame(width: 44)
        }
    }

    private func startReplay(_ d: ClustersData) {
        playing = true
        year = Double(d.minYear)
        Task { @MainActor in
            while playing && Int(year) < d.maxYear {
                try? await Task.sleep(nanoseconds: 650_000_000)
                guard playing else { break }
                withAnimation(.easeInOut(duration: 0.4)) { year += 1 }
            }
            playing = false
        }
    }

    private func hubPanel(_ h: ClustersData.Hub) -> some View {
        HStack {
            Circle().fill(Color(hex: h.color)).frame(width: 10, height: 10)
            VStack(alignment: .leading, spacing: 2) {
                Text(h.name).font(Theme.geist(.body, .semibold))
                Text("\(h.n.formatted()) \(h.n == 1 ? "person" : "people") · \(h.seg)").font(Theme.geist(.footnote)).foregroundStyle(.secondary)
            }
            Spacer()
            if !h.other {
                Button("Open") { model.open(.unit(h.name)) }.buttonStyle(.borderedProminent)
            }
        }
        .padding(14)
        .card(18)
    }
}

/// A canvas that SwiftUI can animate through `settle`, so the clusters bloom outward from you.
struct SettleCanvas: View, Animatable {
    var settle: CGFloat
    let render: (inout GraphicsContext, CGSize, CGFloat) -> Void

    var animatableData: CGFloat {
        get { settle }
        set { settle = newValue }
    }

    var body: some View {
        Canvas { ctx, size in render(&ctx, size, settle) }
    }
}
