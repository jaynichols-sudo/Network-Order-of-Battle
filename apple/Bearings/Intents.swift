import AppIntents
import CoreSpotlight
import UniformTypeIdentifiers
import UIKit

// Siri, Shortcuts and Spotlight.

struct PersonEntity: AppEntity, Identifiable {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Person"
    static var defaultQuery = PersonQuery()
    var id: String
    var name: String
    var detail: String
    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: "\(detail)")
    }

    @MainActor init(_ p: Person) {
        id = p.k
        name = p.fullName
        detail = p.subtitle
    }
}

struct PersonQuery: EntityStringQuery {
    @MainActor private func ready() async -> AppModel {
        let m = AppModel.shared
        await m.start()
        return m
    }

    func entities(for identifiers: [String]) async throws -> [PersonEntity] {
        let m = await ready()
        return await MainActor.run { identifiers.compactMap { m.person($0) }.map(PersonEntity.init) }
    }

    func entities(matching string: String) async throws -> [PersonEntity] {
        let m = await ready()
        let q = string.lowercased()
        return await MainActor.run {
            m.people.filter { $0.x == nil && ($0.fullName.lowercased().contains(q) || $0.c.lowercased().contains(q)) }
                .sorted { $0.score > $1.score }
                .prefix(20)
                .map(PersonEntity.init)
        }
    }

    func suggestedEntities() async throws -> [PersonEntity] {
        let m = await ready()
        return await MainActor.run {
            m.people.filter { $0.x == nil && ($0.starred || $0.waiting) }.prefix(20).map(PersonEntity.init)
        }
    }
}

struct OpenPersonIntent: AppIntent {
    static var title: LocalizedStringResource = "Open a person"
    static var description = IntentDescription("Opens someone’s profile in Bearings.")
    static var openAppWhenRun = true
    @Parameter(title: "Person") var person: PersonEntity

    @MainActor func perform() async throws -> some IntentResult {
        let m = AppModel.shared
        await m.start()
        m.tab = .people
        m.paths[.people] = [.person(person.id)]
        return .result()
    }
}

/// Sends text into Bearings to file against the people it mentions. Works from Shortcuts
/// (including a "Show in Share Sheet" shortcut) for apps that only share plain text.
struct AddMeetingNotesIntent: AppIntent {
    static var title: LocalizedStringResource = "Add meeting notes"
    static var description = IntentDescription("Matches notes or a transcript to the people you know, adds a short note to each, and turns action items into reminders.")
    static var openAppWhenRun = true
    @Parameter(title: "Notes", inputOptions: String.IntentInputOptions(multiline: true)) var text: String
    @Parameter(title: "From", default: "Shortcuts") var source: String

    @MainActor func perform() async throws -> some IntentResult {
        let m = AppModel.shared
        await m.start()
        await m.ingestNotes(text, source: source)
        return .result()
    }
}

struct WhoIsWaitingIntent: AppIntent {
    static var title: LocalizedStringResource = "Who’s waiting on me"
    static var description = IntentDescription("Lists the people who wrote last and are waiting on your reply.")

    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        let m = AppModel.shared
        await m.start()
        let list = m.people.filter { $0.waiting }.sorted { ($0.rx?.t ?? "") > ($1.rx?.t ?? "") }
        if list.isEmpty { return .result(dialog: "Nobody is waiting on a reply. You’re all caught up.") }
        let names = list.prefix(4).map(\.fullName).joined(separator: ", ")
        let more = list.count > 4 ? ", and \(list.count - 4) more" : ""
        return .result(dialog: "\(list.count) \(list.count == 1 ? "person is" : "people are") waiting on your reply: \(names)\(more).")
    }
}

struct FollowUpsDueIntent: AppIntent {
    static var title: LocalizedStringResource = "Follow-ups due"
    static var description = IntentDescription("Tells you which follow-ups are due today or overdue.")

    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        let m = AppModel.shared
        await m.start()
        let list = m.people.filter { $0.due }
        if list.isEmpty { return .result(dialog: "No follow-ups are due.") }
        let names = list.prefix(4).map(\.fullName).joined(separator: ", ")
        return .result(dialog: "\(list.count) \(list.count == 1 ? "follow-up is" : "follow-ups are") due: \(names)\(list.count > 4 ? ", and more" : "").")
    }
}

struct WhoIsNearbyIntent: AppIntent {
    static var title: LocalizedStringResource = "Who do I know nearby"
    static var description = IntentDescription("Opens the Bearings map near where you are.")
    static var openAppWhenRun = true

    @MainActor func perform() async throws -> some IntentResult {
        let m = AppModel.shared
        await m.start()
        UserDefaults.standard.set("map", forKey: "exploreMode")
        m.go("explore")
        return .result()
    }
}

struct BearingsShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: WhoIsWaitingIntent(), phrases: ["Who’s waiting on me in \(.applicationName)", "Who do I owe a reply in \(.applicationName)"],
                    shortTitle: "Waiting on me", systemImageName: "arrowshape.turn.up.left")
        AppShortcut(intent: FollowUpsDueIntent(), phrases: ["Follow-ups due in \(.applicationName)", "What follow-ups are due in \(.applicationName)"],
                    shortTitle: "Follow-ups due", systemImageName: "bell")
        AppShortcut(intent: WhoIsNearbyIntent(), phrases: ["Who do I know nearby in \(.applicationName)"],
                    shortTitle: "Who’s nearby", systemImageName: "location")
        AppShortcut(intent: AddMeetingNotesIntent(), phrases: ["Add meeting notes to \(.applicationName)", "File meeting notes in \(.applicationName)"],
                    shortTitle: "Add meeting notes", systemImageName: "text.badge.plus")
        AppShortcut(intent: QuickLogIntent(), phrases: ["Log a conversation in \(.applicationName)", "Add a note in \(.applicationName)", "Tell \(.applicationName) about a meeting"],
                    shortTitle: "Log a conversation", systemImageName: "mic")
        AppShortcut(intent: AskBearingsIntent(), phrases: ["Ask \(.applicationName)", "Ask \(.applicationName) about my network"],
                    shortTitle: "Ask Bearings", systemImageName: "sparkle.magnifyingglass")
        AppShortcut(intent: OpenPersonIntent(), phrases: ["Open \(\.$person) in \(.applicationName)", "Show \(\.$person) in \(.applicationName)"],
                    shortTitle: "Open a person", systemImageName: "person.crop.circle")
    }
}

/// Puts everyone in iPhone search. Tapping a result opens their profile.
enum SpotlightIndex {
    static let domain = "com.jaynichols.networkoob.people"

    @MainActor static func update(_ people: [Person], sample: Bool) {
        let index = CSSearchableIndex.default()
        var h: UInt64 = 5381
        for p in people { for b in (p.k + p.c + p.p).utf8 { h = (h &* 33) &+ UInt64(b) } }
        let sig = "\(people.count)-\(h)-\(sample)-\(PhotoStore.shared.count)"
        guard UserDefaults.standard.string(forKey: "spotlightSig") != sig else { return }
        let items: [CSSearchableItem] = sample ? [] : people.filter { $0.x == nil }.map { p in
            let a = CSSearchableItemAttributeSet(contentType: .contact)
            a.title = p.fullName
            a.contentDescription = p.subtitle
            a.keywords = [p.c, p.cl.ind, p.cl.agency].filter { !$0.isEmpty }
            if let img = PhotoStore.shared.image(for: p.k) { a.thumbnailData = img.jpegData(compressionQuality: 0.6) }
            return CSSearchableItem(uniqueIdentifier: p.k, domainIdentifier: domain, attributeSet: a)
        }
        index.deleteSearchableItems(withDomainIdentifiers: [domain]) { _ in
            guard !items.isEmpty else { return }
            index.indexSearchableItems(items) { _ in }
        }
        UserDefaults.standard.set(sig, forKey: "spotlightSig")
    }
}
