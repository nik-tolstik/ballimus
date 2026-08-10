import { useState } from 'react'
import { BarChart3, Info, LoaderCircle, Plus, UsersRound } from 'lucide-react'
import type { PollResponseDto } from '@football/api-client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { PollEditor, type PollEditorValues } from './poll-editor'

function publicationLabel(poll: PollResponseDto): string {
  if (poll.publicationState === 'published') return poll.closedAt === null ? 'Активен' : 'Завершён'
  if (poll.publicationState === 'pending') return 'Публикуется'
  if (poll.publicationState === 'uncertain') return 'Проверяется'
  return 'Ошибка публикации'
}

function publicationVariant(poll: PollResponseDto) {
  if (poll.publicationState === 'published') return poll.closedAt === null ? 'success' : 'secondary'
  if (poll.publicationState === 'pending' || poll.publicationState === 'uncertain') return 'info'
  return 'destructive'
}

export function PollsPanel({ polls, saving, onCreate }: { readonly polls: readonly PollResponseDto[]; readonly saving: boolean; readonly onCreate: (values: PollEditorValues) => void }) {
  const [editorOpen, setEditorOpen] = useState(false)
  return <section className="flex flex-col gap-5">
    <div className="flex items-end justify-between gap-4"><h1 className="text-2xl font-semibold tracking-tight">Опросы</h1><Button className="h-10 px-3" onClick={() => setEditorOpen(true)}><Plus data-icon="inline-start" />Новый опрос</Button></div>
    {polls.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><BarChart3 /></EmptyMedia><EmptyTitle>Опросов пока нет</EmptyTitle></EmptyHeader><EmptyContent><Button onClick={() => setEditorOpen(true)}><Plus data-icon="inline-start" />Создать опрос</Button></EmptyContent></Empty> : <div className="flex flex-col gap-2">{polls.map((poll) => <Card key={poll.id} size="sm"><CardHeader><CardTitle>{poll.question}</CardTitle></CardHeader><CardContent className="flex flex-col gap-3"><div className="flex flex-col gap-2">{poll.options.map((option, index) => <div key={`${poll.id}-${String(index)}`} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate">{option.text}</span><div className="flex shrink-0 items-center gap-2">{option.kind === 'informational' ? <Badge variant="secondary"><Info />Инфо</Badge> : null}<span className="font-medium tabular-nums">{option.voterCount}</span></div></div>)}</div><div className="flex flex-wrap items-center gap-2"><Badge variant={publicationVariant(poll)}>{poll.publicationState === 'pending' || poll.publicationState === 'uncertain' ? <LoaderCircle role="status" aria-label="Публикация опроса" className="animate-spin" /> : null}{publicationLabel(poll)}</Badge>{poll.notificationThreshold === null ? null : <Badge variant={poll.options.some((option) => option.kind === 'decision' && option.notificationQueuedAt !== null) ? 'success' : 'secondary'}><UsersRound />{poll.notificationThreshold}</Badge>}</div></CardContent></Card>)}</div>}
    <Sheet open={editorOpen} onOpenChange={setEditorOpen}><SheetContent side="bottom" className="mx-auto max-h-[92svh] w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">Новый опрос</SheetTitle></SheetHeader><PollEditor saving={saving} onSave={(values) => { onCreate(values); setEditorOpen(false) }} /></SheetContent></Sheet>
  </section>
}
