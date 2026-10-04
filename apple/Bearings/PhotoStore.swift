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

    init() {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        keys = Set(names.compactMap { $0.hasSuffix(".jpg") ? String($0.dropLast(4)).removingPercentEncoding : nil })
    }

    var enabled: Bool { UserDefaults.standard.object(forKey: "contactPhotos") as? Bool ?? true }

    private func file(_ k: String) -> URL {
        dir.appendingPathComponent((k.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? k) + ".jpg")
    }

    func image(for k: String) -> UIImage? {
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
