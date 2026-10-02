import Foundation
import JavaScriptCore

/// Runs the shared Bearings logic (classification, scoring, search, import)
/// in JavaScriptCore on its own serial queue. Calls are JSON in, JSON out.
final class Engine: @unchecked Sendable {
    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private let queue = DispatchQueue(label: "bearings.engine", qos: .userInitiated)
    private var context: JSContext!
    private var bridge: JSValue!
    let today: String

    init() {
        today = Day.today
        queue.sync {
            let ctx = JSContext()!
            ctx.exceptionHandler = { _, ex in
                NSLog("Bearings engine exception: \(ex?.toString() ?? "?")")
            }
            if let url = Bundle.main.url(forResource: "engine", withExtension: "js"),
               let src = try? String(contentsOf: url, encoding: .utf8) {
                ctx.evaluateScript(src, withSourceURL: url)
            }
            self.context = ctx
            self.bridge = ctx.objectForKeyedSubscript("Bearings")
        }
    }

    /// Calls `name` with JSON-serializable arguments and decodes the result.
    func call<T: Decodable>(_ name: String, _ args: [Any] = [], as type: T.Type = T.self) async throws -> T {
        let raw = try await rawCall(name, args)
        return try Engine.decode(raw, as: T.self)
    }

    /// Calls without caring about the result.
    func run(_ name: String, _ args: [Any] = []) async throws {
        let raw = try await rawCall(name, args)
        if let err = Engine.errorIn(raw) { throw Failure(message: err) }
    }

    /// The exact JSON for one of the saved files (edits, review, targets, industries).
    func fileJSON(_ name: String) async -> String? {
        await withCheckedContinuation { cont in
            queue.async {
                let v = self.bridge?.invokeMethod("fileJSON", withArguments: [name])
                cont.resume(returning: v?.isString == true ? v?.toString() : nil)
            }
        }
    }

    private func rawCall(_ name: String, _ args: [Any]) async throws -> String {
        let argJSON: String
        do {
            let data = try JSONSerialization.data(withJSONObject: args.map { $0 is NSNull ? NSNull() : $0 }, options: [.fragmentsAllowed])
            argJSON = String(decoding: data, as: UTF8.self)
        } catch {
            throw Failure(message: "Couldn’t prepare \(name): \(error.localizedDescription)")
        }
        return try await withCheckedThrowingContinuation { cont in
            queue.async {
                guard let bridge = self.bridge, !bridge.isUndefined else {
                    cont.resume(throwing: Failure(message: "The Bearings engine didn’t load."))
                    return
                }
                let v = bridge.invokeMethod("call", withArguments: [name, argJSON])
                guard let s = v?.toString(), v?.isString == true else {
                    cont.resume(throwing: Failure(message: "No answer from \(name)."))
                    return
                }
                cont.resume(returning: s)
            }
        }
    }

    private struct Envelope<T: Decodable>: Decodable {
        let ok: T?
        let error: String?
    }

    private static func errorIn(_ raw: String) -> String? {
        guard raw.hasPrefix("{\"error\"") else { return nil }
        struct E: Decodable { let error: String }
        return (try? JSONDecoder().decode(E.self, from: Data(raw.utf8)))?.error
    }

    static func decode<T: Decodable>(_ raw: String, as: T.Type) throws -> T {
        if let err = errorIn(raw) { throw Failure(message: err) }
        let env = try JSONDecoder().decode(Envelope<T>.self, from: Data(raw.utf8))
        if let e = env.error { throw Failure(message: e) }
        if let ok = env.ok { return ok }
        if let opt = T.self as? NilLiteral.Type, let v = opt.makeNil() as? T { return v }
        throw Failure(message: "Empty answer.")
    }
}

protocol NilLiteral { static func makeNil() -> Any }
extension Optional: NilLiteral { static func makeNil() -> Any { Optional<Wrapped>.none as Any } }

/// Decodes anything and throws it away, for calls whose result we ignore.
struct Ignored: Decodable {
    init(from decoder: Decoder) throws {}
}
