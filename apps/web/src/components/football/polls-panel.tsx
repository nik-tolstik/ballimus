import { useState } from 'react'
import { Archive, BarChart3, Bell, BellOff, Check, Ellipsis, ListChecks, LoaderCircle, Minus, Plus, RotateCcw, Save, Trash2, TriangleAlert, UserRoundCheck, UsersRound, type LucideIcon } from 'lucide-react'
import type { PollResponseDto } from '@football/api-client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { ConfirmationSheet } from './confirmation-sheet'
import { PollEditor, type PollEditorValues } from './poll-editor'

function publicationLabel(poll: PollResponseDto): string {
  if (poll.publicationState === 'published') return poll.closedAt === null ? 'Активен' : 'Завершён'
  if (poll.publicationState === 'cancelled') return 'В архиве'
  if (poll.publicationState === 'pending') return 'Публикуется'
  if (poll.publicationState === 'uncertain') return 'Проверьте General'
  return 'Не опубликован'
}

function publicationVariant(poll: PollResponseDto) {
  if (poll.publicationState === 'published') return poll.closedAt === null ? 'success' : 'secondary'
  if (poll.publicationState === 'pending' || poll.publicationState === 'uncertain') return 'info'
  return 'destructive'
}

function PollSummary({ poll, archived = false }: { readonly poll: PollResponseDto; readonly archived?: boolean }) {
  return <Card size="sm" className="relative">
    <CardHeader><CardTitle>{poll.question}</CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">{poll.options.map((option, index) => <div key={`${poll.id}-${String(index)}`} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate">{option.text}</span><div className="flex shrink-0 items-center gap-2">{poll.notificationThreshold !== null && option.notificationEnabled ? <Bell className="size-3.5 text-warning" aria-label="Оповещение включено" /> : null}<span className="font-medium tabular-nums">{option.voterCount}</span></div></div>)}</div>
      {archived ? null : <div className="flex flex-wrap items-center gap-2"><Badge variant={publicationVariant(poll)}>{poll.publicationState === 'pending' ? <LoaderCircle role="status" aria-label="Публикация опроса" className="animate-spin" /> : null}{publicationLabel(poll)}</Badge>{poll.notificationThreshold === null ? null : <Badge variant={poll.options.some((option) => option.notificationEnabled && option.notificationQueuedAt !== null) ? 'success' : 'secondary'}><Bell />{poll.notificationThreshold}</Badge>}</div>}
    </CardContent>
  </Card>
}

const settingTone = {
  notification: 'bg-warning/10 text-warning',
  multiple: 'bg-chart-4/10 text-chart-4',
  identity: 'bg-primary/10 text-primary',
  revoting: 'bg-success/10 text-success',
} as const

function SettingRow({
  icon: Icon,
  tone,
  label,
  value,
  enabled = true,
}: {
  readonly icon: LucideIcon
  readonly tone: keyof typeof settingTone
  readonly label: string
  readonly value?: string
  readonly enabled?: boolean
}) {
  return <div className="flex items-center gap-2 rounded-lg bg-muted/55 p-2.5">
    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', settingTone[tone])}><Icon className="size-4.5" aria-hidden="true" /></span>
    <span className="min-w-0 flex-1 truncate">{label}</span>
    {value === undefined ? enabled ? <Check className="size-4.5 shrink-0 text-success" aria-hidden="true" /> : <Minus className="size-4.5 shrink-0 text-muted-foreground/45" aria-hidden="true" /> : <span className="shrink-0 font-medium tabular-nums text-muted-foreground">{value}</span>}
  </div>
}

function PollNotificationSettingsEditor({ poll, saving, onSave, onOpenActions }: { readonly poll: PollResponseDto; readonly saving: boolean; readonly onSave: (notificationEnabled: readonly boolean[]) => void; readonly onOpenActions: () => void }) {
  const [notificationEnabled, setNotificationEnabled] = useState(() => poll.options.map((option) => option.notificationEnabled))

  return <form className="min-h-0 flex flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); onSave(notificationEnabled) }}>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2" aria-labelledby="poll-edit-question">
          <h3 id="poll-edit-question" className="text-sm font-medium">Вопрос</h3>
          <div className="rounded-xl bg-card p-3 text-base font-medium shadow-sm">{poll.question}</div>
        </section>
        <section className="flex flex-col gap-2" aria-labelledby="poll-edit-options">
          <h3 id="poll-edit-options" className="text-sm font-medium">Варианты ответа</h3>
          <div className="flex flex-col gap-2 rounded-xl bg-card p-3 shadow-sm">
            {poll.options.map((option, index) => {
              const enabled = notificationEnabled[index] ?? false
              return <div key={`${poll.id}-${String(index)}`} className="flex min-h-11 items-center gap-3 rounded-lg bg-muted/55 px-3 py-2">
                <span className="min-w-0 flex-1 break-words">{option.text}</span>
                <span className="shrink-0 font-semibold tabular-nums" aria-label={`${String(option.voterCount)} голосов`}>{option.voterCount}</span>
                <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={`Оповещение для варианта ${String(index + 1)}`} aria-pressed={enabled} disabled={saving} onClick={() => setNotificationEnabled((current) => current.map((value, optionIndex) => optionIndex === index ? !value : value))}>
                  {enabled ? <Bell className="text-warning" /> : <BellOff className="text-muted-foreground" />}
                </Button>
              </div>
            })}
          </div>
        </section>
        {poll.publicationState === 'failed' || poll.publicationState === 'uncertain' ? <div className={cn('rounded-xl p-3', poll.publicationState === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning')}>
          <div className="flex items-center gap-2 font-medium"><TriangleAlert className="size-4.5 shrink-0" aria-hidden="true" />{poll.publicationState === 'failed' ? 'Опрос не опубликован' : 'Проверьте опрос в General'}</div>
        </div> : null}
        <section className="flex flex-col gap-2" aria-labelledby="poll-edit-capabilities">
          <h3 id="poll-edit-capabilities" className="px-3 text-sm font-medium">Настройки</h3>
          <div className="flex flex-col gap-2 rounded-xl bg-card p-3 shadow-sm">
            <SettingRow icon={UsersRound} tone="notification" label="Оповестить о количестве" value={poll.notificationThreshold === null ? 'Выключено' : String(poll.notificationThreshold)} />
            <SettingRow icon={ListChecks} tone="multiple" label="Несколько ответов" enabled={poll.allowsMultipleAnswers} />
            <SettingRow icon={UserRoundCheck} tone="identity" label={poll.isAnonymous ? 'Анонимное голосование' : 'Неанонимное голосование'} />
            <SettingRow icon={RotateCcw} tone="revoting" label="Голос можно отменять" enabled={poll.allowsRevoting} />
          </div>
        </section>
      </div>
    </div>
    <div className="sheet-actions bg-muted/60 px-4 pt-3 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]"><div className="flex gap-2"><Button type="submit" className="h-10 flex-1" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}Сохранить</Button><Button type="button" variant="ghost" size="icon-lg" className="size-10" aria-label="Действия опроса" disabled={saving} onClick={onOpenActions}><Ellipsis /></Button></div></div>
  </form>
}

export function PollsPanel({ polls, archivedPolls, saving, onCreate, onUpdateNotificationSettings, onArchive, onDeleteArchived }: { readonly polls: readonly PollResponseDto[]; readonly archivedPolls: readonly PollResponseDto[]; readonly saving: boolean; readonly onCreate: (values: PollEditorValues) => void; readonly onUpdateNotificationSettings: (pollId: string, notificationEnabled: readonly boolean[]) => Promise<boolean>; readonly onArchive: (pollId: string) => Promise<boolean>; readonly onDeleteArchived: (pollId: string) => Promise<boolean> }) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archivedActionsOpen, setArchivedActionsOpen] = useState(false)
  const [confirmation, setConfirmation] = useState<'archive' | 'delete-archived'>()
  const [selectedPollId, setSelectedPollId] = useState<string>()
  const [archivedPollId, setArchivedPollId] = useState<string>()
  const selectedPoll = polls.find((poll) => poll.id === selectedPollId)
  const archivedPoll = archivedPolls.find((poll) => poll.id === archivedPollId)
  const openSettings = (poll: PollResponseDto) => { setSelectedPollId(poll.id); setSettingsOpen(true) }
  const archiveSelectedPoll = async () => {
    if (selectedPoll === undefined) return
    if (await onArchive(selectedPoll.id)) {
      setConfirmation(undefined)
      setActionsOpen(false)
      setSettingsOpen(false)
      setSelectedPollId(undefined)
    }
  }
  const deleteArchivedSelectedPoll = async () => {
    if (archivedPoll === undefined) return
    if (await onDeleteArchived(archivedPoll.id)) {
      setConfirmation(undefined)
      setArchivedActionsOpen(false)
      setArchiveOpen(false)
      setArchivedPollId(undefined)
    }
  }
  const closeConfirmation = (open: boolean) => {
    if (open) return
    const currentConfirmation = confirmation
    setConfirmation(undefined)
    if (currentConfirmation === 'archive') setActionsOpen(true)
    if (currentConfirmation === 'delete-archived') setArchivedActionsOpen(true)
  }
  const updateSelectedPollNotifications = async (notificationEnabled: readonly boolean[]) => {
    if (selectedPoll === undefined) return
    if (await onUpdateNotificationSettings(selectedPoll.id, notificationEnabled)) setSettingsOpen(false)
  }

  return <section className="flex flex-col gap-5">
    <div className="flex items-end justify-between gap-4"><h1 className="text-2xl font-semibold tracking-tight">Опросы</h1><div className="flex items-center gap-1"><Button variant="ghost" size="icon-lg" aria-label="Архив опросов" onClick={() => setArchiveOpen(true)}><Archive /></Button><Button className="h-10 px-3" onClick={() => setEditorOpen(true)}><Plus data-icon="inline-start" />Новый опрос</Button></div></div>
    {polls.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><BarChart3 /></EmptyMedia><EmptyTitle>Опросов пока нет</EmptyTitle></EmptyHeader><EmptyContent><Button onClick={() => setEditorOpen(true)}><Plus data-icon="inline-start" />Создать опрос</Button></EmptyContent></Empty> : <div className="flex flex-col gap-2">{polls.map((poll) => <div key={poll.id} className="relative"><PollSummary poll={poll} /><button type="button" className="absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`Открыть опрос ${poll.question}`} onClick={() => openSettings(poll)} /></div>)}</div>}
    <Sheet open={editorOpen} onOpenChange={setEditorOpen}><SheetContent side="bottom" className="mx-auto max-h-[92svh] w-full max-w-[480px] gap-0 rounded-t-2xl p-0 data-[side=bottom]:h-[min(92svh,48rem)]"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">Новый опрос</SheetTitle></SheetHeader><PollEditor saving={saving} onSave={(values) => { onCreate(values); setEditorOpen(false) }} /></SheetContent></Sheet>
    <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}><SheetContent side="bottom" className="mx-auto max-h-[92svh] w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">Опрос</SheetTitle></SheetHeader>{selectedPoll === undefined ? null : <PollNotificationSettingsEditor key={selectedPoll.id} poll={selectedPoll} saving={saving} onSave={(notificationEnabled) => { void updateSelectedPollNotifications(notificationEnabled) }} onOpenActions={() => setActionsOpen(true)} />}</SheetContent></Sheet>
    <Sheet open={actionsOpen} onOpenChange={setActionsOpen}><SheetContent side="bottom" className="mx-auto w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">Действия с опросом</SheetTitle></SheetHeader><div className="flex flex-col gap-1 px-2 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]">{selectedPoll === undefined ? null : <Button type="button" variant="ghost" className="h-11 justify-start" disabled={saving} onClick={() => { setActionsOpen(false); setConfirmation('archive') }}><Archive data-icon="inline-start" />В архив</Button>}</div></SheetContent></Sheet>
    <Sheet open={archiveOpen} onOpenChange={setArchiveOpen}>{archiveOpen ? <SheetContent side="bottom" className="mx-auto max-h-[92svh] w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">Архив опросов</SheetTitle></SheetHeader><div className="min-h-0 overflow-y-auto px-4 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]">{archivedPolls.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><Archive /></EmptyMedia><EmptyTitle>Архив пуст</EmptyTitle></EmptyHeader></Empty> : <div className="flex flex-col gap-2">{archivedPolls.map((poll) => <div key={poll.id} className="relative"><PollSummary poll={poll} archived /><button type="button" className="absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`Открыть архивный опрос ${poll.question}`} onClick={() => { setArchivedPollId(poll.id); setArchivedActionsOpen(true) }} /></div>)}</div>}</div></SheetContent> : null}</Sheet>
    <Sheet open={archivedActionsOpen} onOpenChange={setArchivedActionsOpen}><SheetContent side="bottom" className="mx-auto w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">Архивный опрос</SheetTitle></SheetHeader><div className="flex flex-col gap-1 px-2 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]">{archivedPoll === undefined ? null : <Button type="button" variant="ghost" className="h-11 justify-start text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={saving} onClick={() => { setArchivedActionsOpen(false); setConfirmation('delete-archived') }}><Trash2 data-icon="inline-start" />Удалить</Button>}</div></SheetContent></Sheet>
    <ConfirmationSheet open={confirmation !== undefined} title={confirmation === 'archive' ? 'Переместить опрос в архив?' : 'Удалить опрос навсегда?'} description={confirmation === 'archive' ? `«${selectedPoll?.question ?? 'Опрос'}» будет удалён из Telegram.` : `«${archivedPoll?.question ?? 'Архивный опрос'}». Действие нельзя отменить.`} confirmLabel={confirmation === 'archive' ? 'В архив' : 'Удалить'} destructive pending={saving} onOpenChange={closeConfirmation} onConfirm={() => { if (confirmation === 'archive') void archiveSelectedPoll(); else void deleteArchivedSelectedPoll() }} />
  </section>
}
