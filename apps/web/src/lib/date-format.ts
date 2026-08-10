const RUSSIAN_LOCALE = 'ru-BY'

function parseCalendarDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (match === null) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day, 12)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : undefined
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`
}

export function formatMatchDate(dateValue: string, timeValue: string): string {
  const date = parseCalendarDate(dateValue)
  if (date === undefined) return timeValue === '' ? 'Дата уточняется' : `Дата уточняется · ${timeValue}`

  const dateLabel = capitalize(new Intl.DateTimeFormat(RUSSIAN_LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date))
  return timeValue === '' ? dateLabel : `${dateLabel} · ${timeValue}`
}

export function formatMatchTimeRange(timeValue: string, durationMinutes: number): string {
  const match = /^(\d{2}):(\d{2})$/u.exec(timeValue)
  if (match === null || !Number.isSafeInteger(durationMinutes) || durationMinutes <= 0) return timeValue

  const startMinutes = Number(match[1]) * 60 + Number(match[2])
  const endMinutes = (startMinutes + durationMinutes) % (24 * 60)
  const endHours = String(Math.floor(endMinutes / 60)).padStart(2, '0')
  const endMinutesPart = String(endMinutes % 60).padStart(2, '0')
  return `${timeValue}-${endHours}:${endMinutesPart}`
}

export function formatCalendarValue(value: string): string {
  const date = parseCalendarDate(value)
  if (date === undefined) return 'Выберите дату'
  return new Intl.DateTimeFormat(RUSSIAN_LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

export function calendarDateFromValue(value: string): Date | undefined {
  return parseCalendarDate(value)
}

export function calendarValueFromDate(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, '0')
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
