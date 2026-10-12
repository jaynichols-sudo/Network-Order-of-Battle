import SwiftUI

/// One line to start the day with, at the top of Home. The engine picks it, so every device shows the same one.
struct DailyQuote: Codable, Equatable {
    var text: String
    var by: String
}

extension AppModel {
    func quote(for day: String = Day.today) async -> DailyQuote? {
        try? await engine.call("quote", [day], as: DailyQuote.self)
    }
}

struct QuoteCard: View {
    @Environment(AppModel.self) private var model
    @State private var quote: DailyQuote?

    var body: some View {
        // a ZStack with a zero-height anchor, so the view exists (and its task runs) before the quote arrives
        ZStack(alignment: .topLeading) {
            Color.clear.frame(height: 0)
            if let q = quote {
                HStack(alignment: .top, spacing: 12) {
                    Capsule().fill(Theme.amber).frame(width: 3)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("“\(q.text)”")
                            .font(Theme.serif(.body).italic())
                            .foregroundStyle(.primary.opacity(0.88))
                            .fixedSize(horizontal: false, vertical: true)
                        Text(q.by.uppercased())
                            .font(Theme.eyebrow)
                            .tracking(1.1)
                            .foregroundStyle(Theme.text3)
                    }
                    Spacer(minLength: 0)
                }
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Quote of the day: \(q.text), \(q.by)")
                .transition(.opacity)
            }
        }
        .animation(Motion.gentle, value: quote)
        .task(id: "\(Day.today)-\(model.loaded)") { quote = await model.quote() }
    }
}
