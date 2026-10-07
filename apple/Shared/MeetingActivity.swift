#if os(iOS) && !targetEnvironment(macCatalyst)
import ActivityKit
import Foundation

/// Your next meeting with someone you know, on the Lock Screen and in the Dynamic Island:
/// who, when, and what you talked about last time.
struct MeetingActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// The person you know best in the meeting, and what to remember about them.
        var name: String
        var initials: String
        var color: String
        var memory: String
        /// Others you know in the meeting.
        var others: Int
    }
    var meetingID: String
    var title: String
    var start: Date
    var end: Date
    var k: String
}
#endif
