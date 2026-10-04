import SwiftUI
import MapKit
import CoreLocation

/// Asks for the current location once.
@MainActor
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var waiting: CheckedContinuation<CLLocation?, Never>?

    func current() async -> CLLocation? {
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
        return await withCheckedContinuation { c in
            waiting = c
            manager.requestLocation()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let loc = locations.last
        Task { @MainActor in self.finish(loc) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.finish(nil) }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let s = manager.authorizationStatus
        Task { @MainActor in
            if s == .authorizedWhenInUse || s == .authorizedAlways { self.manager.requestLocation() }
            else if s == .denied || s == .restricted { self.finish(nil) }
        }
    }

    private func finish(_ loc: CLLocation?) {
        waiting?.resume(returning: loc)
        waiting = nil
    }
}

struct PlaceGroup: Identifiable {
    let name: String
    let coordinate: CLLocationCoordinate2D
    let approximate: Bool
    var people: [Person]
    var id: String { name }
}

struct PeopleMapView: View {
    @Environment(AppModel.self) private var model
    @State private var camera: MapCameraPosition = .automatic
    @State private var center: CLLocationCoordinate2D?
    @State private var centerName = ""
    @State private var radius = 50.0
    @State private var query = ""
    @State private var finding = false
    @State private var selected: PlaceGroup?
    @State private var locator = LocationProvider()

    private var groups: [PlaceGroup] {
        var byName: [String: PlaceGroup] = [:]
        for (k, pl) in model.places {
            guard let p = model.person(k), p.x == nil else { continue }
            if byName[pl.name] == nil {
                byName[pl.name] = PlaceGroup(name: pl.name, coordinate: pl.coordinate, approximate: pl.isApproximate, people: [])
            }
            byName[pl.name]?.people.append(p)
        }
        return byName.values.map { g in
            var g = g
            g.people.sort { $0.score > $1.score || ($0.score == $1.score && $0.cl.lv < $1.cl.lv) }
            return g
        }
    }

    private var nearby: [(PlaceGroup, Double)] {
        guard let c = center else { return [] }
        return groups.map { ($0, $0.coordinate.miles(to: c)) }
            .filter { $0.1 <= radius && !$0.0.approximate }
            .sorted { $0.1 < $1.1 }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            controls
            map
            if model.places.isEmpty || (!model.info.isSample && model.placesBuilt.isEmpty) { explainer }
            if center != nil { nearbyList } else { topPlaces }
            footnote
        }
        .sheet(item: $selected) { g in PlaceSheet(group: g) }
    }

    private var controls: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Where are you headed?", text: $query)
                    .submitLabel(.search)
                    .onSubmit { Task { await search() } }
                if finding { ProgressView().controlSize(.small) }
                Button {
                    Task { await nearMe() }
                } label: {
                    Label("Near me", systemImage: "location.fill").labelStyle(.iconOnly)
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("People near me")
            }
            .padding(.leading, 12)
            .padding(4)
            .background(Color(.secondarySystemGroupedBackground), in: Capsule())
            NavigationLink(value: Route.trips) {
                Label("Trips: see who’s near where you’re going", systemImage: "airplane")
                    .font(Theme.geist(.subheadline, .semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if center != nil {
                Picker("Distance", selection: $radius) {
                    Text("25 mi").tag(25.0)
                    Text("50 mi").tag(50.0)
                    Text("100 mi").tag(100.0)
                    Text("250 mi").tag(250.0)
                }
                .pickerStyle(.segmented)
            }
        }
    }

    private var map: some View {
        Map(position: $camera) {
            ForEach(groups) { g in
                Annotation(g.name, coordinate: g.coordinate, anchor: .center) {
                    Button { selected = g } label: { bubble(g) }
                        .buttonStyle(.plain)
                }
                .annotationTitles(.hidden)
            }
            if let c = center {
                MapCircle(center: c, radius: radius * 1609.344)
                    .foregroundStyle(Theme.amber.opacity(0.12))
                    .stroke(Theme.amber.opacity(0.7), lineWidth: 1.5)
                Marker(centerName.isEmpty ? "You" : centerName, systemImage: "location.north.fill", coordinate: c)
                    .tint(Theme.amber)
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .frame(height: 380)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func bubble(_ g: PlaceGroup) -> some View {
        let n = g.people.count
        let size: CGFloat = n >= 50 ? 44 : n >= 10 ? 36 : 28
        return Text(n.formatted())
            .font(.system(size: size * 0.38, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Circle().fill(g.approximate ? Color.gray.opacity(0.8) : Theme.violet))
            .overlay(Circle().stroke(.white, lineWidth: 2))
            .shadow(color: .black.opacity(0.2), radius: 3, y: 1)
    }

    private var explainer: some View {
        Callout(icon: "person.crop.circle.badge.questionmark", tint: Theme.info, title: "Find out where people are",
                text: "LinkedIn’s export doesn’t say where people live. Bearings can work it out on this device from their cards in your iPhone Contacts (address, then phone area code) and from places named in their titles. Nothing leaves your devices.",
                button: model.locating ? "Working…" : "Use my Contacts") {
            Task { await model.locate() }
        }
    }

    @ViewBuilder private var nearbyList: some View {
        let list = nearby
        let total = list.reduce(0) { $0 + $1.0.people.count }
        HStack {
            Text("\(total.formatted()) \(total == 1 ? "person" : "people") within \(Int(radius)) miles\(centerName.isEmpty ? "" : " of \(centerName)")")
                .font(Theme.geist(.headline))
            Spacer()
            Button("Clear") { center = nil; centerName = ""; camera = .automatic }
        }
        if list.isEmpty {
            Text("Nobody you know is placed nearby yet. Try a wider distance, or set people’s locations from their profiles.")
                .font(Theme.geist(.subheadline)).foregroundStyle(.secondary)
        }
        ForEach(list, id: \.0.id) { g, miles in
            groupCard(g, detail: miles < 1 ? "here" : "\(Int(miles.rounded())) mi")
        }
    }

    @ViewBuilder private var topPlaces: some View {
        let top = groups.sorted { $0.people.count > $1.people.count }.prefix(12)
        if !top.isEmpty {
            Text("Where your people are").font(Theme.geist(.headline))
            ForEach(Array(top)) { g in groupCard(g, detail: g.approximate ? "somewhere in" : nil) }
        }
    }

    private func groupCard(_ g: PlaceGroup, detail: String?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { selected = g } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(g.name).font(Theme.geist(.body, .semibold)).foregroundStyle(.primary)
                        Text("\(g.people.count.formatted()) \(g.people.count == 1 ? "person" : "people")\(g.approximate ? ", roughly placed" : "")")
                            .font(Theme.geist(.footnote)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if let d = detail, !g.approximate || d != "somewhere in" { Text(d).font(.callout.monospacedDigit()).foregroundStyle(.secondary) }
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                }
                .padding(14)
            }
            .buttonStyle(.plain)
            ForEach(g.people.prefix(3)) { p in
                Divider().padding(.leading, 14)
                Button { model.open(.person(p.k)) } label: {
                    PersonRow(person: p, lens: model.info.lens).padding(.horizontal, 14).padding(.vertical, 6)
                }
                .buttonStyle(.plain)
            }
        }
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var footnote: some View {
        Text(model.info.isSample
             ? "Sample network: locations are made up."
             : "\(model.places.count.formatted()) of \(model.info.count.formatted()) people placed\(model.contactsMatched > 0 ? ", \(model.contactsMatched.formatted()) matched to your Contacts" : ""). Set anyone’s location from their profile. Place data from GeoNames and Google’s libphonenumber.")
            .font(Theme.geist(.caption)).foregroundStyle(.secondary)
    }

    private func focus(_ c: CLLocationCoordinate2D, _ name: String) {
        center = c
        centerName = name
        withAnimation {
            camera = .region(MKCoordinateRegion(center: c, latitudinalMeters: radius * 1609.344 * 2.6, longitudinalMeters: radius * 1609.344 * 2.6))
        }
    }

    private func nearMe() async {
        finding = true
        defer { finding = false }
        guard let loc = await locator.current() else {
            model.show("Location isn’t available. Allow it in Settings, or search for a city.")
            return
        }
        let name = (try? await CLGeocoder().reverseGeocodeLocation(loc).first)?.locality ?? ""
        focus(loc.coordinate, name)
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        finding = true
        defer { finding = false }
        guard let m = try? await CLGeocoder().geocodeAddressString(q).first, let loc = m.location else {
            model.show("Couldn’t find “\(q)”")
            return
        }
        focus(loc.coordinate, m.locality ?? q)
    }
}

struct PlaceSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let group: PlaceGroup

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(group.people) { p in
                        Button {
                            dismiss()
                            model.open(.person(p.k))
                        } label: {
                            PersonRow(person: p, lens: model.info.lens)
                        }
                        .buttonStyle(.plain)
                    }
                } footer: {
                    if group.approximate { Text("These people are only placed somewhere in \(group.name), usually from a phone area code that covers the whole region.") }
                }
            }
            .navigationTitle(group.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}
