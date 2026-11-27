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

/** A computed CSS colour ("rgb(…)", "rgba(…)", "#rrggbb") as [r, g, b, a], each 0 to 1; null otherwise. */
export function colorOf(css) {
  const s = String(css || '').trim()
  let m = /^#([0-9a-f]{6})$/i.exec(s)
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255).concat(1)
  m = /^rgba?\(([^)]+)\)$/i.exec(s)
  if (!m) return null
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
  if (parts.length < 3 || parts.slice(0, 3).some(n => !Number.isFinite(n))) return null
  const a = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1
  return [...parts.slice(0, 3).map(n => Math.min(255, Math.max(0, n)) / 255), Math.min(1, Math.max(0, a))]
}

/**
 * How the glass stands while something covers the page: 'dimmed' where the sheet stops short of
 * the bar (the system's column on iPhone Duo, which the sheets leave free), 'hidden' where the sheet
 * runs under it (a phone on its side), else 'active'.
 */
export function glassState(blocked, root = globalThis.document?.documentElement) {
  if (!blocked) return 'active'
  return root?.dataset?.vbar ? 'dimmed' : 'hidden'
}

/**
 * What the native bar is drawn from: the page's own buttons, measured. {} when it should not be
 * drawn (the bar is at the bottom, the page is zoomed, a part is missing or overlaps another).
 */
export function tabGlassLayout(nav, { blocked = false } = {}) {
  const root = document.documentElement
  const viewport = window.visualViewport
  const state = glassState(blocked, root)
  if (state === 'hidden' || document.hidden || getComputedStyle(nav).flexDirection !== 'column'
      || (viewport && (Math.abs(viewport.scale - 1) > 0.01
        || Math.abs(viewport.offsetTop) > 1 || Math.abs(viewport.offsetLeft) > 1))) return {}
  const entries = [...nav.querySelectorAll('button[data-tour^="tab-"]')]
  if (entries.length !== 4) return {}
  const navRect = nav.getBoundingClientRect()
  const rects = entries.map(el => el.getBoundingClientRect())
  const top = Math.min(...rects.map(r => r.top)), bottom = Math.max(...rects.map(r => r.bottom))
  if (rects.some(r => !(r.width > 0 && r.height > 0)) || top < Math.max(0, navRect.top) - 1
      || bottom > Math.min(window.innerHeight, navRect.bottom) + 1) return {}
  const startBtn = nav.querySelector('button.start')
  const cir = startBtn?.querySelector('.cir')
  const cirRect = cir?.getBoundingClientRect()
  if (cirRect && cirRect.top < bottom && cirRect.bottom > top) return {}
  const on = entries.find(el => el.hasAttribute('aria-current'))
  const label = el => el.dataset.label || el.textContent.trim()
  const text = entries[0].querySelector('.tab-ic + span')
  return {
    state, theme: root.dataset.theme || 'dark',
    x: navRect.left, y: navRect.top, width: navRect.width, height: navRect.height,
    // The colours the page paints them in, so the glass follows the theme and the accent picked.
    tint: colorOf(getComputedStyle(on || entries[0]).color),
    onTint: cir ? colorOf(getComputedStyle(cir).color) : null,
    recordingTint: colorOf(getComputedStyle(root).getPropertyValue('--orange')),
    // Names under the symbols where the page shows them (a tall rail), not where it hides them.
    labels: !!text && getComputedStyle(text).position !== 'absolute',
    tabs: entries.map((el, i) => ({
      ...frameOf(rects[i]), id: el.dataset.tour, label: label(el), a11y: el.getAttribute('aria-label') || label(el),
      selected: el === on, dot: !!el.querySelector('.tab-dot'),
    })),
    ...(cirRect && cirRect.width > 0 ? { start: {
      ...frameOf(cirRect), label: startBtn.getAttribute('aria-label') || startBtn.textContent.trim(),
      recording: startBtn.classList.contains('rec'),
    } } : {}),
  }
}

// The web buttons provide the layout and remain usable when UIKit glass is unavailable. While the
// native bar is visible its tabs and Start forward to the same handlers: a tab press clicks the
// page's tab, Start's tap clicks Start, and a hold on Start is `onHold` (the picker, #930).
// Returns the unbind, with `.update({ blocked })` for a sheet opening or closing: the glass dims
// or steps aside in place instead of being taken down and drawn again.
export function bindTabGlass(nav, { blocked: blockedAtStart = false, onHold } = {}) {
  if (!nav || platformNow() !== 'ios') return
  let blocked = !!blockedAtStart
  let stopped = false
  let native
  let listeners = []
  let pending = 0
  let last = ''
  let generation = 0
  const root = document.documentElement
  const viewport = window.visualViewport
  const refresh = () => {
    pending = 0
    if (stopped || !native) return
    const next = tabGlassLayout(nav, { blocked })
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
  attrs.observe(root, { attributes: true, attributeFilter: ['data-vbar', 'data-theme', 'data-accent', 'style', 'dir'] })
  attrs.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  attrs.observe(nav, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-current', 'aria-label', 'class'] })
  const sizing = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
  sizing?.observe(nav)
  nav.addEventListener('scroll', schedule)
  window.addEventListener('resize', schedule)
  viewport?.addEventListener('resize', schedule)
  viewport?.addEventListener('scroll', schedule)
  document.addEventListener('visibilitychange', schedule)
  plugin().then(async handle => {
    if (stopped || !handle) return
    const on = async (event, fn) => { listeners.push(await handle.p.addListener(event, fn)) }
    await on('tabPressed', ({ id }) => {
      if (!stopped && !blocked) nav.querySelector(`button[data-tour="${CSS.escape(String(id))}"]`)?.click()
    })
    await on('startPressed', () => { if (!stopped && !blocked) nav.querySelector('button.start')?.click() })
    await on('startHeld', () => { if (!stopped && !blocked) onHold?.() })
    if (stopped) { listeners.forEach(l => l.remove().catch(() => {})); return }
    native = handle.p
    schedule()
  }).catch(() => {})
  const unbind = () => {
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
    listeners.forEach(l => l.remove().catch(() => {}))
    // Unmounted (signed out, a screen without tabs): the glass dematerializes.
    native?.setTabGlass({ state: 'hidden', revision: revision() }).catch(() => {})
  }
  unbind.update = ({ blocked: next } = {}) => {
    if (stopped || !!next === blocked) return
    blocked = !!next
    schedule()
  }
  return unbind
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
