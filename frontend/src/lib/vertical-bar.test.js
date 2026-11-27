// @vitest-environment happy-dom
// iPhone Duo closed: the tab bar stands in the system's side column, below the clock.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ listener: null, bar: { side: null, top: 0 }, fail: false }))

const pluginProxy = () => new Proxy({}, {
  get: (_, prop) => {
    if (prop === 'then') return () => new Promise(() => {})
    if (prop === 'addListener') return async (_event, fn) => { h.listener = fn }
    if (prop === 'get') return async () => {
      if (h.fail) throw new Error('"VerticalBar" plugin is not implemented on ios')
      return h.bar
    }
    return undefined
  },
})
vi.mock('@capacitor/core', () => ({ registerPlugin: () => pluginProxy() }))

beforeEach(() => {
  vi.resetModules()
  h.listener = null
  h.bar = { side: null, top: 0 }
  h.fail = false
  globalThis.Capacitor = { getPlatform: () => 'ios' }
  delete document.documentElement.dataset.vbar
  document.documentElement.style.removeProperty('--vbar-top')
})

const root = () => document.documentElement

describe('vertical bar', () => {
  it('puts the tabs in the column the phone reports, and back at the bottom when it goes', async () => {
    h.bar = { side: 'right', top: 174 }
    const { watchVerticalBar } = await import('./vertical-bar.js')
    await watchVerticalBar()
    expect(root().dataset.vbar).toBe('right')
    expect(root().style.getPropertyValue('--vbar-top')).toBe('174px')

    h.listener({ side: null, top: 0 })
    expect(root().dataset.vbar).toBeUndefined()
    expect(root().style.getPropertyValue('--vbar-top')).toBe('')
  })

  it('keeps the bottom bar for anything that is not a side', async () => {
    const { applyVerticalBar } = await import('./vertical-bar.js')
    applyVerticalBar({ side: 'top', top: 20 })
    expect(root().dataset.vbar).toBeUndefined()
    applyVerticalBar({ side: 'left', top: -3 })
    expect(root().style.getPropertyValue('--vbar-top')).toBe('0px')
  })

  it('leaves the bottom bar alone on Android and in an app without the plugin', async () => {
    globalThis.Capacitor = { getPlatform: () => 'android' }
    h.bar = { side: 'right', top: 174 }
    let { watchVerticalBar } = await import('./vertical-bar.js')
    await watchVerticalBar()
    expect(root().dataset.vbar).toBeUndefined()

    vi.resetModules()
    globalThis.Capacitor = { getPlatform: () => 'ios' }
    h.fail = true
    ;({ watchVerticalBar } = await import('./vertical-bar.js'))
    await expect(watchVerticalBar()).resolves.toBeUndefined()
    expect(root().dataset.vbar).toBeUndefined()
  })
})

describe('the Liquid Glass tab bar', () => {
  const box = (el, left, top, width, height) => {
    el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top })
  }
  function rail({ dot = false, rec = false } = {}) {
    document.body.innerHTML = `<nav id="tabbar" style="display:flex;flex-direction:column;color:rgb(10, 20, 30)">
      ${['home', 'plan', 'stats', 'library'].map((k, i) => `<button data-tour="tab-${k}" data-label="${k}" ${i === 1 ? 'aria-current="location" style="color: rgb(163, 230, 53)"' : ''}
        ${dot && i === 0 ? 'aria-label="home, Connection problem"' : ''}><span class="tab-ic">${dot && i === 0 ? '<span class="tab-dot"></span>' : ''}</span><span>${k}</span></button>`).join('')}
      <button data-tour="start" class="start${rec ? ' rec' : ''}" aria-label="${rec ? 'Resume' : ''}"><span class="cir" style="color: rgb(0, 0, 0)"></span><span>Start</span></button>
    </nav>`
    const nav = document.getElementById('tabbar')
    box(nav, 700, 0, 60, 400)
    ;[...nav.querySelectorAll('button[data-tour^="tab-"]')].forEach((b, i) => box(b, 704, 120 + i * 48, 52, 44))
    box(nav.querySelector('.cir'), 705, 330, 50, 50)
    return nav
  }

  it('reads colours the way getComputedStyle writes them', async () => {
    const { colorOf } = await import('./vertical-bar.js')
    expect(colorOf('rgb(255, 0, 51)')).toEqual([1, 0, 0.2, 1])
    expect(colorOf('rgba(0, 0, 0, 0.5)')).toEqual([0, 0, 0, 0.5])
    expect(colorOf('rgb(0 128 255 / 0.25)')).toEqual([0, 128 / 255, 1, 0.25])
    expect(colorOf('#ff0000')).toEqual([1, 0, 0, 1])
    expect(colorOf('color-mix(in srgb, red 50%, blue)')).toBeNull()
    expect(colorOf('')).toBeNull()
  })

  it('dims under a sheet in the system’s column, and steps aside where a sheet runs under it', async () => {
    const { glassState } = await import('./vertical-bar.js')
    expect(glassState(false)).toBe('active')
    expect(glassState(true)).toBe('hidden')
    root().dataset.vbar = 'right'
    expect(glassState(true)).toBe('dimmed')
  })

  it('is drawn from the page’s own buttons: each tab, which is picked, the dot, Start and its state', async () => {
    const { tabGlassLayout } = await import('./vertical-bar.js')
    const layout = tabGlassLayout(rail({ dot: true, rec: true }))
    expect(layout).toMatchObject({ state: 'active', x: 700, y: 0, width: 60, height: 400, tint: [163 / 255, 230 / 255, 53 / 255, 1] })
    expect(layout.tabs.map(t => [t.id, t.selected, t.dot])).toEqual([
      ['tab-home', false, true], ['tab-plan', true, false], ['tab-stats', false, false], ['tab-library', false, false],
    ])
    expect(layout.tabs[0]).toMatchObject({ label: 'home', a11y: 'home, Connection problem', x: 704, y: 120, width: 52, height: 44 })
    expect(layout.start).toMatchObject({ x: 705, y: 330, width: 50, height: 50, recording: true, label: 'Resume' })
    expect(layout.onTint).toEqual([0, 0, 0, 1])
  })

  it('is not drawn at the bottom, under a sheet that covers it, or when Start sits on the tabs', async () => {
    const { tabGlassLayout } = await import('./vertical-bar.js')
    const nav = rail()
    expect(tabGlassLayout(nav, { blocked: true })).toEqual({})
    box(nav.querySelector('.cir'), 705, 150, 50, 50)
    expect(tabGlassLayout(nav)).toEqual({})
    nav.style.flexDirection = 'row'
    expect(tabGlassLayout(nav)).toEqual({})
  })

  it('forwards the native presses to the page and updates in place when a sheet opens', async () => {
    const calls = []
    const events = {}
    vi.doMock('@capacitor/core', () => ({
      registerPlugin: () => new Proxy({}, {
        get: (_, prop) => {
          if (prop === 'then') return undefined
          if (prop === 'addListener') return async (event, fn) => { events[event] = fn; return { remove: async () => {} } }
          if (prop === 'setTabGlass') return async opts => { calls.push(opts); return { visible: !!opts.tabs } }
          return undefined
        },
      }),
    }))
    globalThis.requestAnimationFrame = fn => setTimeout(fn, 0)
    globalThis.cancelAnimationFrame = id => clearTimeout(id)
    const { bindTabGlass } = await import('./vertical-bar.js')
    const nav = rail()
    const clicked = []
    nav.addEventListener('click', e => clicked.push(e.target.closest('button')?.dataset.tour))
    const held = vi.fn()
    const unbind = bindTabGlass(nav, { onHold: held })
    await vi.waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0].tabs).toHaveLength(4)
    await vi.waitFor(() => expect(nav.hasAttribute('data-native-glass')).toBe(true))
    events.tabPressed({ id: 'tab-stats' })
    events.startPressed()
    events.startHeld()
    expect(clicked).toEqual(['tab-stats', 'start'])
    expect(held).toHaveBeenCalledOnce()

    root().dataset.vbar = 'right'
    unbind.update({ blocked: true })
    await vi.waitFor(() => expect(calls.at(-1).state).toBe('dimmed'))
    events.tabPressed({ id: 'tab-home' })
    expect(clicked).toEqual(['tab-stats', 'start'])
    unbind()
    expect(calls.at(-1)).toMatchObject({ state: 'hidden' })
    expect(nav.hasAttribute('data-native-glass')).toBe(false)
    vi.doUnmock('@capacitor/core')
  })
})
