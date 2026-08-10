import { useState } from 'react'
import { CalendarDays, Clock3, MapPin, Pencil, Plus, Send, Trash2 } from 'lucide-react'

import type { NormalizedMatch, NormalizedVenue } from '@/normalize'
import type { EditorValues } from './match-editor'
import type { VenueFormValues } from './venue-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { MatchEditor } from './match-editor'

interface MatchesPanelProps {
  readonly matches: readonly NormalizedMatch[]
  readonly venues: readonly NormalizedVenue[]
  readonly onCreate: (values: EditorValues) => void
  readonly onUpdate: (match: NormalizedMatch, values: EditorValues) => void
  readonly onDelete: (match: NormalizedMatch) => void
  readonly onCreateVenue: (values: VenueFormValues) => Promise<NormalizedVenue>
  readonly saving: boolean
  readonly conflict: string
  readonly onClearConflict: () => void
}

function venueTypeLabel(venue: NormalizedVenue): string {
  return venue.venueType === 'indoor' ? 'В помещении' : 'На улице'
}

function publicationLabel(match: NormalizedMatch): string {
  if (match.publicCardState === 'published') return 'Карточка опубликована'
  if (match.publicCardState === 'pending') return 'Карточка публикуется'
  if (match.publicCardState === 'deleted') return 'Карточка удалена'
  return 'Требуется проверка доставки'
}

function durationLabel(durationMinutes: number): string {
  const hours = Math.floor(durationMinutes / 60)
  const minutes = durationMinutes % 60
  if (hours === 0) return `${minutes} мин.`
  if (minutes === 0) return `${hours} ч`
  return `${hours} ч ${minutes} мин.`
}

export function MatchesPanel({ matches, venues, onCreate, onUpdate, onDelete, onCreateVenue, saving, conflict, onClearConflict }: MatchesPanelProps) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | undefined>()
  const editing = matches.find((match) => match.id === editingId)
  const openCreate = () => { setEditingId(undefined); setEditorOpen(true) }
  const openEdit = (match: NormalizedMatch) => { setEditingId(match.id); setEditorOpen(true) }

  return <section className="flex flex-col gap-5">
    <div className="flex items-end justify-between gap-4"><h1 className="text-2xl font-semibold tracking-tight">Матчи</h1><Button className="h-10 px-3" onClick={openCreate}><Plus data-icon="inline-start" />Новый матч</Button></div>
    {matches.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><CalendarDays /></EmptyMedia><EmptyTitle>Матчей пока нет</EmptyTitle></EmptyHeader><EmptyContent><Button onClick={openCreate}><Plus data-icon="inline-start" />Создать матч</Button></EmptyContent></Empty> : <div className="flex flex-col gap-2">{matches.map((match) => <Card key={match.id} size="sm"><CardHeader><div><CardTitle>{match.dateLabel}</CardTitle><CardDescription className="mt-1 flex items-center gap-1.5"><MapPin className="size-3.5" />{match.venue.name} · {venueTypeLabel(match.venue)}</CardDescription></div><CardAction><div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => openEdit(match)} aria-label={`Редактировать матч ${match.dateLabel}`}><Pencil /></Button><Button size="icon" variant="ghost" className="text-destructive" onClick={() => onDelete(match)} disabled={saving} aria-label={`Удалить матч ${match.dateLabel}`}><Trash2 /></Button></div></CardAction></CardHeader><CardContent className="flex flex-wrap items-center gap-2 pt-0"><a href={match.venue.mapUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><MapPin data-icon="inline-start" />Карта</Button></a><Badge variant={match.publicCardState === 'published' ? 'secondary' : 'outline'}><Send data-icon="inline-start" />{publicationLabel(match)}</Badge><span className="flex items-center gap-1 text-sm text-muted-foreground"><Clock3 className="size-3.5" />{durationLabel(match.durationMinutes)}</span>{match.fieldPriceByn === undefined ? <span className="text-sm text-muted-foreground">Стоимость уточняется</span> : <span className="text-sm text-muted-foreground">{match.fieldPriceByn} руб.</span>}</CardContent></Card>)}</div>}
    <Sheet open={editorOpen} onOpenChange={setEditorOpen}><SheetContent side="bottom" className="mx-auto max-h-[92svh] w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">{editing === undefined ? 'Новый матч' : 'Редактировать матч'}</SheetTitle></SheetHeader><MatchEditor key={editing?.id ?? 'new'} {...(editing === undefined ? {} : { match: editing })} venues={venues} saving={saving} conflict={conflict} onClearConflict={onClearConflict} onCreateVenue={onCreateVenue} onSave={(values) => { if (editing === undefined) onCreate(values); else onUpdate(editing, values); setEditorOpen(false) }} /></SheetContent></Sheet>
  </section>
}
