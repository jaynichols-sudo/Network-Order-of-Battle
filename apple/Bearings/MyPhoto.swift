import SwiftUI
import PhotosUI
import Observation

/// Your own profile photo, kept on this device. Shown on your account button,
/// at the center of the compass and on the share card.
@MainActor
@Observable
final class MyPhoto {
    static let shared = MyPhoto()
    private(set) var image: UIImage?

    private var url: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("NetworkOOB", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("me.jpg")
    }

    init() {
        if let d = try? Data(contentsOf: url) { image = UIImage(data: d) }
    }

    /// Crops to a centered square and saves a 600 px copy.
    func set(_ data: Data) -> Bool {
        guard let src = UIImage(data: data) else { return false }
        let side = min(src.size.width, src.size.height)
        let crop = CGRect(x: (src.size.width - side) / 2, y: (src.size.height - side) / 2, width: side, height: side)
        let out = UIGraphicsImageRenderer(size: CGSize(width: 600, height: 600)).image { _ in
            src.draw(in: CGRect(x: -crop.minX * 600 / side, y: -crop.minY * 600 / side, width: src.size.width * 600 / side, height: src.size.height * 600 / side))
        }
        guard let jpg = out.jpegData(compressionQuality: 0.85) else { return false }
        do { try jpg.write(to: url, options: .atomic) } catch { return false }
        image = out
        return true
    }

    func remove() {
        try? FileManager.default.removeItem(at: url)
        image = nil
    }
}

/// You: your photo if you've added one, otherwise your initials.
struct MeAvatar: View {
    let initials: String
    var size: CGFloat = 34
    var ring: CGFloat = 1.5

    var body: some View {
        ZStack {
            if let img = MyPhoto.shared.image {
                Image(uiImage: img).resizable().scaledToFill()
            } else {
                Circle().fill(Theme.plum)
                if initials.isEmpty {
                    Image(systemName: "person.fill").font(.system(size: size * 0.42, weight: .semibold)).foregroundStyle(.white)
                } else {
                    Text(initials).font(.custom("Geist-SemiBold", fixedSize: size * 0.36)).foregroundStyle(.white)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(Theme.amber.opacity(0.9), lineWidth: ring))
        .accessibilityHidden(true)
    }
}

/// Settings row: pick, change or remove your photo.
struct MyPhotoRow: View {
    @Environment(AppModel.self) private var model
    @State private var item: PhotosPickerItem?
    @State private var loading = false

    var body: some View {
        HStack(spacing: 14) {
            MeAvatar(initials: model.myInitials, size: 60, ring: 2)
                .overlay { if loading { ProgressView().tint(.white) } }
            VStack(alignment: .leading, spacing: 6) {
                PhotosPicker(selection: $item, matching: .images, photoLibrary: .shared()) {
                    Text(MyPhoto.shared.image == nil ? "Add your photo" : "Change photo").font(Theme.geist(.body, .semibold))
                }
                if MyPhoto.shared.image != nil {
                    Button("Remove", role: .destructive) { MyPhoto.shared.remove() }
                        .font(Theme.geist(.subheadline))
                        .buttonStyle(.borderless)
                }
            }
        }
        .padding(.vertical, 4)
        .onChange(of: item) { _, new in
            guard let new else { return }
            loading = true
            Task {
                if let data = try? await new.loadTransferable(type: Data.self), MyPhoto.shared.set(data) {
                    Haptic.success()
                } else {
                    model.show("Couldn’t use that photo")
                }
                item = nil
                loading = false
            }
        }
    }
}
