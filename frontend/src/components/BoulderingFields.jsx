import { useState } from 'react'
import { t } from '../lib/i18n.js'
import {
  CIRCUIT_COLORS, VITAL_GYMS, MAX_CIRCUITS, MAX_CIRCUIT_COUNT, MAX_GRADE_LENGTH, boulderingTotals,
} from '../lib/bouldering.js'
import { Button, Stepper } from './ui.jsx'

export default function BoulderingFields({ value, onChange, onFocus }) {
  const { gym, circuits } = value
  const [otherGym, setOtherGym] = useState(!!gym && !VITAL_GYMS.includes(gym))
  const [grade, setGrade] = useState(circuits[0]?.grade || 'Green')
  const [custom, setCustom] = useState('')
  const known = Object.keys(CIRCUIT_COLORS)
  const choices = [...new Set([...known, ...circuits.map(row => row.grade), grade])]
  const selected = circuits.find(row => row.grade === grade) || { grade, attempts: 0, sends: 0 }
  const totals = boulderingTotals(circuits)
  const atLimit = !selected.attempts && circuits.length >= MAX_CIRCUITS
  const setCount = (field, raw) => {
    if (atLimit) return
    const n = Math.min(MAX_CIRCUIT_COUNT, Math.max(0, Math.trunc(Number(raw) || 0)))
    const row = { ...selected, [field]: n }
    if (field === 'sends') row.attempts = Math.max(row.attempts, n)
    else row.sends = Math.min(row.sends, n)
    const next = circuits.filter(r => r.grade !== grade)
    if (row.attempts) next.push(row)
    onChange({ gym, circuits: next })
  }

  const selectCustomGrade = () => {
    const name = custom.trim()
    if (!name) return
    setGrade(choices.find(g => g.toLowerCase() === name.toLowerCase()) || name)
    setCustom('')
  }

  return <div className="boulder-fields kb-lift" onFocus={onFocus}>
    <label className="boulder-field">
      <span>{t('Climbing gym')}</span>
      <select className="input" value={otherGym ? 'other' : gym} onChange={e => {
        const next = e.target.value
        setOtherGym(next === 'other')
        onChange({ gym: next === 'other' ? '' : next, circuits })
      }}>
        <option value="">{t('Select a gym (optional)')}</option>
        {VITAL_GYMS.map(name => <option key={name} value={name}>{name}</option>)}
        <option value="other">{t('Other gym')}</option>
      </select>
    </label>
    {otherGym && <label className="boulder-field">
      <span>{t('Gym name')}</span>
      <input className="input" value={gym} maxLength={80} onChange={e => onChange({ gym: e.target.value, circuits })} />
    </label>}
    <fieldset>
      <legend>{t('Circuit color or grade')}</legend>
      <div className="boulder-grades">
        {choices.map(name => {
          const row = circuits.find(r => r.grade === name)
          const label = Object.hasOwn(CIRCUIT_COLORS, name) ? t(name) : name
          return <button key={name} type="button" className={'chip nocap' + (grade === name ? ' on' : '')}
            aria-pressed={grade === name} onClick={() => setGrade(name)}>
            {Object.hasOwn(CIRCUIT_COLORS, name) && <span className="boulder-swatch" style={{ backgroundColor: CIRCUIT_COLORS[name] }} aria-hidden="true" />}
            {label}{row && <span className="muted">{t('{0} of {1} sent', row.sends, row.attempts)}</span>}
          </button>
        })}
      </div>
      <div className="boulder-custom">
        <input className="input" value={custom} maxLength={MAX_GRADE_LENGTH} onChange={e => setCustom(e.target.value)}
          aria-label={t('Custom grade')} placeholder={t('Custom grade')} onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); selectCustomGrade() }
          }} />
        <Button type="button" onClick={selectCustomGrade} disabled={!custom.trim()}>{t('Use grade')}</Button>
      </div>
    </fieldset>
    <div className="boulder-counts">
      <div><span>{t('Attempts')}</span><Stepper value={selected.attempts} max={MAX_CIRCUIT_COUNT}
        decimal={false} disabled={atLimit} ariaLabel={t('Attempts')} onChange={n => setCount('attempts', n)} /></div>
      <div><span>{t('Sends')}</span><Stepper value={selected.sends} max={MAX_CIRCUIT_COUNT}
        decimal={false} disabled={atLimit} ariaLabel={t('Sends')} onChange={n => setCount('sends', n)} /></div>
    </div>
    <div className="muted small" aria-live="polite">{atLimit
      ? t('Remove a grade tally before adding another.')
      : t('Session total: {0} of {1} sent. Attempts include sends.', totals.sends, totals.attempts)}</div>
  </div>
}
