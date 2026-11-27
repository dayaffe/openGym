// @vitest-environment happy-dom
// A live bouldering session (BoulderingSession.jsx): start at a gym, one tap per climb, Undo that
// survives closing the sheet, Finish with a note, Discard. The rules are lib/bouldering.test.js.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { bindUI } from './ui.jsx'
import { activitiesOf, withActivity } from '../lib/activities.js'

const confirms = vi.hoisted(() => [])
vi.mock('../sheets.jsx', () => ({ confirmSheet: o => confirms.push(o) }))
import { boulderingSessionSheet } from './BoulderingSession.jsx'

bindUI(useUI)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
beforeEach(() => {
  confirms.length = 0
  const S = structuredClone(DEF)
  S.activities = withActivity({}, 'old', { d: '2026-11-01', sport: 'climb', min: 80, src: 'manual',
    bouldering: { gym: 'Crag Hall', scale: 'v', circuits: [{ grade: 'V3', attempts: 2, sends: 1 }] } }, 1)
  useStore.setState({ S, user: { id: 1, name: 'x' } })
  useUI.setState({ sheets: [], toastMsg: '' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const renderTop = () => {
  const sh = useUI.getState().sheets.at(-1)
  act(() => root.render(sh ? sh.render(() => useUI.getState().closeSheet(sh.id)) : null))
}
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
const click = label => { const b = button(label); if (!b) throw new Error('no button ' + label); act(() => b.click()); renderTop() }
const live = () => activitiesOf(useStore.getState().S).find(a => a.bouldering?.live)

describe('a live bouldering session', () => {
  it('starts at the last gym on the scale it grades, and logs one tap per climb', () => {
    boulderingSessionSheet(); renderTop()
    expect(button('Crag Hall').getAttribute('aria-checked')).toBe('true')
    expect(button('V scale').getAttribute('aria-pressed')).toBe('true')
    click('Start session')
    expect(live().bouldering).toMatchObject({ gym: 'Crag Hall', scale: 'v', circuits: [] })

    click('V4')
    click('Log a flash on V4')
    click('Log a fall on V4')
    click('Log a send on V4')
    expect(live().bouldering.circuits).toEqual([{ grade: 'V4', attempts: 3, sends: 2, flashes: 1 }])
    expect(host.querySelector('.boulder-stats').textContent).toContain('V4')
  })

  it('undoes the last climb after the sheet was closed and opened again', () => {
    boulderingSessionSheet(); renderTop()
    click('Start session')
    click('V5')
    click('Log a fall on V5')
    click('Log a send on V5')
    act(() => useUI.getState().closeAll()); renderTop()
    boulderingSessionSheet(); renderTop()
    click('Undo')
    expect(live().bouldering.circuits).toEqual([{ grade: 'V5', attempts: 1, sends: 0 }])
  })

  it('finishes with a note, and is a finished session in the history after', () => {
    boulderingSessionSheet(); renderTop()
    click('Start session')
    click('V2')
    click('Log a send on V2')
    click('Finish bouldering')
    const note = host.querySelector('textarea')
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(note, 'Felt light'); note.dispatchEvent(new Event('input', { bubbles: true })) })
    click('Save session')
    expect(live()).toBeUndefined()
    const done = activitiesOf(useStore.getState().S).find(a => a.d !== '2026-11-01')
    expect(done).toMatchObject({ sport: 'climb', note: 'Felt light', bouldering: { scale: 'v', circuits: [{ grade: 'V2', attempts: 1, sends: 1 }] } })
    expect(done.bouldering.live).toBeUndefined()
    expect(done.bouldering.log).toBeUndefined()
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useUI.getState().toastMsg).toBe('Bouldering session saved. 1 send.')
  })

  it('discards the session after asking', () => {
    boulderingSessionSheet(); renderTop()
    click('Start session')
    click('Discard session')
    expect(confirms).toHaveLength(1)
    act(() => confirms[0].onConfirm())
    expect(live()).toBeUndefined()
    expect(activitiesOf(useStore.getState().S)).toHaveLength(1)
  })
})
