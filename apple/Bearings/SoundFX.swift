import AVFoundation
import UIKit

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
