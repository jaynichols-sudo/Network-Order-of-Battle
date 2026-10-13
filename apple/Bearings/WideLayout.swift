import SwiftUI

// Layout for big windows: the Mac, and iPad in landscape. Screens built for the phone become
// two columns side by side instead of one narrow strip in the middle of a wide window.

enum Wide {
    /// Below this width a screen keeps its single phone column.
    static let threshold: CGFloat = 800
    /// How wide a two-column page gets before it centers.
    static let page: CGFloat = 1240
    /// The gap between columns.
    static let gutter: CGFloat = 20
    /// The width of the single phone column.
    static let narrow: CGFloat = 680

    /// From this width, People, Companies and You show their list and the open item side by side.
    static let splitThreshold: CGFloat = 880
    /// The list pane in that layout.
    static func listWidth(_ total: CGFloat) -> CGFloat { min(440, max(340, (total * 0.36).rounded())) }
    /// Today goes to three columns from here.
    static let threeColumns: CGFloat = 1180
    /// How wide the three-column Today gets before it centers.
    static let wide: CGFloat = 2600
    /// Four columns on Today from here.
    static let fourColumns: CGFloat = 1640

    /// The page width to use for a window this wide.
    static func pageWidth(_ window: CGFloat) -> CGFloat { window >= threshold ? page : narrow }
}

extension View {
    /// Keeps `width` set to this view's width, for choosing between one column and two.
    func readWidth(_ width: Binding<CGFloat>) -> some View {
        onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width.wrappedValue = $0 }
    }

    /// Larger type on the Mac, where the iPad-scaled interface otherwise reads small.
    @ViewBuilder func macTextSize() -> some View {
        #if targetEnvironment(macCatalyst)
        dynamicTypeSize(.xxLarge)
        #else
        self
        #endif
    }
}

/// Two columns on a wide window, one on a phone. In one column, `primary` comes first.
struct AdaptiveColumns<Primary: View, Secondary: View>: View {
    var width: CGFloat
    var ratio: CGFloat = 0.56
    var spacing: CGFloat = 12
    @ViewBuilder var primary: Primary
    @ViewBuilder var secondary: Secondary

    var body: some View {
        if width >= Wide.threshold {
            TwoColumns(ratio: ratio, gutter: Wide.gutter) {
                VStack(alignment: .leading, spacing: spacing) { primary }
                VStack(alignment: .leading, spacing: spacing) { secondary }
            }
        } else {
            VStack(alignment: .leading, spacing: spacing) {
                primary
                secondary
            }
        }
    }
}

/// Splits the width it's offered between two columns, top-aligned. Working from the offered
/// width, rather than a measured one, means the columns can never run past the window.
struct TwoColumns: Layout {
    var ratio: CGFloat
    var gutter: CGFloat

    private func widths(_ total: CGFloat) -> (CGFloat, CGFloat) {
        let usable = max(0, total - gutter)
        let left = (usable * ratio).rounded()
        return (left, usable - left)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let total = proposal.width ?? Wide.page
        let (l, r) = widths(total)
        var h: CGFloat = 0
        for (view, w) in zip(subviews, [l, r]) {
            h = max(h, view.sizeThatFits(ProposedViewSize(width: w, height: nil)).height)
        }
        return CGSize(width: total, height: h)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let (l, r) = widths(bounds.width)
        var x = bounds.minX
        for (view, w) in zip(subviews, [l, r]) {
            view.place(at: CGPoint(x: x, y: bounds.minY), anchor: .topLeading, proposal: ProposedViewSize(width: w, height: nil))
            x += w + gutter
        }
    }
}

/// Splits the offered width into columns by `ratios`, top-aligned, like TwoColumns.
struct Columns: Layout {
    var ratios: [CGFloat]
    var gutter: CGFloat = Wide.gutter

    private func widths(_ total: CGFloat) -> [CGFloat] {
        let usable = max(0, total - gutter * CGFloat(max(0, ratios.count - 1)))
        let sum = ratios.reduce(0, +)
        return ratios.map { (usable * $0 / max(sum, 0.0001)).rounded(.down) }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let total = proposal.width ?? Wide.wide
        let ws = widths(total)
        var h: CGFloat = 0
        for (view, w) in zip(subviews, ws) {
            h = max(h, view.sizeThatFits(ProposedViewSize(width: w, height: nil)).height)
        }
        return CGSize(width: total, height: h)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        for (view, w) in zip(subviews, widths(bounds.width)) {
            view.place(at: CGPoint(x: x, y: bounds.minY), anchor: .topLeading, proposal: ProposedViewSize(width: w, height: nil))
            x += w + gutter
        }
    }
}

/// Cards flow into whichever column is shortest, like a Pinterest board, so a wide window
/// has no empty column when some cards have nothing to show. Cards with no content take no room.
struct Masonry: Layout {
    var columns: Int
    var spacing: CGFloat = 14
    var gutter: CGFloat = Wide.gutter

    private func columnWidth(_ total: CGFloat) -> CGFloat {
        let n = CGFloat(max(1, columns))
        return ((total - gutter * (n - 1)) / n).rounded(.down)
    }

    private func arrange(_ total: CGFloat, _ subviews: Subviews) -> (points: [CGPoint?], height: CGFloat) {
        let w = columnWidth(total)
        var heights = Array(repeating: CGFloat(0), count: max(1, columns))
        var points: [CGPoint?] = []
        for view in subviews {
            let h = view.sizeThatFits(ProposedViewSize(width: w, height: nil)).height
            guard h >= 1 else { points.append(nil); continue }
            let c = heights.indices.min { heights[$0] < heights[$1] } ?? 0
            points.append(CGPoint(x: CGFloat(c) * (w + gutter), y: heights[c]))
            heights[c] += h + spacing
        }
        return (points, max(0, (heights.max() ?? 0) - spacing))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let total = proposal.width ?? Wide.wide
        return CGSize(width: total, height: arrange(total, subviews).height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let w = columnWidth(bounds.width)
        let points = arrange(bounds.width, subviews).points
        for (view, p) in zip(subviews, points) {
            let at = p.map { CGPoint(x: bounds.minX + $0.x, y: bounds.minY + $0.y) } ?? CGPoint(x: bounds.minX, y: bounds.minY)
            view.place(at: at, anchor: .topLeading, proposal: ProposedViewSize(width: w, height: nil))
        }
    }
}
