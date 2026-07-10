export function createId(prefix = 'mc') {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

  return `${prefix}_${id.replaceAll('-', '').slice(0, 22)}`
}

export function nowIso() {
  return new Date().toISOString()
}
