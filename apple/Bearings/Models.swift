import Foundation
import SwiftUI

// Shapes returned by the engine (src/engine.js). Decoding is lenient so an odd
// value in someone's saved notes never stops the whole network from loading.

extension KeyedDecodingContainer {
    func lenient<T: Decodable>(_ type: T.Type, _ key: Key) -> T? {
        (try? decodeIfPresent(T.self, forKey: key)) ?? nil
    }
    func lenientInt(_ key: Key) -> Int? {
        if let i = lenient(Int.self, key) { return i }
        if let d = lenient(Double.self, key) { return Int(d) }
        if let b = lenient(Bool.self, key) { return b ? 1 : 0 }
        return nil
    }
    func lenientBool(_ key: Key) -> Bool {
        if let b = lenient(Bool.self, key) { return b }
        if let i = lenient(Int.self, key) { return i != 0 }
        return false
    }
}

struct EngineInfo: Decodable, Equatable {
    var mode: String
    var count: Int
    var removed: Int
    var hasRel: Bool
    var lens: Bool
    var lensAuto: Bool
    var lastImport: String
    var relImport: String
    var rev: String
    var deckCount: Int
    var today: String
    var edits: Int
    var targets: Int
    var empty: Bool?

    var isSample: Bool { mode == "sample" }
    /// A starter network built from the phone's contacts, waiting for a LinkedIn export.
    var isStarter: Bool { mode == "starter" }
    static let blank = EngineInfo(mode: "sample", count: 0, removed: 0, hasRel: false, lens: false, lensAuto: false, lastImport: "", relImport: "", rev: "", deckCount: 0, today: "", edits: 0, targets: 0, empty: true)
}

struct Classification: Decodable, Hashable {
    var seg = "", branch = "", status = "", rank = "", grade = "", tier = ""
    var gn: Double = 0
    var sen = "", fn = "", agency = ""
    var certs: [String] = []
    var clr = false
    var lv = 4
    var ind = "", indHow = ""

    enum K: String, CodingKey { case seg, branch, status, rank, grade, tier, gn, sen, fn = "func", agency, certs, clr, lv, ind, indHow }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        seg = c.lenient(String.self, .seg) ?? ""
        branch = c.lenient(String.self, .branch) ?? ""
        status = c.lenient(String.self, .status) ?? ""
        rank = c.lenient(String.self, .rank) ?? ""
        grade = c.lenient(String.self, .grade) ?? ""
        tier = c.lenient(String.self, .tier) ?? ""
        gn = c.lenient(Double.self, .gn) ?? 0
        sen = c.lenient(String.self, .sen) ?? ""
        fn = c.lenient(String.self, .fn) ?? ""
        agency = c.lenient(String.self, .agency) ?? ""
        certs = c.lenient([String].self, .certs) ?? []
        clr = c.lenientBool(.clr)
        lv = c.lenientInt(.lv) ?? 4
        ind = c.lenient(String.self, .ind) ?? ""
        indHow = c.lenient(String.self, .indHow) ?? ""
    }
}

struct Relationship: Decodable, Hashable {
    var m = 0, o = 0, i = 0
    var f = "", t = "", dir = "", s = ""
    var inv = "", invd = "", invn = ""
    var eg = 0, er = 0, rg = 0, rr = 0

    enum K: String, CodingKey { case m, o, i, f, t, dir, s, inv, invd, invn, eg, er, rg, rr }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        m = c.lenientInt(.m) ?? 0; o = c.lenientInt(.o) ?? 0; i = c.lenientInt(.i) ?? 0
        f = c.lenient(String.self, .f) ?? ""; t = c.lenient(String.self, .t) ?? ""
        dir = c.lenient(String.self, .dir) ?? ""; s = c.lenient(String.self, .s) ?? ""
        inv = c.lenient(String.self, .inv) ?? ""; invd = c.lenient(String.self, .invd) ?? ""; invn = c.lenient(String.self, .invn) ?? ""
        eg = c.lenientInt(.eg) ?? 0; er = c.lenientInt(.er) ?? 0; rg = c.lenientInt(.rg) ?? 0; rr = c.lenientInt(.rr) ?? 0
    }
}

struct Edit: Decodable, Hashable {
    var star = false
    var note = "", due = "", replied = "", updated = ""
    var tags: [String] = []
    var ind = "", seg = "", branch = "", status = "", grade = "", rank = ""
    var loc = ""
    var lat: Double?, lon: Double?

    enum K: String, CodingKey { case star, note, due, replied, updated, tags, ind, seg, branch, status, grade, rank, loc, lat, lon }
    init() {}
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        star = c.lenientBool(.star)
        note = c.lenient(String.self, .note) ?? ""
        due = c.lenient(String.self, .due) ?? ""
        replied = c.lenient(String.self, .replied) ?? ""
        updated = c.lenient(String.self, .updated) ?? ""
        tags = c.lenient([String].self, .tags) ?? (c.lenient(String.self, .tags).map { [$0] } ?? [])
        ind = c.lenient(String.self, .ind) ?? ""
        seg = c.lenient(String.self, .seg) ?? ""
        branch = c.lenient(String.self, .branch) ?? ""
        status = c.lenient(String.self, .status) ?? ""
        grade = c.lenient(String.self, .grade) ?? ""
        rank = c.lenient(String.self, .rank) ?? ""
        loc = c.lenient(String.self, .loc) ?? ""
        lat = c.lenient(Double.self, .lat)
        lon = c.lenient(Double.self, .lon)
    }
}

struct PastRole: Decodable, Hashable {
    var c = "", p = "", until = ""
    enum K: String, CodingKey { case c, p, until }
    init(from d: Decoder) throws {
        let k = try d.container(keyedBy: K.self)
        c = k.lenient(String.self, .c) ?? ""; p = k.lenient(String.self, .p) ?? ""; until = k.lenient(String.self, .until) ?? ""
    }
}

struct PersonLinks: Decodable, Hashable {
    var profile: String
    var salesNav: String
}

struct Person: Decodable, Identifiable, Hashable {
    var k: String
    var f: String, l: String, name: String
    var u: String, e: String, c: String, p: String, d: String
    var cl: Classification
    var group: String, color: String, indColor: String, indShort: String
    var band: String, score: Int
    var isNew: Bool, moved: Bool, waiting: Bool, cooling: Bool, due: Bool, anniv: Bool
    var x: String?, jc: String?, fs: String?
    var pv: [PastRole]?
    var rx: Relationship?
    var ed: Edit?
    var links: PersonLinks?

    var id: String { k }
    var starred: Bool { ed?.star ?? false }
    var fullName: String { "\(f) \(l)".trimmingCharacters(in: .whitespaces) }
    var initials: String {
        let a = f.first.map(String.init) ?? "?"
        let b = l.first.map(String.init) ?? ""
        return (a + b).uppercased()
    }
    var tint: Color { Color(hex: color) }
    var subtitle: String { [p, c].filter { !$0.isEmpty }.joined(separator: " · ") }

    enum K: String, CodingKey { case k, f, l, name, u, e, c, p, d, cl, group, color, indColor, indShort, band, score, isNew, moved, waiting, cooling, due, anniv, x, jc, fs, pv, rx, ed, links }
    init(from dec: Decoder) throws {
        let c = try dec.container(keyedBy: K.self)
        k = try c.decode(String.self, forKey: .k)
        f = c.lenient(String.self, .f) ?? ""; l = c.lenient(String.self, .l) ?? ""
        name = c.lenient(String.self, .name) ?? ""
        u = c.lenient(String.self, .u) ?? ""; e = c.lenient(String.self, .e) ?? ""
        self.c = c.lenient(String.self, .c) ?? ""; p = c.lenient(String.self, .p) ?? ""; d = c.lenient(String.self, .d) ?? ""
        cl = (try? c.decode(Classification.self, forKey: .cl)) ?? (try! JSONDecoder().decode(Classification.self, from: Data("{}".utf8)))
        group = c.lenient(String.self, .group) ?? ""; color = c.lenient(String.self, .color) ?? "#8F89A8"
        indColor = c.lenient(String.self, .indColor) ?? "#8F89A8"; indShort = c.lenient(String.self, .indShort) ?? ""
        band = c.lenient(String.self, .band) ?? "none"; score = c.lenientInt(.score) ?? 0
        isNew = c.lenientBool(.isNew); moved = c.lenientBool(.moved); waiting = c.lenientBool(.waiting)
        cooling = c.lenientBool(.cooling); due = c.lenientBool(.due); anniv = c.lenientBool(.anniv)
        x = c.lenient(String.self, .x); jc = c.lenient(String.self, .jc); fs = c.lenient(String.self, .fs)
        pv = c.lenient([PastRole].self, .pv)
        rx = c.lenient(Relationship.self, .rx)
        ed = c.lenient(Edit.self, .ed)
        links = c.lenient(PersonLinks.self, .links)
    }
}

enum Band {
    static func label(_ b: String) -> String {
        switch b {
        case "strong": return "Close"
        case "warm": return "Warm"
        case "light": return "Light touch"
        default: return "No real contact"
        }
    }
    static func color(_ b: String) -> Color {
        switch b {
        case "strong": return Theme.good
        case "warm": return Theme.accent
        case "light": return Theme.info
        default: return .secondary
        }
    }
}

// MARK: home

struct CardAction: Decodable, Hashable {
    var kind: String
    var tab: String?
    var name: String?
    var sig: [String]?
    var seg: [String]?
    var status: [String]?
}

struct HomeCard: Decodable, Hashable, Identifiable {
    var tone: String
    var icon: String
    var title: String
    var body: String
    var people: [String]
    var act: CardAction
    var hero: Bool?
    var ring: Int?
    var bars: [Bar]?
    var id: String { title }

    struct Bar: Decodable, Hashable {
        var id: String, n: Int, color: String
        init(from d: Decoder) throws {
            var c = try d.unkeyedContainer()
            id = try c.decode(String.self); n = try c.decode(Int.self); color = try c.decode(String.self)
        }
    }
}

struct HomeStat: Decodable, Hashable, Identifiable {
    var id: String
    var label: String
    var value: Int
    var detail: String
    var up: Bool?
    var act: CardAction
}

struct HomeData: Decodable {
    var stats: [HomeStat]
    var cards: [HomeCard]
    static let empty = HomeData(stats: [], cards: [])
}

// MARK: search

struct SearchResult: Decodable {
    var keys: [String]
    var chips: [String]
    var count: Int
}

/// A count list from the engine: [value, count] or [value, count, color] or [value, label, count].
struct FacetItem: Decodable, Hashable, Identifiable {
    var value: String
    var label: String
    var count: Int
    var color: String?
    var id: String { value }

    init(from d: Decoder) throws {
        var c = try d.unkeyedContainer()
        value = try c.decode(String.self)
        if let n = try? c.decode(Int.self) {
            count = n
            label = value
            color = try? c.decode(String.self)
        } else {
            label = (try? c.decode(String.self)) ?? value
            count = (try? c.decode(Int.self)) ?? 0
        }
    }
}

struct Facets: Decodable {
    var total: Int
    var sig: [FacetItem]
    var rel: [FacetItem]
    var ind: [FacetItem]
    var sen: [FacetItem]
    var fn: [FacetItem]
    var cert: [FacetItem]
    var company: [FacetItem]
    var seg: [FacetItem]
    var branch: [FacetItem]
    var status: [FacetItem]
    var tier: [FacetItem]
    var agency: [FacetItem]

    enum K: String, CodingKey { case total, sig, rel, ind, sen, fn = "func", cert, company, seg, branch, status, tier, agency }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        total = c.lenientInt(.total) ?? 0
        func list(_ k: K) -> [FacetItem] { c.lenient([FacetItem].self, k) ?? [] }
        sig = list(.sig); rel = list(.rel); ind = list(.ind); sen = list(.sen); fn = list(.fn); cert = list(.cert)
        company = list(.company); seg = list(.seg); branch = list(.branch); status = list(.status); tier = list(.tier); agency = list(.agency)
    }
}

/// Mirrors the engine's filter object.
struct Filters: Equatable {
    var rel: Set<String> = []
    var seg: Set<String> = []
    var branch: Set<String> = []
    var status: Set<String> = []
    var tier: Set<String> = []
    var sen: Set<String> = []
    var fn: Set<String> = []
    var ind: Set<String> = []
    var cert: Set<String> = []
    var sig: Set<String> = []
    var agency = ""
    var company = ""
    var since = ""
    var removed = false

    var activeCount: Int {
        rel.count + seg.count + branch.count + status.count + tier.count + sen.count + fn.count + ind.count + cert.count + sig.count
            + (agency.isEmpty ? 0 : 1) + (company.isEmpty ? 0 : 1) + (since.isEmpty ? 0 : 1) + (removed ? 1 : 0)
    }
    var isEmpty: Bool { activeCount == 0 }

    var json: [String: Any] {
        ["rel": Array(rel), "seg": Array(seg), "branch": Array(branch), "status": Array(status), "tier": Array(tier),
         "sen": Array(sen), "func": Array(fn), "ind": Array(ind), "cert": Array(cert), "sig": Array(sig),
         "agency": agency, "company": company, "since": since, "removed": removed]
    }
}

enum SortOrder: String, CaseIterable, Identifiable {
    case new, name, level, warm, rank
    var id: String { rawValue }
    var label: String {
        switch self {
        case .new: return "Newest connections"
        case .name: return "Last name"
        case .level: return "Most senior"
        case .warm: return "Closest relationships"
        case .rank: return "Rank"
        }
    }
}

// MARK: companies

struct TargetSummary: Decodable, Identifiable, Hashable {
    var name: String
    var note: String
    var count: Int
    var stars: Int
    var news: Int
    var score: Int
    var lv: [Int]
    var gap: String
    var gaps: [String]
    var id: String { name }
}

struct UnitDetail: Decodable {
    struct Rung: Decodable, Identifiable { var lv: Int; var label: String; var keys: [String]; var id: Int { lv } }
    struct Ind: Decodable { var auto: String; var set: String }
    struct Links: Decodable { var company: String; var companyExact: Bool; var peopleAt: String; var salesNav: String }
    struct Location: Decodable { var name: String; var lat: Double; var lon: Double }
    var location: Location?
    struct Alumnus: Decodable, Identifiable { var k: String; var was: String; var until: String; var id: String { k } }
    var alumni: [Alumnus]?
    var name: String
    var count: Int
    var score: Int
    var lv: [Int]
    var gaps: [String]
    var isTarget: Bool
    var note: String
    var isCompany: Bool
    var industry: Ind
    var rungs: [Rung]
    var links: Links
}

struct NameCount: Decodable, Hashable, Identifiable {
    var name: String
    var count: Int
    var color: String?
    var id: String { name }
    init(from d: Decoder) throws {
        var c = try d.unkeyedContainer()
        name = try c.decode(String.self)
        count = (try? c.decode(Int.self)) ?? 0
        color = try? c.decode(String.self)
    }
}

struct Orgs: Decodable {
    var companies: [NameCount]
    var agencies: [NameCount]
}

struct IndustriesData: Decodable {
    struct Summary: Decodable { var industries: Int; var outside: Int; var classifiedPct: Int }
    struct Tile: Decodable, Identifiable { var id: String; var n: Int; var x: Double; var y: Double; var w: Double; var h: Double; var color: String; var short: String }
    struct Row: Decodable, Identifiable { var id: String; var color: String; var short: String; var count: Int; var pct: Int; var companies: Int; var top: [String]; var mix: [Int] }
    struct Guess: Decodable, Identifiable, Hashable {
        var name: String; var count: Int; var ind: String
        var id: String { name }
        init(from d: Decoder) throws {
            var c = try d.unkeyedContainer()
            name = try c.decode(String.self); count = try c.decode(Int.self); ind = try c.decode(String.self)
        }
    }
    var summary: Summary
    var govCount: Int
    var tiles: [Tile]
    var list: [Row]
    var unclassified: [NameCount]
    var unclassifiedTotal: Int
    var guesses: [Guess]
    var tagged: Int
}

struct IndustryDetail: Decodable {
    var id: String
    var color: String
    var short: String
    var count: Int
    var companies: Int
    var vets: Int
    var stars: Int
    var mix: [Int]
    var senior: [String]
    var top: [NameCount]
    var funcs: [NameCount]
}

struct RanksData: Decodable {
    struct Row: Decodable, Identifiable { var tier: String; var sub: String; var cells: [Int]; var total: Int; var id: String { tier } }
    var branches: [String]
    var max: Int
    var rows: [Row]
    var totals: [Int]
    var total: Int
}

struct RadarData: Decodable {
    struct Wedge: Decodable, Identifiable { var id: String; var short: String; var color: String; var a0: Double; var a1: Double; var n: Int }
    struct Dot: Decodable { var k: String; var x: Double; var y: Double; var c: String; var big: Bool }
    var wedges: [Wedge]
    var dots: [Dot]
    var bands: [Double]
    static let empty = RadarData(wedges: [], dots: [], bands: [0.15, 0.37, 0.58, 0.79, 1])
}

struct Payoff: Decodable {
    var total: Int
    var companies: Int
    var execs: Int
    var dirs: Int
    var industries: Int
    var top: [NameCount]
    var sample: [String]
}

struct ImportStats: Decodable {
    var total: Int
    var added: Int
    var changed: Int
    var removed: Int
    var first: Bool
    var rel: Int?
}

struct ImportPlan: Decodable {
    var stats: ImportStats
    var wasSample: Bool
    var wasStarter: Bool?
}

struct StarterResult: Decodable {
    var count: Int
    var companies: Int
    var wasSample: Bool
}

struct RestoreResult: Decodable {
    var added: Int
    var kept: Int
}

struct Reminder: Decodable {
    var k: String
    var due: String
    var title: String
    var body: String
}

struct IndustryInfo: Decodable, Identifiable, Hashable {
    var id: String
    var short: String
    var color: String
}

struct Constants: Decodable {
    var industries: [IndustryInfo]
    var seniority: [String]
    var funcs: [String]
    var branches: [String]
    var statuses: [String]
    var grades: [String]
    var unclassified: String
    var gov: String
    var since: [[String]]
    var segs: [SegInfo]
    struct SegInfo: Decodable, Hashable { var id: String; var short: String; var color: String }
    static let empty = Constants(industries: [], seniority: [], funcs: [], branches: [], statuses: [], grades: [], unclassified: "Unclassified", gov: "Government & Military", since: [], segs: [])
}

struct ClustersData: Decodable {
    struct Hub: Decodable, Identifiable { var name: String; var seg: String; var color: String; var other: Bool; var n: Int; var x: Double; var y: Double; var R: Double; var id: String { name } }
    struct Dot: Decodable { var k: String; var h: Int; var x: Double; var y: Double; var c: String; var y0: Int; var star: Bool; var w: String }
    var hubs: [Hub]
    var people: [Dot]
    var minYear: Int
    var maxYear: Int
}

struct DraftMessage: Decodable, Identifiable, Hashable {
    var id: String
    var label: String
    var text: String
}
