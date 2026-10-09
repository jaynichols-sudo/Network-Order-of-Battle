import XCTest

/// Smoke tests that tap through the main screens on the built-in sample network.
/// They run on every "native app check" build, beside the screenshots.
final class BearingsUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ args: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-onboarded", "YES"] + args
        app.launch()
        return app
    }

    private func text(_ app: XCUIApplication, containing s: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", s)).firstMatch
    }

    private func button(_ app: XCUIApplication, containing s: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", s)).firstMatch
    }

    /// A text field or multi-line text view, found by its placeholder. Waits up to `timeout`
    /// for either kind, since a vertical SwiftUI TextField can surface as a text view.
    private func field(_ app: XCUIApplication, placeholder s: String, timeout: TimeInterval = 30) -> XCUIElement {
        let p = NSPredicate(format: "placeholderValue CONTAINS %@", s)
        let one = app.textFields.matching(p).firstMatch, many = app.textViews.matching(p).firstMatch
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if one.exists { return one }
            if many.exists { return many }
            _ = one.waitForExistence(timeout: 1)
        }
        return one
    }

    /// Scrolls until the element shows, for rows further down a list.
    private func reveal(_ app: XCUIApplication, _ e: XCUIElement, swipes: Int = 5) {
        for _ in 0..<swipes where !(e.exists && e.isHittable) { app.swipeUp() }
    }

    func testTodayShowsTheWeekAndTheCompass() {
        let app = launch()
        XCTAssertTrue(text(app, containing: "need").waitForExistence(timeout: 30) || text(app, containing: "caught up").exists)
        XCTAssertTrue(text(app, containing: "waiting on you").waitForExistence(timeout: 10))
        XCTAssertTrue(text(app, containing: "Later").exists || text(app, containing: "five are done").exists || text(app, containing: "caught up").exists)
    }

    func testOpenSomeoneAndSeeTheirDetails() {
        let app = launch(["-demoOpen", "person"])
        let details = text(app, containing: "Details, location and notes")
        XCTAssertTrue(details.waitForExistence(timeout: 30))
        details.tap()
        let notes = text(app, containing: "Notes and corrections")
        for _ in 0..<4 where !notes.exists { app.swipeUp() }
        XCTAssertTrue(notes.waitForExistence(timeout: 10))
    }

    func testPeopleListAndQuickFilters() {
        let app = launch(["-startTab", "people"])
        XCTAssertTrue(text(app, containing: "people").waitForExistence(timeout: 30))
        let waiting = app.buttons["Waiting"]
        XCTAssertTrue(waiting.waitForExistence(timeout: 10))
        waiting.tap()
        XCTAssertTrue(text(app, containing: "Waiting on your reply").waitForExistence(timeout: 10))
    }

    func testYouTabReachesTeamPacksAndThePaywall() {
        let app = launch(["-startTab", "you"])
        let team = text(app, containing: "Team packs")
        XCTAssertTrue(team.waitForExistence(timeout: 30))
        team.tap()
        XCTAssertTrue(text(app, containing: "Share my pack").waitForExistence(timeout: 10))
        app.navigationBars.buttons.firstMatch.tap()
        let pro = text(app, containing: "Bearings Pro")
        XCTAssertTrue(pro.waitForExistence(timeout: 10))
        pro.tap()
        XCTAssertTrue(text(app, containing: "Yearly").waitForExistence(timeout: 10))
    }

    func testImportScreenExplainsTheSteps() {
        let app = launch(["-demoOpen", "import"])
        XCTAssertTrue(text(app, containing: "Choose your LinkedIn file").waitForExistence(timeout: 30))
        XCTAssertTrue(text(app, containing: "Want something in particular").exists)
    }

    func testExploreOpensFromToday() {
        let app = launch(["-startTab", "explore", "-exploreMode", "compass"])
        XCTAssertTrue(app.segmentedControls.buttons["Compass"].waitForExistence(timeout: 30))
        app.segmentedControls.buttons["Map"].tap()
        XCTAssertTrue(app.segmentedControls.buttons["Map"].isSelected)
    }

    // MARK: new screens

    func testAddAPursuitFromTheYouTabShowsItsSeats() {
        let app = launch(["-startTab", "you"])
        let row = button(app, containing: "Pursuits")
        XCTAssertTrue(row.waitForExistence(timeout: 30))
        reveal(app, row)
        row.tap()
        let add = app.buttons["Add a pursuit"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 10))
        add.tap()

        let name = field(app, placeholder: "Name, like")
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        name.tap()
        name.typeText("UI test gateway pilot")
        let agency = field(app, placeholder: "Agency or company")
        XCTAssertTrue(agency.exists)
        agency.tap()
        agency.typeText("DISA")
        let save = app.buttons["Add"].firstMatch
        XCTAssertTrue(save.waitForExistence(timeout: 5))
        save.tap()

        // the new pursuit opens with its seats: none known yet, each one empty
        XCTAssertTrue(text(app, containing: "seats known").waitForExistence(timeout: 15))
        XCTAssertTrue(text(app, containing: "UI test gateway pilot").exists)
        let empty = text(app, containing: "Empty seat")
        reveal(app, empty, swipes: 2)
        XCTAssertTrue(empty.waitForExistence(timeout: 5))
    }

    func testAskBearingsWhoIsWaiting() {
        let app = launch(["-demoOpen", "ask"])
        let q = field(app, placeholder: "Ask about your network")
        XCTAssertTrue(q.waitForExistence(timeout: 30))
        q.tap()
        q.typeText("Who is waiting on me?\n")
        // "16 people are waiting on you." or "No one is waiting on you right now."
        let answer = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "are waiting on you", "is waiting on you")).firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 15))
    }

    func testQuickNoteFindsThePersonAndTheFollowUp() {
        let app = launch(["-demoOpen", "quicklog"])
        let note = field(app, placeholder: "Just met")
        XCTAssertTrue(note.waitForExistence(timeout: 30))
        note.tap()
        note.typeText("Had coffee with Kim Rhodes. Follow up next week.")
        // Kim Rhodes is in the sample network; "next week" sets a follow-up
        XCTAssertTrue(app.staticTexts["Kim Rhodes"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Follow up")).firstMatch.waitForExistence(timeout: 5))
        let save = app.buttons["Save"].firstMatch
        XCTAssertTrue(save.waitForExistence(timeout: 5))
        let enabled = expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: save)
        wait(for: [enabled], timeout: 10)
        save.tap()
        XCTAssertTrue(text(app, containing: "Saved to Kim Rhodes").waitForExistence(timeout: 10))
    }

    func testIntrosListsTheTrackedAsk() {
        let app = launch(["-startTab", "you", "-demoOpen", "intros"])
        XCTAssertTrue(text(app, containing: "Robert Hale").waitForExistence(timeout: 30))
        XCTAssertTrue(text(app, containing: "Through").exists)
    }

    func testMovesOpens() {
        let app = launch(["-startTab", "you", "-demoOpen", "moves"])
        XCTAssertTrue(app.navigationBars["Moves"].waitForExistence(timeout: 30))
        let any = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@ OR label CONTAINS %@",
                                                                       "Likely to rotate", "Leaving service", "No moves spotted")).firstMatch
        XCTAssertTrue(any.waitForExistence(timeout: 10))
    }

    func testAcrossYourSocialsShowsEachPlatform() {
        let app = launch(["-startTab", "you"])
        let row = button(app, containing: "Across your socials")
        XCTAssertTrue(row.waitForExistence(timeout: 30))
        reveal(app, row)
        row.tap()
        XCTAssertTrue(text(app, containing: "EVERYONE YOU").waitForExistence(timeout: 15) || text(app, containing: "Everyone you").exists)
        for name in ["Facebook", "Instagram", "Snapchat", "TikTok"] {
            let platform = text(app, containing: name)
            reveal(app, platform, swipes: 3)
            XCTAssertTrue(platform.waitForExistence(timeout: 5), "\(name) row")
        }
        XCTAssertTrue(text(app, containing: "Not added yet").exists || text(app, containing: "connections").exists)
    }
}
