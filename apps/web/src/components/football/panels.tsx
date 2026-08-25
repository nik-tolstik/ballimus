import { useState } from 'react'
import { Archive, Banknote, CalendarDays, LoaderCircle, MapPin, Plus, Repeat2, Trash2 } from 'lucide-react'

import type { NormalizedMatch, NormalizedVenue } from '@/normalize'
import type { EditorValues } from './match-editor'
import type { VenueFormValues } from './venue-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ConfirmationSheet } from './confirmation-sheet'
import { MatchEditor } from './match-editor'

interface MatchesPanelProps {
  readonly matches: readonly NormalizedMatch[]
  readonly archivedMatches: readonly NormalizedMatch[]
  readonly venues: readonly NormalizedVenue[]
  readonly onCreate: (values: EditorValues) => void
  readonly onUpdate: (match: NormalizedMatch, values: EditorValues) => void
  readonly onArchive: (match: NormalizedMatch) => Promise<boolean>
  readonly onDeleteArchived: (match: NormalizedMatch) => Promise<boolean>
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

function publicationVariant(match: NormalizedMatch) {
  if (match.publicCardState === 'published') return 'success'
  if (match.publicCardState === 'pending' || match.publicCardState === 'uncertain') return 'info'
  if (match.publicCardState === 'failed') return 'destructive'
  return 'secondary'
}

function repeatValues(match: NormalizedMatch): EditorValues {
  return {
    date: match.date,
    time: match.time,
    durationMinutes: String(match.durationMinutes),
    venueId: match.venue.id,
    fieldPriceByn: match.fieldPriceByn === undefined ? '' : String(match.fieldPriceByn),
  }
}

function MatchSummary({ match, archived = false }: { readonly match: NormalizedMatch; readonly archived?: boolean }) {
  return <Card size="sm" className="relative">
    <CardHeader>
      <div>
        <CardTitle>{match.dateLabel}</CardTitle>
        <CardDescription className="mt-1"><a className="relative z-20 inline-flex items-center gap-1.5 hover:text-foreground" href={match.venue.mapUrl} target="_blank" rel="noreferrer"><MapPin className="size-3.5" />{match.venue.name} · {venueTypeLabel(match.venue)}</a></CardDescription>
        <CardDescription className="mt-1 flex items-center gap-1.5"><Banknote className="size-3.5" />{match.fieldPriceByn === undefined ? 'Стоимость уточняется' : `${match.fieldPriceByn} руб.`}</CardDescription>
      </div>
    </CardHeader>
    {!archived ? <CardContent className="pt-0"><Badge variant={publicationVariant(match)}>{match.publicCardState === 'pending' || match.publicCardState === 'uncertain' ? <LoaderCircle role="status" aria-label="Публикация карточки" className="animate-spin" /> : null}{publicationLabel(match)}</Badge></CardContent> : null}
  </Card>
}

export function MatchesPanel({ matches, archivedMatches, venues, onCreate, onUpdate, onArchive, onDeleteArchived, onCreateVenue, saving, conflict, onClearConflict }: MatchesPanelProps) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archivedActionsOpen, setArchivedActionsOpen] = useState(false)
  const [confirmation, setConfirmation] = useState<'delete-archived'>()
  const [editingId, setEditingId] = useState<string | undefined>()
  const [repeatSource, setRepeatSource] = useState<NormalizedMatch | undefined>()
  const [archivedId, setArchivedId] = useState<string | undefined>()
  const editing = matches.find((match) => match.id === editingId)
  const archivedEditing = archivedMatches.find((match) => match.id === archivedId)

  const openCreate = () => {
    setEditingId(undefined)
    setRepeatSource(undefined)
    setActionsOpen(false)
    setEditorOpen(true)
  }
  const openEdit = (match: NormalizedMatch) => {
    setEditingId(match.id)
    setRepeatSource(undefined)
    setActionsOpen(false)
    setEditorOpen(true)
  }
  const openRepeat = (match: NormalizedMatch) => {
    setEditingId(undefined)
    setRepeatSource(match)
    setArchivedActionsOpen(false)
    setArchiveOpen(false)
    setEditorOpen(true)
  }
  const closeEditor = (open: boolean) => {
    setEditorOpen(open)
    if (!open) {
      setActionsOpen(false)
      setRepeatSource(undefined)
    }
  }
  const closeConfirmation = (open: boolean) => {
    if (open) return
    const currentConfirmation = confirmation
    setConfirmation(undefined)
    if (currentConfirmation === 'delete-archived') setArchivedActionsOpen(true)
  }
  const confirmDeletion = async () => {
    if (confirmation === 'delete-archived' && archivedEditing !== undefined && await onDeleteArchived(archivedEditing)) {
      setConfirmation(undefined)
      setArchiveOpen(false)
    }
  }

  return <section className="flex flex-col gap-5">
    <div className="flex items-end justify-between gap-4"><h1 className="text-2xl font-semibold tracking-tight">Матчи</h1><div className="flex items-center gap-1"><Button variant="ghost" size="icon-lg" aria-label="Архив матчей" onClick={() => setArchiveOpen(true)}><Archive /></Button><Button className="h-10 px-3" onClick={openCreate}><Plus data-icon="inline-start" />Новый матч</Button></div></div>
    {matches.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><CalendarDays /></EmptyMedia><EmptyTitle>Матчей пока нет</EmptyTitle></EmptyHeader><EmptyContent><Button onClick={openCreate}><Plus data-icon="inline-start" />Создать матч</Button></EmptyContent></Empty> : <div className="flex flex-col gap-2">{matches.map((match) => <div key={match.id} className="relative"><MatchSummary match={match} /><button type="button" className="absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`Открыть матч ${match.dateLabel}`} onClick={() => openEdit(match)} /></div>)}</div>}
    <Sheet open={editorOpen} onOpenChange={closeEditor}><SheetContent side="bottom" className="mx-auto max-h-[92svh] w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">{editing === undefined ? 'Новый матч' : 'Редактировать матч'}</SheetTitle></SheetHeader><MatchEditor key={editing?.id ?? repeatSource?.id ?? 'new'} {...(editing === undefined ? {} : { match: editing })} {...(repeatSource === undefined ? {} : { initialValues: repeatValues(repeatSource) })} venues={venues} saving={saving} conflict={conflict} onClearConflict={onClearConflict} onCreateVenue={onCreateVenue} onSave={(values) => { if (editing === undefined) onCreate(values); else onUpdate(editing, values); setEditorOpen(false); setRepeatSource(undefined) }} {...(editing === undefined ? {} : { onOpenActions: () => setActionsOpen(true) })} /></SheetContent></Sheet>
    <Sheet open={actionsOpen} onOpenChange={setActionsOpen}><SheetContent side="bottom" className="mx-auto w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">Действия с матчем</SheetTitle></SheetHeader><div className="flex flex-col gap-1 px-2 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]">{editing === undefined ? null : <Button type="button" variant="ghost" className="h-11 justify-start" disabled={saving} onClick={() => { void onArchive(editing).then((archived) => { if (archived) { setActionsOpen(false); setEditorOpen(false) } }) }}><Archive data-icon="inline-start" />В архив</Button>}</div></SheetContent></Sheet>
    <Sheet open={archiveOpen} onOpenChange={setArchiveOpen}><SheetContent side="bottom" className="mx-auto max-h-[92svh] w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">Архив матчей</SheetTitle></SheetHeader><div className="min-h-0 overflow-y-auto px-4 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]">{archivedMatches.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><Archive /></EmptyMedia><EmptyTitle>Архив пуст</EmptyTitle></EmptyHeader></Empty> : <div className="flex flex-col gap-2">{archivedMatches.map((match) => <div key={match.id} className="relative"><MatchSummary match={match} archived /><button type="button" className="absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`Открыть архивный матч ${match.dateLabel}`} onClick={() => { setArchivedId(match.id); setArchivedActionsOpen(true) }} /></div>)}</div>}</div></SheetContent></Sheet>
    <Sheet open={archivedActionsOpen} onOpenChange={setArchivedActionsOpen}><SheetContent side="bottom" className="mx-auto w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">Архивный матч</SheetTitle></SheetHeader><div className="flex flex-col gap-1 px-2 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]">{archivedEditing === undefined ? null : <><Button type="button" variant="ghost" className="h-11 justify-start" disabled={saving} onClick={() => openRepeat(archivedEditing)}><Repeat2 data-icon="inline-start" />Повторить</Button><Button type="button" variant="ghost" className="h-11 justify-start text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={saving} onClick={() => { setArchivedActionsOpen(false); setConfirmation('delete-archived') }}><Trash2 data-icon="inline-start" />Удалить</Button></>}</div></SheetContent></Sheet>
    <ConfirmationSheet open={confirmation !== undefined} title="Удалить матч навсегда?" description={`${archivedEditing?.dateLabel ?? 'Архивный матч'}. Действие нельзя отменить.`} confirmLabel="Удалить" destructive pending={saving} onOpenChange={closeConfirmation} onConfirm={() => { void confirmDeletion() }} />
  </section>
}
