#if os(iOS) && !targetEnvironment(macCatalyst)
import ActivityKit
import SwiftUI
import WidgetKit

struct TripLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TripActivityAttributes.self) { context in
            TripLockScreen(context: context)
                .activityBackgroundTint(Palette.plum.opacity(0.92))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(tripURL(context.attributes.tripID))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        Image(systemName: "location.north.circle.fill").foregroundStyle(Palette.amber)
                        Text(context.attributes.city).font(.custom("Geist-SemiBold", size: 15)).lineLimit(1)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.attributes.when).font(.custom("Geist-Medium", size: 13)).foregroundStyle(.secondary)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(alignment: .center, spacing: 10) {
                        InitialsRow(initials: context.state.initials, size: 28)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(countLine(context.state.nearby)).font(.custom("Geist-SemiBold", size: 15))
                            if !context.state.lead.isEmpty {
                                Text(context.state.lead).font(.custom("Geist-Regular", size: 12)).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Image(systemName: "location.north.circle.fill").foregroundStyle(Palette.amber)
            } compactTrailing: {
                Text("\(context.state.nearby)").font(.custom("GeistMono-SemiBold", size: 14)).foregroundStyle(Palette.amber)
            } minimal: {
                Text("\(context.state.nearby)").font(.custom("GeistMono-SemiBold", size: 13)).foregroundStyle(Palette.amber)
            }
            .widgetURL(tripURL(context.attributes.tripID))
            .keylineTint(Palette.amber)
        }
    }
}

private func tripURL(_ id: String) -> URL {
    URL(string: "bearings://trip/" + (id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id)) ?? URL(string: "bearings://home")!
}

private func countLine(_ n: Int) -> String {
    n == 0 ? "No one placed nearby yet" : "\(n) \(n == 1 ? "person" : "people") you know nearby"
}

struct TripLockScreen: View {
    let context: ActivityViewContext<TripActivityAttributes>

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            ZStack {
                Circle().stroke(Palette.amber.opacity(0.35), lineWidth: 1)
                Circle().stroke(Palette.amber.opacity(0.2), lineWidth: 1).padding(9)
                Text("\(context.state.nearby)")
                    .font(.custom("GeistMono-SemiBold", size: 22))
                    .foregroundStyle(.white)
            }
            .frame(width: 58, height: 58)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(context.state.now ? "IN" : "HEADING TO")
                        .font(.custom("GeistMono-Medium", size: 10))
                        .foregroundStyle(Palette.amber)
                    Text(context.attributes.when)
                        .font(.custom("GeistMono-Medium", size: 10))
                        .foregroundStyle(.white.opacity(0.6))
                }
                Text(context.attributes.city)
                    .font(.custom("Geist-Bold", size: 19))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Text(context.state.lead.isEmpty ? countLine(context.state.nearby) : context.state.lead)
                    .font(.custom("Geist-Regular", size: 13))
                    .foregroundStyle(.white.opacity(0.75))
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            InitialsRow(initials: context.state.initials, size: 26)
        }
        .padding(16)
    }
}

struct InitialsRow: View {
    let initials: [String]
    let size: CGFloat

    var body: some View {
        HStack(spacing: -size * 0.3) {
            ForEach(Array(initials.prefix(3).enumerated()), id: \.offset) { _, s in
                Text(s)
                    .font(.custom("Geist-SemiBold", size: size * 0.38))
                    .foregroundStyle(Palette.plum)
                    .frame(width: size, height: size)
                    .background(Circle().fill(Palette.amber))
                    .overlay(Circle().stroke(Palette.plum, lineWidth: 1.5))
            }
        }
    }
}
#endif
