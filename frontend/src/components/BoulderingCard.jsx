// Stats: the bouldering of the last 30 days (lib/bouldering.js climbingStats): sessions, sends
// and flashes, the hardest send, each session's top grade as a small trend, and the grade
// pyramid. Only once a session is saved; all time when the last 30 days had none.
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum, isoOf, todayISO } from '../lib/format.js'
import { activitiesOf } from '../lib/activities.js'
import { climbingStats, gradeColor, isRanked } from '../lib/bouldering.js'
import { boulderingSessionSheet } from './BoulderingSession.jsx'
import { GradePyramid, gradeLabel } from './BoulderingFields.jsx'
import { Button } from './ui.jsx'

const TREND = 12

export default function BoulderingCard({ S }) {
  const nav = useNavigate()
  const sessions = activitiesOf(S).filter(a => a.bouldering)
  if (!sessions.some(a => !a.bouldering.live)) return null
  const live = sessions.find(a => a.bouldering.live)
  const from = isoOf(new Date(Date.now() - 29 * 86400e3))
  const month = climbingStats(sessions, { from, to: todayISO() })
  const ever = climbingStats(sessions)
  const st = month.sessions ? month : ever
  const ranked = isRanked(st.scale)
  const tops = st.tops.slice(-TREND)
  const lo = Math.min(...tops.map(x => x.rank)), hi = Math.max(...tops.map(x => x.rank))
  const tiles = [
    [t('Sessions'), fmtNum(st.sessions)],
    [t('Sends'), fmtNum(st.sends)],
    [t('Flashes'), fmtNum(st.flashes)],
    ...(ranked ? [[t('Top grade'), st.best ? gradeLabel(st.scale, st.best) : '–']] : [[t('Hours'), fmtNum(Math.round(st.minutes / 6) / 10)]]),
  ]
  return <div className="card boulder-card" data-bouldering-card>
    <div className="row between" style={{ alignItems: 'flex-start', gap: 12 }}>
      <div>
        <h2 style={{ margin: 0 }}>{t('Bouldering')}</h2>
        <div className="small muted">{month.sessions ? t('Last 30 days') : t('All time')}</div>
      </div>
      <Button size="sm" icon="pullup" onClick={() => boulderingSessionSheet(live?.id)}>{live ? t('Resume') : t('Start')}</Button>
    </div>
    <dl className="boulder-stats">{tiles.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    {ranked && tops.length > 1 && <div className="boulder-trend" role="img"
      aria-label={t('Top grade per session') + ': ' + tops.map(x => `${fmtDate(x.d, true)} ${gradeLabel(st.scale, x.top)}`).join(', ')}>
      {tops.map((x, i) => <span key={x.d + i} className="boulder-trend-bar" title={`${fmtDate(x.d, true)} · ${gradeLabel(st.scale, x.top)}`}
        style={{ '--h': hi > lo ? 0.25 + 0.75 * (x.rank - lo) / (hi - lo) : 1, ...(gradeColor(st.scale, x.top) ? { '--c': gradeColor(st.scale, x.top) } : {}) }}>
        <b>{gradeColor(st.scale, x.top) ? '' : x.top}</b>
      </span>)}
    </div>}
    <GradePyramid b={{ scale: st.scale }} rows={st.pyramid} />
    {ranked && ever.best && ever.best !== st.best && <div className="small muted">{t('Hardest send so far: {0}', gradeLabel(ever.scale, ever.best))}</div>}
    <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/history')}>{t('History')}</Button>
  </div>
}
