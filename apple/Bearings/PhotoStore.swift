import UIKit
import Observation

/// Profile pictures taken from matching iPhone Contacts cards. Kept only on
/// this device (Contacts already syncs them), never uploaded.
@Observable
final class PhotoStore: @unchecked Sendable {
    static let shared = PhotoStore()

    /// Bumped whenever the set of photos changes, so avatars redraw.
    private(set) var version = 0
    @ObservationIgnored private let cache = NSCache<NSString, UIImage>()
    @ObservationIgnored private var keys: Set<String> = []
    @ObservationIgnored private let lock = NSLock()
    @ObservationIgnored private let dir: URL = {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ContactPhotos", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    /// Photos you picked yourself. They win over Contacts and survive a Contacts re-sync.
    @ObservationIgnored private var chosen: Set<String> = []
    @ObservationIgnored private let chosenDir: URL = {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ChosenPhotos", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    init() {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        keys = Set(names.compactMap { $0.hasSuffix(".jpg") ? String($0.dropLast(4)).removingPercentEncoding : nil })
        let mine = (try? FileManager.default.contentsOfDirectory(atPath: chosenDir.path)) ?? []
        chosen = Set(mine.compactMap { $0.hasSuffix(".jpg") ? String($0.dropLast(4)).removingPercentEncoding : nil })
    }

    private func chosenFile(_ k: String) -> URL {
        chosenDir.appendingPathComponent((k.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? k) + ".jpg")
    }

    func hasChosen(_ k: String) -> Bool { lock.lock(); defer { lock.unlock() }; return chosen.contains(k) }

    /// Saves (or, with nil, removes) a photo you picked for someone, square and small.
    func setChosen(_ k: String, image: UIImage?) {
        if let image {
            let side: CGFloat = 480
            let scale = side / min(image.size.width, image.size.height)
            let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            let out = UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { _ in
                image.draw(in: CGRect(x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width, height: size.height))
            }
            try? out.jpegData(compressionQuality: 0.82)?.write(to: chosenFile(k), options: .atomic)
            lock.lock(); chosen.insert(k); lock.unlock()
        } else {
            try? FileManager.default.removeItem(at: chosenFile(k))
            lock.lock(); chosen.remove(k); lock.unlock()
        }
        cache.removeObject(forKey: k as NSString)
        DispatchQueue.main.async { self.version += 1 }
    }

    var enabled: Bool { UserDefaults.standard.object(forKey: "contactPhotos") as? Bool ?? true }

    private func file(_ k: String) -> URL {
        dir.appendingPathComponent((k.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? k) + ".jpg")
    }

    func image(for k: String) -> UIImage? {
        if hasChosen(k) {
            if let img = cache.object(forKey: k as NSString) { return img }
            if let data = try? Data(contentsOf: chosenFile(k)), let img = UIImage(data: data) {
                cache.setObject(img, forKey: k as NSString)
                return img
            }
        }
        guard enabled else { return nil }
        lock.lock(); let has = keys.contains(k); lock.unlock()
        guard has else { return nil }
        if let img = cache.object(forKey: k as NSString) { return img }
        guard let data = try? Data(contentsOf: file(k)), let img = UIImage(data: data) else { return nil }
        cache.setObject(img, forKey: k as NSString)
        return img
    }

    /// Replaces every saved photo with this set (person key -> image data).
    func replaceAll(_ photos: [String: Data]) {
        let fm = FileManager.default
        if let old = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) {
            for f in old { try? fm.removeItem(at: f) }
        }
        for (k, d) in photos { try? d.write(to: file(k), options: .atomic) }
        lock.lock(); keys = Set(photos.keys); lock.unlock()
        cache.removeAllObjects()
        DispatchQueue.main.async { self.version += 1 }
    }

    /// Redraws avatars after the on/off setting changes.
    func replaceAllKeepingFiles() { DispatchQueue.main.async { self.version += 1 } }

    var count: Int { lock.lock(); defer { lock.unlock() }; return keys.count }
}
