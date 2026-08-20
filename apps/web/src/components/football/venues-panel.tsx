import { useMemo, useState } from 'react'
import { MapPin, Plus, Search, Trash2 } from 'lucide-react'

import type { NormalizedVenue } from '@/normalize'
import type { VenueFormValues } from './venue-form'
import { VenueForm } from './venue-form'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

interface VenuesPanelProps {
  readonly venues: readonly NormalizedVenue[]
  readonly onCreate: (values: VenueFormValues) => Promise<NormalizedVenue>
  readonly onUpdate: (venue: NormalizedVenue, values: VenueFormValues) => Promise<void>
  readonly onDelete: (venue: NormalizedVenue) => Promise<boolean>
  readonly saving: boolean
}

function venueTypeLabel(venue: NormalizedVenue): string {
  return venue.venueType === 'indoor' ? 'В помещении' : 'На улице'
}

export function VenuesPanel({ venues, onCreate, onUpdate, onDelete, saving }: VenuesPanelProps) {
  const [search, setSearch] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | undefined>()
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return needle === '' ? venues : venues.filter((venue) => venue.name.toLocaleLowerCase().includes(needle))
  }, [search, venues])
  const editing = venues.find((venue) => venue.id === editingId)
  const openCreate = () => { setEditingId(undefined); setActionsOpen(false); setSheetOpen(true) }
  const openEdit = (venue: NormalizedVenue) => { setEditingId(venue.id); setActionsOpen(false); setSheetOpen(true) }
  const closeEditor = (open: boolean) => { setSheetOpen(open); if (!open) setActionsOpen(false) }
  const deleteVenue = async (venue: NormalizedVenue) => {
    if (await onDelete(venue)) { setActionsOpen(false); setSheetOpen(false) }
  }

  return <section className="flex flex-col gap-5">
    <div className="flex items-center justify-between gap-4"><h1 className="text-2xl font-semibold tracking-tight">Места</h1><Button className="h-10 px-3" onClick={openCreate}><Plus data-icon="inline-start" />Добавить</Button></div>
    <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по названию" className="pl-9" /></div>
    {filtered.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><MapPin /></EmptyMedia><EmptyTitle>{search === '' ? 'Мест пока нет' : 'Ничего не найдено'}</EmptyTitle></EmptyHeader><EmptyContent>{search === '' ? <Button onClick={openCreate}><Plus data-icon="inline-start" />Добавить</Button> : null}</EmptyContent></Empty> : <div className="flex flex-col gap-2">{filtered.map((venue) => <Card key={venue.id} size="sm" className="relative"><CardHeader><div><CardTitle>{venue.name}</CardTitle><CardDescription className="mt-1"><a className="relative z-20 inline-flex items-center gap-1.5 hover:text-foreground" href={venue.mapUrl} target="_blank" rel="noreferrer"><MapPin className="size-3.5" />{venueTypeLabel(venue)}</a></CardDescription></div></CardHeader><button type="button" className="absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => openEdit(venue)} aria-label={`Открыть место ${venue.name}`} /></Card>)}</div>}
    <Sheet open={sheetOpen} onOpenChange={closeEditor}><SheetContent side="bottom" className="mx-auto max-h-[92svh] w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">{editing === undefined ? 'Новое место' : 'Редактировать место'}</SheetTitle></SheetHeader><VenueForm key={editing?.id ?? 'new'} {...(editing === undefined ? {} : { venue: editing })} saving={saving} onSave={async (values) => { if (editing === undefined) await onCreate(values); else await onUpdate(editing, values); setSheetOpen(false) }} {...(editing === undefined ? {} : { onOpenActions: () => setActionsOpen(true) })} /></SheetContent></Sheet>
    <Sheet open={actionsOpen} onOpenChange={setActionsOpen}><SheetContent side="bottom" className="mx-auto w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">Действия с местом</SheetTitle></SheetHeader><div className="flex flex-col gap-1 px-2 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]">{editing === undefined ? null : <Button type="button" variant="ghost" className="h-11 justify-start text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={saving} onClick={() => { void deleteVenue(editing) }}><Trash2 data-icon="inline-start" />Удалить навсегда</Button>}</div></SheetContent></Sheet>
  </section>
}
