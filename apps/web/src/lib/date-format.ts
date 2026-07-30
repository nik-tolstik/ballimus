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

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function addDays(value: Date, amount: number): Date {
  const result = new Date(value)
  result.setDate(result.getDate() + amount)
  return result
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`
}

export function formatMatchDate(dateValue: string, timeValue: string, now: Date = new Date()): string {
  const date = parseCalendarDate(dateValue)
  if (date === undefined) return timeValue === '' ? 'Дата уточняется' : `Дата уточняется · ${timeValue}`

  const today = startOfDay(now)
  const target = startOfDay(date)
  const differenceInDays = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  const mondayOffset = (today.getDay() + 6) % 7
  const nextMonday = addDays(today, 7 - mondayOffset)

  let dateLabel: string
  if (differenceInDays === 0) {
    dateLabel = 'Сегодня'
  } else if (differenceInDays === 1) {
    dateLabel = 'Завтра'
  } else if (target > today && target < nextMonday) {
    dateLabel = capitalize(new Intl.DateTimeFormat(RUSSIAN_LOCALE, { weekday: 'long' }).format(target))
  } else {
    dateLabel = new Intl.DateTimeFormat(RUSSIAN_LOCALE, {
      day: 'numeric',
      month: 'long',
      ...(target.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
    }).format(target)
  }

  return timeValue === '' ? dateLabel : `${dateLabel} · ${timeValue}`
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
