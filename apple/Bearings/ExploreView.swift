import SwiftUI

struct ExploreView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("exploreMode") private var mode = "compass"
    @State private var radar = RadarData.empty
    @State private var ranks: RanksData?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Picker("View", selection: $mode) {
                    Text("Compass").tag("compass")
                    Text("Scope").tag("scope")
                    Text("Clusters").tag("clusters")
                    Text("Map").tag("map")
                    if model.info.lens { Text("Ranks").tag("ranks") }
                }
                .pickerStyle(.segmented)
                if mode == "compass" {
                    CompassCard()
                } else if mode == "ranks" && model.info.lens {
                    RanksGrid(data: ranks)
                } else if mode == "clusters" {
                    ClustersView()
                } else if mode == "map" {
                    PeopleMapView()
                } else {
                    Text("More senior people sit closer to the middle. Tap a dot to open someone.")
                        .font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                    RadarView(data: radar) { k in model.open(.person(k)) }
                        .aspectRatio(1, contentMode: .fit)
                        .frame(maxWidth: 640)
                        .frame(maxWidth: .infinity)
                    legend
                }
            }
            .padding(16)
        }
        .background(Theme.bg)
        .navigationTitle("Explore")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(model.people.count)-\(model.info.lens)-\(model.info.edits)-\(mode)") {
            if mode == "ranks" { ranks = await model.ranks() } else if mode == "scope" { radar = await model.radar() }
        }
    }

    private var legend: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(radar.wedges.sorted { $0.n > $1.n }) { w in
                Button {
                    var f = Filters()
                    if ["DoD & Military", "Federal Civilian", "State & Local"].contains(w.id) {
                        f.seg = [w.id]; f.ind = [model.constants.gov]
                    } else { f.ind = [w.id] }
                    model.searchText = ""; model.filters = f; model.paths[.people] = []; model.tab = .people
                } label: {
                    HStack {
                        Circle().fill(Color(hex: w.color)).frame(width: 10, height: 10)
                        Text(w.id).foregroundStyle(.primary)
                        Spacer()
                        Text(w.n.formatted()).foregroundStyle(.secondary).monospacedDigit()
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                    .padding(.vertical, 10)
                    .padding(.horizontal, 14)
                }
                .buttonStyle(.plain)
                Divider().padding(.leading, 38)
            }
        }
        .card(18)
    }
}

struct RadarView: View {
    let data: RadarData
    let onTap: (String) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        GeometryReader { g in
            let size = min(g.size.width, g.size.height)
            let r: CGFloat = size / 2 - 8
            let center = CGPoint(x: g.size.width / 2, y: g.size.height / 2)
            let dotPaths = paths(center: center, r: r)
            TimelineView(.animation(paused: reduceMotion)) { tl in
                let sweep = sweepAngle(tl.date)
                Canvas { ctx, _ in
                    draw(&ctx, center: center, r: r, sweep: sweep, dots: dotPaths)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { loc in tap(loc, center: center, r: r) }
        }
        .accessibilityElement()
        .accessibilityLabel("Scope of \(data.dots.count) people in \(data.wedges.count) groups")
    }

    private func sweepAngle(_ date: Date) -> Double {
        if reduceMotion { return -Double.pi / 2 }
        let t = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 6) / 6
        return t * 2 * Double.pi - Double.pi / 2
    }

    private func point(_ center: CGPoint, _ angle: Double, _ radius: CGFloat) -> CGPoint {
        CGPoint(x: center.x + CGFloat(cos(angle)) * radius, y: center.y + CGFloat(sin(angle)) * radius)
    }

    private func draw(_ ctx: inout GraphicsContext, center: CGPoint, r: CGFloat, sweep: Double, dots: [(Color, Path)]) {
        let line = Color.secondary.opacity(0.25)
        let last = data.bands.count - 1
        for (i, b) in data.bands.enumerated() where i > 0 {
            let rr = r * CGFloat(b)
            let path = Path(ellipseIn: CGRect(x: center.x - rr, y: center.y - rr, width: rr * 2, height: rr * 2))
            let dash: [CGFloat] = i == last ? [] : [2, 5]
            ctx.stroke(path, with: .color(i == last ? Color.secondary.opacity(0.4) : line), style: StrokeStyle(lineWidth: 1, dash: dash))
        }
        for w in data.wedges {
            var p = Path()
            p.move(to: point(center, w.a0, r * 0.15))
            p.addLine(to: point(center, w.a0, r))
            ctx.stroke(p, with: .color(line), lineWidth: 1)
        }
        if !reduceMotion {
            var wedge = Path()
            wedge.move(to: center)
            wedge.addArc(center: center, radius: r, startAngle: .radians(sweep - 0.8), endAngle: .radians(sweep), clockwise: false)
            wedge.closeSubpath()
            let strength: Double = scheme == .dark ? 0.16 : 0.2
            let gradient = Gradient(colors: [Theme.amber.opacity(0), Theme.amber.opacity(strength)])
            ctx.fill(wedge, with: .linearGradient(gradient, startPoint: point(center, sweep - 0.8, r), endPoint: point(center, sweep, r)))
            var arm = Path()
            arm.move(to: center)
            arm.addLine(to: point(center, sweep, r))
            ctx.stroke(arm, with: .color(Theme.amber.opacity(0.85)), lineWidth: 1.5)
        }
        for (color, path) in dots { ctx.fill(path, with: .color(color)) }
    }

    private func tap(_ loc: CGPoint, center: CGPoint, r: CGFloat) {
        var best: String?
        var bestDist: CGFloat = 18
        for d in data.dots {
            let pt = CGPoint(x: center.x + CGFloat(d.x) * r, y: center.y + CGFloat(d.y) * r)
            let dist = hypot(pt.x - loc.x, pt.y - loc.y)
            if dist < bestDist { bestDist = dist; best = d.k }
        }
        if let k = best { Haptic.tap(); onTap(k) }
    }
}

extension RadarView {
    func paths(center: CGPoint, r: CGFloat) -> [(Color, Path)] {
        let base: CGFloat = data.dots.count > 2500 ? 2.2 : data.dots.count > 900 ? 2.8 : 3.5
        var byColor: [String: Path] = [:]
        for d in data.dots {
            let pt = CGPoint(x: center.x + CGFloat(d.x) * r, y: center.y + CGFloat(d.y) * r)
            let s = d.big ? base * 1.6 : base
            byColor[d.c, default: Path()].addEllipse(in: CGRect(x: pt.x - s, y: pt.y - s, width: s * 2, height: s * 2))
        }
        return byColor.map { (Color(hex: $0.key), $0.value) }
    }
}

struct RanksGrid: View {
    @Environment(AppModel.self) private var model
    let data: RanksData?

    var body: some View {
        if let d = data {
            ScrollView(.horizontal) {
                Grid(alignment: .trailing, horizontalSpacing: 6, verticalSpacing: 6) {
                    GridRow {
                        Text("Tier").gridColumnAlignment(.leading).font(.caption.weight(.semibold))
                        ForEach(d.branches, id: \.self) { b in
                            Text(b.replacingOccurrences(of: " / ", with: "/")).font(.caption2.weight(.semibold)).frame(width: 54).multilineTextAlignment(.center)
                        }
                        Text("Total").font(.caption.weight(.semibold))
                    }
                    ForEach(d.rows) { row in
                        GridRow {
                            VStack(alignment: .leading, spacing: 0) {
                                Text(row.tier).font(.caption.weight(.semibold))
                                if !row.sub.isEmpty { Text(row.sub).font(.caption2).foregroundStyle(.secondary) }
                            }
                            .gridColumnAlignment(.leading)
                            ForEach(Array(row.cells.enumerated()), id: \.offset) { i, n in
                                Button {
                                    var f = Filters(); f.tier = [row.tier]; f.branch = [d.branches[i]]
                                    model.searchText = ""; model.filters = f; model.paths[.people] = []; model.tab = .people
                                } label: {
                                    Text(n > 0 ? n.formatted() : "·")
                                        .font(.callout.monospacedDigit().weight(n > 0 ? .semibold : .regular))
                                        .frame(width: 54, height: 34)
                                        .background(Theme.accent.opacity(n > 0 ? 0.12 + 0.7 * sqrt(Double(n) / Double(max(1, d.max))) : 0.04), in: RoundedRectangle(cornerRadius: 7))
                                        .foregroundStyle(n > 0 ? .primary : .tertiary)
                                }
                                .buttonStyle(.plain)
                                .disabled(n == 0)
                            }
                            Text(row.total.formatted()).font(.callout.monospacedDigit())
                        }
                    }
                    GridRow {
                        Text("Total").font(.caption.weight(.semibold)).gridColumnAlignment(.leading)
                        ForEach(Array(d.totals.enumerated()), id: \.offset) { _, n in Text(n.formatted()).font(.callout.monospacedDigit()).frame(width: 54) }
                        Text(d.total.formatted()).font(.callout.monospacedDigit().weight(.semibold))
                    }
                }
                .padding()
            }
            .card(18)
        } else {
            ProgressView().frame(maxWidth: .infinity)
        }
    }
}
