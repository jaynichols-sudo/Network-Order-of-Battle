import SwiftUI
import UniformTypeIdentifiers
import UIKit

// Today's building blocks in the "Calm cards" design (docs/design-c.md): a small
// compass with the three numbers that matter, this week's five, and chips for the rest.

/// The compass at a glance. Tapping it opens Explore, where it's full size and interactive.
struct TodayCompassCard: View {
    @Environment(AppModel.self) private var model
    @State private var data = CompassData.empty

    var body: some View {
        let t = data.tally
        HStack(spacing: 16) {
            Button {
                Haptic.tap()
                model.open(.explore)
            } label: {
                CompassView(data: data, focus: .constant(nil), initials: model.myInitials, pings: true, labels: false) { _ in }
                    .allowsHitTesting(false)
                    .frame(width: 128, height: 128)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Your network compass. Opens Explore")

            VStack(alignment: .leading, spacing: 10) {
                stat(t.w, "waiting on you", big: true, color: Theme.needs) {
                    model.perform(CardAction(kind: "filter", sig: ["waiting"]))
                }
                HStack(alignment: .top, spacing: 18) {
                    stat(t.j, "new jobs") { model.perform(CardAction(kind: "filter", sig: ["jcw"])) }
                    if data.rel {
                        stat(t.close, "close") {
                            var f = Filters(); f.rel = ["Close"]
                            model.searchText = ""; model.filters = f; model.paths[.people] = []; model.tab = .people
                        }
                    } else {
                        stat(t.n, "new") { model.perform(CardAction(kind: "filter", sig: ["new"])) }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .card()
        .task(id: "\(model.loaded)-\(model.people.count)-\(model.info.lens)-\(model.info.edits)-\(model.info.rev)") {
            data = await model.compassReady()
        }
    }

    private func stat(_ n: Int, _ label: String, big: Bool = false, color: Color = .primary, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 0) {
                Text(n.formatted())
                    .font(Theme.geist(big ? .title2 : .title3, .bold))
                    .foregroundStyle(color)
                    .contentTransition(.numericText())
                Text(label)
                    .font(Theme.geist(big ? .footnote : .caption))
                    .foregroundStyle(Theme.text2)
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}

/// This week's five as rows with one action each. The full brief (drafts, swap someone out) is a tap away.
struct NeedsYouCard: View {
    @Environment(AppModel.self) private var model
    let picks: [WeeklyPick]
    @State private var writing: WeeklyPick?

    var body: some View {
        if !picks.isEmpty {
            let done = picks.filter { model.weeklyDone($0.k) }.count
            VStack(alignment: .leading, spacing: 0) {
                Button { model.showWeekly = true } label: {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Needs you").font(Theme.geist(.headline, .bold)).foregroundStyle(.primary)
                        Spacer()
                        Text("\(done) of \(picks.count) done").font(Theme.geist(.footnote)).foregroundStyle(Theme.text2)
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.text3)
                    }
                    .padding(.top, 14).padding(.bottom, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens this week’s brief with a draft for each person")
                ForEach(Array(picks.enumerated()), id: \.element.id) { i, w in
                    if i > 0 { Theme.line.frame(height: 1) }
                    row(w)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 6)
            .card()
            .sheet(item: $writing) { w in MessageSheet(k: w.k).environment(AppModel.shared) }
        }
    }

    @ViewBuilder private func row(_ w: WeeklyPick) -> some View {
        if let p = model.person(w.k) {
            let isDone = model.weeklyDone(w.k)
            HStack(spacing: 12) {
                Button { model.open(.person(w.k)) } label: {
                    HStack(spacing: 12) {
                        Avatar(person: p, size: 38)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(p.fullName)
                                .font(Theme.geist(.subheadline, .semibold))
                                .foregroundStyle(isDone ? Theme.text3 : .primary)
                                .strikethrough(isDone, color: Theme.text3)
                                .lineLimit(1)
                            Text(w.why)
                                .font(Theme.geist(.footnote))
                                .foregroundStyle(Theme.text2)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if isDone {
                    Text("Done").padding(.horizontal, 14).frame(minHeight: 32)
                        .font(Theme.geist(.footnote, .semibold))
                        .foregroundStyle(Theme.good)
                        .background(Theme.goodSoft, in: Capsule())
                } else {
                    Button(label(w.kind)) { writing = w }
                        .buttonStyle(PillButtonStyle(kind: w.kind == "reply" ? .primary : .soft))
                }
            }
            .padding(.vertical, 10)
            .animation(.smooth, value: isDone)
        }
    }

    private func label(_ kind: String) -> String {
        switch kind {
        case "reply": return "Reply"
        case "congrats": return "Congrats"
        case "new": return "Thank"
        default: return "Write"
        }
    }
}

/// Everything else Today used to hold, as small chips: catch up, lists, events, trips.
struct TodayChips: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let events = model.events.filter { $0.isOn || $0.isUpcoming || ($0.isRecent && !model.toFollowUp($0).isEmpty) }.sorted { $0.start < $1.start }
        let trip = TripMode.current
        FlowLayout(spacing: 8) {
            if model.info.deckCount > 0 {
                chip("\(model.info.deckCount.formatted()) to catch up", icon: "rectangle.stack") { model.open(.catchup) }
            }
            ForEach(model.savedSearches) { s in
                chip(s.name, icon: "pin") { model.apply(s) }
            }
            ForEach(events.prefix(3)) { e in
                let todo = model.toFollowUp(e).count
                chip(e.isUpcoming || e.isOn || todo == 0 ? e.name : "\(e.name) · \(todo)", icon: "ticket") { model.open(.event(e.id)) }
            }
            if let trip {
                chip("\(trip.city) trip", icon: "airplane") { model.open(.trip(trip.id)) }
            }
            if model.yearReviewSeason && !model.info.isSample {
                chip("Your \(String(model.reviewYear))", icon: "sparkles") { model.showYear = true }
            }
            chip("Explore", icon: "scope") { model.open(.explore) }
        }
        .padding(.horizontal, 2)
    }

    private func chip(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            Label(title, systemImage: icon)
                .labelStyle(ChipLabel())
        }
        .buttonStyle(PillButtonStyle(kind: .plain))
        .shadow(color: .black.opacity(0.05), radius: 1, y: 1)
    }
}

private struct ChipLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.icon.font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.text2)
            configuration.title.font(Theme.geist(.footnote, .medium))
        }
        .frame(minHeight: 34)
    }
}

/// All your events, from the You tab.
struct EventsList: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if model.events.isEmpty {
                    ContentUnavailableView("No events yet", systemImage: "ticket",
                                           description: Text("Going to a conference? Set it up to see who you know there, scan cards and keep track of follow-ups."))
                        .padding(.top, 40)
                }
                ForEach(model.events.sorted { $0.start > $1.start }) { e in
                    NavigationLink(value: Route.event(e.id)) { EventRow(event: e) }.buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .background(Theme.bg)
        .navigationTitle("Events")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { model.newEvent = true } label: { Label("New event", systemImage: "plus") }
            }
        }
    }
}

/// The You tab: your profile, your stuff, your data, and settings.
struct YouView: View {
    @Environment(AppModel.self) private var model
    @State private var importingEnrichment = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("You").font(Theme.geist(.title, .bold)).padding(.horizontal, 6).padding(.top, 8)

                VStack(spacing: 14) {
                    MyPhotoRow()
                    Button {
                        Haptic.tap()
                        model.showShareCard = true
                    } label: {
                        Label("Share a picture of your network", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PillButtonStyle(kind: .primary))
                }
                .padding(16)
                .card()

                group("Your stuff") {
                    row("This week’s five", icon: "checklist") { model.showWeekly = true }
                    row("Catch up", icon: "rectangle.stack", detail: model.info.deckCount > 0 ? model.info.deckCount.formatted() : nil) { model.open(.catchup) }
                    row("Explore your network", icon: "scope") { model.open(.explore) }
                    row("Events", icon: "ticket", detail: model.events.isEmpty ? nil : model.events.count.formatted()) { model.open(.events) }
                    row("Trips", icon: "airplane") { model.open(.trips) }
                    row("Find a way into a company", icon: "point.3.connected.trianglepath.dotted") { model.introQuery = "" }
                    row("Team packs", icon: "person.3") { model.open(.team) }
                    row("Your year in review", icon: "calendar.badge.checkmark") { model.showYear = true }
                    ForEach(model.savedSearches) { s in
                        row(s.name, icon: "pin") { model.apply(s) }
                    }
                }

                group("Your data") {
                    row(model.info.isSample ? "Import your connections" : "Refresh connections", icon: "square.and.arrow.down",
                        detail: model.info.lastImport.isEmpty ? nil : Day.nice(model.info.lastImport)) { model.showImport = true }
                    if !model.info.isSample {
                        row("Back up notes", icon: "externaldrive") { Task { await model.backup() } }
                    }
                    row("Import an enrichment file", icon: "tablecells.badge.ellipsis") { importingEnrichment = true }
                }

                group(nil) {
                    row(Pro.shared.owned ? "Bearings Pro (thank you!)" : "Bearings Pro", icon: "sparkles") { model.showPaywall = true }
                    row("Settings", icon: "gearshape") { model.showSettings = true }
                    row("Help and support", icon: "questionmark.circle") {
                        if let u = URL(string: "https://www.jaynichols.net/bearings/support.html") { UIApplication.shared.open(u) }
                    }
                }

                Text("\(model.info.count.formatted()) people. Everything stays on your devices and your iCloud.")
                    .font(Theme.geist(.footnote))
                    .foregroundStyle(Theme.text2)
                    .padding(.horizontal, 6)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg)
        .navigationTitle("You")
        .toolbar(.hidden, for: .navigationBar)
        .fileImporter(isPresented: $importingEnrichment, allowedContentTypes: [.commaSeparatedText, .plainText]) { r in
            if case .success(let url) = r { Task { await model.importEnrichment(url) } }
        }
    }

    private func group<Content: View>(_ title: String?, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title {
                Text(title).font(Theme.geist(.footnote, .semibold)).foregroundStyle(Theme.text2).padding(.horizontal, 6).padding(.top, 6)
            }
            VStack(spacing: 0) {
                Group(subviews: content()) { subs in
                    ForEach(Array(subs.enumerated()), id: \.offset) { i, v in
                        if i > 0 { Theme.line.frame(height: 1).padding(.leading, 48) }
                        v
                    }
                }
            }
            .padding(.horizontal, 16)
            .card()
        }
    }

    private func row(_ title: String, icon: String, detail: String? = nil, action: @escaping () -> Void) -> some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.primary)
                    .frame(width: 30, height: 30)
                    .background(Theme.soft, in: Circle())
                Text(title).font(Theme.geist(.subheadline, .medium)).foregroundStyle(.primary).lineLimit(1)
                Spacer(minLength: 4)
                if let detail { Text(detail).font(Theme.geist(.footnote)).foregroundStyle(Theme.text2) }
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.text3)
            }
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
