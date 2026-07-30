import { useState } from 'react'
import { Plus, Save, Send, Trash2, TriangleAlert } from 'lucide-react'

import type { NormalizedMatch, NormalizedTimeMode } from '@/normalize'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { DatePicker, TimePicker } from './date-time-picker'

export type VenueType = 'outdoor' | 'indoor'
type TimeFormat = 'exact' | 'availability'

export interface EditorValues {
  readonly date: string
  readonly time: string
  readonly timeMode: NormalizedTimeMode
  readonly timeOptions: readonly string[]
  readonly location: string
  readonly venueType: VenueType | ''
  readonly requiredPlayers: number
  readonly fieldPriceByn: string
}

interface MatchEditorProps {
  readonly match?: NormalizedMatch | undefined
  readonly onSave: (values: EditorValues) => void
  readonly conflict: string
  readonly onClearConflict: () => void
  readonly saving: boolean
}

export function validateEditorValues(values: EditorValues): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(values.date)) return 'Выберите дату матча.'
  if (values.timeMode === 'exact' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(values.time)) {
    return 'Выберите точное время матча.'
  }
  if (values.timeMode !== 'exact') {
    const uniqueOptions = new Set(values.timeOptions)
    if (values.timeOptions.length < 1 || values.timeOptions.length > 6 || uniqueOptions.size !== values.timeOptions.length || values.timeOptions.some((value) => !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value))) {
      return 'Добавьте от одного до шести разных вариантов времени.'
    }
  }
  if (values.location.trim() !== '' && values.location.trim().length < 2) {
    return 'Название места должно содержать хотя бы два символа.'
  }
  if (!Number.isSafeInteger(values.requiredPlayers) || values.requiredPlayers < 1 || values.requiredPlayers > 100) {
    return 'Количество игроков должно быть целым числом от 1 до 100.'
  }
  if (values.fieldPriceByn.trim() !== '') {
    const price = Number(values.fieldPriceByn)
    if (!Number.isSafeInteger(price) || price < 0) return 'Стоимость поля должна быть целым неотрицательным числом.'
  }
  return undefined
}

function nextAvailabilityTime(values: readonly string[]): string | undefined {
  const validValues = values.filter((value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value))
  const occupied = new Set(validValues)
  const last = [...validValues].sort().at(-1) ?? '18:00'
  const [hour = 18, minute = 0] = last.split(':').map(Number)
  for (let offset = 60; offset < 24 * 60; offset += 60) {
    const total = (hour * 60 + minute + offset) % (24 * 60)
    const candidate = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
    if (!occupied.has(candidate)) return candidate
  }
  return undefined
}

function initialMatchTimes(match: NormalizedMatch | undefined): string[] {
  if (match === undefined) return ['']
  if (match.timeMode !== 'exact' && match.timeOptions.length > 0) return [...match.timeOptions]
  return [match.time]
}

export function editorTimeConfiguration(matchTimes: readonly string[], timeFormat: TimeFormat): Pick<EditorValues, 'time' | 'timeMode' | 'timeOptions'> {
  const normalizedTimes = matchTimes.map((value) => value.trim()).sort()
  const timeMode: NormalizedTimeMode = timeFormat === 'availability'
    ? 'availability'
    : normalizedTimes.length > 1
      ? 'exact_options'
      : 'exact'
  return {
    time: timeMode === 'exact' ? normalizedTimes[0] ?? '' : '',
    timeMode,
    timeOptions: timeMode !== 'exact' ? normalizedTimes : [],
  }
}

export function MatchEditor({ match, onSave, conflict, onClearConflict, saving }: MatchEditorProps) {
  const [date, setDate] = useState(match?.date ?? '')
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(match?.timeMode === 'availability' ? 'availability' : 'exact')
  const [matchTimes, setMatchTimes] = useState<string[]>(() => initialMatchTimes(match))
  const [location, setLocation] = useState(match?.location === 'Место уточняется' ? '' : match?.location ?? '')
  const [venueType, setVenueType] = useState<VenueType | ''>(match?.venueType ?? 'outdoor')
  const [requiredPlayers, setRequiredPlayers] = useState(String(match?.requiredPlayers ?? 10))
  const [fieldPriceByn, setFieldPriceByn] = useState(match?.fieldPriceByn === undefined ? '' : String(match.fieldPriceByn))
  const [validation, setValidation] = useState('')

  const submit = () => {
    const threshold = Number(requiredPlayers)
    const timeConfiguration = editorTimeConfiguration(matchTimes, timeFormat)
    const values: EditorValues = {
      date,
      ...timeConfiguration,
      location,
      venueType: location.trim() === '' ? '' : venueType,
      requiredPlayers: threshold,
      fieldPriceByn,
    }
    const error = validateEditorValues(values)
    if (error !== undefined) { setValidation(error); return }
    setValidation('')
    onSave(values)
  }

  return (
    <form
      aria-label={match === undefined ? 'Форма создания матча' : 'Форма редактирования матча'}
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {conflict && (
          <Alert variant="destructive" className="mb-4">
            <TriangleAlert />
            <AlertTitle>Данные изменились</AlertTitle>
            <AlertDescription>{conflict}</AlertDescription>
            <AlertAction>
              <Button type="button" variant="ghost" size="xs" onClick={onClearConflict}>Закрыть</Button>
            </AlertAction>
          </Alert>
        )}

        <FieldGroup className="gap-4">
          <FieldGroup className="gap-3">
            <Field data-invalid={validation !== '' && date === ''}>
              <FieldLabel>Дата</FieldLabel>
              <DatePicker value={date} onChange={setDate} invalid={validation !== '' && date === ''} />
            </Field>
          </FieldGroup>

          <Field data-invalid={validation !== '' && matchTimes.some((value) => value === '')}>
            <FieldLabel>Время</FieldLabel>
            <RadioGroup
              value={timeFormat}
              onValueChange={(value) => {
                setTimeFormat(value as TimeFormat)
                setValidation('')
              }}
              className="grid grid-cols-2 gap-2"
              aria-label="Формат времени"
            >
              <Field orientation="horizontal" className="rounded-lg border border-border p-3">
                <RadioGroupItem id="time-mode-exact" value="exact" />
                <FieldLabel htmlFor="time-mode-exact" className="font-normal">{matchTimes[0] || 'Точное время'}</FieldLabel>
              </Field>
              <Field orientation="horizontal" className="rounded-lg border border-border p-3">
                <RadioGroupItem id="time-mode-availability" value="availability" />
                <FieldLabel htmlFor="time-mode-availability" className="font-normal">{matchTimes[0] ? `После ${matchTimes[0]}` : 'После времени'}</FieldLabel>
              </Field>
            </RadioGroup>
            <FieldDescription>{timeFormat === 'exact' ? (matchTimes.length === 1 ? 'Матч начнётся в указанное время.' : 'Игроки выберут один из точных вариантов времени.') : 'Игроки выберут самое раннее время, после которого смогут приехать.'}</FieldDescription>
            <FieldGroup className="gap-2">
              {matchTimes.map((option, index) => <Field key={index} orientation={matchTimes.length > 1 ? 'horizontal' : 'vertical'} className={matchTimes.length > 1 ? 'grid min-w-0 grid-cols-[minmax(0,1fr)_2.5rem] gap-2' : 'min-w-0'}>
                <div className="min-w-0">
                  <TimePicker ariaLabel={`Время ${index + 1}`} value={option} onChange={(value) => { setMatchTimes((current) => current.map((item, itemIndex) => itemIndex === index ? value : item)); setValidation('') }} invalid={validation !== '' && (option === '' || matchTimes.filter((item) => item === option).length > 1)} />
                </div>
                {matchTimes.length > 1 ? <Button type="button" size="icon" variant="ghost" className="size-10" onClick={() => setMatchTimes((current) => current.filter((_item, itemIndex) => itemIndex !== index))} aria-label={`Удалить время ${option || index + 1}`}><Trash2 /></Button> : null}
              </Field>)}
              <Button type="button" variant="outline" disabled={matchTimes.length >= 6} onClick={() => { const next = nextAvailabilityTime(matchTimes); if (next !== undefined) setMatchTimes((current) => [...current, next]); setValidation('') }}><Plus data-icon="inline-start" />Добавить ещё время</Button>
            </FieldGroup>
          </Field>

          <Field>
            <FieldLabel htmlFor="match-location">Место</FieldLabel>
            <Input id="match-location" aria-label="Место проведения" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Поле или спортивный зал" />
          </Field>

          {location.trim() !== '' ? <FieldSet>
            <FieldLegend variant="label">Тип площадки</FieldLegend>
            <RadioGroup
              value={venueType}
              onValueChange={(value) => setVenueType(value as VenueType)}
              className="grid grid-cols-2 gap-2"
            >
              <Field orientation="horizontal" className="rounded-lg border border-border p-3">
                <RadioGroupItem id="venue-outdoor" value="outdoor" />
                <FieldLabel htmlFor="venue-outdoor" className="font-normal">На улице</FieldLabel>
              </Field>
              <Field orientation="horizontal" className="rounded-lg border border-border p-3">
                <RadioGroupItem id="venue-indoor" value="indoor" />
                <FieldLabel htmlFor="venue-indoor" className="font-normal">В помещении</FieldLabel>
              </Field>
            </RadioGroup>
          </FieldSet> : null}

          <FieldGroup className="grid grid-cols-2 gap-3">
            <Field data-invalid={validation !== '' && Number(requiredPlayers) < 1}>
              <FieldLabel htmlFor="required-players">Нужно игроков</FieldLabel>
              <Input id="required-players" aria-label="Необходимое количество игроков" aria-invalid={validation !== '' && Number(requiredPlayers) < 1} type="number" min="1" step="1" inputMode="numeric" value={requiredPlayers} onChange={(event) => setRequiredPlayers(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="field-price">Стоимость поля · руб.</FieldLabel>
              <Input id="field-price" aria-label="Стоимость поля в белорусских рублях" type="number" min="0" step="1" inputMode="numeric" value={fieldPriceByn} onChange={(event) => setFieldPriceByn(event.target.value)} placeholder="Необязательно" />
            </Field>
          </FieldGroup>

          <FieldError>{validation}</FieldError>
        </FieldGroup>

      </div>

      <div className="sheet-actions bg-muted/60 px-4 pt-3 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]">
        <Button type="submit" className="h-10 w-full" disabled={saving}>
          {match ? <Save data-icon="inline-start" /> : <Send data-icon="inline-start" />} {saving ? (match ? 'Сохранение…' : 'Публикация…') : match ? 'Сохранить' : 'Опубликовать матч'}
        </Button>
      </div>
    </form>
  )
}
