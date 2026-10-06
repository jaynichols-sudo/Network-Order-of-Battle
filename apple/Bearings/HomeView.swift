import SwiftUI
import UIKit

struct HomeView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                WeeklyCard()
                CompassCard()
                SavedSearchStrip()
                banner
                ComingUp()
                BirthdaysCard()
                EventsStrip()
                if !model.home.cards.isEmpty {
                    Text("Worth your time").font(Theme.geist(.title3, .bold)).padding(.top, 6)
                } else if model.loaded && !model.info.isSample {
                    Callout(icon: "checkmark.seal.fill", tint: Theme.good, title: "You’re all caught up",
                            text: "Nobody’s waiting on you and no follow-ups are due. A good day to reach out to someone you haven’t talked to in a while.",
                            button: "Find someone") {
                        var f = Filters(); f.sig = ["cold"]
                        model.searchText = ""; model.filters = f; model.paths[.people] = []; model.tab = .people
                    }
                }
                LazyVStack(spacing: 12) {
                    ForEach(model.home.cards) { card in
                        HomeCardView(card: card)
                    }
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 24)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Home")
        .toolbar(.hidden, for: .navigationBar)
        .refreshable { await model.reload() }
    }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let base = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
        return model.firstName.isEmpty ? base : "\(base), \(model.firstName)"
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(greeting)
                    .font(Theme.geist(.largeTitle, .bold))
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                Text(model.info.isSample && !UserDefaults.standard.bool(forKey: "storeMode")
                     ? "You’re looking around a sample network."
                     : model.info.isStarter ? "\(model.info.count.formatted()) people from your contacts"
                     : "\(model.info.count.formatted()) people\(model.info.lastImport.isEmpty ? "" : ", refreshed \(Day.nice(model.info.lastImport))")")
                    .foregroundStyle(.secondary)
                    .font(Theme.geist(.subheadline))
            }
            Spacer()
            AccountButton()
        }
        .padding(.top, 8)
    }

    @ViewBuilder private var banner: some View {
        if !model.errorNote.isEmpty {
            Callout(icon: "exclamationmark.triangle.fill", tint: Theme.bad, title: "Couldn’t load", text: model.errorNote)
        } else if !model.syncNote.isEmpty {
            Callout(icon: "icloud.and.arrow.down", tint: Theme.info, title: "Syncing", text: model.syncNote)
        } else if model.info.isStarter {
            if let at = ExportReminder.requestedAt {
                Callout(icon: "envelope.badge", tint: Theme.info, title: "Watch for LinkedIn’s email",
                        text: "You asked for your LinkedIn data \(Day.ago(Day.fmt.string(from: at))). When the email arrives, download the file and share it to Bearings. Your notes and stars come along.",
                        button: "I have the file") { model.showImport = true }
            } else {
                Callout(icon: "square.and.arrow.down", tint: Theme.accent, title: "This is your contacts. Add LinkedIn for the full picture",
                        text: "LinkedIn adds everyone you’re connected to, who you message, and who changed jobs.",
                        button: "Ask LinkedIn for my data") {
                    if let u = URL(string: "https://www.linkedin.com/mypreferences/d/download-my-data") { UIApplication.shared.open(u) }
                    Task { await ExportReminder.requested() }
                }
            }
        } else if model.info.isSample && !UserDefaults.standard.bool(forKey: "storeMode") {
            Callout(icon: "square.and.arrow.down", tint: Theme.accent, title: "See your own network",
                    text: "Import your LinkedIn connections. It takes about three minutes and stays private to you.",
                    button: "Import connections") { model.showImport = true }
        } else if let days = Day.daysSince(model.info.lastImport), days >= 7 {
            Callout(icon: "arrow.clockwise", tint: Theme.accent, title: "Time for a refresh",
                    text: "It’s been \(days) days. A new LinkedIn export picks up job changes and new connections.",
                    button: "Refresh now") { model.showImport = true }
        }
    }
}

struct Callout: View {
    let icon: String
    let tint: Color
    let title: String
    let text: String
    var button: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(tint)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).geist(.headline)
                Text(text).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                if let button, let action {
                    Button(button, action: action)
                        .buttonStyle(.borderedProminent)
                        .padding(.top, 2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct StatsStrip: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(model.home.stats) { s in
                    Button { model.perform(s.act) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s.value.formatted())
                                .font(Theme.geist(.title2, .bold))
                                .monospacedDigit()
                                .contentTransition(.numericText())
                            Text(s.label)
                                .font(Theme.geist(.subheadline, .semibold))
                                .foregroundStyle(.primary)
                            Text(s.detail)
                                .font(Theme.geist(.caption))
                                .foregroundStyle(s.up == true ? Theme.good : .secondary)
                                .lineLimit(1)
                        }
                        .frame(minWidth: 118, alignment: .leading)
                        .padding(12)
                        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 1)
        }
        .scrollClipDisabled()
        .animation(.default, value: model.home.stats)
    }
}

struct HomeCardView: View {
    @Environment(AppModel.self) private var model
    let card: HomeCard

    var body: some View {
        Button { model.perform(card.act) } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: card.icon)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Theme.tone(card.tone))
                    .frame(width: 38, height: 38)
                    .background(Theme.tone(card.tone).opacity(0.14), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                VStack(alignment: .leading, spacing: 6) {
                    Text(card.title)
                        .font(Theme.geist(.headline))
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                    Text(card.body)
                        .font(Theme.geist(.subheadline))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                    let ps = model.persons(Array(card.people.prefix(6)))
                    if !ps.isEmpty {
                        AvatarStack(people: ps, size: 26)
                            .padding(.top, 2)
                    }
                    if let bars = card.bars, !bars.isEmpty {
                        GeometryReader { g in
                            let total = max(1, bars.reduce(0) { $0 + $1.n })
                            HStack(spacing: 2) {
                                ForEach(bars, id: \.id) { b in
                                    Rectangle().fill(Color(hex: b.color))
                                        .frame(width: max(2, (g.size.width - CGFloat(bars.count * 2)) * CGFloat(b.n) / CGFloat(total)))
                                }
                            }
                        }
                        .frame(height: 8)
                        .clipShape(Capsule())
                        .padding(.top, 4)
                    }
                }
                Spacer(minLength: 4)
                if let r = card.ring {
                    CoverageRing(score: r, size: 46)
                } else {
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .padding(.top, 4)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay {
                if card.hero == true {
                    RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.tone(card.tone).opacity(0.5), lineWidth: 1.5)
                }
            }
        }
        .buttonStyle(.plain)
    }
}
