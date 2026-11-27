// A bouldering session as it happens (lib/bouldering.js): pick the gym, start, then one tap per
// climb (the grade, then Flash, Sent or Fell). The session is an activity marked live from the
// first tap, so it is saved and synced as it goes: the sheet can be closed between climbs, the
// phone locked, another device opened, and Undo still knows the last climb. Finish asks for a
// note and saves it; a session left running ends a few minutes after its last climb.
import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { activeBouldering, activitiesOf, readActivity, withActivity } from '../lib/activities.js'
import { boulderingSummary, finishMinutes, newBouldering, startScale } from '../lib/bouldering.js'
import { NOTE_MAX } from '../lib/history.js'
import { todayISO, uid } from '../lib/format.js'
import { t, tn } from '../lib/i18n.js'
import { useSheetKeyboard } from '../lib/use-sheet-keyboard.js'
import ClimbLogger, { BoulderingStats, GradePyramid, GymPicker, ScalePicker } from './BoulderingFields.jsx'
import Elapsed from './Elapsed.jsx'
import { confirmSheet } from '../sheets.jsx'
import { Button } from './ui.jsx'

const update = fn => useStore.getState().update(fn)
const toast = msg => useUI.getState().toast(msg)

/** The live session `id` changed by `fn(entry)`, stamped now; nothing when it is no longer live. */
function changeLive(id, fn) {
  update(s => {
    const entry = readActivity(s.activities?.[id])
    if (!entry?.bouldering?.live) return
    const now = Date.now()
    const next = fn(entry, now)
    if (next) s.activities = withActivity(s.activities, id, next, now)
  })
}

function SetUpBouldering({ sessions }) {
  const [gym, setGym] = useState(() => sessions.find(a => a.bouldering?.gym)?.bouldering.gym || '')
  const [scale, setScale] = useState(() => startScale(sessions, gym))
  const [chosen, setChosen] = useState(false)
  const pickGym = g => { setGym(g); if (!chosen) setScale(startScale(sessions, g)) }
  const start = () => update(s => {
    if (activeBouldering(s)) return
    const now = Date.now()
    s.activities = withActivity(s.activities, 'm' + uid(), {
      sport: 'climb', d: todayISO(), min: 1, at: now, src: 'manual', bouldering: newBouldering(gym, scale, true),
    }, now)
  })
  return <>
    <h3>{t('Start bouldering')}</h3>
    <div className="muted small boulder-lead">{t('One tap per climb while you are on the wall. It saves as you go, so you can lock the phone between climbs.')}</div>
    <div className="boulder-fields">
      <GymPicker gym={gym} sessions={sessions} onChange={pickGym} />
      <ScalePicker scale={scale} onChange={v => { setChosen(true); setScale(v) }} />
    </div>
    <Button variant="primary" icon="play" onClick={start}>{t('Start session')}</Button>
  </>
}

function FinishBouldering({ activity, back, close }) {
  const [note, setNote] = useState(activity.note || '')
  const noteRef = useRef(null)
  const onFocus = useSheetKeyboard(noteRef, true, { reveal: true })
  const b = activity.bouldering
  const min = finishMinutes(activity.at, b.last, Date.now())
  const s = boulderingSummary(b)
  // The sheet goes first, in the same render as the save: it never shows the start screen behind it.
  const save = () => {
    close()
    changeLive(activity.id, (entry, now) => ({
      ...entry, min: finishMinutes(entry.at, entry.bouldering.last, now), note,
      bouldering: { gym: entry.bouldering.gym, scale: entry.bouldering.scale, circuits: entry.bouldering.circuits },
    }))
    toast(s.sends ? tn('Bouldering session saved. {0} send.', 'Bouldering session saved. {0} sends.', s.sends) : t('Bouldering session saved'))
  }
  return <>
    <h3>{t('Finish bouldering')}</h3>
    <div className="muted small boulder-lead">{[b.gym, t('{0} min', min)].filter(Boolean).join(' · ')}</div>
    <BoulderingStats b={b} />
    <GradePyramid b={b} />
    <textarea ref={noteRef} className="input" rows={2} maxLength={NOTE_MAX} value={note} onFocus={onFocus}
      placeholder={t('How was it? (optional)')} onChange={e => setNote(e.target.value)} />
    <div style={{ height: 16 }} />
    <Button variant="primary" icon="check" onClick={save}>{t('Save session')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={back}>{t('Keep climbing')}</Button>
  </>
}

function LiveBouldering({ activity, sessions, close }) {
  const [finishing, setFinishing] = useState(false)
  const [editing, setEditing] = useState(false)
  const b = activity.bouldering
  if (finishing) return <FinishBouldering activity={activity} back={() => setFinishing(false)} close={close} />
  const discard = () => confirmSheet({
    title: t('Discard this session?'),
    message: t('The climbs you logged in it go with it.'),
    confirmText: t('Discard session'), danger: true,
    onConfirm: () => {
      close()
      update(s => { s.activities = withActivity(s.activities, activity.id, null) })
      toast(t('Session discarded'))
    },
  })
  return <>
    <div className="row between boulder-live-h">
      <h3>{t('Bouldering')}</h3>
      <span className="boulder-clock"><Elapsed start={activity.at} /></span>
    </div>
    <button type="button" className="boulder-where" aria-expanded={editing} onClick={() => setEditing(v => !v)}>
      <span>{b.gym || t('No gym picked')}</span><span className="muted">{t('Change')}</span>
    </button>
    {editing && <div className="boulder-fields">
      <GymPicker gym={b.gym} sessions={sessions} onChange={gym => changeLive(activity.id, e => ({ ...e, bouldering: { ...e.bouldering, gym } }))} />
      <ScalePicker scale={b.scale} onChange={scale => changeLive(activity.id, e => ({ ...e, bouldering: { ...e.bouldering, scale } }))} />
    </div>}
    <BoulderingStats b={b} />
    <ClimbLogger key={b.scale} value={b} sessions={sessions}
      onChange={next => changeLive(activity.id, (e, now) => ({ ...e, min: finishMinutes(e.at, null, now), bouldering: next }))} />
    <div style={{ height: 12 }} />
    <Button variant="primary" icon="check" onClick={() => setFinishing(true)}>{t('Finish bouldering')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" icon="trash" onClick={discard}>{t('Discard session')}</Button>
  </>
}

function BoulderingSession({ id, close }) {
  const activities = useStore(s => s.S.activities)
  const sessions = activitiesOf({ activities })
  const entry = id ? sessions.find(a => a.id === id) : null
  const session = id ? (entry?.bouldering?.live ? entry : null) : activeBouldering({ activities })
  if (session) return <LiveBouldering key={session.id} activity={session} sessions={sessions} close={close} />
  if (id) return <p>{t('This bouldering session has ended.')}</p>
  return <SetUpBouldering sessions={sessions} />
}

/** The live session (`id`, else the one running), or the start of a new one. */
export function boulderingSessionSheet(id) {
  return useUI.getState().openSheet(close => <BoulderingSession id={id} close={close} />)
}
