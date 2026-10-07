import XCTest

/// Drives the app through its animations while the simulator records the screen.
/// Runs only in the "motion reel" workflow (REEL=1); skipped in normal test runs.
final class MotionReel: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = true
        try XCTSkipUnless(ProcessInfo.processInfo.environment["REEL"] == "1", "Only for the motion reel")
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

    private func back(_ app: XCUIApplication) {
        let b = app.navigationBars.buttons.firstMatch
        if b.exists { b.tap() } else {
            let w = app.windows.firstMatch
            w.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5)).press(forDuration: 0.05, thenDragTo: w.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)))
        }
        pause(1.2)
    }

    func testReel() {
        // 1. launch: aurora, compass bloom, numbers counting up, cards cascading in
        let app = launch()
        pause(4.5)

        // 2. scroll Today so cards settle in from the edges, then back up
        let w = app.windows.firstMatch
        w.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)).press(forDuration: 0.05, thenDragTo: w.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)), withVelocity: .slow, thenHoldForDuration: 0.2)
        pause(1.2)
        w.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).press(forDuration: 0.05, thenDragTo: w.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)), withVelocity: .slow, thenHoldForDuration: 0.2)
        pause(1.5)

        // 3. a person zooms out of their row; pull the profile down so the avatar swells
        let row = find(app, "waiting on a reply")
        if row.waitForExistence(timeout: 5) {
            row.tap()
            pause(2.2)
            w.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).press(forDuration: 0.05, thenDragTo: w.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.62)), withVelocity: .slow, thenHoldForDuration: 0.5)
            pause(1.5)
            back(app)
        }

        // 4. the compass zooms open into Explore
        let compass = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Opens Explore")).firstMatch
        if compass.waitForExistence(timeout: 5) {
            compass.tap()
            pause(2.5)
        }

        // 5. the Lens: drag the glass drop across the network a few times
        let big = find(app, "Your network compass:")
        if big.waitForExistence(timeout: 5) {
            let f = big.frame
            let o = app.coordinate(withNormalizedOffset: .zero)
            func pt(_ x: CGFloat, _ y: CGFloat) -> XCUICoordinate {
                o.withOffset(CGVector(dx: f.midX + x * f.width / 2, dy: f.midY + y * f.height / 2))
            }
            let dock = pt(0.74, 0.74)
            for (x, y) in [(-0.35, -0.45), (0.45, -0.2), (-0.55, 0.25)] {
                dock.press(forDuration: 0.35, thenDragTo: pt(x, y), withVelocity: .slow, thenHoldForDuration: 1.4)
                pause(1.0)
                // if the lens opened someone, come back for the next pass
                if !big.exists { pause(1.5); back(app) }
            }
            pause(1)
        }

        // 6. the paywall: icons wave, the selection glides between plans, Continue shimmers
        app.terminate()
        let pay = launch(["-demoOpen", "paywall"])
        pause(2.5)
        for plan in ["Monthly", "Lifetime", "Yearly"] {
            let b = find(pay, plan)
            if b.exists { b.tap(); pause(0.9) }
        }
        pause(2.5)

        // 7. the year card tilts toward your finger
        pay.terminate()
        let year = launch(["-demoOpen", "year"])
        pause(3)
        let yw = year.windows.firstMatch
        yw.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.3)).press(forDuration: 0.3, thenDragTo: yw.coordinate(withNormalizedOffset: CGVector(dx: 0.72, dy: 0.5)), withVelocity: .slow, thenHoldForDuration: 0.8)
        pause(2)
    }
}
