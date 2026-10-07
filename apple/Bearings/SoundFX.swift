import SwiftUI
import AVFoundation
import UIKit
import CoreHaptics

/// Small sounds. Quiet, mixed with whatever is playing, and silent when the ringer is off.
@MainActor
enum SoundFX {
    static var on: Bool { UserDefaults.standard.object(forKey: "sounds") as? Bool ?? true }

    private static let player: AVAudioPlayer? = {
        guard let u = Bundle.main.url(forResource: "ping", withExtension: "wav") else { return nil }
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
        let p = try? AVAudioPlayer(contentsOf: u)
        p?.volume = 0.3
        p?.prepareToPlay()
        return p
    }()

    /// The radar ping, when the sweep passes someone who needs you.
    static func ping() {
        guard on, UIApplication.shared.applicationState == .active else { return }
        player?.currentTime = 0
        player?.play()
    }
}

/// Pick the app icon: the classic, Night, Paper or Field.
struct AppIconPicker: View {
    @State private var current = UIApplication.shared.alternateIconName

    private let options: [(name: String?, label: String, preview: String)] = [
        (nil, "Classic", "IconPreview-Default"),
        ("AppIcon-Night", "Night", "IconPreview-Night"),
        ("AppIcon-Paper", "Paper", "IconPreview-Paper"),
        ("AppIcon-Field", "Field", "IconPreview-Field"),
    ]

    var body: some View {
        if UIApplication.shared.supportsAlternateIcons {
            VStack(alignment: .leading, spacing: 10) {
                Text("App icon").font(Theme.geist(.body))
                HStack(spacing: 14) {
                    ForEach(options, id: \.label) { o in
                        Button {
                            guard current != o.name else { return }
                            UIApplication.shared.setAlternateIconName(o.name) { err in
                                if err == nil { Task { @MainActor in current = o.name; Haptic.success() } }
                            }
                        } label: {
                            VStack(spacing: 6) {
                                Image(o.preview)
                                    .resizable()
                                    .frame(width: 54, height: 54)
                                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(current == o.name ? Theme.accent : Color.primary.opacity(0.1), lineWidth: current == o.name ? 2.5 : 1))
                                Text(o.label).font(Theme.geist(.caption, current == o.name ? .semibold : .regular)).foregroundStyle(current == o.name ? .primary : .secondary)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(o.label) icon")
                        .accessibilityAddTraits(current == o.name ? .isSelected : [])
                    }
                }
            }
            .padding(.vertical, 4)
        }
    }
}

/// Bearings' signature: a soft rising two-note chime with a matching tap-then-swell on the
/// Taptic Engine, for the moments that matter (someone ticked off, all five done, notes saved).
/// Synthesized on the fly, so there's nothing to bundle. Respects the Sounds and Haptics settings.
@MainActor
enum Signature {
    private static var engine: AVAudioEngine?
    private static var node: AVAudioPlayerNode?
    private static var haptics: CHHapticEngine?

    /// Two notes a fifth apart (A5, E6), each a sine with a quick attack and a soft tail.
    private static func buffer(_ notes: [(Double, Double)], format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let rate = format.sampleRate
        let length = AVAudioFrameCount(rate * ((notes.map { $0.1 }.max() ?? 0) + 0.45))
        guard let b = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: length), let ch = b.floatChannelData else { return nil }
        b.frameLength = length
        for i in 0..<Int(length) {
            let t = Double(i) / rate
            var v = 0.0
            for (f, start) in notes where t >= start {
                let u = t - start
                let env = min(1, u / 0.006) * exp(-u * 7)
                v += env * (sin(2 * .pi * f * u) + 0.18 * sin(4 * .pi * f * u))
            }
            let s = Float(v * 0.16)
            for c in 0..<Int(format.channelCount) { ch[c][i] = s }
        }
        return b
    }

    private static func play(_ notes: [(Double, Double)]) {
        guard SoundFX.on, UIApplication.shared.applicationState == .active else { return }
        if engine == nil {
            let e = AVAudioEngine(), n = AVAudioPlayerNode()
            e.attach(n)
            e.connect(n, to: e.mainMixerNode, format: e.mainMixerNode.outputFormat(forBus: 0))
            try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
            engine = e; node = n
        }
        guard let e = engine, let n = node else { return }
        if !e.isRunning { try? e.start() }
        guard let b = buffer(notes, format: e.mainMixerNode.outputFormat(forBus: 0)) else { return }
        n.scheduleBuffer(b, at: nil, options: .interrupts)
        n.play()
    }

    private static func feel(_ events: [CHHapticEvent]) {
        guard UserDefaults.standard.object(forKey: "haptics") as? Bool ?? true, CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        if haptics == nil { haptics = try? CHHapticEngine(); haptics?.isAutoShutdownEnabled = true }
        guard let h = haptics, let p = try? CHHapticPattern(events: events, parameters: []) else { return }
        try? h.start()
        try? h.makePlayer(with: p).start(atTime: 0)
    }

    private static func tap(_ at: Double, _ intensity: Float, _ sharp: Float) -> CHHapticEvent {
        CHHapticEvent(eventType: .hapticTransient, parameters: [.init(parameterID: .hapticIntensity, value: intensity), .init(parameterID: .hapticSharpness, value: sharp)], relativeTime: at)
    }

    /// Someone ticked off, notes saved, a badge matched.
    static func done() {
        play([(880, 0), (1318.5, 0.09)])
        feel([tap(0, 0.55, 0.6), tap(0.09, 0.8, 0.85)])
    }

    /// All five done: the chime climbs one more step and the swell lasts a beat.
    static func complete() {
        play([(880, 0), (1108.7, 0.09), (1318.5, 0.18), (1760, 0.3)])
        feel([tap(0, 0.5, 0.5), tap(0.09, 0.65, 0.7), tap(0.18, 0.8, 0.85),
              CHHapticEvent(eventType: .hapticContinuous, parameters: [.init(parameterID: .hapticIntensity, value: 0.45), .init(parameterID: .hapticSharpness, value: 0.2)], relativeTime: 0.3, duration: 0.35)])
    }
}
