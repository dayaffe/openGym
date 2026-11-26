import Capacitor
import UIKit
import WebKit

/**
 * The system's vertical bar, for the page (lib/vertical-bar.js). On iPhone Duo's outer display
 * iOS moves the status bar to a column on the side and hands that column to the app as a side
 * safe-area inset; a UITabBar moves into it on its own, the page's tab bar does not. The page asks
 * for the side the bar is on (`left`, `right`, or none) and `top`, where the system's own region
 * in that column (the camera, the clock, the battery) ends, so its tabs can stand below it.
 *
 * MainViewController hands every layout pass to `update(from:)`; a change goes out as a
 * "change" event, kept until the page listens.
 *
 * Usage from JS:
 *   const VerticalBar = registerPlugin('VerticalBar')
 *   await VerticalBar.get()   // { side: 'right', top: 174 } or { side: null, top: 0 }
 */
@objc(VerticalBarPlugin)
public class VerticalBarPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VerticalBarPlugin"
    public let jsName = "VerticalBar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTabGlass", returnType: CAPPluginReturnPromise),
    ]

    struct Bar: Equatable {
        var side: String?
        var top: Double

        static let none = Bar(side: nil, top: 0)

        var data: [String: Any] { ["side": side ?? NSNull(), "top": top] }
    }

    private var bar = Bar.none
    private var tabGlass: UIVisualEffectView?
    private var tabGlassRevision: Double = 0

    @objc func get(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            call.resolve((self?.bar ?? .none).data)
        }
    }

    @objc func setTabGlass(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self, #available(iOS 26.0, *) else {
                call.resolve(["visible": false])
                return
            }
            let revision = call.getDouble("revision") ?? 0
            guard revision >= self.tabGlassRevision else {
                call.resolve(["visible": false])
                return
            }
            self.tabGlassRevision = revision
            let visible = self.placeTabGlass(call)
            if !visible {
                self.tabGlass?.removeFromSuperview()
                self.tabGlass = nil
            }
            call.resolve(["visible": visible])
        }
    }

    @available(iOS 26.0, *)
    @MainActor
    private func placeTabGlass(_ call: CAPPluginCall) -> Bool {
        guard let webView = bridge?.webView, let window = webView.window,
              let tabs = call.getArray("tabs") as? [[String: Any]], tabs.count == 4,
              let options = call.options as? [String: Any], let frame = Self.tabFrame(options),
              webView.bounds.insetBy(dx: -1, dy: -1).contains(frame) else { return false }

        let symbols = ["tab-home": "house", "tab-plan": "calendar",
                       "tab-stats": "chart.bar", "tab-library": "dumbbell"]
        let controls = tabs.compactMap { tab -> (String, String, String, CGRect, Bool, Bool)? in
            guard let id = tab["id"] as? String, let symbol = symbols[id],
                  let label = tab["label"] as? String, let rect = Self.tabFrame(tab),
                  frame.insetBy(dx: -1, dy: -1).contains(rect) else { return nil }
            return (id, symbol, label, rect, tab["selected"] as? Bool == true, tab["dot"] as? Bool == true)
        }
        guard controls.count == tabs.count else { return false }
        let glass: UIVisualEffectView
        if let tabGlass {
            glass = tabGlass
        } else {
            // The bar has only symbols over muted page surfaces, so clear glass can
            // show more of the scrolling backdrop while keeping the symbols legible.
            let effect = UIGlassEffect(style: .clear)
            effect.isInteractive = true
            glass = UIVisualEffectView(effect: effect)
        }
        glass.cornerConfiguration = .capsule()
        glass.overrideUserInterfaceStyle = call.getString("theme") == "light" ? .light : .dark
        if glass.superview !== window { window.addSubview(glass) }
        glass.frame = webView.convert(frame, to: window)
        for (id, symbol, label, rect, selected, dot) in controls {
            let existing = glass.contentView.subviews.first { $0.accessibilityIdentifier == id } as? UIButton
            let button = existing ?? UIButton(type: .system)
            if existing == nil {
                button.accessibilityIdentifier = id
                button.addAction(UIAction { [weak self] _ in self?.notifyListeners("tabPressed", data: ["id": id]) }, for: .touchUpInside)
                glass.contentView.addSubview(button)
            }
            button.frame = rect.offsetBy(dx: -frame.minX, dy: -frame.minY)
            button.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 21, weight: selected ? .semibold : .medium)), for: .normal)
            button.tintColor = .label
            button.accessibilityLabel = label
            if selected { button.accessibilityTraits.insert(.selected) }
            else { button.accessibilityTraits.remove(.selected) }
            button.backgroundColor = selected ? .label.withAlphaComponent(0.10) : .clear
            button.layer.cornerRadius = button.bounds.height / 2
            let badgeTag = 901
            if dot {
                let badge = button.viewWithTag(badgeTag) ?? UIView()
                badge.tag = badgeTag
                badge.frame = CGRect(x: button.bounds.midX + 8, y: button.bounds.midY - 12, width: 7, height: 7)
                badge.backgroundColor = .systemOrange
                badge.layer.cornerRadius = 3.5
                badge.isUserInteractionEnabled = false
                if badge.superview == nil { button.addSubview(badge) }
            } else { button.viewWithTag(badgeTag)?.removeFromSuperview() }
        }
        tabGlass = glass
        return true
    }

    private static func tabFrame(_ json: [String: Any]) -> CGRect? {
        guard let x = json["x"] as? Double, let y = json["y"] as? Double,
              let w = json["width"] as? Double, let h = json["height"] as? Double,
              x.isFinite, y.isFinite, w.isFinite, h.isFinite, w > 0, h > 0 else { return nil }
        return CGRect(x: x, y: y, width: w, height: h)
    }

    func update(from view: UIView) {
        let next = VerticalBarPlugin.bar(in: view)
        guard next != bar else { return }
        bar = next
        notifyListeners("change", data: next.data, retainUntilConsumed: true)
    }

    static func bar(in view: UIView) -> Bar {
        #if compiler(>=6.4)
        if #available(iOS 27.1, *) {
            let edge = view.traitCollection.verticalBarEdge
            guard edge != .unspecified else { return .none }
            let rightToLeft = view.effectiveUserInterfaceLayoutDirection == .rightToLeft
            let onRight = (edge == .trailing) != rightToLeft
            let width = onRight ? view.safeAreaInsets.right : view.safeAreaInsets.left
            guard width > 0 else { return .none }
            let bounds = view.bounds
            let column = CGRect(x: onRight ? bounds.maxX - width : bounds.minX, y: bounds.minY, width: width, height: bounds.height)
            let top = view.reservedRegions(kind: .occlusion)
                .map(\.frame)
                .filter { $0.intersects(column) }
                .map(\.maxY)
                .max() ?? view.safeAreaInsets.top
            return Bar(side: onRight ? "right" : "left", top: Double(top))
        }
        #endif
        return .none
    }
}
