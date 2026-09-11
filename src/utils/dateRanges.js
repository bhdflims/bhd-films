export function getRange(preset, customFrom, customTo) {
  const now = new Date()
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)

  if (preset === 'today') {
    return { from: startOfDay(now).toISOString(), to: new Date().toISOString() }
  }
  if (preset === 'week') {
    const start = new Date(now)
    start.setDate(start.getDate() - start.getDay())
    return { from: startOfDay(start).toISOString(), to: new Date().toISOString() }
  }
  if (preset === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: start.toISOString(), to: new Date().toISOString() }
  }
  if (preset === 'custom' && customFrom && customTo) {
    // customFrom/customTo come from <input type="date"> as plain
    // "YYYY-MM-DD" strings. Parsing those directly with `new Date(...)`
    // treats them as UTC midnight, not local midnight - in India (+5:30)
    // that silently shifts the whole range by 5.5 hours, so "just today"
    // could quietly include part of yesterday evening. Splitting out the
    // year/month/day and building the Date the same way startOfDay() and
    // endOfDay() already do for the presets above keeps a custom range
    // lined up with the admin's own calendar day.
    const [fy, fm, fd] = customFrom.split('-').map(Number)
    const [ty, tm, td] = customTo.split('-').map(Number)
    return {
      from: new Date(fy, fm - 1, fd).toISOString(),
      to: endOfDay(new Date(ty, tm - 1, td)).toISOString()
    }
  }
  return { from: null, to: null }
}
