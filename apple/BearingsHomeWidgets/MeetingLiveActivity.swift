#if os(iOS) && !targetEnvironment(macCatalyst)
import ActivityKit
import SwiftUI
import WidgetKit

/// "Walk in prepared": the next meeting with someone you know, with the one thing to remember.
struct MeetingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MeetingActivityAttributes.self) { context in
            MeetingLockScreen(context: context)
                .widgetURL(personURL(context.attributes.k))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Face(initials: context.state.initials, color: context.state.color, size: 40)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(context.state.name).font(Calm.font(16, .semibold, relativeTo: .subheadline)).foregroundStyle(Calm.dark.text).lineLimit(1)
                        Text(context.attributes.title).font(Calm.font(12, relativeTo: .caption)).foregroundStyle(Calm.dark.text2).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.attributes.start, style: .relative)
                        .font(Calm.mono(13, relativeTo: .footnote)).foregroundStyle(Calm.dark.primary)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 70)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.memory)
                        .font(Calm.font(13, relativeTo: .footnote)).foregroundStyle(Calm.dark.text)
                        .lineLimit(3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 4)
                }
            } compactLeading: {
                Face(initials: context.state.initials, color: context.state.color, size: 22)
            } compactTrailing: {
                Text(context.attributes.start, style: .timer)
                    .font(Calm.mono(13, relativeTo: .footnote)).foregroundStyle(Calm.dark.primary)
                    .frame(maxWidth: 52)
            } minimal: {
                Face(initials: context.state.initials, color: context.state.color, size: 22)
            }
            .widgetURL(personURL(context.attributes.k))
            .keylineTint(Calm.dark.primary)
        }
    }
}

private func personURL(_ k: String) -> URL {
    URL(string: "bearings://person/" + (k.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? k)) ?? URL(string: "bearings://home")!
}

/// A face for the Lock Screen: the person's sector color behind their initials.
struct Face: View {
    let initials: String
    let color: String
    let size: CGFloat

    var body: some View {
        let c = faceColor(color)
        Text(initials)
            .font(Calm.font(size * 0.38, .bold, relativeTo: .caption))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Circle().fill(LinearGradient(colors: [c, c.opacity(0.6)], startPoint: .topLeading, endPoint: .bottomTrailing)))
            .accessibilityHidden(true)
    }
}

/// "#RRGGBB" to a color (the widget extension doesn't carry the app's theme helpers).
func faceColor(_ hex: String) -> Color {
    var v: UInt64 = 0
    Scanner(string: hex.trimmingCharacters(in: CharacterSet(charactersIn: "# "))).scanHexInt64(&v)
    return Color(.sRGB, red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255, opacity: 1)
}

struct MeetingLockScreen: View {
    let context: ActivityViewContext<MeetingActivityAttributes>
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let t = Calm.tokens(scheme)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Face(initials: context.state.initials, color: context.state.color, size: 46)
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.state.name + (context.state.others > 0 ? " +\(context.state.others)" : ""))
                        .font(Calm.font(17, .bold, relativeTo: .headline)).foregroundStyle(t.text).lineLimit(1)
                    Text(context.attributes.title).font(Calm.font(13, relativeTo: .footnote)).foregroundStyle(t.text2).lineLimit(1)
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 1) {
                    Text(context.attributes.start, style: .time).font(Calm.mono(15, relativeTo: .subheadline)).foregroundStyle(t.primary)
                    Text(context.attributes.start, style: .relative).font(Calm.font(11, relativeTo: .caption2)).foregroundStyle(t.text2)
                        .multilineTextAlignment(.trailing)
                }
            }
            Text(context.state.memory)
                .font(Calm.font(14, relativeTo: .subheadline)).foregroundStyle(t.text)
                .lineLimit(3)
        }
        .padding(16)
        .activityBackgroundTint(t.card)
        .activitySystemActionForegroundColor(t.text)
        .accessibilityElement(children: .combine)
    }
}
#endif
