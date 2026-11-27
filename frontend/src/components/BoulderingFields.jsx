// The pieces a bouldering session is logged with (lib/bouldering.js): where (GymPicker), how the
// gym grades (ScalePicker), the climbs themselves (ClimbLogger: pick a grade, then Flash, Sent or
// Fell), and what they add up to (BoulderingStats, GradePyramid). The live session
// (BoulderingSession.jsx) and the after-the-fact sheet (ActivitySheet.jsx) are both built from them.
import { useMemo, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import {
  SCALES, SCALE_LABEL, DEFAULT_SCALE, MAX_GRADE_LENGTH, MAX_GYM, gradeColor, gradeRange, normalizeGrade, logClimb, undoClimb, lastClimb,
  clearGrade, sortedTallies, boulderingSummary, gymChoices, gradeChoices, gradesSeen, isRanked,
} from '../lib/bouldering.js'
import Icon from './Icon.jsx'
import { Button, Segmented } from './ui.jsx'

const RESULT = {
  flash: { icon: 'bolt', label: () => t('Flashed'), aria: g => t('Log a flash on {0}', g) },
  send: { icon: 'check', label: () => t('Sent it'), aria: g => t('Log a send on {0}', g) },
  fall: { icon: 'xmark', label: () => t('Fell'), aria: g => t('Log a fall on {0}', g) },
}

/** A grade as the app says it: a circuit colour in the profile's language, anything else as it is. */
export const gradeLabel = (scale, grade) => (gradeColor(scale, grade) ? t(grade) : grade)

function Swatch({ scale, grade }) {
  const color = gradeColor(scale, grade)
  return color ? <span className="boulder-swatch" style={{ backgroundColor: color }} aria-hidden="true" /> : null
}

function tap() {
  try { navigator.vibrate?.(8) } catch { /* no vibration here */ }
}

/** The gyms you have climbed at (then a few suggestions) as chips, and a name of your own. */
export function GymPicker({ gym, sessions, onChange }) {
  const choices = useMemo(() => gymChoices(sessions), [sessions])
  const known = choices.some(c => c.toLowerCase() === gym.toLowerCase())
  const [typing, setTyping] = useState(!!gym && !known)
  return <div className="boulder-field">
    <span className="small muted" id="boulder-gym-l">{t('Climbing gym')}</span>
    <div className="boulder-chips" role="radiogroup" aria-labelledby="boulder-gym-l">
      {choices.map(name => {
        const on = !typing && name.toLowerCase() === gym.toLowerCase()
        return <button key={name} type="button" role="radio" aria-checked={on} className={'chip nocap' + (on ? ' on' : '')}
          onClick={() => { setTyping(false); onChange(on ? '' : name) }}>{name}</button>
      })}
      <button type="button" role="radio" aria-checked={typing} className={'chip nocap ichip' + (typing ? ' on' : '')}
        onClick={() => { setTyping(true); if (known) onChange('') }}><Icon name="plus" />{t('Other gym')}</button>
    </div>
    {typing && <input className="input" value={gym} maxLength={MAX_GYM} autoFocus={!gym}
      aria-label={t('Gym name')} placeholder={t('Gym name')} onChange={e => onChange(e.target.value)} />}
  </div>
}

/** VITAL's colours (the default), V scale, Font or another gym's colours. VITAL is a name, not translated. */
export function ScalePicker({ scale, onChange }) {
  return <div className="boulder-field">
    <span className="small muted" id="boulder-scale-l">{t('Grading')}</span>
    <Segmented ariaLabelledby="boulder-scale-l" value={scale} onChange={onChange}
      options={SCALES.map(s => ({ value: s, label: s === 'vital' ? SCALE_LABEL.vital : t(SCALE_LABEL[s]) }))} />
  </div>
}

/** Sends, flashes, attempts and the hardest send, as four figures. */
export function BoulderingStats({ b }) {
  const s = boulderingSummary(b)
  const tiles = [
    [t('Sends'), fmtNum(s.sends)],
    [t('Flashes'), fmtNum(s.flashes)],
    [t('Attempts'), fmtNum(s.attempts)],
    ...(isRanked(s.scale) ? [[t('Top grade'), s.top ? gradeLabel(s.scale, s.top) : '–']] : [[t('Send rate'), s.rate == null ? '–' : `${Math.round(s.rate * 100)}%`]]),
  ]
  return <dl className="boulder-stats" aria-live="polite">
    {tiles.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
  </dl>
}

/**
 * Every grade of a session as a bar, hardest on top on a ranked scale: flashes, other sends and
 * the goes that did not go, side by side. `onClear` adds a button that takes a grade out.
 */
export function GradePyramid({ b, onClear, rows: given }) {
  const rows = given || sortedTallies(b)
  const scale = b?.scale || DEFAULT_SCALE
  if (!rows.length) return null
  const most = Math.max(...rows.map(r => r.attempts))
  return <ul className="boulder-pyramid" aria-label={t('Grades')}>
    {rows.map(r => {
      const label = gradeLabel(scale, r.grade)
      const fl = r.flashes || 0
      const line = [t('{0} of {1} sent', r.sends, r.attempts), fl ? t('{0} flashed', fl) : null].filter(Boolean).join(' · ')
      return <li key={r.grade}>
        <span className="bp-g"><Swatch scale={scale} grade={r.grade} />{label}{gradeRange(scale, r.grade) && <span className="bp-r">{gradeRange(scale, r.grade)}</span>}</span>
        <span className="bp-bar" aria-hidden="true" style={{ '--w': r.attempts / most }}>
          <i className="bp-flash" style={{ '--p': fl / r.attempts }} />
          <i className="bp-send" style={{ '--p': (r.sends - fl) / r.attempts }} />
        </span>
        <span className="bp-n">{line}</span>
        {onClear && <button type="button" className="iconbtn bp-x" aria-label={t('Remove {0}', label)} onClick={() => onClear(r.grade)}><Icon name="xmark" /></button>}
      </li>
    })}
  </ul>
}

function firstGrade(b, choices) {
  const last = lastClimb(b)
  if (last) return last.g
  const busiest = [...(b.circuits || [])].sort((x, y) => y.attempts - x.attempts)[0]
  if (busiest) return busiest.grade
  // Nothing climbed yet: a beginner's grade (VITAL's Yellow, V2, Font 5), the first colour otherwise.
  const start = { vital: 1, v: 3, font: 3 }[b.scale] ?? 0
  return choices[Math.min(choices.length - 1, start)] || ''
}

/**
 * Log climbs into `value` (a bouldering block): tap the grade, then Flash, Sent or Fell. The
 * grade stays picked, since a session is mostly the same grade or two. A live session keeps its
 * Undo in the session itself (lib/bouldering.js log); one logged after the fact keeps it here.
 */
export default function ClimbLogger({ value, onChange, sessions, now = () => Date.now() }) {
  const scale = value.scale || DEFAULT_SCALE
  const seen = useMemo(() => [...gradesSeen(sessions, scale), ...value.circuits.map(r => r.grade)], [sessions, scale, value.circuits])
  const [all, setAll] = useState(false)
  const [extra, setExtra] = useState([])
  const { grades, more } = gradeChoices(scale, [...seen, ...extra], all)
  const [grade, setGrade] = useState(() => firstGrade(value, grades))
  const [adding, setAdding] = useState(false)
  const [custom, setCustom] = useState('')
  const [bumped, setBumped] = useState(null)
  // After the fact: Undo walks back through the changes made in this sheet.
  const undo = useRef([])
  const [, redraw] = useState(0)
  const live = !!value.live
  const picked = grades.includes(grade) ? grade : grades.find(g => g.toLowerCase() === grade.toLowerCase()) || grade
  const row = value.circuits.find(r => r.grade.toLowerCase() === picked.toLowerCase())

  const log = result => {
    if (!picked) return
    const next = logClimb(value, picked, result, now())
    if (next === value) return
    if (!live) { undo.current = [...undo.current.slice(-39), { prev: value, g: picked, r: result }]; redraw(n => n + 1) }
    tap()
    setBumped({ g: picked, n: Date.now() })
    onChange(next)
  }
  const back = () => {
    if (live) { onChange(undoClimb(value)); return }
    const step = undo.current.pop()
    redraw(n => n + 1)
    if (step) onChange(step.prev)
  }
  const recent = live ? [...(value.log || [])].reverse().slice(0, 6) : [...undo.current].reverse().slice(0, 6)
  const canUndo = live ? !!lastClimb(value) : undo.current.length > 0
  const addGrade = () => {
    const g = normalizeGrade(scale, custom)
    if (!g) return
    if (!grades.some(x => x.toLowerCase() === g.toLowerCase())) setExtra(x => [...x, g])
    setGrade(g)
    setCustom('')
    setAdding(false)
  }

  return <div className="boulder-logger">
    <div className="row between boulder-grade-h">
      <span className="small muted" id="boulder-grade-l">{t('Grade')}</span>
      {more || all ? <button type="button" className="btn ghost xs" aria-expanded={all} onClick={() => setAll(v => !v)}>{all ? t('Fewer grades') : t('All grades')}</button> : null}
    </div>
    <div className="boulder-grades" role="radiogroup" aria-labelledby="boulder-grade-l">
      {grades.map(g => {
        const r = value.circuits.find(x => x.grade.toLowerCase() === g.toLowerCase())
        const on = g.toLowerCase() === picked.toLowerCase()
        const label = gradeLabel(scale, g)
        const range = gradeRange(scale, g)
        const named = range ? `${label} (${range})` : label
        return <button key={g} type="button" role="radio" aria-checked={on}
          aria-label={r ? `${named}, ${t('{0} of {1} sent', r.sends, r.attempts)}` : named}
          className={'boulder-grade' + (on ? ' on' : '') + (r ? ' has' : '')} onClick={() => { setGrade(g); tap() }}>
          <span className="bg-top"><Swatch scale={scale} grade={g} /><span className="bg-l">{label}</span></span>
          <span className="bg-n" key={bumped?.g === g ? bumped.n : 0} data-bump={bumped?.g === g || undefined}>
            {[range, r ? `${r.sends}/${r.attempts}` : null].filter(Boolean).join(' · ') || ' '}</span>
        </button>
      })}
      <button type="button" className="boulder-grade add" aria-expanded={adding} onClick={() => setAdding(v => !v)}>
        <span className="bg-top"><Icon name="plus" /></span><span className="bg-n">{t('Add a grade')}</span>
      </button>
    </div>
    {adding && <div className="boulder-custom">
      <input className="input" value={custom} maxLength={MAX_GRADE_LENGTH} autoFocus onChange={e => setCustom(e.target.value)}
        aria-label={t('Grade name')} placeholder={t('Grade name')} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addGrade() } }} />
      <Button type="button" variant="tinted" size="sm" onClick={addGrade} disabled={!custom.trim()}>{t('Add')}</Button>
    </div>}
    <div className="boulder-results" role="group" aria-label={picked ? gradeLabel(scale, picked) : t('Grade')}>
      {['flash', 'send', 'fall'].map(k => <button key={k} type="button" className={'boulder-result is-' + k} disabled={!picked}
        aria-label={RESULT[k].aria(gradeLabel(scale, picked))} onClick={() => log(k)}>
        <Icon name={RESULT[k].icon} /><span>{RESULT[k].label()}</span>
      </button>)}
    </div>
    <div className="row between boulder-recent">
      <div className="boulder-recent-list" aria-label={t('Latest climbs')}>
        {recent.length ? recent.map((e, i) => <span key={recent.length - i} className={'boulder-recent-i is-' + e.r} title={`${gradeLabel(scale, e.g)} · ${RESULT[e.r].label()}`}>
          <Swatch scale={scale} grade={e.g} />{gradeLabel(scale, e.g)}<Icon name={RESULT[e.r].icon} />
        </span>) : <span className="small muted">{row ? t('{0} of {1} sent', row.sends, row.attempts) : t('Pick a grade, then how it went.')}</span>}
      </div>
      <Button type="button" variant="plain" size="sm" icon="undo" disabled={!canUndo} onClick={back}>{t('Undo')}</Button>
    </div>
  </div>
}

/** Gym, grading, the climbs and the pyramid, for a session logged after the fact. */
export function BoulderingFields({ value, onChange, sessions, onFocus }) {
  return <div className="boulder-fields kb-lift" onFocus={onFocus}>
    <GymPicker gym={value.gym} sessions={sessions} onChange={gym => onChange({ ...value, gym })} />
    <ScalePicker scale={value.scale} onChange={scale => onChange({ ...value, scale })} />
    <ClimbLogger key={value.scale} value={value} sessions={sessions} onChange={onChange} />
    {value.circuits.length > 0 && <>
      <BoulderingStats b={value} />
      <GradePyramid b={value} onClear={g => onChange(clearGrade(value, g))} />
    </>}
  </div>
}
