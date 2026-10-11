import XCTest

/// Drives one short scene per feature while the simulator records the screen, for the website.
/// Each scene prints CLIP markers with wall-clock times so the workflow can cut the recording.
/// Runs only in the "site media" workflow (SITE=1 or SITE=dark); skipped in normal test runs.
final class SiteClips: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = true
        let s = ProcessInfo.processInfo.environment["SITE"] ?? ""
        try XCTSkipUnless(s == "1" || s == "dark", "Only for the site media workflow")
    }

    private var set: String { ProcessInfo.processInfo.environment["SITE"] ?? "1" }

    private func mark(_ name: String, _ edge: String) {
        print(String(format: "CLIP|%@|%@|%.3f", name, edge, Date().timeIntervalSince1970))
    }

    private func launch(_ args: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-onboarded", "YES", "-storeMode", "YES"] + args
        app.launch()
        return app
    }

    private func find(_ app: XCUIApplication, _ s: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", s)).firstMatch
    }

    private func pause(_ s: Double) { Thread.sleep(forTimeInterval: s) }

    private func scroll(_ app: XCUIApplication, from: CGFloat = 0.78, to: CGFloat = 0.38) {
        let w = app.windows.firstMatch
        w.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: from))
            .press(forDuration: 0.05, thenDragTo: w.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: to)), withVelocity: .slow, thenHoldForDuration: 0.3)
    }

    /// Launches, lets the screen settle, then records `body` between CLIP markers.
    private func clip(_ name: String, _ args: [String] = [], settle: Double = 3.5, _ body: (XCUIApplication) -> Void) {
        let app = launch(args)
        pause(settle)
        mark(name, "start")
        body(app)
        mark(name, "end")
        pause(0.4)
    }

    func testClips() {
        if set == "dark" { darkClips(); return }

        clip("today") { app in
            pause(2.2)
            let later = app.buttons["Later"]
            if later.waitForExistence(timeout: 3) {
                later.tap(); pause(2.0)
                later.tap(); pause(2.0)
            }
            scroll(app, from: 0.8, to: 0.3); pause(4.5)
        }

        clip("radar", ["-homeScroll", "compass"]) { _ in pause(8) }

        clip("profile", ["-startTab", "people", "-demoOpen", "person"]) { app in
            pause(2.5)
            scroll(app); pause(1.8)
            scroll(app); pause(2.2)
        }

        clip("ask", ["-demoOpen", "ask"], settle: 3) { app in
            pause(1.2)
            let field = app.textFields.firstMatch
            if field.waitForExistence(timeout: 3) {
                field.tap()
                field.typeText("Who changed jobs lately")
                pause(0.8)
                field.typeText("\n")
            }
            pause(4)
        }

        clip("quicknote", ["-demoOpen", "quicklog"], settle: 3) { app in
            pause(1)
            let field = app.textFields.firstMatch.exists ? app.textFields.firstMatch : app.textViews.firstMatch
            if field.waitForExistence(timeout: 3) {
                field.tap()
                field.typeText("Coffee with Jason Jacobs. He wants the pricing deck by Friday.")
            }
            pause(4)
        }

        clip("federal", ["-startTab", "companies", "-startCompanies", "agencies"]) { app in
            pause(2.5)
            let covered = app.buttons["Covered"]
            if covered.exists { covered.tap(); pause(2.4) }
            let gaps = app.buttons["Gaps"]
            if gaps.exists { gaps.tap(); pause(1.6) }
            scroll(app); pause(1.6)
            scroll(app); pause(2)
        }

        clip("org", ["-startTab", "companies", "-demoOpen", "org"], settle: 5) { app in
            pause(2.5)
            scroll(app); pause(2)
            scroll(app); pause(2)
        }

        clip("pursuit", ["-startTab", "you", "-demoOpen", "pursuit"], settle: 5) { app in
            pause(2.5)
            scroll(app); pause(2.2)
            scroll(app); pause(2)
        }

        clip("socials", ["-startTab", "you", "-demoOpen", "socials"], settle: 5) { app in
            pause(2.5)
            scroll(app); pause(2.2)
        }

        clip("intro", ["-startTab", "companies", "-demoOpen", "intro"], settle: 4) { app in
            pause(2.5)
            scroll(app); pause(2.5)
        }

        clip("event", ["-demoOpen", "event"], settle: 4) { app in
            pause(2.5)
            scroll(app); pause(2.5)
        }

        clip("moves", ["-startTab", "you", "-demoOpen", "moves"]) { app in
            pause(2.5)
            scroll(app); pause(2.2)
        }

        clip("year", ["-demoOpen", "year"], settle: 3) { app in
            pause(1.5)
            let w = app.windows.firstMatch
            w.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.3))
                .press(forDuration: 0.3, thenDragTo: w.coordinate(withNormalizedOffset: CGVector(dx: 0.72, dy: 0.5)), withVelocity: .slow, thenHoldForDuration: 0.8)
            pause(2.5)
        }
    }

    /// The night-sky moments, recorded with the simulator in dark mode.
    private func darkClips() {
        clip("compass-dark", ["-startTab", "explore", "-exploreMode", "compass"]) { app in
            pause(2.5)
            let big = find(app, "Your network compass:")
            if big.waitForExistence(timeout: 4) {
                let f = big.frame
                let o = app.coordinate(withNormalizedOffset: .zero)
                func pt(_ x: CGFloat, _ y: CGFloat) -> XCUICoordinate {
                    o.withOffset(CGVector(dx: f.midX + x * f.width / 2, dy: f.midY + y * f.height / 2))
                }
                let dock = pt(0.74, 0.74)
                for (x, y) in [(-0.35, -0.45), (0.45, -0.2)] {
                    dock.press(forDuration: 0.35, thenDragTo: pt(x, y), withVelocity: .slow, thenHoldForDuration: 1.4)
                    pause(1.2)
                    if !big.exists { pause(1.2); app.navigationBars.buttons.firstMatch.tap(); pause(1) }
                }
            }
            pause(1.5)
        }

        clip("clusters-dark", ["-startTab", "explore", "-exploreMode", "clusters"]) { _ in pause(6) }

        clip("today-dark", settle: 2) { app in
            pause(3)
            scroll(app, from: 0.8, to: 0.3); pause(5)
        }
    }
}
