import XCTest

/// Drives one short scene per feature while the simulator records the screen, for the website.
/// Each scene prints CLIP markers with wall-clock times so the workflow can cut the recording.
/// Runs only in the "site media" workflow (SITE=1 or SITE=dark); skipped in normal test runs.
final class SiteClips: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = true
        let s = ProcessInfo.processInfo.environment["SITE"] ?? ""
        try XCTSkipUnless(["1", "dark", "ph", "tour"].contains(s), "Only for the site media workflow")
        Self.skipIdleWaits()
    }

    /// The radar never stops moving, so XCTest's wait for the app to go idle before each
    /// event would time out every time. For recording, don't wait.
    private static var skipped = false
    private static func skipIdleWaits() {
        guard !skipped, let cls = NSClassFromString("XCUIApplicationProcess") else { return }
        skipped = true
        for name in ["waitForQuiescenceIncludingAnimationsIdle:", "waitForQuiescenceIncludingAnimationsIdle:isPreEvent:"] {
            guard let m = class_getInstanceMethod(cls, NSSelectorFromString(name)) else { continue }
            if name.hasSuffix("isPreEvent:") {
                let block: @convention(block) (AnyObject, Bool, Bool) -> Void = { _, _, _ in }
                method_setImplementation(m, imp_implementationWithBlock(block))
            } else {
                let block: @convention(block) (AnyObject, Bool) -> Void = { _, _ in }
                method_setImplementation(m, imp_implementationWithBlock(block))
            }
        }
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

    /// Marks a moment to save as a full-resolution still.
    private func shot(_ name: String) {
        pause(0.3)
        print(String(format: "CLIP|%@|shot|%.3f", name, Date().timeIntervalSince1970))
        pause(0.3)
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
        if set == "ph" { productHuntClips(); return }
        if set == "tour" { tourClips(); return }

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

    /// The Product Hunt demo video and gallery, in the order of the 20-second script.
    private func productHuntClips() {
        clip("ph-import", ["-demoOpen", "import"], settle: 10) { app in
            // if the sheet didn't open from the launch argument, open it from the setup card
            if !find(app, "Choose your LinkedIn file").exists {
                let row = find(app, "LinkedIn connections")
                if row.exists { row.tap(); pause(2) }
            }
            pause(1); shot("ph-import"); pause(2)
        }

        clip("ph-clusters", ["-startTab", "explore", "-exploreMode", "clusters"], settle: 10) { _ in
            pause(1.5); shot("ph-clusters"); pause(3)
        }

        clip("ph-today", settle: 12) { app in
            pause(1); shot("ph-today"); pause(0.6)
            // the first pick's "Remind me later" moves on to the next one
            let later = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "later")).firstMatch
            if later.waitForExistence(timeout: 5) { later.tap(); pause(1.6) }
            if later.exists { later.tap(); pause(1.6) }
            shot("ph-today-congrats")
            let congrats = app.buttons["Congratulate"]
            if congrats.waitForExistence(timeout: 5) { congrats.tap(); pause(2.5); shot("ph-congrats-draft") }
            pause(1)
        }

        clip("ph-intro", ["-startTab", "companies", "-demoOpen", "intro"], settle: 10) { app in
            pause(1.2); shot("ph-intro"); pause(0.5)
            let ask = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Ask for an intro")).firstMatch
            if ask.waitForExistence(timeout: 5) { ask.tap(); pause(2.5); shot("ph-intro-ask") }
            pause(1.5)
        }

        clip("ph-weekly", ["-demoOpen", "weekly"], settle: 10) { app in
            pause(1.2); shot("ph-weekly")
            scroll(app, from: 0.8, to: 0.45); pause(1.5)
            scroll(app, from: 0.8, to: 0.45); pause(1.5)
        }

        clip("ph-event", ["-demoOpen", "event"], settle: 10) { app in
            pause(1); shot("ph-event")
            scroll(app); pause(1.5); shot("ph-event-followups")
        }

        clip("ph-trips", ["-startTab", "explore", "-exploreMode", "map"], settle: 10) { app in
            pause(1); shot("ph-trips")
            scroll(app, from: 0.85, to: 0.5); pause(1.5); shot("ph-trips-people")
        }
    }

    /// Every feature, one scene each, for the long tour video. The cut is picked by eye from
    /// the full recording, so each scene just holds long enough to read.
    private func tourClips() {
        let only = ProcessInfo.processInfo.environment["TOUR_ONLY"].flatMap { $0.isEmpty ? nil : Set($0.split(separator: ",").map(String.init)) }
        func scene(_ name: String, _ args: [String] = [], hold: Double = 5, _ body: ((XCUIApplication) -> Void)? = nil) {
            if let only, !only.contains(name) { return }
            clip("tour-" + name, args, settle: 10) { app in
                pause(hold)
                body?(app)
            }
        }
        scene("import", ["-demoOpen", "import"]) { app in
            if !self.find(app, "Choose your LinkedIn file").exists {
                let row = self.find(app, "LinkedIn connections")
                if row.exists { row.tap(); self.pause(4) }
            }
        }
        scene("clusters", ["-startTab", "explore", "-exploreMode", "clusters"])
        scene("compass", ["-startTab", "explore", "-exploreMode", "compass"])
        scene("today", hold: 3) { app in self.scroll(app, from: 0.8, to: 0.35); self.pause(3) }
        scene("weekly", ["-demoOpen", "weekly"], hold: 3) { app in self.scroll(app, from: 0.8, to: 0.45); self.pause(3) }
        scene("person", ["-startTab", "people", "-demoOpen", "person"], hold: 3) { app in self.scroll(app); self.pause(3) }
        scene("ask", ["-demoOpen", "ask"], hold: 2) { app in
            let field = app.textFields.firstMatch
            if field.waitForExistence(timeout: 3) {
                field.tap(); field.typeText("Who do I know at NAVFAC"); self.pause(0.6); field.typeText("\n")
            }
            self.pause(5)
        }
        scene("intro", ["-startTab", "companies", "-demoOpen", "intro"], hold: 3) { app in
            let ask = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Ask for an intro")).firstMatch
            if ask.waitForExistence(timeout: 5) { ask.tap(); self.pause(5) }
        }
        scene("federal", ["-startTab", "companies", "-startCompanies", "agencies"], hold: 3) { app in self.scroll(app); self.pause(3) }
        scene("org", ["-startTab", "companies", "-demoOpen", "org"], hold: 3) { app in self.scroll(app); self.pause(3) }
        scene("pursuit", ["-startTab", "you", "-demoOpen", "pursuit"], hold: 3) { app in self.scroll(app); self.pause(3) }
        scene("pipeline", ["-startTab", "you", "-demoOpen", "pipeline"], hold: 3) { app in self.scroll(app); self.pause(3) }
        // round 2: bid/no-bid, key dates, fiscal quarters, competitors, the weekly digest and set-asides
        scene("bid", ["-startTab", "you", "-demoOpen", "capture"], hold: 3) { app in
            for _ in 0..<5 { self.scroll(app, from: 0.8, to: 0.35); self.pause(2.5) }
        }
        scene("quarters", ["-startTab", "you", "-demoOpen", "capture", "-captureOpen", "pipeline"], hold: 3) { app in
            for _ in 0..<3 { self.scroll(app, from: 0.8, to: 0.35); self.pause(2.5) }
        }
        scene("competitors", ["-startTab", "companies", "-demoOpen", "capture", "-captureOpen", "teaming"], hold: 5) { app in self.scroll(app); self.pause(3) }
        scene("digest", ["-startTab", "you", "-demoOpen", "capture", "-captureOpen", "pursuits"], hold: 6) { app in self.scroll(app); self.pause(3) }
        scene("setasides", ["-demoOpen", "opportunities", "-sam.setAsides", "(small, sdvosb)"], hold: 4) { app in self.scroll(app); self.pause(3) }
        scene("opportunities", ["-demoOpen", "opportunities"], hold: 3) { app in self.scroll(app); self.pause(3) }
        scene("recompetes", ["-startTab", "companies", "-demoOpen", "recompetes"], hold: 4) { app in self.scroll(app); self.pause(3) }
        scene("teaming", ["-startTab", "companies", "-demoOpen", "teaming"], hold: 4) { app in self.scroll(app); self.pause(3) }
        scene("event", ["-demoOpen", "event"], hold: 3) { app in self.scroll(app); self.pause(3) }
        scene("notes", ["-demoOpen", "notes"], hold: 3) { app in self.scroll(app); self.pause(3) }
        scene("trips", ["-startTab", "explore", "-exploreMode", "map"], hold: 6)
        scene("socials", ["-startTab", "you", "-demoOpen", "socials"], hold: 3) { app in self.scroll(app); self.pause(3) }
        scene("team", ["-demoOpen", "team"], hold: 6)
        scene("year", ["-demoOpen", "year"], hold: 5)
    }
}
