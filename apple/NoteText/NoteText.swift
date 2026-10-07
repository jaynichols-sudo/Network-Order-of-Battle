import Foundation
import PDFKit
import Vision
import UIKit
import UniformTypeIdentifiers

/// Turns a shared file into text on this device: plain text and Markdown as they are,
/// PDFs by their text layer, and handwriting, scans and photos (a reMarkable page, a
/// whiteboard) by reading them with Vision. Nothing is uploaded.
enum NoteText {
    static let types: [UTType] = [.plainText, .utf8PlainText, .rtf, .pdf, .image,
                                  UTType("net.daringfireball.markdown") ?? .plainText]

    static func from(url: URL) async -> String? {
        let ext = url.pathExtension.lowercased()
        let type = UTType(filenameExtension: ext)
        if type?.conforms(to: .pdf) == true { return await pdf(url) }
        if type?.conforms(to: .image) == true {
            guard let img = UIImage(contentsOfFile: url.path) else { return nil }
            return await ocr(img)
        }
        if type?.conforms(to: .rtf) == true || ext == "rtf",
           let a = try? NSAttributedString(url: url, options: [.documentType: NSAttributedString.DocumentType.rtf], documentAttributes: nil) {
            return a.string
        }
        if let s = try? String(contentsOf: url, encoding: .utf8) { return s }
        return try? String(contentsOf: url, encoding: .isoLatin1)
    }

    /// The PDF's text, or, when it has none (handwriting exported from a reMarkable, a scan),
    /// each page read as a picture.
    static func pdf(_ url: URL) async -> String? {
        guard let doc = PDFDocument(url: url) else { return nil }
        var out = ""
        for i in 0..<min(doc.pageCount, 40) { out += (doc.page(at: i)?.string ?? "") + "\n" }
        if out.trimmingCharacters(in: .whitespacesAndNewlines).count > 40 { return out }
        var read = ""
        for i in 0..<min(doc.pageCount, 12) {
            guard let page = doc.page(at: i) else { continue }
            let img = page.thumbnail(of: CGSize(width: 1700, height: 2200), for: .mediaBox)
            if let t = await ocr(img) { read += t + "\n\n" }
        }
        return read.isEmpty ? nil : read
    }

    static func pdfCreator(_ url: URL) -> String {
        let a = PDFDocument(url: url)?.documentAttributes ?? [:]
        return [a[PDFDocumentAttribute.creatorAttribute], a[PDFDocumentAttribute.producerAttribute]].compactMap { $0 as? String }.joined(separator: " ")
    }

    /// Reads printed text and handwriting from a picture.
    static func ocr(_ image: UIImage) async -> String? {
        guard let cg = image.cgImage else { return nil }
        return await Task.detached(priority: .userInitiated) { () -> String? in
            let req = VNRecognizeTextRequest()
            req.recognitionLevel = .accurate
            req.usesLanguageCorrection = true
            try? VNImageRequestHandler(cgImage: cg, orientation: .up).perform([req])
            let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
            return lines.isEmpty ? nil : lines.joined(separator: "\n")
        }.value
    }
}
