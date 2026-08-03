import { useMemo, useState } from 'react'
import { Archive, ArchiveRestore, MapPin, Pencil, Plus, Search } from 'lucide-react'

import type { NormalizedVenue } from '@/normalize'
import type { VenueFormValues } from './venue-form'
import { VenueForm } from './venue-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

interface VenuesPanelProps {
  readonly venues: readonly NormalizedVenue[]
  readonly onCreate: (values: VenueFormValues) => Promise<NormalizedVenue>
  readonly onUpdate: (venue: NormalizedVenue, values: VenueFormValues) => Promise<void>
  readonly onArchive: (venue: NormalizedVenue) => void
  readonly onRestore: (venue: NormalizedVenue) => void
  readonly saving: boolean
}

function venueTypeLabel(venue: NormalizedVenue): string {
  return venue.venueType === 'indoor' ? 'В помещении' : 'На улице'
}

export function VenuesPanel({ venues, onCreate, onUpdate, onArchive, onRestore, saving }: VenuesPanelProps) {
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | undefined>()
  const active = venues.filter((venue) => venue.archivedAt === undefined)
  const archived = venues.filter((venue) => venue.archivedAt !== undefined)
  const shown = showArchived ? archived : active
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return needle === '' ? shown : shown.filter((venue) => venue.name.toLocaleLowerCase().includes(needle))
  }, [search, shown])
  const editing = venues.find((venue) => venue.id === editingId)
  const openCreate = () => { setEditingId(undefined); setSheetOpen(true) }
  const openEdit = (venue: NormalizedVenue) => { setEditingId(venue.id); setSheetOpen(true) }

  return <section className="flex flex-col gap-5">
    <div className="flex items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">Места</h1><p className="mt-1 text-sm text-muted-foreground">Площадки для матчей и бронирования</p></div><Button className="h-10 px-3" onClick={openCreate}><Plus data-icon="inline-start" />Добавить</Button></div>
    <div className="flex gap-2"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по названию" className="pl-9" /></div><Button type="button" variant={showArchived ? 'default' : 'elevated'} className="h-10" onClick={() => { setShowArchived((value) => !value); setSearch('') }}>{showArchived ? 'Активные' : `Архив ${archived.length > 0 ? archived.length : ''}`}</Button></div>
    {filtered.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><MapPin /></EmptyMedia><EmptyTitle>{showArchived ? 'В архиве нет мест' : search === '' ? 'Мест пока нет' : 'Ничего не найдено'}</EmptyTitle></EmptyHeader><EmptyContent>{!showArchived && search === '' ? <Button onClick={openCreate}><Plus data-icon="inline-start" />Добавить место</Button> : null}</EmptyContent></Empty> : <div className="flex flex-col gap-2">{filtered.map((venue) => <Card key={venue.id} size="sm"><CardHeader><div><CardTitle>{venue.name}</CardTitle><CardDescription className="mt-1"><Badge variant="secondary">{venueTypeLabel(venue)}</Badge></CardDescription></div><CardAction><div className="flex items-center gap-1"><Button size="icon" variant="ghost" onClick={() => openEdit(venue)} aria-label={`Редактировать ${venue.name}`}><Pencil /></Button>{venue.archivedAt === undefined ? <Button size="icon" variant="ghost" className="text-muted-foreground" onClick={() => onArchive(venue)} disabled={saving} aria-label={`В архив ${venue.name}`}><Archive /></Button> : <Button size="icon" variant="ghost" className="text-muted-foreground" onClick={() => onRestore(venue)} disabled={saving} aria-label={`Восстановить ${venue.name}`}><ArchiveRestore /></Button>}</div></CardAction></CardHeader><CardContent className="flex flex-wrap gap-2 pt-0"><a href={venue.mapUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><MapPin data-icon="inline-start" />Карта</Button></a></CardContent></Card>)}</div>}
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}><SheetContent side="bottom" className="mx-auto max-h-[92svh] w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">{editing === undefined ? 'Новое место' : 'Редактировать место'}</SheetTitle><SheetDescription>{editing === undefined ? 'Добавьте площадку для быстрого выбора в матче.' : 'Изменения появятся во всех связанных матчах.'}</SheetDescription></SheetHeader><VenueForm key={editing?.id ?? 'new'} {...(editing === undefined ? {} : { venue: editing })} saving={saving} onSave={async (values) => { if (editing === undefined) await onCreate(values); else await onUpdate(editing, values); setSheetOpen(false) }} /></SheetContent></Sheet>
  </section>
}
