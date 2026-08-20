import { useState } from 'react'
import { Archive, BarChart3, Bell, BellOff, Check, ListChecks, LoaderCircle, Minus, Plus, RotateCcw, Send, TriangleAlert, UserRoundCheck, UsersRound, type LucideIcon } from 'lucide-react'
import type { PollResponseDto } from '@football/api-client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
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

function PollNotificationSettingsEditor({ poll, saving, onSave }: { readonly poll: PollResponseDto; readonly saving: boolean; readonly onSave: (notificationEnabled: readonly boolean[]) => void }) {
  const [notificationEnabled, setNotificationEnabled] = useState(() => poll.options.map((option) => option.notificationEnabled))

  return <form className="min-h-0 flex flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); onSave(notificationEnabled) }}>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
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
    </div>
    <div className="border-t bg-background p-4 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]"><Button type="submit" className="h-11 w-full" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Check data-icon="inline-start" />}Сохранить</Button></div>
  </form>
}

function PollDetails({ poll, saving, onEditNotifications, onRepublish, onArchive }: { readonly poll: PollResponseDto; readonly saving: boolean; readonly onEditNotifications: () => void; readonly onRepublish: () => void; readonly onArchive: () => void }) {
  return <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]">
    <div className="flex flex-col gap-5">
      <Button type="button" className="h-11" disabled={saving} onClick={onEditNotifications}><Bell data-icon="inline-start" />Редактировать оповещения</Button>
      <section className="flex flex-col gap-2" aria-labelledby="poll-settings-question">
        <h3 id="poll-settings-question" className="text-sm font-medium">Вопрос</h3>
        <div className="rounded-xl bg-card p-3 text-base font-medium shadow-sm">{poll.question}</div>
      </section>
      <section className="flex flex-col gap-2" aria-labelledby="poll-settings-options">
        <h3 id="poll-settings-options" className="text-sm font-medium">Варианты ответа</h3>
        <div className="flex flex-col gap-2 rounded-xl bg-card p-3 shadow-sm">
          {poll.options.map((option, index) => <div key={`${poll.id}-${String(index)}`} className="flex min-h-10 items-center gap-3 rounded-lg bg-muted/55 px-3 py-2">
            <span className="min-w-0 flex-1 break-words">{option.text}</span>
            <div className="flex shrink-0 items-center gap-2">
              {poll.notificationThreshold !== null && option.notificationEnabled ? <Bell className="size-4 text-warning" aria-label="Оповещение включено" /> : null}
              <span className="min-w-6 text-right font-semibold tabular-nums" aria-label={`${String(option.voterCount)} голосов`}>{option.voterCount}</span>
            </div>
          </div>)}
        </div>
      </section>
      <section className="flex flex-col gap-2" aria-labelledby="poll-settings-capabilities">
        <h3 id="poll-settings-capabilities" className="px-3 text-sm font-medium">Настройки</h3>
        <div className="flex flex-col gap-2 rounded-xl bg-card p-3 shadow-sm">
          <SettingRow icon={UsersRound} tone="notification" label="Оповестить о количестве" value={poll.notificationThreshold === null ? 'Выключено' : String(poll.notificationThreshold)} />
          <SettingRow icon={ListChecks} tone="multiple" label="Несколько ответов" enabled={poll.allowsMultipleAnswers} />
          <SettingRow icon={UserRoundCheck} tone="identity" label={poll.isAnonymous ? 'Анонимное голосование' : 'Неанонимное голосование'} />
          <SettingRow icon={RotateCcw} tone="revoting" label="Голос можно отменять" enabled={poll.allowsRevoting} />
        </div>
      </section>
      {poll.publicationState === 'failed' || poll.publicationState === 'uncertain' ? <div className={cn('flex flex-col gap-3 rounded-xl p-3', poll.publicationState === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning')}>
        <div className="flex items-center gap-2 font-medium"><TriangleAlert className="size-4.5 shrink-0" aria-hidden="true" />{poll.publicationState === 'failed' ? 'Опрос не опубликован' : 'Проверьте опрос в General'}</div>
        <Button type="button" className="h-11" disabled={saving} onClick={onRepublish}>
          {saving ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}
          Переопубликовать
        </Button>
      </div> : null}
      <Button type="button" variant="ghost" className="h-11 border border-destructive/25 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={saving} onClick={onArchive}>
        {saving ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Archive data-icon="inline-start" />}
        В архив
      </Button>
    </div>
  </div>
}

export function PollsPanel({ polls, saving, onCreate, onUpdateNotificationSettings, onRepublish, onArchive }: { readonly polls: readonly PollResponseDto[]; readonly saving: boolean; readonly onCreate: (values: PollEditorValues) => void; readonly onUpdateNotificationSettings: (pollId: string, notificationEnabled: readonly boolean[]) => Promise<boolean>; readonly onRepublish: (pollId: string) => Promise<boolean>; readonly onArchive: (pollId: string) => Promise<boolean> }) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notificationsEditorOpen, setNotificationsEditorOpen] = useState(false)
  const [selectedPollId, setSelectedPollId] = useState<string>()
  const selectedPoll = polls.find((poll) => poll.id === selectedPollId)
  const openSettings = (poll: PollResponseDto) => { setSelectedPollId(poll.id); setSettingsOpen(true) }
  const archiveSelectedPoll = async () => {
    if (selectedPoll === undefined) return
    if (!window.confirm(`Переместить опрос «${selectedPoll.question}» в архив? Опрос будет удалён из Telegram.`)) return
    if (await onArchive(selectedPoll.id)) {
      setSettingsOpen(false)
      setSelectedPollId(undefined)
    }
  }
  const republishSelectedPoll = async () => {
    if (selectedPoll === undefined) return
    if (selectedPoll.publicationState === 'uncertain' && !window.confirm('Сначала проверьте General — Telegram мог получить опрос, даже если не подтвердил отправку. Переопубликовать?')) return
    await onRepublish(selectedPoll.id)
  }
  const updateSelectedPollNotifications = async (notificationEnabled: readonly boolean[]) => {
    if (selectedPoll === undefined) return
    if (await onUpdateNotificationSettings(selectedPoll.id, notificationEnabled)) setNotificationsEditorOpen(false)
  }

  return <section className="flex flex-col gap-5">
    <div className="flex items-end justify-between gap-4"><h1 className="text-2xl font-semibold tracking-tight">Опросы</h1><Button className="h-10 px-3" onClick={() => setEditorOpen(true)}><Plus data-icon="inline-start" />Новый опрос</Button></div>
    {polls.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><BarChart3 /></EmptyMedia><EmptyTitle>Опросов пока нет</EmptyTitle></EmptyHeader><EmptyContent><Button onClick={() => setEditorOpen(true)}><Plus data-icon="inline-start" />Создать опрос</Button></EmptyContent></Empty> : <div className="flex flex-col gap-2">{polls.map((poll) => <Card key={poll.id} size="sm" className="relative"><CardHeader><CardTitle>{poll.question}</CardTitle></CardHeader><CardContent className="flex flex-col gap-3"><div className="flex flex-col gap-2">{poll.options.map((option, index) => <div key={`${poll.id}-${String(index)}`} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate">{option.text}</span><div className="flex shrink-0 items-center gap-2">{poll.notificationThreshold !== null && option.notificationEnabled ? <Bell className="size-3.5 text-warning" aria-label="Оповещение включено" /> : null}<span className="font-medium tabular-nums">{option.voterCount}</span></div></div>)}</div><div className="flex flex-wrap items-center gap-2"><Badge variant={publicationVariant(poll)}>{poll.publicationState === 'pending' ? <LoaderCircle role="status" aria-label="Публикация опроса" className="animate-spin" /> : null}{publicationLabel(poll)}</Badge>{poll.notificationThreshold === null ? null : <Badge variant={poll.options.some((option) => option.notificationEnabled && option.notificationQueuedAt !== null) ? 'success' : 'secondary'}><Bell />{poll.notificationThreshold}</Badge>}</div></CardContent><button type="button" className="absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`Открыть опрос ${poll.question}`} onClick={() => openSettings(poll)} /></Card>)}</div>}
    <Sheet open={editorOpen} onOpenChange={setEditorOpen}><SheetContent side="bottom" className="mx-auto max-h-[92svh] w-full max-w-[480px] gap-0 rounded-t-2xl p-0 data-[side=bottom]:h-[min(92svh,48rem)]"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">Новый опрос</SheetTitle></SheetHeader><PollEditor saving={saving} onSave={(values) => { onCreate(values); setEditorOpen(false) }} /></SheetContent></Sheet>
    <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}><SheetContent side="bottom" className="mx-auto max-h-[92svh] w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">Опрос</SheetTitle></SheetHeader>{selectedPoll === undefined ? null : <PollDetails poll={selectedPoll} saving={saving} onEditNotifications={() => { setSettingsOpen(false); setNotificationsEditorOpen(true) }} onRepublish={() => { void republishSelectedPoll() }} onArchive={() => { void archiveSelectedPoll() }} />}</SheetContent></Sheet>
    <Sheet open={notificationsEditorOpen} onOpenChange={setNotificationsEditorOpen}><SheetContent side="bottom" className="mx-auto max-h-[92svh] w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">Оповещения</SheetTitle></SheetHeader>{selectedPoll === undefined ? null : <PollNotificationSettingsEditor key={selectedPoll.id} poll={selectedPoll} saving={saving} onSave={(notificationEnabled) => { void updateSelectedPollNotifications(notificationEnabled) }} />}</SheetContent></Sheet>
  </section>
}
