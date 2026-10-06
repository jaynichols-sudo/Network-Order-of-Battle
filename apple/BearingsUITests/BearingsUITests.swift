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

    func testTodayShowsTheWeekAndTheCompass() {
        let app = launch()
        XCTAssertTrue(text(app, containing: "Needs you").waitForExistence(timeout: 30))
        XCTAssertTrue(text(app, containing: "waiting on you").exists)
        XCTAssertTrue(text(app, containing: "this week").exists || text(app, containing: "caught up").exists)
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
}
