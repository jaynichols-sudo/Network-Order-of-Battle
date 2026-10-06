import Foundation

/// On the Mac, Bearings looks in Downloads for a LinkedIn export newer than the last import
/// and offers to bring it in, so a refresh is one click after LinkedIn's email arrives.
enum MacDownloads {
    static func newestExport(after: Date?) -> URL? {
        #if targetEnvironment(macCatalyst)
        guard let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first,
              let items = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles])
        else { return nil }
        var best: (URL, Date)?
        for u in items {
            let n = u.lastPathComponent.lowercased()
            guard (n.hasSuffix(".zip") && n.contains("linkedindataexport")) || n == "connections.csv" else { continue }
            guard let d = (try? u.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate else { continue }
            if let after, d <= after { continue }
            if best == nil || d > best!.1 { best = (u, d) }
        }
        return best?.0
        #else
        return nil
        #endif
    }
}

extension AppModel {
    /// Offers a fresh export found in Downloads, once per file.
    func checkDownloads() {
        #if targetEnvironment(macCatalyst)
        guard loaded, !showImport, !showOnboarding else { return }
        let since = info.isSample ? nil : Day.date(info.lastImport)
        guard let url = MacDownloads.newestExport(after: since) else { return }
        let id = url.lastPathComponent + "|" + String(Int((try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate?.timeIntervalSince1970 ?? 0))
        guard prefs.string(forKey: "offeredExport") != id else { return }
        prefs.set(id, forKey: "offeredExport")
        foundExport = url
        #endif
    }
}
