import { useMemo, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  CloudSun,
  Clock3,
  GripVertical,
  Link2,
  MapPin,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
  Trophy,
  Users,
  XCircle,
} from 'lucide-react'

import type {
  NormalizedExternalParticipant,
  NormalizedMatch,
  NormalizedPlayer,
  NormalizedVote,
  NormalizedVoteOption,
  NormalizedRosterTarget,
} from '@/normalize'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { MatchEditor, type EditorValues } from './match-editor'

interface ExternalParticipantCreateValues {
  readonly displayName?: string
  readonly quantity: number
  readonly availableAfter?: string | null
}

interface ExternalParticipantUpdateValues {
  readonly displayName: string
  readonly availableAfter?: string | null
}

export interface FinalMatchDetailsValues {
  readonly time: string
  readonly location: string
  readonly venueType: '' | 'outdoor' | 'indoor'
  readonly fieldPriceRubles: string
}

export interface FinalMatchDetailsValidation {
  readonly time?: string
  readonly location?: string
  readonly fieldPriceRubles?: string
}

const CANCELLATION_REASON_OPTIONS = [
  { value: 'bad_weather', label: 'Плохая погода' },
  { value: 'not_enough_players', label: 'Недостаточно игроков' },
  { value: 'other', label: 'Другое' },
] as const

export type CancellationReasonOption = (typeof CANCELLATION_REASON_OPTIONS)[number]['value']

interface MatchesPanelProps {
  readonly matches: readonly NormalizedMatch[]
  readonly selected: NormalizedMatch | undefined
  readonly onSelect: (id: string | undefined) => void
  readonly onCreate: (values: EditorValues) => Promise<void>
  readonly onPatch: (match: NormalizedMatch, values: EditorValues) => void
  readonly onPublish: (match: NormalizedMatch) => void
  readonly onFinalize: (match: NormalizedMatch, values: FinalMatchDetailsValues) => Promise<void>
  readonly onConfirm: (match: NormalizedMatch) => void
  readonly onComplete: (match: NormalizedMatch) => void
  readonly onSendWeather: (match: NormalizedMatch) => void
  readonly onCancel: (match: NormalizedMatch, reason: string) => void
  readonly onCorrectVote: (match: NormalizedMatch, vote: NormalizedVote, target: NormalizedRosterTarget) => Promise<void>
  readonly onRemoveVote: (match: NormalizedMatch, vote: NormalizedVote, target: NormalizedRosterTarget) => void
  readonly onAddExternal: (match: NormalizedMatch, values: ExternalParticipantCreateValues) => void
  readonly onUpdateExternal: (match: NormalizedMatch, participant: NormalizedExternalParticipant, values: ExternalParticipantUpdateValues) => void
  readonly onRemoveExternal: (match: NormalizedMatch, participant: NormalizedExternalParticipant) => void
  readonly onReconcile: (match: NormalizedMatch, action: 'attach' | 'retry', telegramMessageId?: string) => void
  readonly conflict: string
  readonly onClearConflict: () => void
  readonly saving: boolean
  readonly actionPending: boolean
}

function statusBadge(match: NormalizedMatch) {
  if (match.status === 'cancelled') return <Badge variant="destructive">{match.statusLabel}</Badge>
  if (match.status === 'confirmed' || match.status === 'completed' || match.planningStage === 'ready_to_confirm') {
    return <Badge variant="secondary" className="bg-success/12 text-success"><span className="size-1.5 rounded-full bg-success" />{match.statusShortLabel}</Badge>
  }
  return <Badge variant="secondary">{match.statusShortLabel}</Badge>
}

function plural(count: number, one: string, few: string, many: string): string {
  const absolute = Math.abs(count) % 100
  const last = absolute % 10
  if (absolute > 10 && absolute < 20) return many
  if (last === 1) return one
  if (last > 1 && last < 5) return few
  return many
}

export function initialsForName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/u).filter(Boolean)
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
}

const PLAYER_AVATAR_COLORS = [
  'bg-rose-500/15 text-rose-700 dark:bg-rose-400/20 dark:text-rose-200',
  'bg-orange-500/15 text-orange-700 dark:bg-orange-400/20 dark:text-orange-200',
  'bg-amber-500/15 text-amber-700 dark:bg-amber-400/20 dark:text-amber-200',
  'bg-emerald-500/15 text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-200',
  'bg-cyan-500/15 text-cyan-700 dark:bg-cyan-400/20 dark:text-cyan-200',
  'bg-blue-500/15 text-blue-700 dark:bg-blue-400/20 dark:text-blue-200',
  'bg-violet-500/15 text-violet-700 dark:bg-violet-400/20 dark:text-violet-200',
  'bg-pink-500/15 text-pink-700 dark:bg-pink-400/20 dark:text-pink-200',
] as const

export function playerAvatarColor(playerId: string): (typeof PLAYER_AVATAR_COLORS)[number] {
  let hash = 0
  for (let index = 0; index < playerId.length; index += 1) {
    hash = (hash * 31 + playerId.charCodeAt(index)) >>> 0
  }
  return PLAYER_AVATAR_COLORS[hash % PLAYER_AVATAR_COLORS.length]!
}

function PlayerAvatar({ playerId, displayName, avatarUrl, size = 'default' }: {
  readonly playerId: string
  readonly displayName: string
  readonly avatarUrl: string | undefined
  readonly size?: 'default' | 'sm' | 'lg'
}) {
  return (
    <Avatar size={size}>
      {avatarUrl !== undefined && <AvatarImage src={avatarUrl} alt="" />}
      <AvatarFallback className={cn('font-medium', playerAvatarColor(playerId))}>{initialsForName(displayName)}</AvatarFallback>
    </Avatar>
  )
}

export function cancellationReasonText(option: CancellationReasonOption | undefined, otherReason: string): string {
  if (option === 'bad_weather') return 'Плохая погода'
  if (option === 'not_enough_players') return 'Недостаточно игроков'
  return option === 'other' ? otherReason.trim() : ''
}

export function validateCancellationReason(option: CancellationReasonOption | undefined, otherReason: string): string | undefined {
  if (option === undefined) return 'Выберите причину отмены.'
  return option === 'other' && otherReason.trim() === '' ? 'Опишите другую причину.' : undefined
}

export function validateExternalParticipantValues(source: string, quantity: string): string | undefined {
  if (source.trim() === '') return 'Укажите источник.'
  const parsedQuantity = Number(quantity)
  return Number.isSafeInteger(parsedQuantity) && parsedQuantity >= 1 && parsedQuantity <= 50 ? undefined : 'Количество должно быть целым числом от 1 до 50.'
}

export function validateExternalParticipantName(displayName: string): string | undefined {
  return displayName.trim() === '' ? 'Укажите имя игрока.' : undefined
}

export function validateFinalMatchDetails(
  match: NormalizedMatch,
  values: FinalMatchDetailsValues,
): FinalMatchDetailsValidation {
  const validation: { time?: string; location?: string; fieldPriceRubles?: string } = {}
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(values.time)) {
    validation.time = 'Укажите точное время матча.'
  } else if (match.timeMode === 'exact_options' && !match.timeOptions.includes(values.time)) {
    validation.time = 'Выберите один из точных вариантов времени.'
  } else if (match.timeMode !== 'exact') {
    const available = availabilityCountAt(match, values.time)
    if (available < match.requiredPlayers) {
      validation.time = `К этому времени смогут только ${available} из ${match.requiredPlayers} игроков.`
    }
  }
  const location = values.location.trim()
  if (location.length < 2 || location.length > 200) validation.location = 'Укажите место игры.'
  const price = Number(values.fieldPriceRubles)
  if (values.fieldPriceRubles.trim() === '' || !Number.isSafeInteger(price) || price < 0) {
    validation.fieldPriceRubles = 'Укажите стоимость поля целым числом.'
  }
  return validation
}

function EmptyState({ icon: Icon, title, copy, action }: { readonly icon: typeof CircleDot; readonly title: string; readonly copy?: string; readonly action?: ReactNode }) {
  return (
    <Empty className="min-h-60 bg-muted/55 shadow-inner">
      <EmptyHeader><EmptyMedia variant="icon"><Icon /></EmptyMedia><EmptyTitle>{title}</EmptyTitle>{copy === undefined ? null : <EmptyDescription>{copy}</EmptyDescription>}</EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}

export function CancellationReasonFields({ option, otherReason, validation, onOptionChange, onOtherReasonChange, matchId = 'match' }: {
  readonly option: CancellationReasonOption | undefined
  readonly otherReason: string
  readonly validation: string
  readonly onOptionChange: (option: CancellationReasonOption) => void
  readonly onOtherReasonChange: (reason: string) => void
  readonly matchId?: string
}) {
  const optionInvalid = validation !== '' && option === undefined
  const otherReasonInvalid = validation !== '' && option === 'other'

  return <>
    <Field data-invalid={optionInvalid || undefined}>
      <FieldLabel htmlFor={`cancel-reason-${matchId}`}>Причина отмены</FieldLabel>
      <Select value={option ?? ''} onValueChange={(value) => onOptionChange(value as CancellationReasonOption)}>
        <SelectTrigger id={`cancel-reason-${matchId}`} className="w-full" aria-invalid={optionInvalid || undefined}>
          <SelectValue placeholder="Выберите причину" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>{CANCELLATION_REASON_OPTIONS.map((reason) => <SelectItem key={reason.value} value={reason.value}>{reason.label}</SelectItem>)}</SelectGroup>
        </SelectContent>
      </Select>
      <FieldError>{optionInvalid ? validation : undefined}</FieldError>
    </Field>
    {option === 'other' ? <Field data-invalid={otherReasonInvalid || undefined}>
      <FieldLabel htmlFor={`cancel-other-reason-${matchId}`}>Другая причина</FieldLabel>
      <Input id={`cancel-other-reason-${matchId}`} value={otherReason} onChange={(event) => onOtherReasonChange(event.target.value)} placeholder="Опишите причину отмены" aria-invalid={otherReasonInvalid || undefined} autoFocus />
      <FieldError>{otherReasonInvalid ? validation : undefined}</FieldError>
    </Field> : null}
  </>
}

const VOTE_LABELS: Record<NormalizedVoteOption, string> = {
  going: 'Идут',
  maybe: 'Возможно',
  not_going: 'Не идут',
}

const VOTE_OPTIONS: readonly NormalizedVoteOption[] = ['going', 'maybe', 'not_going']
const EMPTY_EXTERNAL_PARTICIPANTS: readonly NormalizedExternalParticipant[] = []

interface VoteDropZoneStyle {
  readonly zone: string
  readonly empty: string
  readonly label: string
}

const VOTE_DROP_ZONE_STYLES: Record<NormalizedVoteOption, VoteDropZoneStyle> = {
  going: {
    zone: 'border-success/55 bg-success/10 ring-1 ring-inset ring-success/20',
    empty: 'border-success/60 bg-success/8 text-success',
    label: 'text-success',
  },
  maybe: {
    zone: 'border-warning/60 bg-warning/10 ring-1 ring-inset ring-warning/20',
    empty: 'border-warning/65 bg-warning/8 text-warning',
    label: 'text-warning',
  },
  not_going: {
    zone: 'border-destructive/55 bg-destructive/10 ring-1 ring-inset ring-destructive/20',
    empty: 'border-destructive/60 bg-destructive/8 text-destructive',
    label: 'text-destructive',
  },
}

function rosterTargetOption(target: NormalizedRosterTarget): NormalizedVoteOption {
  return target.startsWith('after:') || target.startsWith('at:') ? 'going' : target as NormalizedVoteOption
}

function rosterTargetLabel(target: NormalizedRosterTarget): string {
  if (target.startsWith('after:')) return `После ${target.slice('after:'.length)}`
  if (target.startsWith('at:')) return target.slice('at:'.length)
  return VOTE_LABELS[target as NormalizedVoteOption]
}

function rosterTargetForVote(match: NormalizedMatch, vote: NormalizedVote): NormalizedRosterTarget {
  if (match.timeMode !== 'exact' && match.selectedTime === undefined && vote.option === 'going') {
    const prefix = match.timeMode === 'availability' ? 'after' : 'at'
    return `${prefix}:${match.timeMode === 'exact_options' ? vote.exactTimes[0] ?? vote.availableAfter ?? match.timeOptions[0] ?? '00:00' : vote.availableAfter ?? match.timeOptions[0] ?? '00:00'}`
  }
  if (
    match.timeMode !== 'exact'
    && match.selectedTime !== undefined
    && vote.option === 'going'
    && (
      match.timeMode === 'availability'
        ? vote.availableAfter !== undefined && vote.availableAfter > match.selectedTime
        : !vote.exactTimes.includes(match.selectedTime)
    )
  ) return 'not_going'
  return vote.option
}

function voteMatchesRosterTarget(match: NormalizedMatch, vote: NormalizedVote, target: NormalizedRosterTarget): boolean {
  if (match.timeMode === 'exact_options' && match.selectedTime === undefined && target.startsWith('at:') && vote.option === 'going') {
    const time = target.slice('at:'.length)
    return vote.exactTimes.includes(time) || (vote.exactTimes.length === 0 && vote.availableAfter === time)
  }
  return rosterTargetForVote(match, vote) === target
}

export function voteDropZoneStyle(target: NormalizedRosterTarget): VoteDropZoneStyle {
  return VOTE_DROP_ZONE_STYLES[rosterTargetOption(target)]
}

const ROSTER_DND_INSTRUCTIONS = {
  draggable: 'Чтобы поднять карточку игрока, нажмите пробел. Перемещайте её стрелками. Чтобы положить карточку, снова нажмите пробел. Для отмены нажмите Escape.',
}

const ROSTER_DND_ANNOUNCEMENTS: Announcements = {
  onDragStart: ({ active }) => `Поднята карточка ${String(active.data.current?.['readableName'] ?? 'игрока')}.`,
  onDragOver: ({ over }) => over === null ? 'Карточка вне группы.' : `Карточка над группой ${rosterTargetLabel(voteOptionFromDropTarget(over.id) ?? 'going')}.`,
  onDragEnd: ({ active, over }) => over === null ? `Перенос ${String(active.data.current?.['readableName'] ?? 'игрока')} отменён.` : `Карточка ${String(active.data.current?.['readableName'] ?? 'игрока')} перенесена в группу ${rosterTargetLabel(voteOptionFromDropTarget(over.id) ?? 'going')}.`,
  onDragCancel: ({ active }) => `Перенос ${String(active.data.current?.['readableName'] ?? 'игрока')} отменён.`,
}

export function voteOptionFromDropTarget(value: unknown): NormalizedRosterTarget | undefined {
  return value === 'going' || value === 'maybe' || value === 'not_going' || (typeof value === 'string' && /^(?:after|at):(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) ? value as NormalizedRosterTarget : undefined
}

export type VoteRemovalAction =
  | { readonly type: 'remove_vote' }
  | { readonly type: 'replace_exact_times'; readonly exactTimes: readonly string[] }

export function voteRemovalAction(
  match: NormalizedMatch,
  vote: NormalizedVote,
  target: NormalizedRosterTarget,
): VoteRemovalAction {
  if (match.timeMode !== 'exact_options' || match.selectedTime !== undefined || !target.startsWith('at:')) {
    return { type: 'remove_vote' }
  }
  const selectedTimes = vote.exactTimes.length > 0
    ? vote.exactTimes
    : vote.availableAfter === undefined
      ? []
      : [vote.availableAfter]
  const removedTime = target.slice('at:'.length)
  const exactTimes = selectedTimes.filter((time) => time !== removedTime)
  return exactTimes.length === 0
    ? { type: 'remove_vote' }
    : { type: 'replace_exact_times', exactTimes }
}

function VoteIdentity({ vote }: { readonly vote: NormalizedVote }) {
  return <><PlayerAvatar playerId={vote.playerId} displayName={vote.readableName} avatarUrl={vote.avatarUrl} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{vote.readableName}</span></>
}

function DraggableVote({ match, vote, target, onRemove, disabled, draggable }: {
  readonly match: NormalizedMatch
  readonly vote: NormalizedVote
  readonly target: NormalizedRosterTarget
  readonly onRemove: MatchesPanelProps['onRemoveVote']
  readonly disabled: boolean
  readonly draggable: boolean
}) {
  const { attributes, isDragging, listeners, setActivatorNodeRef, setNodeRef } = useDraggable({
    id: `${vote.playerId}:${target}`,
    data: { playerId: vote.playerId, readableName: vote.readableName, option: vote.option },
    disabled: disabled || !draggable,
  })

  return (
    <motion.div ref={setNodeRef} layout className={cn('flex items-center gap-2.5 rounded-lg border bg-background/80 p-2.5 shadow-sm transition-[border-color,box-shadow] duration-150', isDragging && 'opacity-30')}>
      <button ref={setActivatorNodeRef} type="button" className="grid size-8 shrink-0 touch-none place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 active:cursor-grabbing" disabled={disabled || !draggable} aria-label={`Перетащить ${vote.readableName}`} {...attributes} {...listeners}><GripVertical className="size-4" /></button>
      <VoteIdentity vote={vote} />
      <Button size="icon-xs" variant="destructive" disabled={disabled} onClick={() => onRemove(match, vote, target)} aria-label={target.startsWith('at:') ? `Удалить ${vote.readableName} из ${rosterTargetLabel(target)}` : `Удалить голос ${vote.readableName}`}><Trash2 /></Button>
    </motion.div>
  )
}

function ExternalParticipantCard({ match, participant, onEdit, onRemove, disabled }: {
  readonly match: NormalizedMatch
  readonly participant: NormalizedExternalParticipant
  readonly onEdit: (participant: NormalizedExternalParticipant) => void
  readonly onRemove: MatchesPanelProps['onRemoveExternal']
  readonly disabled: boolean
}) {
  return (
    <motion.div layout className="flex items-center gap-2.5 rounded-lg border bg-background/80 p-2.5 shadow-sm">
      <Avatar><AvatarFallback className="bg-muted font-semibold text-muted-foreground">?</AvatarFallback></Avatar>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onEdit(participant)} disabled={disabled}><span className="block truncate text-sm font-medium">{participant.displayName}</span></button>
      <Button size="icon-xs" variant="ghost" disabled={disabled} onClick={() => onEdit(participant)} aria-label={`Изменить ${participant.displayName}`}><Pencil /></Button>
      <Button size="icon-xs" variant="destructive" disabled={disabled} onClick={() => onRemove(match, participant)} aria-label={`Удалить ${participant.displayName}`}><Trash2 /></Button>
    </motion.div>
  )
}

export function rosterGroupCount(target: NormalizedRosterTarget, votes: readonly NormalizedVote[], externalParticipants: readonly NormalizedExternalParticipant[]): number {
  return votes.length + (rosterTargetOption(target) === 'going' ? externalParticipants.reduce((total, participant) => total + participant.quantity, 0) : 0)
}

function externalParticipantsForRosterTarget(
  match: NormalizedMatch,
  target: NormalizedRosterTarget,
): readonly NormalizedExternalParticipant[] {
  if (match.timeMode === 'availability' && match.selectedTime === undefined) {
    if (!target.startsWith('after:')) return EMPTY_EXTERNAL_PARTICIPANTS
    return match.roster.externalParticipants.filter((participant) => participant.availableAfter === target.slice('after:'.length))
  }
  if (match.timeMode === 'exact_options' && match.selectedTime === undefined) {
    return target === `at:${match.timeOptions[0] ?? ''}` ? match.roster.externalParticipants : EMPTY_EXTERNAL_PARTICIPANTS
  }
  return rosterTargetOption(target) === 'going' ? match.roster.externalParticipants : EMPTY_EXTERNAL_PARTICIPANTS
}

function VoteGroup({ match, votes, externalParticipants, target, onAddExternal, onEditExternal, onRemoveVote, onRemoveExternal, disabled }: {
  readonly match: NormalizedMatch
  readonly votes: readonly NormalizedVote[]
  readonly externalParticipants: readonly NormalizedExternalParticipant[]
  readonly target: NormalizedRosterTarget
  readonly onAddExternal: () => void
  readonly onEditExternal: (participant: NormalizedExternalParticipant) => void
  readonly onRemoveVote: MatchesPanelProps['onRemoveVote']
  readonly onRemoveExternal: MatchesPanelProps['onRemoveExternal']
  readonly disabled: boolean
}) {
  const { isOver, setNodeRef } = useDroppable({ id: target, data: { target }, disabled })
  const hasParticipants = votes.length > 0 || externalParticipants.length > 0
  const participantCount = rosterGroupCount(target, votes, externalParticipants)
  const dropZoneStyle = voteDropZoneStyle(target)
  return (
    <section ref={setNodeRef} className={cn('-mx-2 min-h-24 rounded-xl border border-transparent p-2 transition-[background-color,border-color,box-shadow] duration-150', isOver && dropZoneStyle.zone)} aria-label={`Группа ${rosterTargetLabel(target)}`}>
      <div className="mb-2 flex items-center justify-between"><p className={cn('text-xs font-medium text-muted-foreground transition-colors', isOver && dropZoneStyle.label)}>{rosterTargetLabel(target)}</p><div className="flex items-center gap-1"><Badge variant="secondary">{participantCount}</Badge>{rosterTargetOption(target) === 'going' ? <Button size="icon-xs" variant="ghost" disabled={disabled} onClick={onAddExternal} aria-label="Добавить дополнительных игроков" title="Добавить дополнительных игроков"><Plus /></Button> : null}</div></div>
      {!hasParticipants ? <div className={cn('grid min-h-12 place-items-center rounded-lg border border-dashed text-xs text-muted-foreground transition-colors', isOver && dropZoneStyle.empty)}>{isOver ? 'Отпустите здесь' : 'Перетащите сюда'}</div> : <div className="flex flex-col gap-2">{votes.map((vote) => <DraggableVote key={`${vote.playerId}:${target}`} match={match} vote={vote} target={target} onRemove={onRemoveVote} disabled={disabled} draggable={!target.startsWith('at:')} />)}{externalParticipants.map((participant) => <ExternalParticipantCard key={participant.id} match={match} participant={participant} onEdit={onEditExternal} onRemove={onRemoveExternal} disabled={disabled} />)}</div>}
    </section>
  )
}

function DraggedVotePreview({ vote }: { readonly vote: NormalizedVote }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-primary/40 bg-background p-2.5 shadow-xl">
      <span className="grid size-8 shrink-0 place-items-center rounded-md text-primary"><GripVertical className="size-4" /></span>
      <VoteIdentity vote={vote} />
    </div>
  )
}

export function MatchRoster({ match, onCorrectVote, onRemoveVote, onAddExternal, onUpdateExternal, onRemoveExternal, disabled }: Pick<MatchesPanelProps, 'onCorrectVote' | 'onRemoveVote' | 'onAddExternal' | 'onUpdateExternal' | 'onRemoveExternal'> & { readonly match: NormalizedMatch; readonly disabled: boolean }) {
  const [editingId, setEditingId] = useState<string | undefined>()
  const [externalSheetOpen, setExternalSheetOpen] = useState(false)
  const [activePlayerId, setActivePlayerId] = useState<string | undefined>()
  const [optimisticTargets, setOptimisticTargets] = useState<Record<string, NormalizedRosterTarget>>({})
  const editing = match.roster.externalParticipants.find((participant) => participant.id === editingId)
  const [displayName, setDisplayName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [availableAfter, setAvailableAfter] = useState<string | undefined>()
  const [validation, setValidation] = useState('')
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )
  const votes = useMemo(() => match.roster.votes.map((vote) => {
    const target = optimisticTargets[vote.playerId]
    if (target === undefined || target === rosterTargetForVote(match, vote)) return vote
    return target.startsWith('after:') || target.startsWith('at:')
      ? { ...vote, option: 'going' as const, availableAfter: target.startsWith('after:') ? target.slice(target.indexOf(':') + 1) : undefined, exactTimes: target.startsWith('at:') ? [target.slice(target.indexOf(':') + 1)] : [] }
      : { ...vote, option: target as NormalizedVoteOption, availableAfter: undefined }
  }), [match, optimisticTargets])
  const rosterTargets: readonly NormalizedRosterTarget[] = match.timeMode !== 'exact' && match.selectedTime === undefined
    ? [...match.timeOptions.map((time) => `${match.timeMode === 'availability' ? 'after' : 'at'}:${time}` as const), 'maybe', 'not_going']
    : VOTE_OPTIONS
  const activeVote = votes.find((vote) => vote.playerId === activePlayerId)
  const unassignedExternalParticipants = match.timeMode === 'availability' && match.selectedTime === undefined
    ? match.roster.externalParticipants.filter((participant) => participant.availableAfter === undefined)
    : EMPTY_EXTERNAL_PARTICIPANTS
  const clearExternalForm = () => { setEditingId(undefined); setDisplayName(''); setQuantity('1'); setAvailableAfter(undefined); setValidation('') }
  const setExternalOpen = (open: boolean) => { setExternalSheetOpen(open); if (!open) clearExternalForm() }
  const beginCreate = () => { clearExternalForm(); setExternalSheetOpen(true) }
  const beginEdit = (participant: NormalizedExternalParticipant) => { setEditingId(participant.id); setDisplayName(participant.displayName === 'Дополнительные игроки' ? '' : participant.displayName); setQuantity('1'); setAvailableAfter(participant.availableAfter); setValidation(''); setExternalSheetOpen(true) }
  const submit = () => {
    const normalizedName = displayName.trim()
    const formValidation = editing === undefined
      ? validateExternalParticipantValues(normalizedName, quantity)
      : validateExternalParticipantName(normalizedName)
    if (formValidation !== undefined) { setValidation(formValidation); return }
    const availability = match.timeMode === 'availability' ? availableAfter ?? null : undefined
    if (editing === undefined) {
      onAddExternal(match, { quantity: Number(quantity), displayName: normalizedName, ...(availability === undefined ? {} : { availableAfter: availability }) })
    } else {
      onUpdateExternal(match, editing, { displayName: normalizedName, ...(availability === undefined ? {} : { availableAfter: availability }) })
    }
    setExternalOpen(false)
  }
  const finishDrag = ({ active, over }: DragEndEvent) => {
    setActivePlayerId(undefined)
    const nextTarget = voteOptionFromDropTarget(over?.id)
    const vote = votes.find((item) => item.playerId === String(active.data.current?.['playerId'] ?? active.id))
    if (vote === undefined || nextTarget === undefined || nextTarget === rosterTargetForVote(match, vote)) return
    setOptimisticTargets((current) => ({ ...current, [vote.playerId]: nextTarget }))
    void onCorrectVote(match, vote, nextTarget).catch(() => {
      setOptimisticTargets((current) => {
        if (current[vote.playerId] !== nextTarget) return current
        const { [vote.playerId]: _removed, ...rest } = current
        return rest
      })
    })
  }

  return <>
    <Card size="sm">
      <CardHeader><CardTitle>Состав</CardTitle><CardDescription>{match.timeMode === 'exact_options' ? 'Игрок может выбрать несколько точных времён в Telegram.' : 'Перетащите игрока за маркер в нужную группу — изменение сохранится автоматически.'}</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-5">
        <DndContext sensors={sensors} collisionDetection={closestCenter} accessibility={{ announcements: ROSTER_DND_ANNOUNCEMENTS, screenReaderInstructions: ROSTER_DND_INSTRUCTIONS }} onDragStart={({ active }: DragStartEvent) => setActivePlayerId(String(active.data.current?.['playerId'] ?? active.id))} onDragCancel={() => setActivePlayerId(undefined)} onDragEnd={finishDrag}>
          <div className="flex flex-col gap-1">
            {rosterTargets.map((target) => <VoteGroup key={target} match={match} votes={votes.filter((vote) => voteMatchesRosterTarget(match, vote, target))} externalParticipants={externalParticipantsForRosterTarget(match, target)} target={target} onAddExternal={beginCreate} onEditExternal={beginEdit} onRemoveVote={onRemoveVote} onRemoveExternal={onRemoveExternal} disabled={disabled} />)}
            {unassignedExternalParticipants.length === 0 ? null : <section className="-mx-2 rounded-xl border border-dashed p-2" aria-label="Дополнительные игроки без указанного времени"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-medium text-muted-foreground">Доп. игроки без указанного времени</p><Badge variant="secondary">{unassignedExternalParticipants.reduce((total, participant) => total + participant.quantity, 0)}</Badge></div><div className="flex flex-col gap-2">{unassignedExternalParticipants.map((participant) => <ExternalParticipantCard key={participant.id} match={match} participant={participant} onEdit={beginEdit} onRemove={onRemoveExternal} disabled={disabled} />)}</div></section>}
          </div>
          <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>{activeVote === undefined ? null : <DraggedVotePreview vote={activeVote} />}</DragOverlay>
        </DndContext>
      </CardContent>
    </Card>
    <Sheet open={externalSheetOpen} onOpenChange={setExternalOpen}><SheetContent side="bottom" className="mx-auto w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">{editing === undefined ? 'Добавить игроков' : 'Изменить игрока'}</SheetTitle><SheetDescription>{editing === undefined ? 'Укажите источник, количество и доступность дополнительных игроков.' : 'Задайте понятное имя и доступность для этого игрока.'}</SheetDescription></SheetHeader><form aria-label={editing === undefined ? 'Форма дополнительных игроков' : 'Форма редактирования дополнительного игрока'} onSubmit={(event) => { event.preventDefault(); submit() }}><FieldGroup className="gap-4 px-4 pb-5">{editing === undefined ? <FieldGroup className="grid grid-cols-[1fr_5.5rem] gap-3"><Field><FieldLabel htmlFor={`external-source-${match.id}`}>Источник</FieldLabel><Input id={`external-source-${match.id}`} value={displayName} onChange={(event) => { setDisplayName(event.target.value); setValidation('') }} placeholder="Например, От Никиты" autoFocus /></Field><Field><FieldLabel htmlFor={`external-quantity-${match.id}`}>Кол-во</FieldLabel><Input id={`external-quantity-${match.id}`} type="number" min="1" max="50" step="1" inputMode="numeric" value={quantity} onChange={(event) => { setQuantity(event.target.value); setValidation('') }} /></Field></FieldGroup> : <Field><FieldLabel htmlFor={`external-name-${match.id}`}>Имя игрока</FieldLabel><Input id={`external-name-${match.id}`} value={displayName} onChange={(event) => { setDisplayName(event.target.value); setValidation('') }} placeholder="Например, Саша" autoFocus /></Field>}{match.timeMode === 'availability' ? <Field><FieldLabel htmlFor={`external-availability-${match.id}`}>Доступность</FieldLabel><Select value={availableAfter ?? 'unknown'} onValueChange={(value) => { setAvailableAfter(value === 'unknown' ? undefined : value); setValidation('') }}><SelectTrigger id={`external-availability-${match.id}`} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="unknown">Время не указано</SelectItem>{match.timeOptions.map((time) => <SelectItem key={time} value={time}>После {time}</SelectItem>)}</SelectGroup></SelectContent></Select></Field> : null}<FieldError>{validation}</FieldError><Button type="submit" className="h-11" disabled={disabled}>{editing === undefined ? 'Добавить игроков' : 'Сохранить изменения'}</Button></FieldGroup></form></SheetContent></Sheet>
  </>
}

function ReconciliationActions({ match, onReconcile, disabled }: Pick<MatchesPanelProps, 'onReconcile'> & { readonly match: NormalizedMatch; readonly disabled: boolean }) {
  const [messageId, setMessageId] = useState('')
  if (!match.reconciliationRequired) return null
  const validMessageId = /^[1-9]\d*$/u.test(messageId)
  return (
    <Alert variant="destructive">
      <Link2 />
      <AlertTitle>Нужно сверить карточку в Telegram</AlertTitle>
      <AlertDescription>
        <p>Проверьте General: если карточка существует, укажите её message ID. Если карточки точно нет, разрешите одну безопасную повторную публикацию.</p>
        <form aria-label="Форма сверки Telegram-карточки" className="mt-3 flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); if (!disabled && validMessageId) onReconcile(match, 'attach', messageId) }}><Input value={messageId} onChange={(event) => setMessageId(event.target.value)} inputMode="numeric" placeholder="Telegram message ID" /><Button type="submit" size="sm" disabled={disabled || !validMessageId}>Привязать карточку</Button><Button type="button" size="sm" variant="destructive" disabled={disabled} onClick={() => onReconcile(match, 'retry')}>Карточки нет — повторить публикацию</Button></form>
      </AlertDescription>
    </Alert>
  )
}

type MatchDetailTab = 'overview' | 'roster' | 'settings'

const MATCH_DETAIL_TABS: readonly { readonly value: MatchDetailTab; readonly label: string }[] = [
  { value: 'overview', label: 'Обзор' },
  { value: 'roster', label: 'Состав' },
  { value: 'settings', label: 'Настройки' },
]

function publicCardStateLabel(match: NormalizedMatch): string {
  if (match.reconciliationRequired) return 'Требуется проверка'
  if (match.publicCardState === 'published') return 'Карточка опубликована'
  if (match.publicCardState === 'deleted') return 'Карточка удалена'
  if (match.publicCardState === 'pending') return 'Публикация ожидается'
  return 'Статус карточки уточняется'
}

function venueLabel(match: NormalizedMatch): string {
  if (match.venueType === 'indoor') return 'В помещении'
  if (match.venueType === 'outdoor') return 'На улице'
  return 'Формат не указан'
}

function OverviewRow({ icon: Icon, title, description, onClick }: {
  readonly icon: typeof Users
  readonly title: string
  readonly description: string
  readonly onClick: () => void
}) {
  return (
    <button type="button" className="flex min-h-18 w-full items-center gap-3 border-b px-1 py-3 text-left last:border-b-0" onClick={onClick}>
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-5" /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span></span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
    </button>
  )
}

export function availabilityCountAt(match: NormalizedMatch, time: string): number {
  const votes = match.roster.votes.filter((vote) => vote.option === 'going' && (
    match.timeMode === 'exact_options'
      ? vote.exactTimes.includes(time) || (vote.exactTimes.length === 0 && vote.availableAfter === time)
      : vote.availableAfter === undefined || vote.availableAfter <= time
  )).length
  const external = match.roster.externalParticipants
    .filter((participant) => match.timeMode !== 'availability' || (participant.availableAfter !== undefined && participant.availableAfter <= time))
    .reduce((total, participant) => total + participant.quantity, 0)
  return votes + external
}

function AvailabilitySummary({ match }: { readonly match: NormalizedMatch }) {
  if (match.timeMode === 'exact' || match.selectedTime !== undefined) return null
  return <Card size="sm"><CardHeader><CardTitle>Доступность по времени</CardTitle><CardDescription>{match.timeMode === 'availability' ? 'Сколько игроков смогут участвовать к каждому времени.' : 'Сколько игроков выбрали каждый точный вариант.'}</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">{match.timeOptions.map((time) => { const count = availabilityCountAt(match, time); return <div key={time} className="flex items-center gap-3"><span className="w-14 text-sm font-medium">{match.timeMode === 'availability' ? `К ${time}` : time}</span><Progress value={Math.min(100, (count / match.requiredPlayers) * 100)} className={cn('h-1.5 flex-1', count >= match.requiredPlayers && '[&_[data-slot=progress-indicator]]:bg-success')} /><Badge variant={match.selectedTime === time ? 'default' : 'secondary'}>{count}/{match.requiredPlayers}</Badge></div> })}</CardContent></Card>
}

function MatchOverview({ match, onNavigate, onPublish, onFinalizeRequest, onConfirm, onComplete, onSendWeather, onCancelRequest, disabled }: {
  readonly match: NormalizedMatch
  readonly onNavigate: (tab: MatchDetailTab) => void
  readonly onPublish: MatchesPanelProps['onPublish']
  readonly onFinalizeRequest: () => void
  readonly onConfirm: MatchesPanelProps['onConfirm']
  readonly onComplete: MatchesPanelProps['onComplete']
  readonly onSendWeather: MatchesPanelProps['onSendWeather']
  readonly onCancelRequest: () => void
  readonly disabled: boolean
}) {
  const remaining = Math.max(0, match.requiredPlayers - match.goingCount)
  const canSendWeather = (match.status === 'active' || match.status === 'confirmed')
    && match.venueType === 'outdoor'
    && match.date !== ''
    && match.time !== ''
  const primaryAction = match.status === 'draft'
    ? { label: 'Опубликовать матч', copy: 'Черновик готов к публикации', run: () => onPublish(match), icon: Send }
    : match.status === 'active'
      ? match.planningStage === 'finalizing_details'
        ? { label: 'Уточнить время и место', copy: 'Состав набран — забронируйте поле и укажите итоговые детали', run: onFinalizeRequest, icon: MapPin }
        : match.planningStage === 'ready_to_confirm'
          ? { label: 'Подтвердить матч', copy: 'Время, место и минимальный состав определены', run: () => onConfirm(match), icon: CheckCircle2 }
          : { label: 'Посмотреть состав', copy: remaining === 0 ? 'Следите за актуальным составом' : `Нужно ещё ${remaining} ${plural(remaining, 'игрок', 'игрока', 'игроков')}`, run: () => onNavigate('roster'), icon: Users }
      : match.status === 'confirmed'
        ? { label: 'Завершить матч', copy: 'Состав подтверждён', run: () => onComplete(match), icon: Trophy }
        : undefined

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="match-summary"><h2 id="match-summary" className="text-lg font-semibold">Сводка</h2><div className="mt-2">
        <OverviewRow icon={Users} title="Участники" description={`${match.goingCount} идут · ${remaining} осталось`} onClick={() => onNavigate('roster')} />
        <OverviewRow icon={CalendarDays} title="Параметры" description={`${match.dateLabel} · ${match.location}`} onClick={() => onNavigate('settings')} />
      </div></section>
      <AvailabilitySummary match={match} />
      {primaryAction && <section aria-labelledby="next-match-action"><h2 id="next-match-action" className="text-lg font-semibold">Ближайшее действие</h2><p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="size-4 text-primary" />{primaryAction.copy}</p><div className="mt-4 flex flex-col gap-2"><Button className="h-11 w-full" onClick={primaryAction.run} disabled={disabled}><primaryAction.icon data-icon="inline-start" />{primaryAction.label}</Button>{canSendWeather && <Button variant="outline" className="h-11 w-full" onClick={() => onSendWeather(match)} disabled={disabled}><CloudSun data-icon="inline-start" />Отправить погоду сейчас</Button>}{(match.status === 'active' || match.status === 'confirmed') && <Button variant="destructive" className="h-11 w-full" onClick={onCancelRequest} disabled={disabled}><XCircle data-icon="inline-start" />Отменить матч</Button>}</div></section>}
    </div>
  )
}

export function MatchSettings({ match, openEdit, onReconcile, disabled }: {
  readonly match: NormalizedMatch
  readonly openEdit: () => void
  readonly onReconcile: MatchesPanelProps['onReconcile']
  readonly disabled: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      <ReconciliationActions match={match} onReconcile={onReconcile} disabled={disabled} />
      <Card size="sm"><CardHeader><CardTitle>Параметры матча</CardTitle><CardAction><Button variant="ghost" size="icon" onClick={openEdit} aria-label="Редактировать параметры матча"><Pencil /></Button></CardAction></CardHeader><CardContent className="flex flex-col gap-3 text-sm"><p className="flex justify-between gap-4"><span className="text-muted-foreground">Дата и время</span><span className="text-right">{match.dateLabel}</span></p><Separator /><p className="flex justify-between gap-4"><span className="text-muted-foreground">Место</span><span className="text-right">{match.location}</span></p><Separator /><p className="flex justify-between gap-4"><span className="text-muted-foreground">Формат</span><span className="text-right">{venueLabel(match)}</span></p><Separator /><p className="flex justify-between gap-4"><span className="text-muted-foreground">Нужно игроков</span><span>{match.requiredPlayers}</span></p><Separator /><p className="flex justify-between gap-4"><span className="text-muted-foreground">Стоимость поля</span><span>{match.fieldPriceByn === undefined ? 'Не указана' : `${match.fieldPriceByn} руб.`}</span></p></CardContent></Card>
    </div>
  )
}

export function MatchesPanel(props: MatchesPanelProps) {
  const { matches, selected, onSelect, onCreate, onPatch, conflict, onClearConflict, saving } = props
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<MatchDetailTab>('overview')
  const [cancelSheetOpen, setCancelSheetOpen] = useState(false)
  const [finalizationSheetOpen, setFinalizationSheetOpen] = useState(false)
  const [finalizationValues, setFinalizationValues] = useState<FinalMatchDetailsValues>({ time: '', location: '', venueType: '', fieldPriceRubles: '' })
  const [finalizationValidation, setFinalizationValidation] = useState<FinalMatchDetailsValidation>({})
  const [cancellationReasonOption, setCancellationReasonOption] = useState<CancellationReasonOption>()
  const [cancellationOtherReason, setCancellationOtherReason] = useState('')
  const [cancellationValidation, setCancellationValidation] = useState('')
  const editorSheetRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const editingMatch = selected?.id === editingMatchId ? selected : matches.find((match) => match.id === editingMatchId)
  const openCreate = () => { setEditingMatchId(null); setEditorOpen(true) }
  const openEdit = () => { if (selected) { setEditingMatchId(selected.id); setEditorOpen(true) } }
  const openMatch = (id: string) => { setDetailTab('overview'); onSelect(id) }
  const closeMatch = () => { setDetailTab('overview'); setCancelSheetOpen(false); setFinalizationSheetOpen(false); onSelect(undefined) }
  const resetCancellation = () => { setCancellationReasonOption(undefined); setCancellationOtherReason(''); setCancellationValidation('') }
  const openCancellation = () => { resetCancellation(); setCancelSheetOpen(true) }
  const openFinalization = () => {
    if (selected === undefined) return
    const firstSuitable = selected.timeOptions.find((time) => availabilityCountAt(selected, time) >= selected.requiredPlayers)
    setFinalizationValues({
      time: selected.time || firstSuitable || selected.timeOptions.at(-1) || '',
      location: selected.location === 'Место уточняется' ? '' : selected.location,
      venueType: selected.venueType ?? '',
      fieldPriceRubles: selected.fieldPriceByn?.toString() ?? '',
    })
    setFinalizationValidation({})
    setFinalizationSheetOpen(true)
  }
  const setCancellationOpen = (open: boolean) => {
    setCancelSheetOpen(open)
    if (!open) resetCancellation()
  }
  const submitCancellation = () => {
    if (selected === undefined) return
    const validation = validateCancellationReason(cancellationReasonOption, cancellationOtherReason)
    if (validation !== undefined) { setCancellationValidation(validation); return }
    props.onCancel(selected, cancellationReasonText(cancellationReasonOption, cancellationOtherReason))
    setCancellationOpen(false)
  }
  const submitFinalization = () => {
    if (selected === undefined) return
    const validation = validateFinalMatchDetails(selected, finalizationValues)
    if (Object.keys(validation).length > 0) { setFinalizationValidation(validation); return }
    void props.onFinalize(selected, {
      ...finalizationValues,
      location: finalizationValues.location.trim(),
      fieldPriceRubles: String(Number(finalizationValues.fieldPriceRubles)),
    }).then(() => setFinalizationSheetOpen(false)).catch(() => undefined)
  }

  return (
    <section className="flex flex-col gap-5">
      {selected === undefined ? <>
        <div className="flex items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">Матчи</h1><p className="mt-1 text-sm text-muted-foreground">{matches.length === 0 ? 'Запланируйте следующую игру' : `${matches.length} ${plural(matches.length, 'предстоящий матч', 'предстоящих матча', 'предстоящих матчей')}`}</p></div><Button className="h-10 px-3" onClick={openCreate}><Plus data-icon="inline-start" /> Новый матч</Button></div>
        {matches.length === 0 ? <EmptyState icon={CalendarDays} title="Матчей пока нет" /> : <div className="flex flex-col gap-2" aria-label="Предстоящие матчи">{matches.map((match, index) => <motion.div key={match.id} layout initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduceMotion ? 0 : index * 0.025, duration: 0.18 }}><Card size="sm" className="py-0"><button type="button" className="w-full p-3 text-left" onClick={() => openMatch(match.id)}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="mb-2 flex items-center gap-2">{statusBadge(match)}<span className="truncate text-xs text-muted-foreground">#{match.id}</span></div><h2 className="truncate text-[15px] font-medium text-foreground">{match.title}</h2><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />{match.dateLabel}</span><span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" />{match.location}</span></div></div><div className="flex shrink-0 items-center gap-2 text-xs font-medium"><Users className="size-4 text-muted-foreground" />{match.goingCount}/{match.requiredPlayers}<ChevronRight className="size-4 text-muted-foreground" /></div></div></button></Card></motion.div>)}</div>}
      </> : <motion.div key={selected.id} initial={reduceMotion ? false : { opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }}>
        <div className="relative flex min-h-12 items-center justify-center"><Button variant="ghost" size="icon" className="absolute left-0" onClick={closeMatch} aria-label="Вернуться к списку матчей"><ArrowLeft /></Button><div className="text-center"><h1 className="text-xl font-semibold">Матч #{selected.id}</h1><p className={cn('mt-0.5 text-xs', selected.status === 'cancelled' ? 'text-destructive' : selected.status === 'confirmed' || selected.status === 'completed' || selected.planningStage === 'ready_to_confirm' ? 'text-success' : 'text-muted-foreground')}>{selected.statusLabel}</p></div></div>
        <div className="mt-5 flex flex-col gap-3 text-sm"><p className={cn('flex items-center gap-3', selected.reconciliationRequired ? 'text-destructive' : selected.publicCardState === 'published' ? 'text-success' : 'text-muted-foreground')}><Send className="size-5" />{publicCardStateLabel(selected)}</p><p className="flex items-center gap-3"><CalendarDays className="size-5 text-muted-foreground" />{selected.dateLabel}</p><p className="flex items-center gap-3"><MapPin className="size-5 text-muted-foreground" />{selected.location} · {venueLabel(selected)}</p><div><p className="mb-2 flex items-center gap-3"><Users className="size-5 text-muted-foreground" /><span>{selected.goingCount} из {selected.requiredPlayers} игроков</span></p><Progress value={Math.min(100, (selected.goingCount / selected.requiredPlayers) * 100)} className={cn('ml-8 h-1.5 w-[calc(100%-2rem)]', selected.goingCount >= selected.requiredPlayers && '[&_[data-slot=progress-indicator]]:bg-success')} /></div></div>
        <ToggleGroup type="single" value={detailTab} onValueChange={(value) => { if (value !== '') setDetailTab(value as MatchDetailTab) }} variant="segment" spacing={1} className="mt-5 w-full rounded-xl border bg-muted p-1" aria-label="Разделы матча">{MATCH_DETAIL_TABS.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="h-10 flex-1 rounded-lg">{item.label}</ToggleGroupItem>)}</ToggleGroup>
        <motion.div key={detailTab} className="mt-6" initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}>{detailTab === 'overview' ? <MatchOverview match={selected} onNavigate={setDetailTab} onPublish={props.onPublish} onFinalizeRequest={openFinalization} onConfirm={props.onConfirm} onComplete={props.onComplete} onSendWeather={props.onSendWeather} onCancelRequest={openCancellation} disabled={props.actionPending} /> : detailTab === 'roster' ? (selected.status === 'active' || selected.status === 'confirmed' ? <MatchRoster match={selected} onCorrectVote={props.onCorrectVote} onRemoveVote={props.onRemoveVote} onAddExternal={props.onAddExternal} onUpdateExternal={props.onUpdateExternal} onRemoveExternal={props.onRemoveExternal} disabled={props.actionPending} /> : <EmptyState icon={Users} title="Состав пока недоступен" copy="Опубликуйте матч, чтобы участники могли проголосовать." />) : <MatchSettings match={selected} openEdit={openEdit} onReconcile={props.onReconcile} disabled={props.actionPending} />}</motion.div>
      </motion.div>}

      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent
          ref={editorSheetRef}
          side="bottom"
          className="mx-auto max-h-[92svh] w-full max-w-[480px] gap-0 rounded-t-2xl p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            editorSheetRef.current?.querySelector<HTMLButtonElement>('[data-slot="sheet-close"]')?.focus()
          }}
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" />
          <SheetHeader className="px-4 pt-3 pb-4">
            <SheetTitle className="text-lg">{editingMatch ? 'Редактировать матч' : 'Новый матч'}</SheetTitle>
            <SheetDescription>{editingMatch ? 'Обновите данные матча.' : 'Заполните детали — матч сразу появится в Telegram.'}</SheetDescription>
          </SheetHeader>
          <MatchEditor key={editingMatch?.id ?? 'new'} match={editingMatch} onSave={(values) => {
            if (editingMatch) { onPatch(editingMatch, values); setEditorOpen(false); return }
            void onCreate(values).then(() => setEditorOpen(false)).catch(() => undefined)
          }} conflict={conflict} onClearConflict={onClearConflict} saving={saving} />
        </SheetContent>
      </Sheet>
      <Sheet open={cancelSheetOpen} onOpenChange={setCancellationOpen}><SheetContent side="bottom" className="mx-auto w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">Отменить матч</SheetTitle><SheetDescription>Укажите причину — она появится в карточке Telegram и истории.</SheetDescription></SheetHeader><form aria-label="Форма отмены матча" onSubmit={(event) => { event.preventDefault(); submitCancellation() }}><FieldGroup className="gap-3 px-4 pb-5"><CancellationReasonFields option={cancellationReasonOption} otherReason={cancellationOtherReason} validation={cancellationValidation} onOptionChange={(option) => { setCancellationReasonOption(option); setCancellationValidation('') }} onOtherReasonChange={(reason) => { setCancellationOtherReason(reason); setCancellationValidation('') }} matchId={selected?.id ?? 'match'} /><Button type="submit" variant="destructive" className="h-11" disabled={props.actionPending}><XCircle data-icon="inline-start" />Отменить матч</Button></FieldGroup></form></SheetContent></Sheet>
      <Sheet open={finalizationSheetOpen} onOpenChange={setFinalizationSheetOpen}>
        <SheetContent side="bottom" className="mx-auto max-h-[92svh] w-full max-w-[480px] gap-0 overflow-y-auto rounded-t-2xl p-0">
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" />
          <SheetHeader className="px-4 pt-3 pb-4">
            <SheetTitle className="text-lg">Уточнить время и место</SheetTitle>
            <SheetDescription>После сохранения карточка обновится, а в чат уйдёт итоговое сообщение.</SheetDescription>
          </SheetHeader>
          <form aria-label="Форма итоговых параметров матча" onSubmit={(event) => { event.preventDefault(); submitFinalization() }}>
            <FieldGroup className="gap-3 px-4 pb-5">
              <Field data-invalid={finalizationValidation.time !== undefined || undefined}>
                <FieldLabel htmlFor="final-match-time">Точное время</FieldLabel>
                <Input
                  id="final-match-time"
                  type="time"
                  value={finalizationValues.time}
                  onChange={(event) => {
                    setFinalizationValues((values) => ({ ...values, time: event.target.value }))
                    setFinalizationValidation({})
                  }}
                  aria-invalid={finalizationValidation.time !== undefined || undefined}
                  required
                />
                {selected !== undefined && selected.timeMode !== 'exact' && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(finalizationValues.time)
                  ? <FieldDescription className={availabilityCountAt(selected, finalizationValues.time) >= selected.requiredPlayers ? 'text-success' : 'text-destructive'}>{selected.timeMode === 'availability' ? `К ${finalizationValues.time} смогут` : `${finalizationValues.time} выбрали`} {availabilityCountAt(selected, finalizationValues.time)} из {selected.requiredPlayers} игроков</FieldDescription>
                  : null}
                <FieldError>{finalizationValidation.time}</FieldError>
              </Field>
              <Field data-invalid={finalizationValidation.location !== undefined || undefined}>
                <FieldLabel htmlFor="final-match-location">Место</FieldLabel>
                <Input
                  id="final-match-location"
                  value={finalizationValues.location}
                  onChange={(event) => {
                    setFinalizationValues((values) => ({ ...values, location: event.target.value }))
                    setFinalizationValidation({})
                  }}
                  placeholder="Например, BOX365"
                  aria-invalid={finalizationValidation.location !== undefined || undefined}
                  required
                />
                <FieldError>{finalizationValidation.location}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor="final-match-venue">Формат поля</FieldLabel>
                <Select value={finalizationValues.venueType} onValueChange={(value) => setFinalizationValues((values) => ({ ...values, venueType: value as FinalMatchDetailsValues['venueType'] }))}>
                  <SelectTrigger id="final-match-venue" className="w-full"><SelectValue placeholder="Выберите формат" /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="outdoor">На улице</SelectItem>
                      <SelectItem value="indoor">В помещении</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field data-invalid={finalizationValidation.fieldPriceRubles !== undefined || undefined}>
                <FieldLabel htmlFor="final-match-price">Стоимость поля, руб.</FieldLabel>
                <Input
                  id="final-match-price"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={finalizationValues.fieldPriceRubles}
                  onChange={(event) => {
                    setFinalizationValues((values) => ({ ...values, fieldPriceRubles: event.target.value }))
                    setFinalizationValidation({})
                  }}
                  placeholder="Например, 120"
                  aria-invalid={finalizationValidation.fieldPriceRubles !== undefined || undefined}
                  required
                />
                <FieldError>{finalizationValidation.fieldPriceRubles}</FieldError>
              </Field>
              <Button type="submit" className="h-11" disabled={props.actionPending}>
                <CheckCircle2 data-icon="inline-start" />
                Сохранить и подтвердить
              </Button>
            </FieldGroup>
          </form>
        </SheetContent>
      </Sheet>
    </section>
  )
}

interface PlayersPanelProps {
  readonly players: readonly NormalizedPlayer[]
  readonly onUpdatePlayer: (player: NormalizedPlayer, displayName: string) => void
  readonly saving: boolean
}

export function validatePlayerPseudonym(displayName: string): string | undefined {
  return displayName.trim() === '' ? 'Укажите понятное имя игрока.' : undefined
}

export function PlayersPanel({ players, onUpdatePlayer, saving }: PlayersPanelProps) {
  const [search, setSearch] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | undefined>()
  const [displayName, setDisplayName] = useState('')
  const [validation, setValidation] = useState('')
  const confirmedPlayers = useMemo(() => players.filter((player) => player.confirmed), [players])
  const selectedPlayer = confirmedPlayers.find((player) => player.id === selectedPlayerId)
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return query === '' ? confirmedPlayers : confirmedPlayers.filter((player) => `${player.displayName} ${player.username ?? ''}`.toLowerCase().includes(query))
  }, [confirmedPlayers, search])
  const openPseudonym = (player: NormalizedPlayer) => { setSelectedPlayerId(player.id); setDisplayName(player.displayName); setValidation(''); setSheetOpen(true) }
  const submitPseudonym = () => {
    if (selectedPlayer === undefined) return
    const formValidation = validatePlayerPseudonym(displayName)
    if (formValidation !== undefined) { setValidation(formValidation); return }
    onUpdatePlayer(selectedPlayer, displayName.trim())
    setSheetOpen(false)
  }

  return (
    <section className="flex flex-col gap-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">Игроки</h1><p className="mt-1 text-sm text-muted-foreground">Задавайте понятные имена участникам голосований</p></div>
      <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 pl-9" placeholder="Найти игрока" aria-label="Поиск игроков" /></div>
      {filtered.length === 0 ? <EmptyState icon={Users} title={confirmedPlayers.length === 0 ? 'Игроков пока нет' : 'Игроки не найдены'} copy={confirmedPlayers.length === 0 ? 'Игроки появятся здесь после первого голоса.' : 'Попробуйте другое имя или username.'} /> : <Card className="gap-0 py-0">{filtered.map((player, index) => <div key={player.id}><button type="button" className="flex w-full items-center gap-3 p-3.5 text-left" onClick={() => openPseudonym(player)} aria-label={`Добавить псевдоним ${player.displayName}`}><PlayerAvatar playerId={player.id} displayName={player.displayName} avatarUrl={player.avatarUrl} size="lg" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{player.displayName}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{player.username === undefined ? 'Без username' : `@${player.username.replace(/^@/u, '')}`}</p></div><span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary"><Pencil className="size-3.5" />Псевдоним</span></button>{index < filtered.length - 1 && <Separator className="ml-16 w-[calc(100%-4rem)]" />}</div>)}</Card>}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}><SheetContent side="bottom" className="mx-auto w-full max-w-[480px] gap-0 rounded-t-2xl p-0"><div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" /><SheetHeader className="px-4 pt-3 pb-4"><SheetTitle className="text-lg">Псевдоним игрока</SheetTitle><SheetDescription>{selectedPlayer?.username === undefined ? 'Это имя будет отображаться в голосованиях и карточках.' : `@${selectedPlayer.username.replace(/^@/u, '')} · это имя будет отображаться в голосованиях и карточках.`}</SheetDescription></SheetHeader><form aria-label="Форма псевдонима игрока" onSubmit={(event) => { event.preventDefault(); submitPseudonym() }}><FieldGroup className="gap-3 px-4 pb-5"><Field><FieldLabel htmlFor="player-pseudonym">Понятное имя</FieldLabel><Input id="player-pseudonym" value={displayName} onChange={(event) => { setDisplayName(event.target.value); setValidation('') }} placeholder="Например, Никита" autoFocus /></Field><FieldError>{validation}</FieldError><Button type="submit" className="h-11" disabled={saving || selectedPlayer === undefined || displayName.trim() === selectedPlayer.displayName}>Сохранить псевдоним</Button></FieldGroup></form></SheetContent></Sheet>
    </section>
  )
}

export function HistoryPanel({ history }: { readonly history: readonly NormalizedMatch[] }) {
  return <section className="flex flex-col gap-5"><div className="flex items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">История</h1><p className="mt-1 text-sm text-muted-foreground">Завершённые и отменённые матчи</p></div><Badge variant="secondary">За всё время</Badge></div>{history.length === 0 ? <EmptyState icon={Trophy} title="Завершённых матчей нет" copy="Завершённые и отменённые игры будут храниться здесь." /> : <div className="flex flex-col gap-2">{history.map((match) => <Card key={match.id} size="sm"><CardHeader><div className="mb-1">{statusBadge(match)}</div><CardTitle>{match.title}</CardTitle><CardDescription className="flex items-center gap-1.5"><Clock3 className="size-3.5" />{match.dateLabel} · {match.location}</CardDescription><CardAction><span className="text-lg font-semibold">{match.goingCount}/{match.requiredPlayers}</span></CardAction></CardHeader><CardContent className="flex flex-col gap-2"><p className="text-xs font-medium text-muted-foreground">Финальный состав</p>{(['going', 'maybe', 'not_going'] as const).map((option) => { const names = match.roster.votes.filter((vote) => vote.option === option).map((vote) => vote.readableName); return <p key={option} className="text-sm"><span className="text-muted-foreground">{VOTE_LABELS[option]}:</span> {names.join(', ') || '—'}</p> })}<p className="text-sm"><span className="text-muted-foreground">Доп. участники:</span> {match.roster.externalParticipants.map((participant) => participant.displayName).join(', ') || '—'}</p>{match.cancellationReason ? <Alert variant="destructive" className="mt-1"><XCircle /><AlertTitle>Причина отмены</AlertTitle><AlertDescription>{match.cancellationReason}</AlertDescription></Alert> : null}</CardContent></Card>)}</div>}</section>
}

export function ReconciliationNotice() {
  return <Alert><CircleDot /><AlertTitle>Telegram — источник актуальных данных</AlertTitle><AlertDescription>Состав и состояние публикации синхронизируются с группой.</AlertDescription></Alert>
}
