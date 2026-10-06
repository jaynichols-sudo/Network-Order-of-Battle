#if os(iOS) && !targetEnvironment(macCatalyst)
import ActivityKit
import SwiftUI
import WidgetKit

struct TripLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TripActivityAttributes.self) { context in
            TripLockScreen(context: context)
                .widgetURL(tripURL(context.attributes.tripID))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        Image(systemName: "location.north.circle.fill").foregroundStyle(Calm.dark.primary)
                        Text(context.attributes.city).font(Calm.font(15, .semibold, relativeTo: .subheadline)).foregroundStyle(Calm.dark.text).lineLimit(1)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.attributes.when).font(Calm.font(13, .medium, relativeTo: .footnote)).foregroundStyle(Calm.dark.text2)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(alignment: .center, spacing: 10) {
                        InitialsRow(initials: context.state.initials, size: 28, t: Calm.dark)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(countLine(context.state.nearby)).font(Calm.font(15, .semibold, relativeTo: .subheadline)).foregroundStyle(Calm.dark.text)
                            if !context.state.lead.isEmpty {
                                Text(context.state.lead).font(Calm.font(12, relativeTo: .caption)).foregroundStyle(Calm.dark.text2).lineLimit(1)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Image(systemName: "location.north.circle.fill").foregroundStyle(Calm.dark.primary)
            } compactTrailing: {
                Text("\(context.state.nearby)").font(Calm.mono(14, relativeTo: .subheadline)).foregroundStyle(Calm.dark.primary)
                    .accessibilityLabel(countLine(context.state.nearby))
            } minimal: {
                Text("\(context.state.nearby)").font(Calm.mono(13, relativeTo: .footnote)).foregroundStyle(Calm.dark.primary)
                    .accessibilityLabel(countLine(context.state.nearby))
            }
            .widgetURL(tripURL(context.attributes.tripID))
            .keylineTint(Calm.dark.primary)
        }
    }
}

private func tripURL(_ id: String) -> URL {
    URL(string: "bearings://trip/" + (id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id)) ?? URL(string: "bearings://home")!
}

private func countLine(_ n: Int) -> String {
    n == 0 ? "No one placed nearby yet" : "\(n) \(n == 1 ? "person" : "people") you know nearby"
}

/// The Lock Screen card: white in light mode, night purple in dark, with the brand's
/// plum (light) or amber (dark) for the count.
struct TripLockScreen: View {
    let context: ActivityViewContext<TripActivityAttributes>
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let t = Calm.tokens(scheme)
        HStack(alignment: .center, spacing: 14) {
            ZStack {
                Circle().fill(t.soft)
                Circle().stroke(t.primary.opacity(0.2), lineWidth: 1).padding(7)
                Text("\(context.state.nearby)")
                    .font(Calm.mono(22, relativeTo: .title2))
                    .foregroundStyle(t.primary)
                    .minimumScaleFactor(0.6)
            }
            .frame(width: 58, height: 58)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(countLine(context.state.nearby))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(context.state.now ? "In" : "Heading to")
                        .font(Calm.font(12, .semibold, relativeTo: .caption))
                        .foregroundStyle(t.primary)
                    Text(context.attributes.when)
                        .font(Calm.font(12, .medium, relativeTo: .caption))
                        .foregroundStyle(t.text2)
                }
                Text(context.attributes.city)
                    .font(Calm.font(19, .bold, relativeTo: .title3))
                    .foregroundStyle(t.text)
                    .lineLimit(1)
                Text(context.state.lead.isEmpty ? countLine(context.state.nearby) : context.state.lead)
                    .font(Calm.font(13, relativeTo: .footnote))
                    .foregroundStyle(t.text2)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            InitialsRow(initials: context.state.initials, size: 26, t: t)
        }
        .padding(16)
        .activityBackgroundTint(t.card)
        .activitySystemActionForegroundColor(t.text)
    }
}

/// Up to three overlapping initials, on soft circles.
struct InitialsRow: View {
    let initials: [String]
    let size: CGFloat
    let t: Calm.Tokens

    var body: some View {
        HStack(spacing: -size * 0.3) {
            ForEach(Array(initials.prefix(3).enumerated()), id: \.offset) { _, s in
                Text(s)
                    .font(Calm.font(size * 0.38, .semibold, relativeTo: .caption2))
                    .foregroundStyle(t.primary)
                    .frame(width: size, height: size)
                    .background(Circle().fill(t.soft))
                    .overlay(Circle().stroke(t.card, lineWidth: 1.5))
            }
        }
        .accessibilityHidden(true)
    }
}
#endif
