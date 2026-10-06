import SwiftUI
import WidgetKit

/// "Calm cards" tokens for the widget extension (docs/design-c.md). The app's `Theme`
/// lives in the main app target only, so the widgets keep their own copy of the values.
enum Calm {
    struct Tokens {
        let bg: Color
        let card: Color
        let card2: Color
        let line: Color
        let text: Color
        let text2: Color
        let text3: Color
        let primary: Color
        let onPrimary: Color
        let soft: Color
        let needs: Color
        let needsSoft: Color
        let good: Color
        let goodSoft: Color
    }

    static let light = Tokens(
        bg: rgb(0xF3F3F6), card: rgb(0xFFFFFF), card2: rgb(0xF3F3F6), line: rgb(0xF0EFF4),
        text: rgb(0x1A1726), text2: rgb(0x7A7590), text3: rgb(0x9A96AC),
        primary: rgb(0x2A2448), onPrimary: rgb(0xFFFFFF), soft: rgb(0xEEEDF4),
        needs: rgb(0xC77700), needsSoft: rgb(0xFFF1D6), good: rgb(0x227A66), goodSoft: rgb(0xE4F3EE))

    static let dark = Tokens(
        bg: rgb(0x0D0A17), card: rgb(0x17132A), card2: rgb(0x221C38), line: rgb(0x26203A),
        text: rgb(0xF2EEFF), text2: rgb(0x9C95B8), text3: rgb(0x6F6890),
        primary: rgb(0xFFB020), onPrimary: rgb(0x1B1830), soft: rgb(0x2A2440),
        needs: rgb(0xFFB020), needsSoft: rgb(0x3A2C12), good: rgb(0x3DD4A3), goodSoft: rgb(0x173A33))

    static func tokens(_ scheme: ColorScheme) -> Tokens { scheme == .dark ? dark : light }

    static func rgb(_ hex: UInt32) -> Color {
        Color(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255, opacity: 1)
    }

    /// Geist (bundled with the widget extension), scaling with Dynamic Type.
    static func font(_ size: CGFloat, _ weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        let name: String
        switch weight {
        case .bold, .heavy, .black: name = "Geist-Bold"
        case .semibold: name = "Geist-SemiBold"
        case .medium: name = "Geist-Medium"
        default: name = "Geist-Regular"
        }
        return Font.custom(name, size: size, relativeTo: style)
    }

    /// Geist Mono for figures.
    static func mono(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        Font.custom("GeistMono-SemiBold", size: size, relativeTo: style)
    }

    /// "Five people to get back to" (replies and follow-ups due), spelled out up to ten.
    static func needLine(_ n: Int) -> String {
        if n <= 0 { return "You’re all caught up." }
        if n == 1 { return "One person to get back to." }
        let words = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"]
        return "\(n < words.count ? words[n] : n.formatted()) people to get back to."
    }

    static func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").filter { !$0.isEmpty }
        let first = parts.first?.first.map { String($0) } ?? ""
        let last = parts.count > 1 ? (parts.last?.first.map { String($0) } ?? "") : ""
        return (first + last).uppercased()
    }
}

extension View {
    /// An inner card on the widget's gray (or night) background.
    func calmCard(_ t: Calm.Tokens, radius: CGFloat = 16) -> some View {
        modifier(CalmCard(t: t, radius: radius))
    }
}

struct CalmCard: ViewModifier {
    let t: Calm.Tokens
    let radius: CGFloat
    @Environment(\.widgetRenderingMode) private var mode

    func body(content: Content) -> some View {
        // In tinted or clear Home Screen modes a solid white card would turn into a bright
        // block, so it becomes a faint panel instead.
        content.background(mode == .fullColor ? t.card : t.text.opacity(0.1),
                           in: RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

/// The widget's container background: light gray by day, night purple in dark mode.
struct CalmWidgetBackground: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Calm.tokens(scheme).bg
    }
}
