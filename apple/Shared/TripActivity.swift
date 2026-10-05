#if os(iOS) && !targetEnvironment(macCatalyst)
import ActivityKit
import Foundation

/// Trip mode on the Lock Screen and in the Dynamic Island: who you know near where you're going.
struct TripActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var nearby: Int
        var initials: [String]
        var names: [String]
        var lead: String
        var now: Bool
    }
    var tripID: String
    var city: String
    var when: String
}
#endif
