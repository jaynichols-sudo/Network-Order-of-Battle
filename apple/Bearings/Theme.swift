import SwiftUI
import UIKit

extension Color {
    init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        var v: UInt64 = 0
        Scanner(string: String(s.prefix(6))).scanHexInt64(&v)
        self.init(.sRGB, red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255, opacity: 1)
    }

    /// A color that switches between light and dark appearance.
    static func dynamic(_ light: String, _ dark: String) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(Color(hex: dark)) : UIColor(Color(hex: light)) })
    }
}

enum Theme {
    static let accent = Color.dynamic("#E89A00", "#FFB52E")
    static let amber = Color(hex: "#FFB020")
    static let good = Color.dynamic("#11946F", "#3DD4A3")
    static let bad = Color.dynamic("#D9434A", "#FF7A7F")
    static let info = Color.dynamic("#3E6FE8", "#7EA6FF")
    static let violet = Color.dynamic("#7556E8", "#A992FF")
    static let plum = Color(hex: "#2A2448")

    static func tone(_ t: String) -> Color {
        switch t {
        case "coral": return bad
        case "violet": return violet
        case "sky": return info
        case "green": return good
        default: return accent
        }
    }

    static func coverage(_ score: Int) -> Color { score >= 75 ? good : score >= 45 ? accent : bad }

    // Geist for the brand voice, with Dynamic Type so text still scales with the
    // reader's settings.
    static func geist(_ style: Font.TextStyle, _ weight: Font.Weight = .regular) -> Font {
        let size: CGFloat
        switch style {
        case .largeTitle: size = 34
        case .title: size = 28
        case .title2: size = 22
        case .title3: size = 20
        case .headline: size = 17
        case .subheadline: size = 15
        case .callout: size = 16
        case .footnote: size = 13
        case .caption: size = 12
        case .caption2: size = 11
        default: size = 17
        }
        return Font.custom(name(for: style == .headline && weight == .regular ? .semibold : weight), size: size, relativeTo: style)
    }

    static func name(for weight: Font.Weight) -> String {
        switch weight {
        case .bold, .heavy, .black: return "Geist-Bold"
        case .semibold: return "Geist-SemiBold"
        case .medium: return "Geist-Medium"
        default: return "Geist-Regular"
        }
    }

    static func configureAppearance() {
        let metrics = UIFontMetrics(forTextStyle: .largeTitle)
        let nav = UINavigationBar.appearance()
        if let big = UIFont(name: "Geist-Bold", size: 34) {
            nav.largeTitleTextAttributes = [.font: metrics.scaledFont(for: big)]
        }
        if let small = UIFont(name: "Geist-SemiBold", size: 17) {
            nav.titleTextAttributes = [.font: UIFontMetrics(forTextStyle: .headline).scaledFont(for: small)]
        }
    }
}

extension View {
    func geist(_ style: Font.TextStyle, _ weight: Font.Weight = .regular) -> some View {
        font(Theme.geist(style, weight))
    }
}

/// Round initials badge tinted by the person's group.
struct Avatar: View {
    let person: Person
    var size: CGFloat = 40

    var body: some View {
        ZStack {
            Circle().fill(person.tint.opacity(0.18))
            Text(person.initials)
                .font(Theme.geist(.subheadline, .semibold))
                .foregroundStyle(person.tint)
                .minimumScaleFactor(0.5)
        }
        .frame(width: size, height: size)
        .overlay(alignment: .bottomTrailing) {
            if person.starred {
                Image(systemName: "star.fill")
                    .font(.system(size: size * 0.26, weight: .bold))
                    .foregroundStyle(Theme.amber)
                    .padding(2)
                    .background(Circle().fill(Color(.systemBackground)))
                    .offset(x: 3, y: 3)
            }
        }
        .accessibilityHidden(true)
    }
}

/// Coverage ring with the score in the middle.
struct CoverageRing: View {
    let score: Int
    var size: CGFloat = 52
    @State private var shown: Double = 0

    var body: some View {
        ZStack {
            Circle().stroke(Color(.tertiarySystemFill), lineWidth: size * 0.11)
            Circle()
                .trim(from: 0, to: shown)
                .stroke(Theme.coverage(score), style: StrokeStyle(lineWidth: size * 0.11, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(score)")
                .font(.system(size: size * 0.3, weight: .semibold, design: .rounded))
                .monospacedDigit()
        }
        .frame(width: size, height: size)
        .onAppear { withAnimation(.easeOut(duration: 0.7)) { shown = Double(score) / 100 } }
        .onChange(of: score) { _, v in withAnimation(.easeOut(duration: 0.5)) { shown = Double(v) / 100 } }
        .accessibilityElement()
        .accessibilityLabel("Coverage \(score) percent")
    }
}

/// A row of overlapping avatars.
struct AvatarStack: View {
    let people: [Person]
    var size: CGFloat = 28

    var body: some View {
        HStack(spacing: -size * 0.3) {
            ForEach(people.prefix(5)) { p in
                Avatar(person: p, size: size)
                    .background(Circle().fill(Color(.secondarySystemGroupedBackground)).padding(-2))
            }
            if people.count > 5 {
                Text("+\(people.count - 5)")
                    .font(.caption2.weight(.semibold))
                    .frame(width: size, height: size)
                    .background(Circle().fill(Color(.tertiarySystemFill)))
            }
        }
    }
}

/// Seniority mix as a thin stacked bar (exec, director, manager, staff).
struct MixBar: View {
    let mix: [Int]

    var body: some View {
        let parts = Array(mix.dropFirst().prefix(4))
        let total = max(1, parts.reduce(0, +))
        let colors: [Color] = [Theme.violet, Theme.violet.opacity(0.55), Theme.accent, Color(.systemGray4)]
        GeometryReader { g in
            HStack(spacing: 1) {
                ForEach(Array(parts.enumerated()), id: \.offset) { i, n in
                    if n > 0 {
                        Rectangle().fill(colors[i]).frame(width: g.size.width * CGFloat(n) / CGFloat(total))
                    }
                }
            }
        }
        .frame(height: 5)
        .clipShape(Capsule())
        .accessibilityHidden(true)
    }
}

enum Haptic {
    private static var on: Bool { UserDefaults.standard.object(forKey: "haptics") as? Bool ?? true }
    static func tap() { if on { UIImpactFeedbackGenerator(style: .light).impactOccurred() } }
    static func star() { if on { UIImpactFeedbackGenerator(style: .medium).impactOccurred() } }
    static func success() { if on { UINotificationFeedbackGenerator().notificationOccurred(.success) } }
}

enum AppInfo {
    /// Where "Contact support" sends email. Change this once there's a dedicated support inbox.
    static let supportEmail = "support@jaynichols.net"
}
