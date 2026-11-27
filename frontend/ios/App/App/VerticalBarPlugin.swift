import Capacitor
import UIKit
import WebKit

/**
 * The system's vertical bar, and the tab bar that stands in it (lib/vertical-bar.js).
 *
 * On iPhone Duo's outer display iOS moves the status bar to a column on the side and hands that
 * column to the app as a side safe-area inset; a UITabBar moves into it on its own, the page's tab
 * bar does not. The page asks for the side the bar is on (`left`, `right`, or none) and `top`,
 * where the system's own region in that column (the camera, the clock, the battery) ends, so its
 * tabs can stand below it. MainViewController hands every layout pass to `update(from:)`; a change
 * goes out as a "change" event, kept until the page listens.
 *
 * Wherever the page's tabs stand in a column (that bar, or a phone on its side), `setTabGlass`
 * draws them as the system draws a tab bar since iOS 26 (GlassTabRail below): Liquid Glass in a
 * glass container, a selection platter that slides to the tab you touch and follows a drag
 * along the bar, symbols that fill and bounce when picked, and Start as a tinted glass button
 * beside them. The page keeps its own buttons underneath for the layout, VoiceOver of the web
 * view, and every OS before 26.
 *
 * Usage from JS:
 *   const VerticalBar = registerPlugin('VerticalBar')
 *   await VerticalBar.get()          // { side: 'right', top: 174 } or { side: null, top: 0 }
 *   await VerticalBar.setTabGlass({ revision, state, tabs, start, … })   // { visible }
 *   events: change, tabPressed { id }, startPressed, startHeld
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
    /// The GlassTabRail on iOS 26 and later (typed loosely so the class needs no availability).
    private var rail: AnyObject?
    private var railRevision: Double = 0

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
            // Layouts can overtake each other on the bridge: only the newest one counts.
            let revision = call.getDouble("revision") ?? 0
            guard revision >= self.railRevision else {
                call.resolve(["visible": (self.rail as? GlassTabRail)?.isShown == true])
                return
            }
            self.railRevision = revision
            call.resolve(["visible": self.placeRail(call.options as? [String: Any] ?? [:])])
        }
    }

    @available(iOS 26.0, *)
    @MainActor
    private func placeRail(_ options: [String: Any]) -> Bool {
        guard let webView = bridge?.webView, let window = webView.window,
              let layout = GlassTabRail.Layout(options),
              webView.bounds.insetBy(dx: -1, dy: -1).contains(layout.frame) else {
            (rail as? GlassTabRail)?.dismiss()
            return false
        }
        let view: GlassTabRail
        if let existing = rail as? GlassTabRail {
            view = existing
        } else {
            view = GlassTabRail { [weak self] event, data in
                self?.notifyListeners(event, data: data)
            }
            rail = view
        }
        view.apply(layout, over: webView, in: window)
        return true
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

/// A view that lets touches through wherever none of its glass is.
private final class PassthroughView: UIView {
    var ignored: [UIView] = []
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === self || ignored.contains(where: { $0 === hit }) ? nil : hit
    }
}

/// One tab: its symbol, its name under it when the bar has room, and the connection dot.
@available(iOS 26.0, *)
private final class GlassTabItem: UIControl {
    let id: String
    let icon = UIImageView()
    let title = UILabel()
    let dot = UIView()
    var symbol = ""
    var selectedSymbol = ""
    var shownSymbol = ""
    var showsTitle = false

    init(id: String) {
        self.id = id
        super.init(frame: .zero)
        icon.contentMode = .center
        icon.isUserInteractionEnabled = false
        icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 20, weight: .medium)
        title.font = UIFontMetrics(forTextStyle: .caption2).scaledFont(for: .systemFont(ofSize: 10, weight: .semibold), maximumPointSize: 13)
        title.adjustsFontForContentSizeCategory = true
        title.adjustsFontSizeToFitWidth = true
        title.minimumScaleFactor = 0.7
        title.textAlignment = .center
        title.isUserInteractionEnabled = false
        dot.backgroundColor = .systemOrange
        dot.layer.cornerRadius = 3.5
        dot.isUserInteractionEnabled = false
        dot.isHidden = true
        [icon, title, dot].forEach(addSubview)
        isAccessibilityElement = true
        showsLargeContentViewer = true
        scalesLargeContentImage = true
    }

    required init?(coder: NSCoder) { nil }

    override func layoutSubviews() {
        super.layoutSubviews()
        let titleHeight: CGFloat = showsTitle ? ceil(title.font.lineHeight) : 0
        let gap: CGFloat = showsTitle ? 2 : 0
        let iconHeight: CGFloat = 26
        let top = (bounds.height - iconHeight - gap - titleHeight) / 2
        icon.frame = CGRect(x: 0, y: top, width: bounds.width, height: iconHeight)
        title.frame = CGRect(x: 2, y: top + iconHeight + gap, width: bounds.width - 4, height: titleHeight)
        title.isHidden = !showsTitle
        dot.frame = CGRect(x: bounds.midX + 7, y: top + 1, width: 7, height: 7)
    }
}

/**
 * The tab bar in a column, drawn as Liquid Glass. Everything sits in one glass container, so the
 * tabs' capsule and Start blend into each other when a press brings them close. Laid out from the
 * page's own buttons on every change (Layout), animated only where the state changed.
 */
@available(iOS 26.0, *)
@MainActor
final class GlassTabRail: NSObject, UIGestureRecognizerDelegate {
    struct Tab: Equatable {
        var id: String, label: String, spoken: String, frame: CGRect, selected: Bool, dot: Bool
    }
    struct Start: Equatable {
        var frame: CGRect, label: String, recording: Bool
    }
    struct Layout {
        var frame: CGRect
        var tabs: [Tab]
        var start: Start?
        var dimmed: Bool
        var labels: Bool
        var dark: Bool
        var tint: UIColor?
        var onTint: UIColor?
        var recording: UIColor?

        init?(_ json: [String: Any]) {
            guard json["state"] as? String != "hidden", let frame = rect(json),
                  let list = json["tabs"] as? [[String: Any]], (2...6).contains(list.count) else { return nil }
            let tabs = list.compactMap { t -> Tab? in
                guard let id = t["id"] as? String, let r = rect(t), frame.insetBy(dx: -1, dy: -1).contains(r) else { return nil }
                let label = t["label"] as? String ?? ""
                return Tab(id: id, label: label, spoken: t["a11y"] as? String ?? label, frame: r,
                           selected: t["selected"] as? Bool == true, dot: t["dot"] as? Bool == true)
            }
            guard tabs.count == list.count else { return nil }
            self.frame = frame
            self.tabs = tabs
            if let s = json["start"] as? [String: Any], let r = rect(s), frame.insetBy(dx: -1, dy: -1).contains(r),
               !tabs.contains(where: { $0.frame.intersects(r) }) {
                start = Start(frame: r, label: s["label"] as? String ?? "", recording: s["recording"] as? Bool == true)
            }
            dimmed = json["state"] as? String == "dimmed"
            labels = json["labels"] as? Bool == true
            dark = json["theme"] as? String != "light"
            tint = color(json["tint"])
            onTint = color(json["onTint"])
            recording = color(json["recordingTint"])
        }
    }

    private static let symbols: [String: (String, String)] = [
        "tab-home": ("house", "house.fill"),
        "tab-plan": ("calendar", "calendar"),
        "tab-stats": ("chart.bar", "chart.bar.fill"),
        "tab-library": ("dumbbell", "dumbbell.fill"),
    ]

    private let host = PassthroughView()
    private let container = UIVisualEffectView(effect: nil)
    private let tabs = UIVisualEffectView(effect: nil)
    private let platter = UIView()
    private let start = UIVisualEffectView(effect: nil)
    private let startButton = UIButton(type: .custom)
    private let startIcon = UIImageView()
    /// The pulse around Start while a workout runs, beside the glass rather than inside it.
    private let ringView = UIView()
    private let ring = CAShapeLayer()
    private var startTint: UIColor?
    private var items: [GlassTabItem] = []
    private var layout: Layout?
    private var selectedId: String?
    private var pressedId: String?
    private var dragging = false
    private var dismissing = false
    private let selection = UISelectionFeedbackGenerator()
    private let send: (String, [String: Any]) -> Void

    var isShown: Bool { host.superview != nil && !dismissing }

    init(send: @escaping (String, [String: Any]) -> Void) {
        self.send = send
        super.init()
        let glassContainer = UIGlassContainerEffect()
        glassContainer.spacing = 8
        container.effect = glassContainer
        // Touches outside the glass reach the page; on the capsule they stay with the bar.
        host.ignored = [container, container.contentView]
        host.addSubview(container)
        container.contentView.addSubview(tabs)
        container.contentView.addSubview(ringView)
        container.contentView.addSubview(start)
        ringView.isUserInteractionEnabled = false
        ringView.layer.addSublayer(ring)
        tabs.cornerConfiguration = .capsule()
        tabs.accessibilityTraits = .tabBar
        tabs.addInteraction(UILargeContentViewerInteraction())
        platter.isUserInteractionEnabled = false
        platter.backgroundColor = UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 1, alpha: 0.16) : UIColor(white: 0, alpha: 0.08) }
        platter.cornerConfiguration = .capsule()
        tabs.contentView.addSubview(platter)
        let pan = UIPanGestureRecognizer(target: self, action: #selector(dragged(_:)))
        pan.delegate = self
        tabs.addGestureRecognizer(pan)

        start.cornerConfiguration = .capsule()
        startIcon.image = UIImage(systemName: "play.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 22, weight: .semibold))
        startIcon.contentMode = .center
        startIcon.isUserInteractionEnabled = false
        start.contentView.addSubview(startIcon)
        start.contentView.addSubview(startButton)
        ring.fillColor = UIColor.clear.cgColor
        ring.lineWidth = 2
        ring.opacity = 0
        startButton.addTarget(self, action: #selector(startTapped), for: .touchUpInside)
        let hold = UILongPressGestureRecognizer(target: self, action: #selector(startHeld(_:)))
        hold.minimumPressDuration = 0.45   // TabBar.jsx START_HOLD_MS
        startButton.addGestureRecognizer(hold)
        // The page's own Start button is what VoiceOver reads; this one would say it twice.
        start.accessibilityElementsHidden = true
    }

    private var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }

    private func spring(_ duration: TimeInterval = 0.5, bounce: CGFloat = 0.22, _ changes: @escaping () -> Void, completion: ((Bool) -> Void)? = nil) {
        if reduceMotion {
            UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction], animations: changes, completion: completion)
        } else {
            UIView.animate(springDuration: duration, bounce: bounce, initialSpringVelocity: 0, delay: 0,
                           options: [.beginFromCurrentState, .allowUserInteraction], animations: changes, completion: completion)
        }
    }

    private func tabGlass() -> UIGlassEffect {
        let glass = UIGlassEffect(style: .regular)
        glass.isInteractive = true
        return glass
    }

    /// Prominent (tinted) while it can be pressed, orange while a workout runs, plain glass while a sheet has the screen.
    private func startTintFor(_ l: Layout, _ s: Start) -> UIColor? {
        l.dimmed ? nil : (s.recording ? (l.recording ?? .systemOrange) : (l.tint ?? .tintColor))
    }

    private func startGlass(_ l: Layout, _ s: Start) -> UIGlassEffect {
        let glass = UIGlassEffect(style: .regular)
        glass.isInteractive = true
        glass.tintColor = startTintFor(l, s)
        return glass
    }

    /// A new tint fades in; the same one leaves the glass alone, so a layout pass never flickers it.
    private func refreshStartGlass(animated: Bool) {
        guard let l = layout, let s = l.start, start.effect != nil else { return }
        let tint = startTintFor(l, s)
        guard tint != startTint else { return }
        startTint = tint
        let glass = startGlass(l, s)
        if animated { UIView.animate(withDuration: 0.25) { self.start.effect = glass } } else { start.effect = glass }
    }

    func apply(_ l: Layout, over webView: WKWebView, in window: UIWindow) {
        let first = host.superview == nil || dismissing
        dismissing = false
        let previous = layout
        layout = l
        if host.superview == nil {
            // Above the page, under anything presented later (an alert, the share sheet).
            if let root = window.subviews.first(where: { webView.isDescendant(of: $0) }) {
                window.insertSubview(host, aboveSubview: root)
            } else {
                window.addSubview(host)
            }
        }
        host.overrideUserInterfaceStyle = l.dark ? .dark : .light
        let frame = webView.convert(l.frame, to: window)
        let tabsFrame = l.tabs.map(\.frame).reduce(l.tabs[0].frame) { $0.union($1) }.insetBy(dx: -3, dy: -5)
            .intersection(l.frame.insetBy(dx: 2, dy: 0))
        let structureChanged = items.map(\.id) != l.tabs.map(\.id)
        UIView.performWithoutAnimation {
            host.frame = frame
            container.frame = host.bounds
            tabs.frame = tabsFrame.offsetBy(dx: -l.frame.minX, dy: -l.frame.minY)
            if structureChanged { rebuildItems(l.tabs) }
            for (item, tab) in zip(items, l.tabs) {
                item.frame = tab.frame.offsetBy(dx: -tabsFrame.minX, dy: -tabsFrame.minY)
                item.showsTitle = l.labels && item.frame.height >= 50
                item.title.text = tab.label
                item.accessibilityLabel = tab.spoken
                item.largeContentTitle = tab.label
                item.dot.isHidden = !tab.dot
                item.setNeedsLayout()
            }
            if let s = l.start {
                start.frame = s.frame.offsetBy(dx: -l.frame.minX, dy: -l.frame.minY)
                startIcon.frame = start.bounds
                startButton.frame = start.bounds
                ringView.frame = start.frame
                ring.frame = ringView.bounds
                ring.path = UIBezierPath(ovalIn: ringView.bounds.insetBy(dx: 1, dy: 1)).cgPath
            }
            start.isHidden = l.start == nil
            ringView.isHidden = l.start == nil
        }
        let picked = l.tabs.first(where: \.selected)?.id
        let moved = picked != selectedId
        if !dragging && pressedId == nil {
            selectedId = picked
        }
        paint(l, animated: !first && moved)
        if first || structureChanged || previous?.frame != l.frame {
            UIView.performWithoutAnimation { placePlatter(on: selectedId, lifted: false) }
        } else if moved && !dragging && pressedId == nil {
            spring { self.placePlatter(on: self.selectedId, lifted: false) }
        }
        dim(l.dimmed, animated: !first)
        if first { materialize() }
        recordingRing(l.start?.recording == true && !l.dimmed, color: l.recording ?? .systemOrange)
    }

    private func rebuildItems(_ list: [Tab]) {
        items.forEach { $0.removeFromSuperview() }
        items = list.map { tab in
            let item = GlassTabItem(id: tab.id)
            let names = Self.symbols[tab.id] ?? ("circle", "circle.fill")
            item.symbol = names.0
            item.selectedSymbol = UIImage(systemName: names.1) == nil ? names.0 : names.1
            item.icon.image = UIImage(systemName: item.symbol)
            item.shownSymbol = item.symbol
            item.largeContentImage = UIImage(systemName: item.symbol)
            item.addTarget(self, action: #selector(itemDown(_:)), for: .touchDown)
            item.addTarget(self, action: #selector(itemDragIn(_:)), for: .touchDragEnter)
            item.addTarget(self, action: #selector(itemUp(_:)), for: .touchUpInside)
            item.addTarget(self, action: #selector(itemCancel(_:)), for: [.touchUpOutside, .touchCancel, .touchDragExit])
            tabs.contentView.addSubview(item)
            return item
        }
    }

    /// Symbols and tints for the tab that is picked (or being pressed). The newly picked one fills and bounces.
    private func paint(_ l: Layout, animated: Bool) {
        let shown = pressedId ?? selectedId
        for item in items {
            let on = item.id == shown
            let name = on ? item.selectedSymbol : item.symbol
            if item.shownSymbol != name, let image = UIImage(systemName: name) {
                item.shownSymbol = name
                if animated && !reduceMotion {
                    item.icon.setSymbolImage(image, contentTransition: .replace)
                } else {
                    item.icon.image = image
                }
                // The picked symbol springs as it fills, the way a tab bar's does.
                if on && animated && !reduceMotion {
                    let icon = item.icon
                    icon.transform = CGAffineTransform(scaleX: 0.8, y: 0.8)
                    spring(0.45, bounce: 0.55) { icon.transform = .identity }
                }
            }
            let tint: UIColor = on ? (l.tint ?? .tintColor) : .label
            item.icon.tintColor = tint
            item.title.textColor = tint
            if item.id == selectedId { item.accessibilityTraits.insert(.selected) } else { item.accessibilityTraits.remove(.selected) }
            item.accessibilityTraits.insert(.button)
        }
        startIcon.tintColor = l.start?.recording == true ? .black : (l.onTint ?? .white)
    }

    private func frameOf(_ id: String?) -> CGRect? {
        items.first(where: { $0.id == id })?.frame
    }

    private func placePlatter(on id: String?, lifted: Bool) {
        guard let rect = frameOf(id) else {
            platter.alpha = 0
            return
        }
        platter.alpha = 1
        platter.bounds = CGRect(origin: .zero, size: CGSize(width: rect.width - 4, height: min(rect.height - 2, rect.width + 6)))
        platter.center = CGPoint(x: rect.midX, y: rect.midY)
        platter.transform = lifted ? CGAffineTransform(scaleX: 1.12, y: 1.12) : .identity
    }

    private func materialize() {
        tabs.effect = nil
        start.effect = nil
        tabs.contentView.alpha = 0
        start.contentView.alpha = 0
        let glass = tabGlass()
        let startEffect = layout.flatMap { l in l.start.map { startGlass(l, $0) } }
        startTint = layout.flatMap { l in l.start.flatMap { startTintFor(l, $0) } }
        if !reduceMotion { host.transform = CGAffineTransform(scaleX: 0.92, y: 0.92) }
        spring(0.55, bounce: 0.3) {
            self.tabs.effect = glass
            self.start.effect = startEffect
            self.tabs.contentView.alpha = self.layout?.dimmed == true ? 0.45 : 1
            self.start.contentView.alpha = self.layout?.dimmed == true ? 0.45 : 1
            self.host.transform = .identity
        }
    }

    /// While a sheet has the screen the bar stays, dimmed and out of reach, the way a UITabBar does
    /// under a presented sheet: a tap there lands on the page's backdrop and closes the sheet.
    private var isDimmed = false
    private func dim(_ on: Bool, animated: Bool) {
        let changed = on != isDimmed
        isDimmed = on
        host.isUserInteractionEnabled = !on
        refreshStartGlass(animated: animated)
        guard changed else { return }
        let changes = {
            self.host.tintAdjustmentMode = on ? .dimmed : .automatic
            self.tabs.contentView.alpha = on ? 0.45 : 1
            self.start.contentView.alpha = on ? 0.45 : 1
        }
        if animated { UIView.animate(withDuration: 0.25, delay: 0, options: [.beginFromCurrentState], animations: changes) } else { changes() }
    }

    private func recordingRing(_ on: Bool, color: UIColor) {
        ring.strokeColor = color.cgColor
        let key = "og.ping"
        if !on || reduceMotion {
            ring.removeAnimation(forKey: key)
            ring.opacity = 0
            return
        }
        guard ring.animation(forKey: key) == nil else { return }
        let scale = CABasicAnimation(keyPath: "transform.scale")
        scale.fromValue = 1
        scale.toValue = 1.45
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0.7
        fade.toValue = 0
        let group = CAAnimationGroup()
        group.animations = [scale, fade]
        group.duration = 1.9
        group.repeatCount = .infinity
        group.timingFunction = CAMediaTimingFunction(name: .easeOut)
        ring.add(group, forKey: key)
    }

    /// Dematerializes the glass, then leaves the window.
    func dismiss() {
        guard host.superview != nil, !dismissing else { return }
        dismissing = true
        dragging = false
        pressedId = nil
        spring(0.35, bounce: 0) {
            self.tabs.effect = nil
            self.start.effect = nil
            self.tabs.contentView.alpha = 0
            self.start.contentView.alpha = 0
            if !self.reduceMotion { self.host.transform = CGAffineTransform(scaleX: 0.94, y: 0.94) }
        } completion: { _ in
            guard self.dismissing else { return }
            self.host.removeFromSuperview()
            self.host.transform = .identity
            self.layout = nil
            self.isDimmed = false
            self.startTint = nil
            self.dismissing = false
        }
    }

    // MARK: touches

    private func choose(_ id: String) {
        let was = selectedId
        selectedId = id
        pressedId = nil
        if let l = layout { paint(l, animated: was != id) }
        spring { self.placePlatter(on: id, lifted: false) }
        send("tabPressed", ["id": id])
    }

    @objc private func itemDown(_ item: GlassTabItem) {
        guard !dragging else { return }
        pressedId = item.id
        if let l = layout { paint(l, animated: item.id != selectedId) }
        spring(0.35, bounce: 0.3) { self.placePlatter(on: item.id, lifted: true) }
    }

    @objc private func itemDragIn(_ item: GlassTabItem) {
        itemDown(item)
    }

    @objc private func itemUp(_ item: GlassTabItem) {
        guard !dragging else { return }
        choose(item.id)
    }

    @objc private func itemCancel(_ item: GlassTabItem) {
        guard !dragging, pressedId != nil else { return }
        pressedId = nil
        if let l = layout { paint(l, animated: true) }
        spring { self.placePlatter(on: self.selectedId, lifted: false) }
    }

    /// Along the bar, the platter follows the finger and the tab under it lights; letting go picks it.
    @objc private func dragged(_ pan: UIPanGestureRecognizer) {
        guard !items.isEmpty else { return }
        let point = pan.location(in: tabs.contentView)
        let nearest = items.min(by: { abs($0.frame.midY - point.y) < abs($1.frame.midY - point.y) })
        switch pan.state {
        case .began:
            dragging = true
            selection.prepare()
            pressedId = nearest?.id
            if let l = layout { paint(l, animated: true) }
            spring(0.3, bounce: 0.3) { self.placePlatter(on: self.pressedId, lifted: true) }
        case .changed:
            let lo = items.map(\.frame.midY).min() ?? 0, hi = items.map(\.frame.midY).max() ?? 0
            let y = min(max(point.y, lo), hi)
            platter.center = CGPoint(x: platter.center.x, y: y)
            if let id = nearest?.id, id != pressedId {
                pressedId = id
                selection.selectionChanged()
                if let l = layout { paint(l, animated: true) }
            }
        case .ended:
            dragging = false
            if let id = nearest?.id { choose(id) }
        default:
            dragging = false
            pressedId = nil
            if let l = layout { paint(l, animated: true) }
            spring { self.placePlatter(on: self.selectedId, lifted: false) }
        }
    }

    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        guard let pan = g as? UIPanGestureRecognizer else { return true }
        let v = pan.velocity(in: tabs)
        return abs(v.y) > abs(v.x)
    }

    @objc private func startTapped() {
        send("startPressed", [:])
    }

    @objc private func startHeld(_ g: UILongPressGestureRecognizer) {
        guard g.state == .began else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        send("startHeld", [:])
    }
}

private func rect(_ json: [String: Any]) -> CGRect? {
    guard let x = json["x"] as? Double, let y = json["y"] as? Double,
          let w = json["width"] as? Double, let h = json["height"] as? Double,
          x.isFinite, y.isFinite, w.isFinite, h.isFinite, w > 0, h > 0 else { return nil }
    return CGRect(x: x, y: y, width: w, height: h)
}

/// `[r, g, b, a]`, each 0 to 1, as the page reads them off its own buttons.
private func color(_ value: Any?) -> UIColor? {
    guard let c = value as? [Double], c.count == 4, c.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1 }) else { return nil }
    return UIColor(red: c[0], green: c[1], blue: c[2], alpha: c[3])
}
