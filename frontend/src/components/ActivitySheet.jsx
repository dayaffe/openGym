import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum, todayISO, uid } from '../lib/format.js'
import { NOTE_MAX } from '../lib/history.js'
import { tappable, useSheetKeyboard } from '../lib/use-sheet-keyboard.js'
import { SPORTS, SPORT_LABEL, SPORT_ICON, SPORT_PRESETS, ACTIVITY_MIN_MAX, activitiesOf, withActivity, activityName } from '../lib/activities.js'
import { boulderingTotals } from '../lib/bouldering.js'
import BoulderingFields from './BoulderingFields.jsx'
import { boulderingSessionSheet } from './BoulderingSession.jsx'
import DateField from './DateField.jsx'
import Icon from './Icon.jsx'
import { Button, Stepper } from './ui.jsx'

// Activities (lib/activities.js): a run, a ride, a padel match. Most arrive by themselves from
// Apple Health or Health Connect, or from an import; this sheet logs one by hand (web, no watch)
// and opens an existing one to fix or remove. Opened from History and a day in the calendar.

const SOURCE_LINE = {
  hc: 'From Health Connect',
  ah: 'From Apple Health',
  import: 'From an import',
  or: 'From openRunning',
}

// Distances in the profile's unit: km, or miles next to lb.
const MI = 1.609344
export const distText = (S, km) => (S?.unit === 'lb' ? t('{0} mi', fmtNum(Math.round(km / MI * 10) / 10)) : t('{0} km', fmtNum(Math.round(km * 10) / 10)))

function ActivityLog({ id = null, day = null, bouldering = false, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const had = id ? activitiesOf(S).find(a => a.id === id) : null
  const [sport, setSport] = useState(had?.sport || (bouldering ? 'climb' : 'run'))
  const [climb, setClimb] = useState(() => had?.bouldering || {
    gym: bouldering ? activitiesOf(S).find(a => a.bouldering?.gym)?.bouldering.gym || '' : '',
    circuits: [],
  })
  const [logCircuits, setLogCircuits] = useState(!!had?.bouldering || bouldering)
  const [min, setMin] = useState(had?.min || SPORT_PRESETS[1])
  const [d, setD] = useState(had?.d || day || todayISO())
  const [note, setNote] = useState(had?.note || '')
  const noteRef = useRef(null)
  const onNoteFocus = useSheetKeyboard(noteRef, true, { reveal: logCircuits })
  const save = () => {
    if (!(min >= 1) || !d || d > todayISO()) return
    update(s => {
      s.activities = withActivity(s.activities, id || 'm' + uid(), {
        ...had, d, sport, min, note, src: had?.src || 'manual',
        bouldering: sport === 'climb' && logCircuits ? climb : null,
      })
    })
    close()
    toast(had ? t('Saved') : sport === 'climb' && logCircuits
      ? t('Bouldering session saved')
      : t('{0} logged. Your legs have opinions.', t(SPORT_LABEL[sport])))
  }
  const remove = () => {
    update(s => { s.activities = withActivity(s.activities, id, null) })
    close()
    toast(t('Activity removed'))
  }
  return <>
    <h3>{bouldering || had?.bouldering ? t('Bouldering') : had ? t('Edit activity') : t('Log an activity')}</h3>
    {!bouldering && !had?.bouldering && <>
      <div className="muted small" style={{ marginBottom: 12 }}>
        {had && SOURCE_LINE[had.src] ? t(SOURCE_LINE[had.src]) + '. ' : ''}
        {t('Sport outside the gym. It shows in your history and calendar and tires the muscles it used, but adds no sets.')}
      </div>
      <div className="chips rec-kinds" role="radiogroup" aria-label={t('Sport')} style={{ margin: '0 0 12px', flexWrap: 'wrap' }}>
        {SPORTS.map(k => <button key={k} type="button" role="radio" aria-checked={sport === k}
          className={'chip nocap ichip' + (sport === k ? ' on' : '')} onClick={() => setSport(k)}>
          <Icon name={SPORT_ICON[k]} />{t(SPORT_LABEL[k])}</button>)}
      </div>
    </>}
    <div className="small muted" style={{ marginBottom: 6 }}>{t('How long')}</div>
    <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
      {SPORT_PRESETS.map(m => <button key={m} type="button" className={'chip nocap' + (min === m ? ' on' : '')}
        aria-pressed={min === m} onClick={() => setMin(m)}>{t('{0} min', m)}</button>)}
      <Stepper value={min} min={1} max={ACTIVITY_MIN_MAX} step={5} decimal={false} onChange={setMin} unit={t('min')} ariaLabel={t('Minutes')} />
    </div>
    <label className="measure-date">
      <span>{t('Date')}</span>
      <DateField value={d} max={todayISO()} onChange={setD} label={t('Date')} />
    </label>
    {sport === 'climb' && <>
      {!bouldering && !had?.bouldering && <Button aria-pressed={logCircuits} onClick={() => setLogCircuits(v => !v)}>
        {logCircuits ? t('Hide bouldering details') : t('Add bouldering details')}
      </Button>}
      {logCircuits && <BoulderingFields value={climb} onChange={setClimb} onFocus={onNoteFocus} />}
    </>}
    <textarea ref={noteRef} className="input" rows={2} maxLength={NOTE_MAX} value={note}
      placeholder={t('How was it? (optional)')} onFocus={onNoteFocus} onChange={e => setNote(e.target.value)} />
    <div style={{ height: 16 }} />
    <Button variant="primary" icon="check" onClick={save} disabled={!(min >= 1) || !d || d > todayISO()}>{t('Save')}</Button>
    {had && <><div style={{ height: 8 }} /><Button variant="ghost" icon="trash" onClick={remove}>{t('Remove')}</Button></>}
  </>
}

/** Log a new activity (on `day`, else today), or open the one with `id`. */
export const activitySheet = ({ id = null, day = null, bouldering = false } = {}) =>
  useUI.getState().openSheet(close => <ActivityLog id={id} day={day} bouldering={bouldering} close={close} />)

/** One activity as a list row, the way History lists a workout. */
export function ActivityRow({ a, showDate = true }) {
  const S = useStore(s => s.S)
  const tally = a.bouldering && boulderingTotals(a.bouldering.circuits)
  const result = tally?.attempts ? t('{0} of {1} sent', tally.sends, tally.attempts) : null
  const duration = a.bouldering?.live ? t('Session in progress') : t('{0} min', a.min)
  const open = () => a.bouldering?.live ? boulderingSessionSheet(a.id) : activitySheet({ id: a.id })
  return <div className="item act-row" data-activity={a.id} {...tappable(open)}>
    <span className="lrow-i act-i" aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 19 }}><Icon name={SPORT_ICON[a.sport] || 'flag'} /></span>
    <div className="grow"><div className="tt">{activityName(a, t)}</div>
      <div className="ss">{[showDate ? fmtDate(a.d, true) : null, duration, a.bouldering?.gym, result, a.km ? distText(S, a.km) : null, a.note].filter(Boolean).join(' · ')}</div></div>
    <Icon name="chevronRight" className="chev" />
  </div>
}
