import SwiftUI

struct YearReview: Decodable {
    struct Sector: Decodable, Hashable { var id: String; var n: Int; var color: String }
    struct Company: Decodable, Hashable { var name: String; var n: Int }
    var year: Int
    var total: Int
    var joined: Int
    var moved: Int
    var talked: Int
    var reconnected: Int
    var notes: Int
    var months: [Int]
    var busiestMonth: Int
    var topSectors: [Sector]
    var topCompanies: [Company]
    var closest: [String]
    var hasRel: Bool
}

extension AppModel {
    func yearInReview(_ year: Int) async -> YearReview? {
        try? await engine.call("yearInReview", [year], as: YearReview.self)
    }

    /// December and January: the year in review is worth a chip on Today.
    var yearReviewSeason: Bool {
        let m = Calendar.current.component(.month, from: Date())
        return m == 12 || m == 1
    }

    /// The year being reviewed: this one in December, last one in January.
    var reviewYear: Int {
        let c = Calendar.current.dateComponents([.year, .month], from: Date())
        return (c.month ?? 12) == 1 ? (c.year ?? 2026) - 1 : (c.year ?? 2026)
    }
}

/// The shareable card: counts only, no names.
struct YearCardView: View {
    let r: YearReview
    let sample: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(sample ? "A SAMPLE YEAR" : "MY YEAR IN NETWORKING")
                    .font(.custom("GeistMono-SemiBold", fixedSize: 11)).tracking(1)
                    .foregroundStyle(Theme.amber)
                Spacer()
                Image("BrandMark").resizable().scaledToFit().frame(width: 22, height: 22)
            }
            Text(String(r.year))
                .font(.custom("Geist-Bold", fixedSize: 64))
                .foregroundStyle(.white)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 14) {
                stat(r.joined, "new connections")
                stat(r.moved, "job changes I caught")
                if r.hasRel { stat(r.talked, "people I talked with") }
                if r.reconnected > 0 { stat(r.reconnected, "people I reconnected with") }
            }
            .padding(.top, 18)
            bars.padding(.top, 22)
            if !r.topSectors.isEmpty {
                VStack(alignment: .leading, spacing: 7) {
                    Text("WHERE IT GREW").font(.custom("GeistMono-SemiBold", fixedSize: 10)).tracking(1).foregroundStyle(.white.opacity(0.5))
                    ForEach(r.topSectors, id: \.self) { s in
                        HStack(spacing: 10) {
                            Circle().fill(Color(hex: s.color)).frame(width: 9, height: 9)
                            Text(s.id).font(.custom("Geist-Medium", fixedSize: 14)).foregroundStyle(.white.opacity(0.9))
                            Spacer()
                            Text("+\(s.n)").font(.custom("GeistMono-Medium", fixedSize: 14)).foregroundStyle(.white.opacity(0.7))
                        }
                    }
                }
                .padding(.top, 22)
            }
            Spacer(minLength: 12)
            HStack {
                Text("Mapped with Bearings").font(.custom("Geist-SemiBold", fixedSize: 12)).foregroundStyle(.white.opacity(0.85))
                Spacer()
                Text("\(r.total.formatted()) people").font(.custom("Geist-Regular", fixedSize: 12)).foregroundStyle(.white.opacity(0.5))
            }
        }
        .padding(26)
        .frame(width: 400, height: 640)
        .background(
            ZStack {
                Color(hex: "#120F22")
                RadialGradient(colors: [Color(hex: "#3A2C6E").opacity(0.9), .clear], center: .init(x: 0.7, y: 0.2), startRadius: 0, endRadius: 380)
            }
        )
        .environment(\.colorScheme, .dark)
    }

    private func stat(_ n: Int, _ label: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(n.formatted()).font(.custom("Geist-Bold", fixedSize: 30)).foregroundStyle(Theme.amber)
            Text(label).font(.custom("Geist-Regular", fixedSize: 16)).foregroundStyle(.white.opacity(0.8))
        }
    }

    /// New connections by month.
    private var bars: some View {
        let top = max(1, r.months.max() ?? 1)
        return HStack(alignment: .bottom, spacing: 5) {
            ForEach(Array(r.months.enumerated()), id: \.offset) { i, n in
                VStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(i + 1 == r.busiestMonth ? Theme.amber : Color.white.opacity(0.28))
                        .frame(height: max(3, 54 * CGFloat(n) / CGFloat(top)))
                    Text(String(Array("JFMAMJJASOND")[i]))
                        .font(.custom("GeistMono-Medium", fixedSize: 9)).foregroundStyle(.white.opacity(0.45))
                }
                .frame(maxWidth: .infinity)
            }
        }
        .frame(height: 70)
    }

    @MainActor static func render(_ r: YearReview, sample: Bool) -> UIImage? {
        let renderer = ImageRenderer(content: YearCardView(r: r, sample: sample))
        renderer.scale = 3
        return renderer.uiImage
    }
}

/// The year in review: the card to share, and the people behind the numbers.
struct YearInReviewView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var review: YearReview?
    @State private var image: UIImage?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if let image {
                        Image(uiImage: image)
                            .resizable().scaledToFit()
                            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                            .holoTilt()
                            .padding(.horizontal, 36)
                            .transition(.asymmetric(insertion: .scale(scale: 0.85).combined(with: .opacity), removal: .opacity))
                            .accessibilityLabel(review.map(Self.spoken) ?? "Your year in networking")
                        Label("Only counts and sectors. No names.", systemImage: "lock.fill")
                            .font(Theme.geist(.footnote, .medium)).foregroundStyle(Theme.text2)
                        ShareLink(item: Image(uiImage: image), subject: Text("My year in networking"),
                                  message: Text("My year in networking, mapped with Bearings."),
                                  preview: SharePreview("My year", image: Image(uiImage: image))) {
                            Text("Share").font(Theme.geist(.body, .semibold))
                                .frame(maxWidth: .infinity, minHeight: 48)
                                .foregroundStyle(Theme.onPrimary)
                                .background(Theme.primary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                        .padding(.horizontal, 24)
                    } else {
                        ProgressView().padding(.top, 80)
                    }
                    if let r = review, !r.closest.isEmpty {
                        VStack(alignment: .leading, spacing: 0) {
                            Text("Who you talked with most").font(Theme.geist(.footnote, .semibold)).foregroundStyle(Theme.text2)
                                .padding(.top, 14).padding(.bottom, 4)
                            ForEach(Array(model.persons(r.closest).enumerated()), id: \.element.k) { i, p in
                                if i > 0 { Theme.line.frame(height: 1) }
                                NavigationLink(value: Route.person(p.k)) {
                                    HStack(spacing: 12) {
                                        Avatar(person: p, size: 34)
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(p.fullName).font(Theme.geist(.subheadline, .semibold)).foregroundStyle(.primary)
                                            Text(p.subtitle).font(Theme.geist(.footnote)).foregroundStyle(Theme.text2).lineLimit(1)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.text3)
                                            .accessibilityHidden(true)
                                    }
                                    .padding(.vertical, 9)
                                    .accessibilityElement(children: .combine)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 16).padding(.bottom, 4)
                        .card()
                        .padding(.horizontal, 16)
                    }
                }
                .padding(.vertical, 12)
            }
            .background(Theme.bg)
            .navigationTitle("Your \(String(model.reviewYear))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .navigationDestination(for: Route.self) { r in
                if case .person(let k) = r { ProfileView(k: k) } else if case .about(let k) = r { PersonAboutView(k: k) }
            }
            .task {
                review = await model.yearInReview(model.reviewYear)
                if let review { let img = YearCardView.render(review, sample: model.info.isSample); withAnimation(Motion.bouncy) { image = img } }
            }
        }
    }

    /// What VoiceOver reads for the card image.
    static func spoken(_ r: YearReview) -> String {
        var parts = ["Your \(r.year) in networking", "\(r.joined) new connections", "\(r.moved) job changes caught"]
        if r.hasRel { parts.append("\(r.talked) people you talked with") }
        if r.reconnected > 0 { parts.append("\(r.reconnected) people you reconnected with") }
        if !r.topSectors.isEmpty { parts.append("Grew most in " + r.topSectors.map(\.id).joined(separator: ", ")) }
        return parts.joined(separator: ". ")
    }
}
