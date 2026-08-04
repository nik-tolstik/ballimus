import { useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'

import type { VenueCreateDto } from '@football/api-client'
import type { NormalizedVenue } from '@/normalize'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

export type VenueFormValues = VenueCreateDto

interface BookingContactValues {
  readonly name: string
  readonly phone: string
}

interface VenueFormProps {
  readonly venue?: NormalizedVenue
  readonly onSave: (values: VenueFormValues) => Promise<void>
  readonly saving: boolean
}

const phonePattern = /^\+?[0-9][0-9\s().-]{4,48}$/u

function validUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch { return false }
}

export function VenueForm({ venue, onSave, saving }: VenueFormProps) {
  const [name, setName] = useState(venue?.name ?? '')
  const [mapUrl, setMapUrl] = useState(venue?.mapUrl ?? '')
  const [venueType, setVenueType] = useState<'outdoor' | 'indoor'>(venue?.venueType ?? 'outdoor')
  const [contacts, setContacts] = useState<BookingContactValues[]>(venue?.bookingContacts.length
    ? venue.bookingContacts.map((contact) => ({ name: contact.name ?? '', phone: contact.phone }))
    : [{ name: '', phone: '' }])
  const [websiteUrl, setWebsiteUrl] = useState(venue?.websiteUrl ?? '')
  const [error, setError] = useState('')

  const submit = () => {
    const normalizedName = name.trim()
    const normalizedMapUrl = mapUrl.trim()
    const normalizedContacts = contacts.map((contact) => ({ name: contact.name.trim(), phone: contact.phone.trim() }))
    const contactsWithPhones = normalizedContacts.filter((contact) => contact.phone !== '')
    const normalizedWebsiteUrl = websiteUrl.trim()
    if (normalizedName.length < 2) { setError('Название должно содержать хотя бы два символа.'); return }
    if (!validUrl(normalizedMapUrl)) { setError('Укажите корректную ссылку на карту.'); return }
    if (normalizedWebsiteUrl !== '' && !validUrl(normalizedWebsiteUrl)) { setError('Укажите корректный сайт.'); return }
    if (normalizedContacts.some((contact) => contact.name !== '' && contact.phone === '')) { setError('Укажите телефон для контакта с именем.'); return }
    if (contactsWithPhones.some((contact) => !phonePattern.test(contact.phone))) { setError('Проверьте номер телефона для бронирования.'); return }
    if (new Set(contactsWithPhones.map((contact) => contact.phone)).size !== contactsWithPhones.length) { setError('Номера телефонов не должны повторяться.'); return }
    setError('')
    void onSave({ name: normalizedName, mapUrl: normalizedMapUrl, venueType, bookingContacts: contactsWithPhones.map((contact) => ({ ...(contact.name === '' ? {} : { name: contact.name }), phone: contact.phone })), websiteUrl: normalizedWebsiteUrl === '' ? null : normalizedWebsiteUrl })
  }

  return <form aria-label={venue === undefined ? 'Форма создания места' : 'Форма редактирования места'} className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); submit() }}>
    <FieldGroup className="min-h-0 flex-1 gap-4 overflow-y-auto px-4 pb-5">
      <Field><FieldLabel htmlFor="venue-name">Название</FieldLabel><Input id="venue-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, BOX365 Октябрьская" required /></Field>
      <Field><FieldLabel htmlFor="venue-map-url">Ссылка на карту</FieldLabel><Input id="venue-map-url" type="url" inputMode="url" value={mapUrl} onChange={(event) => setMapUrl(event.target.value)} placeholder="https://…" required /></Field>
      <FieldSet><FieldLegend variant="label">Формат площадки</FieldLegend><RadioGroup value={venueType} onValueChange={(value) => setVenueType(value as 'outdoor' | 'indoor')} className="grid grid-cols-2 gap-2"><Field orientation="horizontal" className="rounded-lg border border-border p-3"><RadioGroupItem id="venue-form-outdoor" value="outdoor" /><FieldLabel htmlFor="venue-form-outdoor" className="font-normal">На улице</FieldLabel></Field><Field orientation="horizontal" className="rounded-lg border border-border p-3"><RadioGroupItem id="venue-form-indoor" value="indoor" /><FieldLabel htmlFor="venue-form-indoor" className="font-normal">В помещении</FieldLabel></Field></RadioGroup></FieldSet>
      <FieldGroup className="gap-2"><FieldLabel>Контакты для бронирования</FieldLabel>{contacts.map((contact, index) => <div key={index} className="grid grid-cols-[minmax(0,.8fr)_minmax(0,1fr)_2.5rem] gap-2"><Input aria-label={`Имя контакта ${index + 1}`} maxLength={100} value={contact.name} onChange={(event) => setContacts((current) => current.map((value, itemIndex) => itemIndex === index ? { ...value, name: event.target.value } : value))} placeholder="Имя" /><Input aria-label={`Телефон для бронирования ${index + 1}`} type="tel" inputMode="tel" maxLength={50} value={contact.phone} onChange={(event) => setContacts((current) => current.map((value, itemIndex) => itemIndex === index ? { ...value, phone: event.target.value } : value))} placeholder="+375 …" />{contacts.length > 1 ? <Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Удалить контакт ${index + 1}`} onClick={() => setContacts((current) => current.filter((_value, itemIndex) => itemIndex !== index))}><Trash2 /></Button> : <span />}</div>)}<Button type="button" variant="outline" disabled={contacts.length >= 5} onClick={() => setContacts((current) => [...current, { name: '', phone: '' }])}><Plus data-icon="inline-start" />Добавить контакт</Button></FieldGroup>
      <Field><FieldLabel htmlFor="venue-website">Сайт</FieldLabel><Input id="venue-website" type="url" inputMode="url" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="Необязательно" /></Field>
      <FieldError>{error}</FieldError>
    </FieldGroup>
    <div className="sheet-actions bg-muted/60 px-4 pt-3 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]"><Button type="submit" className="h-10 w-full" disabled={saving}><Save data-icon="inline-start" />{saving ? 'Сохранение…' : venue === undefined ? 'Добавить место' : 'Сохранить'}</Button></div>
  </form>
}
