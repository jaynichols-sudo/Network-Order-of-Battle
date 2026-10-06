import SwiftUI

/// "Calm cards" on the watch (docs/design-c.md): the dark palette only, since watchOS is
/// always dark. System rounded type, because the Geist fonts aren't bundled with the watch app.
enum WatchTheme {
    static let bg = rgb(0x0D0A17)
    static let card = rgb(0x17132A)
    static let card2 = rgb(0x221C38)
    static let text = rgb(0xF2EEFF)
    static let text2 = rgb(0x9C95B8)
    static let text3 = rgb(0x6F6890)
    static let soft = rgb(0x2A2440)
    /// Main accent in dark mode, and the "waiting on you" color.
    static let amber = rgb(0xFFB020)
    static let onAmber = rgb(0x1B1830)
    static let needsSoft = rgb(0x3A2C12)
    static let good = rgb(0x3DD4A3)
    static let info = rgb(0x7EA6FF)
    static let violet = rgb(0xA992FF)

    static func rgb(_ hex: UInt32) -> Color {
        Color(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255, opacity: 1)
    }

    static func font(_ style: Font.TextStyle, _ weight: Font.Weight = .regular) -> Font {
        Font.system(style, design: .rounded).weight(weight)
    }

    /// The rounded card behind a list row.
    static var rowCard: some View {
        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(card)
    }
}

extension View {
    /// A rounded night-purple card for content outside a list.
    func watchCard(padding: CGFloat = 10, fill: Color = WatchTheme.card) -> some View {
        self
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
