import SwiftUI

// Layout for big windows: the Mac, and iPad in landscape. Screens built for the phone become
// two columns side by side instead of one narrow strip in the middle of a wide window.

enum Wide {
    /// Below this width a screen keeps its single phone column.
    static let threshold: CGFloat = 860
    /// How wide a two-column page gets before it centers.
    static let page: CGFloat = 1240
    /// The gap between columns.
    static let gutter: CGFloat = 20
    /// The width of the single phone column.
    static let narrow: CGFloat = 680

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
            let usable = min(width, Wide.page) - 32 - Wide.gutter
            HStack(alignment: .top, spacing: Wide.gutter) {
                VStack(alignment: .leading, spacing: spacing) { primary }
                    .frame(width: usable * ratio)
                VStack(alignment: .leading, spacing: spacing) { secondary }
                    .frame(width: usable * (1 - ratio))
            }
        } else {
            VStack(alignment: .leading, spacing: spacing) {
                primary
                secondary
            }
        }
    }
}
