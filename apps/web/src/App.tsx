import { useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { RotateCw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import {
  getErrorCode,
  getErrorStatus,
  getGetOwnerBootstrapQueryKey,
  getGetOwnerMatchQueryKey,
  getListOwnerMatchesQueryKey,
  getListOwnerPlayersQueryKey,
  useCancelOwnerMatch,
  useCompleteOwnerMatch,
  useConfirmOwnerMatch,
  useCorrectOwnerMatchVote,
  useCreateOwnerExternalParticipant,
  useCreateOwnerMatch,
  useFinalizeOwnerMatch,
  useGetOwnerBootstrap,
  useGetOwnerMatch,
  useListOwnerMatches,
  useListOwnerPlayers,
  usePatchOwnerMatch,
  usePublishOwnerMatch,
  useReconcileOwnerMatchCard,
  useRemoveOwnerExternalParticipant,
  useRemoveOwnerMatchVote,
  useUpdateOwnerExternalParticipant,
  useUpdateOwnerPlayerReadableName,
  type MatchCreateDto,
  type PatchMatchDto,
} from '@football/api-client'

import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { MatchesPanel, PlayersPanel, HistoryPanel, type FinalMatchDetailsValues } from '@/components/football/panels'
import { TabBar, type Tab } from '@/components/football/navigation'
import { StateScreen } from '@/components/football/state-screen'
import { ThemeToggle } from '@/components/football/theme-toggle'
import { applicationBrand } from '@/brand'
import type { EditorValues } from '@/components/football/match-editor'
import {
  normalizeDashboard,
  normalizeMatchEnvelope,
  type NormalizedExternalParticipant,
  type NormalizedMatch,
  type NormalizedPlayer,
  type NormalizedVote,
  type NormalizedVoteOption,
  type NormalizedRosterTarget,
} from './normalize'
import { useTelegramWebApp, type TelegramSession } from './telegram'

interface AppProps { readonly telegramSession?: TelegramSession }
type AuthFailure = 'unauthorized' | 'expired' | undefined

function requestKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `football-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function errorMessage(error: unknown): string {
  const code = getErrorCode(error)
  if (code === 'MATCH_TIME_MODE_HAS_VOTES') return 'Нельзя менять способ выбора времени после появления голосов.'
  if (code === 'MATCH_TIME_OPTION_HAS_VOTES') return 'Нельзя удалить вариант времени, за который уже проголосовали.'
  if (code === 'MATCH_CONFIRMED_TIME_LOCKED') return 'После подтверждения нельзя менять режим и варианты времени.'
  if (code === 'MATCH_NOT_READY_FOR_CONFIRMATION') return 'Сначала определите время, наберите минимум игроков и укажите место.'
  if (code === 'MATCH_PLAYER_THRESHOLD_NOT_REACHED') return 'Сначала наберите минимальный состав.'
  if (code === 'MATCH_FINAL_TIME_BELOW_THRESHOLD') return 'К этому времени смогут прийти недостаточно игроков.'
  if (code === 'MATCH_FINAL_TIME_BEFORE_AVAILABILITY') return 'Точное время не может быть раньше вариантов доступности.'
  if (code === 'MATCH_TIME_INVALID') return 'Укажите корректное время матча.'
  return 'Не удалось выполнить запрос. Попробуйте ещё раз.'
}

function authFailureFor(error: unknown): AuthFailure {
  if (getErrorCode(error) === 'TELEGRAM_INIT_DATA_EXPIRED') return 'expired'
  const status = getErrorStatus(error)
  return status === 401 || status === 403 ? 'unauthorized' : undefined
}

export function App({ telegramSession }: AppProps = {}) {
  const detectedSession = useTelegramWebApp()
  const session = telegramSession ?? detectedSession
  const queryClient = useQueryClient()
  const reduceMotion = useReducedMotion()
  const [tab, setTab] = useState<Tab>('matches')
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [conflict, setConflict] = useState('')
  const [authFailure, setAuthFailure] = useState<AuthFailure>()

  const invalidateDashboard = (matchId?: string) => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetOwnerBootstrapQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListOwnerMatchesQueryKey({ limit: 100 }) }),
      queryClient.invalidateQueries({ queryKey: getListOwnerPlayersQueryKey({ limit: 100 }) }),
      ...(matchId === undefined ? [] : [queryClient.invalidateQueries({ queryKey: getGetOwnerMatchQueryKey(matchId) })]),
    ])
  }
  const handleMutationError = (error: unknown) => {
    const auth = authFailureFor(error)
    if (auth !== undefined) { setAuthFailure(auth); return }
    if (getErrorStatus(error) === 409 && getErrorCode(error) === 'MATCH_VERSION_STALE') { setConflict('Матч уже изменился на сервере. Обновите данные и повторите попытку.'); return }
    toast.error(errorMessage(error))
  }
  const mutationOptions = { mutation: { onError: handleMutationError } }

  const queryEnabled = session.status === 'ready' && session.initData !== undefined && authFailure === undefined
  const bootstrapQuery = useGetOwnerBootstrap({ query: { enabled: queryEnabled } })
  const matchesQuery = useListOwnerMatches({ limit: 100 }, { query: { enabled: queryEnabled } })
  const playersQuery = useListOwnerPlayers({ limit: 100 }, { query: { enabled: queryEnabled } })
  const dashboard = useMemo(() => normalizeDashboard(bootstrapQuery.data, matchesQuery.data, playersQuery.data), [bootstrapQuery.data, matchesQuery.data, playersQuery.data])
  const upcoming = dashboard.matches.filter((match) => match.status !== 'completed' && match.status !== 'cancelled')
  const selectedSummary = upcoming.find((match) => match.id === selectedId)
  const effectiveSelectedId = selectedId
  const matchQuery = useGetOwnerMatch(effectiveSelectedId ?? '', { query: { enabled: queryEnabled && effectiveSelectedId !== undefined } })
  const selected = effectiveSelectedId === undefined ? undefined : normalizeMatchEnvelope(matchQuery.data) ?? selectedSummary

  const patchMutation = usePatchOwnerMatch(mutationOptions)
  const createMutation = useCreateOwnerMatch(mutationOptions)
  const publishMutation = usePublishOwnerMatch(mutationOptions)
  const finalizeMutation = useFinalizeOwnerMatch(mutationOptions)
  const confirmMutation = useConfirmOwnerMatch(mutationOptions)
  const completeMutation = useCompleteOwnerMatch(mutationOptions)
  const cancelMutation = useCancelOwnerMatch(mutationOptions)
  const reconcileMutation = useReconcileOwnerMatchCard(mutationOptions)
  const correctVoteMutation = useCorrectOwnerMatchVote(mutationOptions)
  const removeVoteMutation = useRemoveOwnerMatchVote(mutationOptions)
  const createExternalMutation = useCreateOwnerExternalParticipant(mutationOptions)
  const updateExternalMutation = useUpdateOwnerExternalParticipant(mutationOptions)
  const removeExternalMutation = useRemoveOwnerExternalParticipant(mutationOptions)
  const updatePlayerMutation = useUpdateOwnerPlayerReadableName(mutationOptions)

  const queryErrors = [bootstrapQuery.error, matchesQuery.error, playersQuery.error, matchQuery.error]
  const queryAuthFailure = queryErrors.map(authFailureFor).find((value) => value !== undefined)
  const effectiveAuthFailure = authFailure ?? queryAuthFailure

  if (session.status === 'loading') return <StateScreen kind="loading" title="Подготавливаем команду" copy="Подключаемся к Telegram…" />
  if (session.status === 'outside-telegram') return <StateScreen kind="outside" title="Откройте приложение в Telegram" copy="Это закрытое мини-приложение. Запустите его из бота Telegram, чтобы продолжить." />
  if (session.status === 'unauthorized' || effectiveAuthFailure === 'unauthorized') return <StateScreen kind="unauthorized" title="Нужен доступ владельца" copy="У этого аккаунта Telegram нет прав на управление командой." action={<Button onClick={() => window.location.reload()}><RotateCw data-icon="inline-start" /> Перезагрузить</Button>} />
  if (effectiveAuthFailure === 'expired') return <StateScreen kind="unauthorized" title="Сессия Telegram истекла" copy="Закройте это окно и заново откройте Mini App из Telegram, чтобы получить свежую подписанную сессию." />
  if (session.status === 'error') return <StateScreen kind="error" title="Не удалось запустить Telegram" copy={session.reason ?? 'Telegram не смог запустить мини-приложение.'} />

  const queryLoading = [bootstrapQuery, matchesQuery, playersQuery].some((query) => query.isPending && query.data === undefined)
  if (queryLoading) return <StateScreen kind="loading" title="Загружаем команду" copy="Получаем актуальные матчи и состав…" />
  const queryError = queryErrors.find((error) => error !== null && error !== undefined)
  if (queryError !== undefined) return <StateScreen kind="error" title="Не удалось загрузить команду" copy={errorMessage(queryError)} action={<Button variant="secondary" onClick={() => { void queryClient.refetchQueries({ type: 'active' }) }}><RotateCw data-icon="inline-start" /> Повторить</Button>} />

  const versionedHeaders = (match: NormalizedMatch) => ({ 'If-Match': String(match.version), 'Idempotency-Key': requestKey() })
  const finishMutation = (matchId?: string) => { invalidateDashboard(matchId); setConflict('') }

  const handleCreate = async (values: EditorValues) => {
    const data: MatchCreateDto = { date: values.date, time: values.timeMode === 'exact' ? values.time : null, timeMode: values.timeMode, ...(values.timeMode === 'availability' ? { timeOptions: [...values.timeOptions] } : {}), location: values.location || null, venueType: values.venueType || null, requiredPlayers: values.requiredPlayers, fieldPriceRubles: values.fieldPriceByn.trim() === '' ? null : Number(values.fieldPriceByn) }
    const response = await createMutation.mutateAsync({ data, headers: { 'Idempotency-Key': requestKey() } })
    finishMutation(response.match.id)
  }
  const handlePatch = (match: NormalizedMatch, values: EditorValues) => {
    const data: PatchMatchDto = { date: values.date || null, time: values.timeMode === 'exact' ? values.time : null, timeMode: values.timeMode, ...(values.timeMode === 'availability' ? { timeOptions: [...values.timeOptions] } : {}), location: values.location || null, venueType: values.venueType || null, requiredPlayers: values.requiredPlayers, fieldPriceRubles: values.fieldPriceByn.trim() === '' ? null : Number(values.fieldPriceByn) }
    patchMutation.mutate({ id: match.id, data, headers: versionedHeaders(match) }, { onSuccess: () => finishMutation(match.id) })
  }
  const handlePublish = (match: NormalizedMatch) => publishMutation.mutate({ id: match.id, headers: versionedHeaders(match) }, { onSuccess: () => finishMutation(match.id) })
  const handleFinalize = async (match: NormalizedMatch, values: FinalMatchDetailsValues) => {
    const data = {
      time: values.time,
      location: values.location,
      fieldPriceRubles: Number(values.fieldPriceRubles),
      ...(values.venueType === '' ? {} : { venueType: values.venueType }),
    }
    await finalizeMutation.mutateAsync({ id: match.id, data, headers: versionedHeaders(match) })
    finishMutation(match.id)
  }
  const handleConfirm = (match: NormalizedMatch) => confirmMutation.mutate({ id: match.id, headers: versionedHeaders(match) }, { onSuccess: () => finishMutation(match.id) })
  const handleComplete = (match: NormalizedMatch) => completeMutation.mutate({ id: match.id, headers: versionedHeaders(match) }, { onSuccess: () => finishMutation(match.id) })
  const handleCancel = (match: NormalizedMatch, cancellationReason: string) => cancelMutation.mutate({ id: match.id, data: { cancellationReason }, headers: versionedHeaders(match) }, { onSuccess: () => finishMutation(match.id) })
  const handleCorrectVote = async (match: NormalizedMatch, vote: NormalizedVote, target: NormalizedRosterTarget) => {
    const option: NormalizedVoteOption = target.startsWith('after:') ? 'going' : target as NormalizedVoteOption
    const availableAfter = target.startsWith('after:') ? target.slice('after:'.length) : null
    await correctVoteMutation.mutateAsync({ id: match.id, data: { playerId: vote.playerId, option, availableAfter }, headers: { 'Idempotency-Key': requestKey() } })
    finishMutation(match.id)
  }
  const handleRemoveVote = (match: NormalizedMatch, vote: NormalizedVote) => removeVoteMutation.mutate({ id: match.id, playerId: vote.playerId, headers: { 'Idempotency-Key': requestKey() } }, { onSuccess: () => finishMutation(match.id) })
  const handleAddExternal = (match: NormalizedMatch, values: { readonly displayName?: string; readonly quantity: number }) => createExternalMutation.mutate({ id: match.id, data: { quantity: values.quantity, displayName: values.displayName ?? null }, headers: { 'Idempotency-Key': requestKey() } }, { onSuccess: () => finishMutation(match.id) })
  const handleUpdateExternal = (match: NormalizedMatch, participant: NormalizedExternalParticipant, displayName: string) => updateExternalMutation.mutate({ id: match.id, participantId: participant.id, data: { displayName }, headers: { 'Idempotency-Key': requestKey() } }, { onSuccess: () => finishMutation(match.id) })
  const handleRemoveExternal = (match: NormalizedMatch, participant: NormalizedExternalParticipant) => removeExternalMutation.mutate({ id: match.id, participantId: participant.id, headers: { 'Idempotency-Key': requestKey() } }, { onSuccess: () => finishMutation(match.id) })
  const handleReconcile = (match: NormalizedMatch, action: 'attach' | 'retry', telegramMessageId?: string) => reconcileMutation.mutate({ id: match.id, data: { action, ...(telegramMessageId === undefined ? {} : { telegramMessageId }) }, headers: { 'Idempotency-Key': requestKey() } }, { onSuccess: () => finishMutation(match.id) })
  const handleUpdatePlayer = (player: NormalizedPlayer, displayName: string) => updatePlayerMutation.mutate({ id: player.id, data: { displayName }, headers: { 'Idempotency-Key': requestKey() } }, { onSuccess: () => finishMutation() })

  const actionPending = [publishMutation, finalizeMutation, confirmMutation, completeMutation, cancelMutation, reconcileMutation, correctVoteMutation, removeVoteMutation, createExternalMutation, updateExternalMutation, removeExternalMutation].some((mutation) => mutation.isPending)
  const playerSaving = updatePlayerMutation.isPending
  const mutationError = [patchMutation, createMutation, publishMutation, finalizeMutation, confirmMutation, completeMutation, cancelMutation, reconcileMutation, correctVoteMutation, removeVoteMutation, createExternalMutation, updateExternalMutation, removeExternalMutation, updatePlayerMutation].map((mutation) => mutation.error).find((error) => error !== null && error !== undefined)
  const matchDetailOpen = tab === 'matches' && selectedId !== undefined
  const handleTabChange = (nextTab: Tab) => { setSelectedId(undefined); setTab(nextTab) }

  return (
    <main className="app-shell">
      {!matchDetailOpen && <header className="flex h-14 items-center justify-between bg-background/90 shadow-sm backdrop-blur-sm"><div className="flex items-center gap-2.5"><img src={applicationBrand.logo} alt="" width="36" height="36" className="size-9 rounded-full object-cover" /><p className="text-base font-semibold leading-none">{applicationBrand.name}</p></div><ThemeToggle /></header>}
      <div className={matchDetailOpen ? 'px-4 pt-3 pb-24' : 'px-4 py-5 pb-24'}>{mutationError !== undefined && <Alert variant="destructive" className="mb-4"><TriangleAlert /><AlertTitle>Не удалось сохранить изменения</AlertTitle><AlertDescription>{errorMessage(mutationError)}</AlertDescription></Alert>}<AnimatePresence mode="wait" initial={false}><motion.div key={tab} initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? {} : { opacity: 0, y: -4 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
        {tab === 'matches' && <MatchesPanel matches={upcoming} selected={selected} onSelect={setSelectedId} onCreate={handleCreate} onPatch={handlePatch} onPublish={handlePublish} onFinalize={handleFinalize} onConfirm={handleConfirm} onComplete={handleComplete} onCancel={handleCancel} onCorrectVote={handleCorrectVote} onRemoveVote={handleRemoveVote} onAddExternal={handleAddExternal} onUpdateExternal={handleUpdateExternal} onRemoveExternal={handleRemoveExternal} onReconcile={handleReconcile} conflict={conflict} onClearConflict={() => setConflict('')} saving={createMutation.isPending || patchMutation.isPending} actionPending={actionPending} />}
        {tab === 'players' && <PlayersPanel players={dashboard.players} onUpdatePlayer={handleUpdatePlayer} saving={playerSaving} />}
        {tab === 'history' && <HistoryPanel history={dashboard.history} />}
      </motion.div></AnimatePresence></div>
      <TabBar value={tab} onChange={handleTabChange} />
    </main>
  )
}

export { MatchEditor } from '@/components/football/match-editor'
export { TabBar } from '@/components/football/navigation'
export default App
