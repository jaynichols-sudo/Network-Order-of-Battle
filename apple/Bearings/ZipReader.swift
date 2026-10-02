import Foundation
import Compression

/// Just enough of the zip format to read the CSV files out of a LinkedIn export:
/// central directory, stored and deflated entries, and Zip64 sizes.
struct ZipReader {
    struct Entry {
        let name: String
        let method: UInt16
        let compressedSize: Int
        let size: Int
        let localOffset: Int
    }

    enum Failure: LocalizedError {
        case notZip, unsupported(String), corrupt(String)
        var errorDescription: String? {
            switch self {
            case .notZip: return "That file isn’t a zip archive."
            case .unsupported(let n): return "\(n) is compressed in a way Bearings can’t read. Try downloading the export again."
            case .corrupt(let n): return "\(n) in the zip looks damaged. Try downloading the export again."
            }
        }
    }

    let data: Data
    let entries: [Entry]

    init(data: Data) throws {
        self.data = data
        self.entries = try ZipReader.readDirectory(data)
    }

    func entry(matching suffix: String) -> Entry? {
        let s = suffix.lowercased()
        return entries.first { e in
            let n = e.name.lowercased()
            return n == s || n.hasSuffix("/" + s)
        }
    }

    func text(_ suffix: String) throws -> String? {
        guard let e = entry(matching: suffix) else { return nil }
        let raw = try extract(e)
        return String(decoding: raw, as: UTF8.self)
    }

    func extract(_ e: Entry) throws -> Data {
        let base = e.localOffset
        guard base + 30 <= data.count, u32(data, base) == 0x04034b50 else { throw Failure.corrupt(e.name) }
        let nameLen = Int(u16(data, base + 26)), extraLen = Int(u16(data, base + 28))
        let start = base + 30 + nameLen + extraLen
        guard start + e.compressedSize <= data.count else { throw Failure.corrupt(e.name) }
        let body = data.subdata(in: start..<(start + e.compressedSize))
        switch e.method {
        case 0: return body
        case 8: return try inflate(body, size: e.size, name: e.name)
        default: throw Failure.unsupported(e.name)
        }
    }

    private func inflate(_ input: Data, size: Int, name: String) throws -> Data {
        if size == 0 { return Data() }
        var out = Data(count: size)
        let written = out.withUnsafeMutableBytes { (dst: UnsafeMutableRawBufferPointer) -> Int in
            input.withUnsafeBytes { (src: UnsafeRawBufferPointer) -> Int in
                compression_decode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, size,
                                          src.bindMemory(to: UInt8.self).baseAddress!, input.count,
                                          nil, COMPRESSION_ZLIB)
            }
        }
        guard written == size else { throw Failure.corrupt(name) }
        return out
    }

    private static func readDirectory(_ d: Data) throws -> [Entry] {
        guard d.count >= 22 else { throw Failure.notZip }
        // find the end of central directory record
        var eocd = -1
        let lowest = max(0, d.count - 65_557)
        var i = d.count - 22
        while i >= lowest {
            if u32(d, i) == 0x06054b50 { eocd = i; break }
            i -= 1
        }
        guard eocd >= 0 else { throw Failure.notZip }
        var count = Int(u16(d, eocd + 10))
        var dirOffset = Int(u32(d, eocd + 16))
        // Zip64 end of central directory
        if (dirOffset == 0xFFFFFFFF || count == 0xFFFF), eocd >= 20, u32(d, eocd - 20) == 0x07064b50 {
            let z64 = Int(u64(d, eocd - 12))
            if z64 + 56 <= d.count, u32(d, z64) == 0x06064b50 {
                count = Int(u64(d, z64 + 32))
                dirOffset = Int(u64(d, z64 + 48))
            }
        }
        var out: [Entry] = []
        var p = dirOffset
        for _ in 0..<count {
            guard p + 46 <= d.count, u32(d, p) == 0x02014b50 else { break }
            let method = u16(d, p + 10)
            var csize = Int(u32(d, p + 20)), usize = Int(u32(d, p + 24))
            let nameLen = Int(u16(d, p + 28)), extraLen = Int(u16(d, p + 30)), commentLen = Int(u16(d, p + 32))
            var local = Int(u32(d, p + 42))
            guard p + 46 + nameLen <= d.count else { break }
            let name = String(decoding: d.subdata(in: (p + 46)..<(p + 46 + nameLen)), as: UTF8.self)
            // Zip64 extra field carries the real sizes and offset
            var x = p + 46 + nameLen
            let xEnd = min(d.count, x + extraLen)
            while x + 4 <= xEnd {
                let id = u16(d, x), len = Int(u16(d, x + 2))
                if id == 0x0001 {
                    var q = x + 4
                    if usize == 0xFFFFFFFF, q + 8 <= xEnd { usize = Int(u64(d, q)); q += 8 }
                    if csize == 0xFFFFFFFF, q + 8 <= xEnd { csize = Int(u64(d, q)); q += 8 }
                    if local == 0xFFFFFFFF, q + 8 <= xEnd { local = Int(u64(d, q)) }
                }
                x += 4 + len
            }
            if !name.hasSuffix("/") {
                out.append(Entry(name: name, method: method, compressedSize: csize, size: usize, localOffset: local))
            }
            p += 46 + nameLen + extraLen + commentLen
        }
        if out.isEmpty { throw Failure.notZip }
        return out
    }
}

private func u16(_ d: Data, _ o: Int) -> UInt16 {
    d.withUnsafeBytes { UInt16($0[o]) | UInt16($0[o + 1]) << 8 }
}
private func u32(_ d: Data, _ o: Int) -> UInt32 {
    d.withUnsafeBytes { UInt32($0[o]) | UInt32($0[o + 1]) << 8 | UInt32($0[o + 2]) << 16 | UInt32($0[o + 3]) << 24 }
}
private func u64(_ d: Data, _ o: Int) -> UInt64 {
    UInt64(u32(d, o)) | UInt64(u32(d, o + 4)) << 32
}
