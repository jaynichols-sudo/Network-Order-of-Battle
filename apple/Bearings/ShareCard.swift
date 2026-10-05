import SwiftUI

/// A picture of your network to post on LinkedIn. Dots and sectors only:
/// no names, photos or companies of the people in it.
struct ShareCardView: View {
    let data: CompassData
    let initials: String
    let sample: Bool

    var body: some View {
        let top = data.wedges.sorted { $0.n > $1.n }.prefix(3)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(sample ? "A SAMPLE NETWORK" : "MY NETWORK")
                    .font(.custom("GeistMono-SemiBold", fixedSize: 11))
                    .foregroundStyle(Theme.amber)
                    .tracking(1)
                Spacer()
                Image("BrandMark").resizable().scaledToFit().frame(width: 22, height: 22)
            }
            Text("\(data.total.formatted()) people")
                .font(.custom("Geist-Bold", fixedSize: 38))
                .foregroundStyle(.white)
                .padding(.top, 10)
            Text(subtitle)
                .font(.custom("Geist-Regular", fixedSize: 15))
                .foregroundStyle(.white.opacity(0.72))
                .padding(.top, 2)
            CompassView(data: data, focus: .constant(nil), initials: initials, still: true) { _ in }
                .frame(width: 300, height: 300)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
            VStack(spacing: 8) {
                ForEach(Array(top)) { w in
                    HStack(spacing: 10) {
                        Circle().fill(Color(hex: w.color)).frame(width: 9, height: 9)
                        Text(w.id).font(.custom("Geist-Medium", fixedSize: 14)).foregroundStyle(.white.opacity(0.9))
                        Spacer()
                        Text(w.n.formatted()).font(.custom("GeistMono-Medium", fixedSize: 14)).foregroundStyle(.white.opacity(0.7))
                    }
                }
            }
            Spacer(minLength: 14)
            HStack {
                Text("Mapped with Bearings").font(.custom("Geist-SemiBold", fixedSize: 12)).foregroundStyle(.white.opacity(0.85))
                Spacer()
                Text("Your network, mapped").font(.custom("Geist-Regular", fixedSize: 12)).foregroundStyle(.white.opacity(0.5))
            }
        }
        .padding(26)
        .frame(width: 400, height: 640)
        .background(
            ZStack {
                Color(hex: "#120F22")
                RadialGradient(colors: [Color(hex: "#3A2C6E").opacity(0.9), .clear], center: .init(x: 0.5, y: 0.5), startRadius: 0, endRadius: 330)
            }
        )
        .environment(\.colorScheme, .dark)
    }

    private var subtitle: String {
        var parts = ["across \(data.wedges.count) sectors"]
        if data.rel && data.tally.close > 0 { parts.append("\(data.tally.close.formatted()) close") }
        return parts.joined(separator: ", ")
    }

    @MainActor static func render(data: CompassData, initials: String, sample: Bool) -> UIImage? {
        let r = ImageRenderer(content: ShareCardView(data: data, initials: initials, sample: sample))
        r.scale = 3
        return r.uiImage
    }
}

/// Preview and share.
struct ShareCardSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                        .shadow(color: .black.opacity(0.25), radius: 20, y: 8)
                        .padding(.horizontal, 36)
                    Label("Only dots and sector totals. No names, photos or companies.", systemImage: "lock.fill")
                        .font(Theme.geist(.footnote, .medium))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                    ShareLink(item: Image(uiImage: image), subject: Text("My network"),
                              message: Text("My professional network, mapped. \(model.info.count.formatted()) people, one picture."),
                              preview: SharePreview("My network", image: Image(uiImage: image))) {
                        Label("Share", systemImage: "square.and.arrow.up")
                            .font(Theme.geist(.headline))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .prominentGlassButton()
                    .controlSize(.large)
                    .padding(.horizontal, 24)
                } else {
                    Spacer()
                    ProgressView()
                }
                Spacer(minLength: 0)
            }
            .padding(.top, 8)
            .navigationTitle("Share your network")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task {
                let data = await model.compass()
                image = ShareCardView.render(data: data, initials: model.myInitials, sample: model.info.isSample)
            }
        }
    }
}
