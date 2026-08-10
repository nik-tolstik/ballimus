import { useState } from 'react'
import { Banknote, CalendarDays, LoaderCircle, MapPin, Plus } from 'lucide-react'

import type { NormalizedMatch, NormalizedVenue } from '@/normalize'
import type { EditorValues } from './match-editor'
import type { VenueFormValues } from './venue-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { MatchEditor } from './match-editor'

interface MatchesPanelProps {
  readonly matches: readonly NormalizedMatch[]
  readonly venues: readonly NormalizedVenue[]
  readonly onCreate: (values: EditorValues) => void
  readonly onUpdate: (match: NormalizedMatch, values: EditorValues) => void
  readonly onDelete: (match: NormalizedMatch) => Promise<boolean>
  readonly onCreateVenue: (values: VenueFormValues) => Promise<NormalizedVenue>
  readonly saving: boolean
  readonly conflict: string
  readonly onClearConflict: () => void
}

function venueTypeLabel(venue: NormalizedVenue): string {
  return venue.venueType === 'indoor' ? 'В помещении' : 'На улице'
}

function publicationLabel(match: NormalizedMatch): string {
  if (match.publicCardState === 'published') return 'Опубликована'
  if (match.publicCardState === 'pending') return 'Публикуется'
  if (match.publicCardState === 'deleted') return 'Удалена'
  if (match.publicCardState === 'failed') return 'Ошибка публикации'
  if (match.publicCardState === 'uncertain') return 'Проверяется'
  return 'Не опубликована'
}

export function MatchesPanel({ matches, venues, onCreate, onUpdate, onDelete, onCreateVenue, saving, conflict, onClearConflict }: MatchesPanelProps) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | undefined>()
  const editing = matches.find((match) => match.id === editingId)
  const openCreate = () => { setEditingId(undefined); setEditorOpen(true) }
  const openEdit = (match: NormalizedMatch) => { setEditingId(match.id); setEditorOpen(true) }

  return <section className="flex flex-col gap-5">
    <div className="flex items-end justify-between gap-4"><h1 className="text-2xl font-semibold tracking-tight">Матчи</h1><Button className="h-10 px-3" onClick={openCreate}><Plus data-icon="inline-start" />Новый матч</Button></div>
    {matches.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><CalendarDays /></EmptyMedia><EmptyTitle>Матчей пока нет</EmptyTitle></EmptyHeader><EmptyContent><Button onClick={openCreate}><Plus data-icon="inline-start" />Создать матч</Button></EmptyContent></Empty> : <div className="flex flex-col gap-2">{matches.map((match) => <Card key={match.id} size="sm" className="relative"><CardHeader><div><CardTitle>{match.dateLabel}</CardTitle><CardDescription className="mt-1"><a className="relative z-20 inline-flex items-center gap-1.5 hover:text-foreground" href={match.venue.mapUrl} target="_blank" rel="noreferrer"><MapPin className="size-3.5" />{match.venue.name} · {venueTypeLabel(match.venue)}</a></CardDescription><CardDescription className="mt-1 flex items-center gap-1.5"><Banknote className="size-3.5" />{match.fieldPriceByn === undefined ? 'Стоимость уточняется' : `${match.fieldPriceByn} руб.`}</CardDescription></div></CardHeader><CardContent className="pt-0"><Badge variant={match.publicCardState === 'published' ? 'secondary' : match.publicCardState === 'failed' ? 'destructive' : 'outline'}>{match.publicCardState === 'pending' || match.publicCardState === 'uncertain' ? <LoaderCircle role="status" aria-label="Публикация карточки" className="animate-spin" /> : null}{publicationLabel(match)}</Badge></CardContent><button type="button" className="absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`Открыть матч ${match.dateLabel}`} onClick={() => openEdit(match)} /></Card>)}</div>}
    <Sheet open={editorOpen} onOpenChange={setEditorOpen}><SheetContent side="bottom" className="mx-auto max-h-[92svh] w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">{editing === undefined ? 'Новый матч' : 'Редактировать матч'}</SheetTitle></SheetHeader><MatchEditor key={editing?.id ?? 'new'} {...(editing === undefined ? {} : { match: editing })} venues={venues} saving={saving} conflict={conflict} onClearConflict={onClearConflict} onCreateVenue={onCreateVenue} onSave={(values) => { if (editing === undefined) onCreate(values); else onUpdate(editing, values); setEditorOpen(false) }} {...(editing === undefined ? {} : { onDelete: async () => { if (await onDelete(editing)) setEditorOpen(false) } })} /></SheetContent></Sheet>
  </section>
}
