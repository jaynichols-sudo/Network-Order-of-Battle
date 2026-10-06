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

    // "Calm cards" (docs/design-c.md): light gray screens with white cards, the
    // brand's deep plum for main actions; dark keeps the night-sky purple and amber.
    static let bg = Color.dynamic("#F3F3F6", "#0D0A17")
    static let card = Color.dynamic("#FFFFFF", "#17132A")
    static let card2 = Color.dynamic("#F3F3F6", "#221C38")
    static let line = Color.dynamic("#F0EFF4", "#26203A")
    static let text2 = Color.dynamic("#7A7590", "#9C95B8")
    static let text3 = Color.dynamic("#9A96AC", "#6F6890")
    static let primary = Color.dynamic("#2A2448", "#FFB020")
    static let onPrimary = Color.dynamic("#FFFFFF", "#1B1830")
    static let soft = Color.dynamic("#EEEDF4", "#2A2440")
    static let needs = Color.dynamic("#C77700", "#FFB020")
    static let needsSoft = Color.dynamic("#FFF1D6", "#3A2C12")
    static let goodSoft = Color.dynamic("#E4F3EE", "#173A33")
    static let infoSoft = Color.dynamic("#E9EFF9", "#1E2638")

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

    /// Geist Mono for figures, so numbers read as data and line up.
    static func mono(_ style: Font.TextStyle, _ weight: Font.Weight = .medium) -> Font {
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
        let heavy = weight == .semibold || weight == .bold || weight == .heavy || weight == .black
        return Font.custom(heavy ? "GeistMono-SemiBold" : "GeistMono-Medium", size: size, relativeTo: style)
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
    /// Liquid Glass on iOS 26 and later, a material elsewhere.
    @ViewBuilder func glassCapsule(tint: Color? = nil) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(tint.map { Glass.regular.tint($0.opacity(0.35)).interactive() } ?? Glass.regular.interactive(), in: Capsule())
        } else {
            self.background(.regularMaterial, in: Capsule())
        }
    }

    @ViewBuilder func glassCircle(tint: Color? = nil) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(tint.map { Glass.regular.tint($0).interactive() } ?? Glass.regular.interactive(), in: Circle())
        } else {
            self.background(Circle().fill(tint ?? Color(.tertiarySystemFill)))
        }
    }

    @ViewBuilder func glassButton() -> some View {
        if #available(iOS 26.0, *) { self.buttonStyle(.glass) } else { self.buttonStyle(.bordered) }
    }

    @ViewBuilder func prominentGlassButton() -> some View {
        if #available(iOS 26.0, *) { self.buttonStyle(.glassProminent) } else { self.buttonStyle(.borderedProminent) }
    }

    /// A white card on the gray screen: rounded, with a soft shadow in light mode and a hairline in dark.
    func card(_ radius: CGFloat = 20, padding: CGFloat? = nil) -> some View {
        modifier(CardStyle(radius: radius, padding: padding))
    }

    func geist(_ style: Font.TextStyle, _ weight: Font.Weight = .regular) -> some View {
        font(Theme.geist(style, weight))
    }
}

struct CardStyle: ViewModifier {
    let radius: CGFloat
    let padding: CGFloat?
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .padding(padding ?? 0)
            .background(Theme.card, in: shape)
            .overlay(shape.strokeBorder(Color.white.opacity(scheme == .dark ? 0.06 : 0), lineWidth: 1))
            .shadow(color: Color(red: 20/255, green: 16/255, blue: 40/255).opacity(scheme == .dark ? 0 : 0.05), radius: 1, y: 1)
            .shadow(color: Color(red: 20/255, green: 16/255, blue: 40/255).opacity(scheme == .dark ? 0 : 0.05), radius: 10, y: 6)
    }
}

/// A rounded pill button: primary (filled), soft (tinted), or done (green).
struct PillButtonStyle: ButtonStyle {
    enum Kind { case primary, soft, done, plain }
    var kind: Kind = .soft

    func makeBody(configuration: Configuration) -> some View {
        let (bg, fg): (Color, Color) = {
            switch kind {
            case .primary: return (Theme.primary, Theme.onPrimary)
            case .soft: return (Theme.soft, Theme.primary)
            case .done: return (Theme.goodSoft, Theme.good)
            case .plain: return (Theme.card, .primary)
            }
        }()
        configuration.label
            .font(Theme.geist(.footnote, .semibold))
            .lineLimit(1)
            .padding(.horizontal, 14)
            .frame(minHeight: 32)
            .foregroundStyle(fg)
            .background(bg, in: Capsule())
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// Round initials badge tinted by the person's group.
struct Avatar: View {
    let person: Person
    var size: CGFloat = 40

    var body: some View {
        let _ = PhotoStore.shared.version
        ZStack {
            if let img = PhotoStore.shared.image(for: person.k) {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .clipShape(Circle())
            } else {
                Circle().fill(person.tint.opacity(0.18))
                Text(person.initials)
                    .font(.custom("Geist-SemiBold", fixedSize: size * 0.36))
                    .foregroundStyle(person.tint)
                    .minimumScaleFactor(0.5)
            }
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
                    .background(Circle().fill(Theme.card).padding(-2))
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
    static let supportEmail = "jay@jaynichols.net"
}
