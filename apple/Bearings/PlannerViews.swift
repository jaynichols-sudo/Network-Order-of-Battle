import SwiftUI
import MapKit

/// Home's "Coming up": meeting prep and trips, or an invitation to connect the calendar.
struct ComingUp: View {
    @Environment(AppModel.self) private var model
    @AppStorage("calendarPromptHidden") private var promptHidden = false
    private var cal: CalendarService { CalendarService.shared }

    var body: some View {
        let meetings = cal.meetings.filter { $0.start < Date().addingTimeInterval(36 * 3600) }
        let trips = cal.trips.filter { $0.start < Date().addingTimeInterval(30 * 86400) }
        VStack(alignment: .leading, spacing: 10) {
            if !cal.enabled || !cal.authorized {
                if !promptHidden && !model.info.isSample {
                    Callout(icon: "calendar.badge.clock", tint: Theme.violet, title: "Prep for meetings and trips",
                            text: "Bearings can read your calendar on this device to brief you before meetings with people you know, and to show who’s near where you’re traveling.",
                            button: "Use my calendar") {
                        Task {
                            if await CalendarService.shared.requestAccess() { await CalendarService.shared.scan(model: model, force: true) }
                        }
                    }
                    .overlay(alignment: .topTrailing) {
                        Button { promptHidden = true } label: { Image(systemName: "xmark").font(.caption.weight(.bold)).padding(10) }
                            .buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("Hide")
                    }
                }
            } else if !meetings.isEmpty || !trips.isEmpty {
                Text("Coming up").font(Theme.geist(.headline)).padding(.top, 2)
                ForEach(meetings.prefix(4)) { m in
                    NavigationLink(value: Route.meeting(m.id)) { MeetingRow(meeting: m) }.buttonStyle(.plain)
                }
                ForEach(trips.prefix(3)) { t in
                    NavigationLink(value: Route.trip(t.id)) { TripRow(trip: t) }.buttonStyle(.plain)
                }
            }
            if cal.enabled && cal.authorized && cal.home == nil && !model.info.isSample {
                Callout(icon: "house", tint: Theme.info, title: "Where’s home?",
                        text: "Tell Bearings your home city so it can tell trips from local meetings. You can set it in Settings.",
                        button: "Open Settings") { model.showSettings = true }
            }
        }
    }
}

struct MeetingRow: View {
    @Environment(AppModel.self) private var model
    let meeting: CalendarService.Meeting

    var body: some View {
        let ps = model.persons(meeting.matched)
        HStack(spacing: 12) {
            VStack(spacing: 0) {
                Text(meeting.start.formatted(.dateTime.weekday(.abbreviated))).font(.caption2.weight(.semibold)).foregroundStyle(Theme.violet)
                Text(meeting.start.formatted(.dateTime.hour().minute())).font(.caption.weight(.bold).monospacedDigit())
            }
            .frame(width: 54)
            VStack(alignment: .leading, spacing: 3) {
                Text(meeting.title).font(Theme.geist(.body, .semibold)).lineLimit(1).foregroundStyle(.primary)
                Text("With \(ps.prefix(2).map(\.fullName).joined(separator: ", "))\(ps.count > 2 ? " and \(ps.count - 2) more" : "")")
                    .font(Theme.geist(.footnote)).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 4)
            AvatarStack(people: ps, size: 26)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

struct TripRow: View {
    @Environment(AppModel.self) private var model
    let trip: CalendarService.Trip

    var body: some View {
        let n = CalendarService.shared.nearby(trip, model: model).count
        HStack(spacing: 12) {
            Image(systemName: "airplane")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.info)
                .frame(width: 38, height: 38)
                .background(Theme.info.opacity(0.14), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text("\(trip.city), \(trip.when)").font(Theme.geist(.body, .semibold)).foregroundStyle(.primary).lineLimit(1)
                Text(n == 0 ? "Nobody you know is placed nearby yet" : "\(n) \(n == 1 ? "person" : "people") you know nearby")
                    .font(Theme.geist(.footnote)).foregroundStyle(n == 0 ? .secondary : Theme.good)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

struct MeetingView: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var also: [String: [String]] = [:]
    @State private var writingTo: String?

    var body: some View {
        if let m = CalendarService.shared.meeting(id) {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(m.title).geist(.title2, .bold)
                        Text("\(m.start.formatted(date: .complete, time: .shortened))\(m.location.isEmpty ? "" : "\n\(m.location)")")
                            .font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                    }
                    .listRowBackground(Color.clear)
                }
                ForEach(model.persons(m.matched)) { p in
                    Section { brief(p, meeting: m) }
                }
                let others = m.attendees.filter { $0.k == nil }
                if !others.isEmpty {
                    Section("Also attending") {
                        ForEach(others, id: \.self) { a in
                            VStack(alignment: .leading) {
                                Text(a.name.isEmpty ? a.email : a.name)
                                if !a.email.isEmpty && !a.name.isEmpty { Text(a.email).font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                    }
                }
                ForEach(also.keys.sorted(), id: \.self) { co in
                    let ps = model.persons(also[co] ?? [])
                    if !ps.isEmpty {
                        Section("Others you know at \(co)") {
                            ForEach(ps) { p in NavigationLink(value: Route.person(p.k)) { PersonRow(person: p, lens: model.info.lens) } }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Meeting prep")
            .navigationBarTitleDisplayMode(.inline)
            .task(id: id) {
                for k in m.matched { await model.loadFull(k) }
                also = await model.alsoAt(m.matched)
            }
            .sheet(item: Binding(get: { writingTo.map { IDString(id: $0) } }, set: { writingTo = $0?.id })) { w in
                MessageSheet(k: w.id, meeting: m.title)
            }
        } else {
            ContentUnavailableView("Meeting not found", systemImage: "calendar", description: Text("It may have moved or been cancelled."))
        }
    }

    @ViewBuilder private func brief(_ p: Person, meeting: CalendarService.Meeting) -> some View {
        NavigationLink(value: Route.person(p.k)) { PersonRow(person: p, lens: model.info.lens) }
        if let x = p.rx, !x.t.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(Band.label(p.band)). \(x.dir == "i" ? "\(p.f) wrote you" : "You wrote") \(Day.ago(x.t)).")
                    .font(Theme.geist(.subheadline, .medium))
                if !x.s.isEmpty { Text("“\(x.s)”").font(Theme.geist(.footnote)).foregroundStyle(.secondary) }
            }
        } else {
            Text("No LinkedIn messages with \(p.f) yet.").font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
        }
        if let note = p.ed?.note, !note.isEmpty {
            Text(note).font(Theme.geist(.footnote))
        }
        if p.moved, let was = p.pv?.first {
            Text("New role since your last refresh. Was \(was.p) at \(was.c).").font(Theme.geist(.footnote)).foregroundStyle(Theme.info)
        }
        if let due = p.ed?.due, !due.isEmpty {
            Text("You planned to follow up \(Day.nice(due)).").font(Theme.geist(.footnote)).foregroundStyle(Theme.violet)
        }
        Button { writingTo = p.k } label: { Label("Write a follow-up", systemImage: "square.and.pencil") }
    }
}

struct IDString: Identifiable { let id: String }

struct TripView: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var radius = 50.0
    @State private var writingTo: String?

    var body: some View {
        if let t = CalendarService.shared.trip(id) {
            let near = CalendarService.shared.nearby(t, model: model, miles: radius)
            List {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(t.city).geist(.title2, .bold)
                        Text(t.when + (t.source == "calendar" ? ", from your calendar" : "")).font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                    }
                    .listRowBackground(Color.clear)
                    Map(initialPosition: .region(MKCoordinateRegion(center: t.coordinate, latitudinalMeters: radius * 3600, longitudinalMeters: radius * 3600))) {
                        MapCircle(center: t.coordinate, radius: radius * 1609.344).foregroundStyle(Theme.amber.opacity(0.12)).stroke(Theme.amber.opacity(0.6), lineWidth: 1)
                        ForEach(Array(Set(near.map { $0.1.name })), id: \.self) { name in
                            if let pl = near.first(where: { $0.1.name == name })?.1 {
                                Marker(name, systemImage: "person.2.fill", coordinate: pl.coordinate).tint(Theme.violet)
                            }
                        }
                    }
                    .frame(height: 220)
                    .listRowInsets(EdgeInsets())
                    Picker("Distance", selection: $radius) {
                        Text("25 mi").tag(25.0); Text("50 mi").tag(50.0); Text("100 mi").tag(100.0)
                    }
                    .pickerStyle(.segmented)
                }
                Section {
                    if near.isEmpty {
                        Text("Nobody you know is placed near \(t.city) yet. Match with your Contacts, or set locations on companies and people.")
                            .font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
                    }
                    ForEach(near, id: \.0.k) { p, pl, miles in
                        HStack {
                            NavigationLink(value: Route.person(p.k)) {
                                VStack(alignment: .leading, spacing: 2) {
                                    PersonRow(person: p, lens: model.info.lens)
                                    Text("\(pl.name), \(miles < 1 ? "in town" : "\(Int(miles.rounded())) mi")").font(.caption).foregroundStyle(.secondary).padding(.leading, 54)
                                }
                            }
                        }
                        .swipeActions {
                            Button { writingTo = p.k } label: { Label("Message", systemImage: "square.and.pencil") }.tint(Theme.violet)
                        }
                    }
                } header: {
                    Text("\(near.count) \(near.count == 1 ? "person" : "people") within \(Int(radius)) miles")
                } footer: {
                    if !near.isEmpty { Text("Swipe left on someone to write an “I’ll be in town” message.") }
                }
                if t.source == "you" {
                    Section {
                        Button("Remove this trip", role: .destructive) {
                            CalendarService.shared.removeTrip(t)
                            model.paths[model.tab]?.removeLast()
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Trip")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(item: Binding(get: { writingTo.map { IDString(id: $0) } }, set: { writingTo = $0?.id })) { w in
                MessageSheet(k: w.id, trip: (t.city.components(separatedBy: ",").first ?? t.city, t.whenPhrase))
            }
        } else {
            ContentUnavailableView("Trip not found", systemImage: "airplane", description: Text("It may have been removed from your calendar."))
        }
    }
}

struct TripsView: View {
    @Environment(AppModel.self) private var model
    @State private var adding = false
    @State private var city = ""
    @State private var start = Date()
    @State private var end = Date().addingTimeInterval(2 * 86400)

    var body: some View {
        List {
            Section {
                ForEach(CalendarService.shared.trips) { t in
                    NavigationLink(value: Route.trip(t.id)) { TripRow(trip: t) }
                        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                        .listRowBackground(Color.clear)
                }
                if CalendarService.shared.trips.isEmpty {
                    Text(CalendarService.shared.enabled ? "No trips found in the next two months. Add one below." : "Add a trip, or turn on your calendar in Settings so Bearings finds them for you.")
                        .foregroundStyle(.secondary)
                }
            }
            Section("Add a trip") {
                TextField("City, like Tampa, FL", text: $city)
                DatePicker("From", selection: $start, displayedComponents: .date)
                DatePicker("To", selection: $end, in: start..., displayedComponents: .date)
                Button("Add trip") {
                    Task {
                        if await CalendarService.shared.addTrip(city, start: start, end: end) {
                            city = ""
                            Haptic.success()
                        } else { model.show("Couldn’t find “\(city)”") }
                    }
                }
                .disabled(city.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .navigationTitle("Trips")
    }
}
