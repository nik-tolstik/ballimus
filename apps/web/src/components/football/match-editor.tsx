import { useState } from 'react'
import { Save, Send, TriangleAlert } from 'lucide-react'

import type { NormalizedMatch, NormalizedVenue } from '@/normalize'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { DatePicker, TimePicker } from './date-time-picker'
import { VenueAutocomplete } from './venue-autocomplete'
import { VenueForm, type VenueFormValues } from './venue-form'

export interface EditorValues {
  readonly date: string
  readonly time: string
  readonly venueId: string
  readonly fieldPriceByn: string
}

interface MatchEditorProps {
  readonly match?: NormalizedMatch
  readonly onSave: (values: EditorValues) => void
  readonly conflict: string
  readonly onClearConflict: () => void
  readonly saving: boolean
  readonly venues: readonly NormalizedVenue[]
  readonly onCreateVenue: (values: VenueFormValues) => Promise<NormalizedVenue>
}

export function validateEditorValues(values: EditorValues): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(values.date)) return 'Выберите дату матча.'
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(values.time)) return 'Выберите точное время матча.'
  if (!/^[1-9]\d*$/u.test(values.venueId)) return 'Выберите площадку из каталога.'
  if (values.fieldPriceByn.trim() !== '') {
    const price = Number(values.fieldPriceByn)
    if (!Number.isSafeInteger(price) || price < 0) return 'Стоимость поля должна быть целым неотрицательным числом.'
  }
  return undefined
}

export function currentHourTime(now = new Date()): string {
  return `${String(now.getHours()).padStart(2, '0')}:00`
}

export function MatchEditor({ match, onSave, conflict, onClearConflict, saving, venues, onCreateVenue }: MatchEditorProps) {
  const [date, setDate] = useState(match?.date ?? '')
  const [time, setTime] = useState(match?.time ?? currentHourTime())
  const [venueId, setVenueId] = useState<string | null>(match?.venue.id ?? null)
  const [fieldPriceByn, setFieldPriceByn] = useState(match?.fieldPriceByn === undefined ? '' : String(match.fieldPriceByn))
  const [venueCreateOpen, setVenueCreateOpen] = useState(false)
  const [validation, setValidation] = useState('')

  const submit = () => {
    const values: EditorValues = { date, time, venueId: venueId ?? '', fieldPriceByn }
    const error = validateEditorValues(values)
    if (error !== undefined) { setValidation(error); return }
    setValidation('')
    onSave(values)
  }

  return <>
    <form aria-label={match === undefined ? 'Форма создания матча' : 'Форма редактирования матча'} className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); submit() }}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {conflict && <Alert variant="destructive" className="mb-4"><TriangleAlert /><AlertTitle>Данные изменились</AlertTitle><AlertDescription>{conflict}</AlertDescription><AlertAction><Button type="button" variant="ghost" size="xs" onClick={onClearConflict}>Закрыть</Button></AlertAction></Alert>}
        <FieldGroup className="gap-4">
          <Field data-invalid={validation !== '' && date === ''}><FieldLabel>Дата</FieldLabel><DatePicker value={date} onChange={(value) => { setDate(value); setValidation('') }} invalid={validation !== '' && date === ''} /></Field>
          <Field data-invalid={validation !== '' && time === ''}><FieldLabel>Точное время</FieldLabel><TimePicker ariaLabel="Время матча" value={time} onChange={(value) => { setTime(value); setValidation('') }} invalid={validation !== '' && time === ''} /></Field>
          <Field data-invalid={validation !== '' && venueId === null}><FieldLabel>Площадка</FieldLabel><VenueAutocomplete venues={venues} value={venueId} onValueChange={(value) => { setVenueId(value); setValidation('') }} onCreate={() => setVenueCreateOpen(true)} /></Field>
          <Field><FieldLabel htmlFor="field-price">Стоимость поля · руб.</FieldLabel><Input id="field-price" aria-label="Стоимость поля в белорусских рублях" type="number" min="0" step="1" inputMode="numeric" value={fieldPriceByn} onChange={(event) => { setFieldPriceByn(event.target.value); setValidation('') }} placeholder="Необязательно" /></Field>
          <FieldError>{validation}</FieldError>
        </FieldGroup>
      </div>
      <div className="sheet-actions bg-muted/60 px-4 pt-3 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]"><Button type="submit" className="h-10 w-full" disabled={saving}>{match ? <Save data-icon="inline-start" /> : <Send data-icon="inline-start" />}{saving ? 'Сохранение…' : match ? 'Сохранить карточку' : 'Опубликовать матч'}</Button></div>
    </form>
    <Sheet open={venueCreateOpen} onOpenChange={setVenueCreateOpen}><SheetContent side="bottom" className="mx-auto max-h-[92svh] w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">Новое место</SheetTitle></SheetHeader><VenueForm saving={saving} onSave={async (values) => { const venue = await onCreateVenue(values); setVenueId(venue.id); setVenueCreateOpen(false) }} /></SheetContent></Sheet>
  </>
}
