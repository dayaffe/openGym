import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { activeBouldering, activitiesOf, ACTIVITY_MIN_MAX, readActivity, withActivity } from '../lib/activities.js'
import { boulderingTotals, CIRCUIT_COLORS, logBoulder, MAX_GRADE_LENGTH } from '../lib/bouldering.js'
import { todayISO, uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { useSheetKeyboard } from '../lib/use-sheet-keyboard.js'
import { BoulderingGymField } from './BoulderingFields.jsx'
import Elapsed from './Elapsed.jsx'
import { Button } from './ui.jsx'

const update = fn => useStore.getState().update(fn)
const minutesSince = (start, now) => Math.min(ACTIVITY_MIN_MAX, Math.max(1, Math.round((now - start) / 60000)))

function SetUpBouldering({ lastGym }) {
  const [gym, setGym] = useState(lastGym)
  const fieldRef = useRef(null)
  const onFocus = useSheetKeyboard(fieldRef, true, { reveal: true })
  const start = () => update(s => {
    if (activeBouldering(s)) return
    const now = Date.now()
    s.activities = withActivity(s.activities, 'm' + uid(), {
      sport: 'climb', d: todayISO(), min: 1, at: now, src: 'manual',
      bouldering: { gym, circuits: [], live: true },
    }, now)
  })
  return <>
    <h3>{t('Start bouldering')}</h3>
    <div className="boulder-fields kb-lift" ref={fieldRef} onFocus={onFocus}>
      <BoulderingGymField gym={gym} onChange={setGym} />
    </div>
    <Button variant="primary" icon="play" onClick={start}>{t('Start session')}</Button>
  </>
}

function LiveBouldering({ activity, close }) {
  const { gym, circuits } = activity.bouldering
  const [send, setSend] = useState(true)
  const [custom, setCustom] = useState('')
  const [last, setLast] = useState(null)
  const fieldRef = useRef(null)
  const onFocus = useSheetKeyboard(fieldRef, true, { reveal: true })
  const totals = boulderingTotals(circuits)
  const grades = [...new Set([...Object.keys(CIRCUIT_COLORS), ...circuits.map(row => row.grade)])]

  const save = (grade, sent, direction) => {
    let changed = false
    update(s => {
      const entry = readActivity(s.activities?.[activity.id])
      if (!entry?.bouldering?.live) return
      const next = logBoulder(entry.bouldering.circuits, grade, sent, direction)
      if (next === entry.bouldering.circuits) return
      const now = Date.now()
      s.activities = withActivity(s.activities, activity.id, {
        ...entry, min: minutesSince(entry.at, now),
        bouldering: { ...entry.bouldering, circuits: next },
      }, now)
      changed = true
    })
    if (changed) setLast(direction > 0 ? { grade, sent } : null)
    return changed
  }
  const addCustom = () => {
    if (save(custom, send, 1)) setCustom('')
  }
  const finish = () => {
    update(s => {
      const entry = readActivity(s.activities?.[activity.id])
      if (!entry?.bouldering?.live) return
      const now = Date.now()
      s.activities = withActivity(s.activities, activity.id, {
        ...entry, min: minutesSince(entry.at, now),
        bouldering: { ...entry.bouldering, live: false },
      }, now)
    })
    close()
    useUI.getState().toast(t('Bouldering session saved'))
  }

  return <>
    <h3>{t('Bouldering')}</h3>
    <div className="row between muted small">
      <span>{gym || t('Session in progress')}</span>
      <span className="boulder-elapsed"><Elapsed start={activity.at} /></span>
    </div>
    <div className="boulder-fields kb-lift" ref={fieldRef} onFocus={onFocus}>
      <div className="boulder-custom" role="group" aria-label={t('What to log')}>
        <Button variant={send ? 'tinted' : 'plain'} aria-pressed={send} onClick={() => setSend(true)}>{t('Log sends')}</Button>
        <Button variant={!send ? 'tinted' : 'plain'} aria-pressed={!send} onClick={() => setSend(false)}>{t('Log attempts')}</Button>
      </div>
      <div className="boulder-live-grades">
        {grades.map(grade => {
          const row = circuits.find(r => r.grade === grade)
          const color = Object.hasOwn(CIRCUIT_COLORS, grade) ? CIRCUIT_COLORS[grade] : null
          const label = color ? t(grade) : grade
          return <button type="button" key={grade} className="btn plain boulder-live-grade"
            aria-label={send ? t('Log {0} send', label) : t('Log {0} attempt', label)}
            onClick={() => save(grade, send, 1)}>
            {color && <span className="boulder-swatch" style={{ backgroundColor: color }} aria-hidden="true" />}
            <span>{label}</span>
            <span className="muted boulder-elapsed">{(send ? row?.sends : row?.attempts) || 0}</span>
          </button>
        })}
      </div>
      <div className="boulder-custom">
        <input className="input" value={custom} maxLength={MAX_GRADE_LENGTH} onChange={e => setCustom(e.target.value)}
          aria-label={t('Custom grade')} placeholder={t('Custom grade')} onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); addCustom() }
          }} />
        <Button type="button" disabled={!custom.trim()} onClick={addCustom}>{send ? t('Log send') : t('Log attempt')}</Button>
      </div>
      <div className="row between boulder-live-summary">
        <span aria-live="polite">{t('{0} of {1} sent', totals.sends, totals.attempts)}</span>
        <Button variant="ghost" disabled={!last} onClick={() => last && save(last.grade, last.sent, -1)}>{t('Undo last')}</Button>
      </div>
    </div>
    <Button variant="primary" icon="check" onClick={finish}>{t('Finish bouldering')}</Button>
  </>
}

function BoulderingSession({ id, close }) {
  const activities = useStore(s => s.S.activities)
  const entry = id ? readActivity(activities?.[id]) : null
  const session = id ? (entry?.bouldering?.live ? { ...entry, id } : null) : activeBouldering({ activities })
  if (session) return <LiveBouldering key={session.id} activity={session} close={close} />
  if (id) return <p>{t('This bouldering session has ended.')}</p>
  const lastGym = activitiesOf({ activities }).find(a => a.bouldering?.gym)?.bouldering.gym || ''
  return <SetUpBouldering lastGym={lastGym} />
}

export function boulderingSessionSheet(id) {
  return useUI.getState().openSheet(close => <BoulderingSession id={id} close={close} />)
}
