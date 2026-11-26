// iPhone Duo's outer display puts the status bar in a column on the side and gives that column
// to the app as a side safe-area inset (VerticalBarPlugin.swift). The tab bar moves into it, under
// the system's own region at the top of the column (the camera, the clock): data-vbar on <html>
// names the side and --vbar-top is where that region ends (index.css, "vertical bar").
import { platformNow } from './platform-now.js'

const SIDES = ['left', 'right']

export function applyVerticalBar(bar, root = globalThis.document?.documentElement) {
  if (!root) return
  if (SIDES.includes(bar?.side)) {
    root.dataset.vbar = bar.side
    root.style.setProperty('--vbar-top', `${Math.max(0, Number(bar.top) || 0)}px`)
  } else {
    delete root.dataset.vbar
    root.style.removeProperty('--vbar-top')
  }
}

// Registered once, kept inside an object: a Capacitor plugin proxy answers `then` with a native call
// that never settles, so a promise resolved with the bare proxy would hang (#42).
let pluginP = null
const plugin = () => pluginP || (pluginP = (async () => {
  const { registerPlugin } = await import('@capacitor/core')
  return { p: registerPlugin('VerticalBar') }
})().catch(() => null))

const frameOf = r => ({ x: r.left, y: r.top, width: r.width, height: r.height })
const revision = () => performance.timeOrigin + performance.now()

// The web buttons provide the layout and remain usable when UIKit glass is unavailable.
// While the native pill is visible, its buttons forward taps to the same navigation handlers.
export function bindTabGlass(nav, blocked) {
  if (!nav || platformNow() !== 'ios') return
  let stopped = false
  let native
  let listener
  let pending = 0
  let last = ''
  let generation = 0
  const root = document.documentElement
  const viewport = window.visualViewport
  const buttons = () => [...nav.querySelectorAll('button[data-tour^="tab-"]')]
  const layout = () => {
    if (blocked || document.hidden || getComputedStyle(nav).flexDirection !== 'column'
        || (viewport && (viewport.scale !== 1 || viewport.offsetTop || viewport.offsetLeft))) return {}
    const entries = buttons()
    if (entries.length !== 4) return {}
    const rects = entries.map(el => el.getBoundingClientRect())
    const navRect = nav.getBoundingClientRect()
    const left = Math.max(navRect.left, Math.min(...rects.map(r => r.left)) - 3)
    const right = Math.min(navRect.right, Math.max(...rects.map(r => r.right)) + 3)
    const top = Math.min(...rects.map(r => r.top)) - 3
    const bottom = Math.max(...rects.map(r => r.bottom)) + 3
    const start = nav.querySelector('button.start')?.getBoundingClientRect()
    if (top < Math.max(0, navRect.top) || bottom > Math.min(window.innerHeight, navRect.bottom)
        || (start && start.top < bottom && start.bottom > top)) return {}
    return {
      x: left, y: top, width: right - left, height: bottom - top, theme: root.dataset.theme,
      tabs: entries.map((el, i) => ({
        ...frameOf(rects[i]), id: el.dataset.tour, label: el.getAttribute('aria-label'),
        selected: el.hasAttribute('aria-current'), dot: !!el.querySelector('.tab-dot'),
      })),
    }
  }
  const refresh = () => {
    pending = 0
    if (stopped || !native) return
    const next = layout()
    const key = JSON.stringify(next)
    if (key === last) return
    last = key
    const request = ++generation
    if (!next.tabs) nav.removeAttribute('data-native-glass')
    native.setTabGlass({ ...next, revision: revision() }).then(({ visible }) => {
      if (!stopped && request === generation) nav.toggleAttribute('data-native-glass', visible === true)
    }).catch(() => {
      if (!stopped && request === generation) nav.removeAttribute('data-native-glass')
    })
  }
  const schedule = () => { if (!pending) pending = window.requestAnimationFrame(refresh) }
  const attrs = new MutationObserver(schedule)
  attrs.observe(root, { attributes: true, attributeFilter: ['data-vbar', 'data-theme', 'style'] })
  attrs.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  attrs.observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current', 'aria-label'] })
  const sizing = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
  sizing?.observe(nav)
  nav.addEventListener('scroll', schedule)
  window.addEventListener('resize', schedule)
  viewport?.addEventListener('resize', schedule)
  viewport?.addEventListener('scroll', schedule)
  document.addEventListener('visibilitychange', schedule)
  plugin().then(async handle => {
    if (stopped || !handle) return
    listener = await handle.p.addListener('tabPressed', ({ id }) => {
      if (!stopped && !blocked) buttons().find(el => el.dataset.tour === id)?.click()
    })
    if (stopped) { await listener.remove(); return }
    native = handle.p
    if (blocked) refresh()
    else schedule()
  }).catch(() => {})
  return () => {
    stopped = true
    window.cancelAnimationFrame(pending)
    attrs.disconnect()
    sizing?.disconnect()
    nav.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    viewport?.removeEventListener('resize', schedule)
    viewport?.removeEventListener('scroll', schedule)
    document.removeEventListener('visibilitychange', schedule)
    nav.removeAttribute('data-native-glass')
    listener?.remove().catch(() => {})
    native?.setTabGlass({ revision: revision() }).catch(() => {})
  }
}

export async function watchVerticalBar() {
  if (platformNow() !== 'ios') return
  try {
    const h = await plugin()
    if (!h) return
    await h.p.addListener('change', bar => applyVerticalBar(bar))
    applyVerticalBar(await h.p.get())
  } catch {
    // An app from before the plugin: the tab bar stays at the bottom.
  }
}
