import SwiftUI
import UIKit

// A one-page brief on someone, made to be read on paper or a reMarkable before a
// meeting: who they are, how you know them, what was said last, and a ruled half page
// for handwritten notes. Share it to the reMarkable app, Files or a printer.

struct PaperBriefPage: View {
    let person: Person
    let brief: String
    let lastWord: String
    let notes: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("BEARINGS · BRIEF").font(.custom("GeistMono-Medium", fixedSize: 9)).tracking(1.2)
                Spacer()
                Text(Date().formatted(.dateTime.weekday(.wide).month(.wide).day().year())).font(.custom("GeistMono-Medium", fixedSize: 9))
            }
            .foregroundStyle(.black.opacity(0.55))
            Rectangle().fill(.black).frame(height: 1.5).padding(.top, 6)

            Text(person.fullName).font(.custom("Geist-Bold", fixedSize: 34)).padding(.top, 18)
            Text([person.p, person.c].filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.custom("Geist-Regular", fixedSize: 13)).foregroundStyle(.black.opacity(0.7)).padding(.top, 2)

            HStack(spacing: 18) {
                fact("SECTOR", person.cl.ind)
                if person.rx != nil { fact("HOW CLOSE", "\(Band.label(person.band)) · \(person.score)") }
                if !person.d.isEmpty { fact("CONNECTED", Day.nice(person.d)) }
            }
            .padding(.top, 14)

            section("THE BRIEF", brief)
            if !lastWord.isEmpty { section("LAST WORD", "“\(lastWord)”") }
            if !notes.isEmpty { section("YOUR NOTES", String(notes.suffix(700))) }

            Text("NOTES FROM TODAY").font(.custom("GeistMono-Medium", fixedSize: 9)).tracking(1.2).foregroundStyle(.black.opacity(0.55)).padding(.top, 20)
            VStack(spacing: 0) {
                ForEach(0..<14, id: \.self) { _ in
                    Rectangle().fill(.black.opacity(0.18)).frame(height: 0.6).padding(.top, 21)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 48).padding(.vertical, 44)
        .frame(width: 612, height: 792, alignment: .topLeading)
        .background(Color.white)
        .environment(\.colorScheme, .light)
    }

    private func fact(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(k).font(.custom("GeistMono-Medium", fixedSize: 8)).tracking(1).foregroundStyle(.black.opacity(0.5))
            Text(v).font(.custom("Geist-SemiBold", fixedSize: 11))
        }
    }

    private func section(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(k).font(.custom("GeistMono-Medium", fixedSize: 9)).tracking(1.2).foregroundStyle(.black.opacity(0.55))
            Text(v).font(.custom("Geist-Regular", fixedSize: 12)).lineSpacing(3).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 18)
    }
}

extension AppModel {
    /// Writes the paper brief as a one-page PDF and opens the share sheet for it.
    @MainActor
    func sharePaperBrief(_ k: String) {
        guard let p = person(k) else { return }
        let page = PaperBriefPage(person: p, brief: Brief.template(p, model: self), lastWord: p.rx?.s ?? "", notes: p.ed?.note ?? "")
        let safe = p.fullName.replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(safe) brief.pdf")
        let renderer = ImageRenderer(content: page)
        renderer.render { size, draw in
            var box = CGRect(origin: .zero, size: size)
            guard let ctx = CGContext(url as CFURL, mediaBox: &box, nil) else { return }
            ctx.beginPDFPage(nil)
            draw(ctx)
            ctx.endPDFPage()
            ctx.closePDF()
        }
        Haptic.tap()
        shareFile = ShareFile(url: url)
    }

    /// A plain-text version of someone, for Apple Notes or a message.
    func personText(_ k: String) -> String {
        guard let p = person(k) else { return "" }
        var lines = [p.fullName, [p.p, p.c].filter { !$0.isEmpty }.joined(separator: ", "), "", Brief.template(p, model: self)]
        if let n = p.ed?.note, !n.isEmpty { lines += ["", "Notes:", n] }
        if !p.u.isEmpty { lines += ["", p.u] }
        return lines.joined(separator: "\n")
    }
}
