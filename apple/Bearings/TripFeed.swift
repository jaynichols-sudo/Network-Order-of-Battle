import SwiftUI

/// Settings > Calendar > TripIt feed: paste the calendar feed link from TripIt (or any
/// https or webcal travel calendar). Northfix fetches it on this device, at most every six hours.
struct TripFeedSettings: View {
    @Environment(AppModel.self) private var model
    @State private var link = ""
    @State private var working = false
    @State private var problem: String?
    private var cal: CalendarService { CalendarService.shared }

    var body: some View {
        Form {
            Section {
                TextField("https:// or webcal:// link", text: $link, axis: .vertical)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .font(Theme.geist(.footnote))
                    .lineLimit(1...4)
                Button {
                    Task { await save() }
                } label: {
                    HStack {
                        Text(cal.hasFeed ? "Save link" : "Add feed")
                        if working { Spacer(); ProgressView() }
                    }
                }
                .disabled(working || link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if let problem {
                    Text(problem).font(Theme.geist(.footnote)).foregroundStyle(Theme.bad)
                }
            } header: {
                Text("TripIt feed")
            } footer: {
                Text("In TripIt, open Settings, then Calendar Feeds, and copy the feed link. Northfix reads it straight from TripIt on this device every few hours, and places each trip where your flight lands. The link stays in this device’s Keychain. No Northfix server sees it or your trips.")
            }
            if cal.hasFeed {
                Section {
                    LabeledContent("Trips coming up", value: "\(upcoming)")
                    if let at = cal.feedCheckedAt {
                        LabeledContent("Last checked", value: at.formatted(.relative(presentation: .named)))
                    }
                    if let err = cal.feedError {
                        Text(err).font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                    }
                    Button("Check now") {
                        Task {
                            working = true
                            await cal.refreshFeedNow(model: model)
                            working = false
                        }
                    }
                    .disabled(working)
                    Button("Remove feed", role: .destructive) {
                        Task {
                            _ = await cal.setFeed(nil, model: model)
                            link = ""
                            problem = nil
                        }
                    }
                }
            }
        }
        .navigationTitle("TripIt feed")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { link = cal.feedURL ?? "" }
    }

    private var upcoming: Int {
        let today = Calendar.current.startOfDay(for: Date())
        return cal.feedTrips.filter { $0.end >= today }.count
    }

    private func save() async {
        working = true
        defer { working = false }
        problem = await cal.setFeed(link, model: model)
        if problem == nil {
            Haptic.success()
            let n = upcoming
            model.show(n == 0 ? "Feed added. No trips coming up yet." : "Feed added. \(n) \(n == 1 ? "trip" : "trips") coming up.")
        }
    }
}

/// Under a trip's dates: where it came from, and its flights ("Flight AA 1234, CLT to SAN, lands 2:10 PM").
struct TripFlightLines: View {
    let trip: CalendarService.Trip

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if trip.source == "feed" {
                Label("From \(CalendarService.shared.feedName == "TripIt" ? "TripIt" : "your travel feed")", systemImage: "suitcase.rolling")
                    .font(Theme.geist(.footnote)).foregroundStyle(Theme.info)
            }
            ForEach(Array((trip.flights ?? []).prefix(6).enumerated()), id: \.offset) { _, f in
                Label(f.summary, systemImage: "airplane")
                    .font(Theme.geist(.footnote)).foregroundStyle(.secondary)
            }
        }
    }
}
