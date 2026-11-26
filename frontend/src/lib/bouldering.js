export const CIRCUIT_COLORS = {
  Green: '#4ca66a', Yellow: '#e8ba36', Blue: '#4a91e9', Orange: '#ee8748',
  Red: '#db525b', Pink: '#e879ad', Purple: '#9a76d5', Black: '#25252b',
  White: '#f4f4f5', Gray: '#8a8b93',
}

export const VITAL_GYMS = [
  'VITAL Brooklyn', 'VITAL Lower East Side', 'VITAL Upper East Side', 'VITAL Upper West Side',
]

export const MAX_CIRCUIT_COUNT = 999
export const MAX_CIRCUITS = 24
export const MAX_GRADE_LENGTH = 32

function count(value) {
  return Number.isFinite(Number(value))
    ? Math.min(MAX_CIRCUIT_COUNT, Math.max(0, Math.trunc(Number(value))))
    : 0
}

export function readBouldering(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const gym = typeof value.gym === 'string' ? value.gym.trim().slice(0, 80) : ''
  const circuits = []
  const seen = new Set()
  if (Array.isArray(value.circuits)) {
    for (const row of value.circuits.slice(0, MAX_CIRCUITS)) {
      const grade = typeof row?.grade === 'string' ? row.grade.trim().slice(0, MAX_GRADE_LENGTH) : ''
      const key = grade.toLowerCase()
      const sends = count(row?.sends)
      const attempts = Math.max(count(row?.attempts), sends)
      if (!grade || !attempts || seen.has(key)) continue
      seen.add(key)
      circuits.push({ grade, attempts, sends })
    }
  }
  return { gym, circuits }
}

export function boulderingTotals(circuits) {
  return circuits.reduce((total, row) => ({
    attempts: total.attempts + row.attempts,
    sends: total.sends + row.sends,
  }), { attempts: 0, sends: 0 })
}
