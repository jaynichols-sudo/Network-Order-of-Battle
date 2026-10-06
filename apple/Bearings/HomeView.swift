import SwiftUI
import UIKit

struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var picks: [WeeklyPick] = []
    @State private var picksLoaded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                header
                banner
                TodayCompassCard()
                NeedsYouCard(picks: picks)
                TodayChips()
                ComingUp()
                BirthdaysCard()
                if !model.home.cards.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Worth your time").font(Theme.geist(.headline, .bold)).padding(.top, 14).padding(.bottom, 4)
                        ForEach(Array(model.home.cards.enumerated()), id: \.element.id) { i, card in
                            if i > 0 { Theme.line.frame(height: 1) }
                            HomeCardView(card: card)
                        }
                    }
                    .padding(.horizontal, 16)
                    .card()
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg)
        .navigationTitle("Today")
        .toolbar(.hidden, for: .navigationBar)
        .refreshable { await model.reload() }
        .task(id: "\(model.loaded)-\(model.people.count)-\(model.info.rev)-\(model.info.edits)-\(model.showWeekly)") {
            guard model.loaded else { return }
            var got = await model.weeklyPicks()
            // the engine may still be warming up right after launch
            for _ in 0..<4 where got.isEmpty && !model.people.isEmpty && !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 500_000_000)
                got = await model.weeklyPicks()
            }
            picks = got
            picksLoaded = true
        }
    }

    private var openCount: Int { picks.filter { !model.weeklyDone($0.k) }.count }

    /// "Five people need you this week." Spelled out, since it reads as a sentence.
    private var headline: String {
        let n = openCount
        if !picksLoaded { return greeting }
        if n == 0 { return picks.isEmpty ? "You’re all caught up." : "Your week is done." }
        if n == 1 { return "One person needs you this week." }
        let words = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"]
        return "\(n <= 10 ? words[n] : String(n)) people need you this week."
    }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let base = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
        return model.firstName.isEmpty ? base : "\(base), \(model.firstName)"
    }

    private var subline: String {
        let date = Date().formatted(.dateTime.weekday(.wide).month(.wide).day())
        if model.info.isSample && !UserDefaults.standard.bool(forKey: "storeMode") { return "\(date). A sample network" }
        return date
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(subline)
                    .font(Theme.geist(.footnote, .medium))
                    .foregroundStyle(Theme.text2)
                Text(headline)
                    .font(Theme.geist(.title, .bold))
                    .fixedSize(horizontal: false, vertical: true)
                    .contentTransition(.opacity)
                    .animation(.smooth, value: headline)
            }
            Spacer(minLength: 0)
            AccountButton()
        }
        .padding(.horizontal, 6)
        .padding(.top, 8)
        .padding(.bottom, 4)
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
                        .buttonStyle(PillButtonStyle(kind: .primary))
                        .padding(.top, 2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .card()
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
                        .card(18)
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
                    .background(Theme.tone(card.tone).opacity(0.14), in: Circle())
                VStack(alignment: .leading, spacing: 6) {
                    Text(card.title)
                        .font(Theme.geist(.subheadline, .semibold))
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                    Text(card.body)
                        .font(Theme.geist(.footnote))
                        .foregroundStyle(Theme.text2)
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
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
