import { useMemo, useState } from 'react'
import { CloudSun, RotateCw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import {
  getErrorCode,
  getErrorStatus,
  getListOwnerMatchesQueryKey,
  getListOwnerPollsQueryKey,
  getListOwnerVenuesQueryKey,
  useArchiveOwnerPoll,
  useArchiveOwnerVenue,
  useCreateOwnerMatch,
  useCreateOwnerPoll,
  useCreateOwnerVenue,
  useDeleteOwnerMatch,
  useListOwnerMatches,
  useListOwnerPolls,
  useListOwnerVenues,
  useRepublishOwnerMatch,
  useRestoreOwnerVenue,
  useSendCurrentWeather,
  useUpdateOwnerMatch,
  useUpdateOwnerVenue,
} from '@football/api-client'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { MatchesPanel } from '@/components/football/panels'
import { PollsPanel } from '@/components/football/polls-panel'
import { StateScreen } from '@/components/football/state-screen'
import { TabBar, type Tab } from '@/components/football/navigation'
import { ThemeToggle } from '@/components/football/theme-toggle'
import { VenuesPanel } from '@/components/football/venues-panel'
import type { EditorValues } from '@/components/football/match-editor'
import type { PollEditorValues } from '@/components/football/poll-editor'
import type { VenueFormValues } from '@/components/football/venue-form'
import { applicationBrand } from '@/brand'
import { normalizeMatch, normalizeVenue, type NormalizedMatch, type NormalizedVenue } from './normalize'
import { useTelegramWebApp, type TelegramSession } from './telegram'

interface AppProps { readonly telegramSession?: TelegramSession }
type AuthFailure = 'unauthorized' | 'expired' | undefined
const POLL_RESULTS_REFRESH_INTERVAL_MS = 3_000

function requestKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `football-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function errorMessage(error: unknown): string {
  if (getErrorCode(error) === 'VENUE_ARCHIVED') return 'Эта площадка находится в архиве. Выберите активную площадку.'
  if (getErrorCode(error) === 'WEATHER_UNAVAILABLE') return 'Не удалось отправить текущую погоду. Попробуйте ещё раз.'
  return 'Не удалось выполнить запрос. Попробуйте ещё раз.'
}

function authFailureFor(error: unknown): AuthFailure {
  if (getErrorCode(error) === 'TELEGRAM_INIT_DATA_EXPIRED') return 'expired'
  const status = getErrorStatus(error)
  return status === 401 || status === 403 ? 'unauthorized' : undefined
}

function matchRequest(values: EditorValues) {
  return {
    date: values.date,
    time: values.time,
    durationMinutes: Number(values.durationMinutes),
    venueId: values.venueId,
    fieldPriceRubles: values.fieldPriceByn.trim() === '' ? null : Number(values.fieldPriceByn),
  }
}

export function App({ telegramSession }: AppProps = {}) {
  const detectedSession = useTelegramWebApp()
  const session = telegramSession ?? detectedSession
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('matches')
  const [conflict, setConflict] = useState('')
  const [authFailure, setAuthFailure] = useState<AuthFailure>()
  const queryEnabled = session.status === 'ready' && session.initData !== undefined && authFailure === undefined
  const matchesQuery = useListOwnerMatches(undefined, { query: { enabled: queryEnabled } })
  const pollsQuery = useListOwnerPolls({ query: { enabled: queryEnabled, refetchInterval: tab === 'polls' ? POLL_RESULTS_REFRESH_INTERVAL_MS : false, refetchOnWindowFocus: true } })
  const venuesQuery = useListOwnerVenues({ includeArchived: true }, { query: { enabled: queryEnabled } })
  const matches = useMemo(() => matchesQuery.data?.matches.map(normalizeMatch) ?? [], [matchesQuery.data])
  const venues = useMemo(() => venuesQuery.data?.venues.map(normalizeVenue) ?? [], [venuesQuery.data])

  const invalidateMatches = () => void queryClient.invalidateQueries({ queryKey: getListOwnerMatchesQueryKey() })
  const invalidatePolls = () => void queryClient.invalidateQueries({ queryKey: getListOwnerPollsQueryKey() })
  const invalidateVenues = () => void queryClient.invalidateQueries({ queryKey: getListOwnerVenuesQueryKey({ includeArchived: true }) })
  const handleMutationError = (error: unknown) => {
    const auth = authFailureFor(error)
    if (auth !== undefined) { setAuthFailure(auth); return }
    if (getErrorStatus(error) === 409 && getErrorCode(error) === 'MATCH_VERSION_STALE') {
      setConflict('Матч уже изменился на сервере. Обновите данные и повторите попытку.')
      return
    }
    toast.error(errorMessage(error))
  }
  const mutationOptions = { mutation: { onError: handleMutationError } }
  const createMatchMutation = useCreateOwnerMatch(mutationOptions)
  const createPollMutation = useCreateOwnerPoll(mutationOptions)
  const archivePollMutation = useArchiveOwnerPoll(mutationOptions)
  const updateMatchMutation = useUpdateOwnerMatch(mutationOptions)
  const deleteMatchMutation = useDeleteOwnerMatch(mutationOptions)
  const republishMatchMutation = useRepublishOwnerMatch(mutationOptions)
  const weatherMutation = useSendCurrentWeather({ mutation: { onError: handleMutationError } })
  const createVenueMutation = useCreateOwnerVenue(mutationOptions)
  const updateVenueMutation = useUpdateOwnerVenue(mutationOptions)
  const archiveVenueMutation = useArchiveOwnerVenue(mutationOptions)
  const restoreVenueMutation = useRestoreOwnerVenue(mutationOptions)

  const queryAuthFailure = [matchesQuery.error, pollsQuery.error, venuesQuery.error].map(authFailureFor).find((value) => value !== undefined)
  const effectiveAuthFailure = authFailure ?? queryAuthFailure
  if (session.status === 'loading') return <StateScreen kind="loading" title="Подготавливаем команду" copy="Подключаемся к Telegram…" />
  if (session.status === 'outside-telegram') return <StateScreen kind="outside" title="Откройте приложение в Telegram" copy="Это закрытое мини-приложение. Запустите его из Telegram." />
  if (session.status === 'unauthorized' || effectiveAuthFailure === 'unauthorized') return <StateScreen kind="unauthorized" title="Нужен доступ владельца" copy="У этого аккаунта Telegram нет прав на управление командой." action={<Button onClick={() => window.location.reload()}><RotateCw data-icon="inline-start" />Перезагрузить</Button>} />
  if (effectiveAuthFailure === 'expired') return <StateScreen kind="unauthorized" title="Сессия Telegram истекла" copy="Закройте это окно и заново откройте Mini App из Telegram." />
  if (session.status === 'error') return <StateScreen kind="error" title="Не удалось запустить Telegram" copy={session.reason ?? 'Telegram не смог запустить мини-приложение.'} />

  const handleCreateMatch = (values: EditorValues) => createMatchMutation.mutate({ data: matchRequest(values), headers: { 'Idempotency-Key': requestKey() } }, { onSuccess: () => { invalidateMatches(); toast.success('Карточка матча отправлена в Telegram.') } })
  const handleCreatePoll = (values: PollEditorValues) => createPollMutation.mutate({
    data: {
      question: values.question.trim(),
      options: values.options.map((option) => ({ text: option.text.trim(), notificationEnabled: option.notificationEnabled })),
      notificationThreshold: values.notificationThreshold === null ? null : Number(values.notificationThreshold),
      allowsMultipleAnswers: values.allowsMultipleAnswers,
    },
    headers: { 'Idempotency-Key': requestKey() },
  }, { onSuccess: () => { invalidatePolls(); toast.success('Опрос отправлен в Telegram.') } })
  const handleArchivePoll = async (pollId: string): Promise<boolean> => {
    try {
      await archivePollMutation.mutateAsync({ id: pollId, headers: { 'Idempotency-Key': requestKey() } })
      invalidatePolls()
      toast.success('Опрос перемещён в архив и удаляется из Telegram.')
      return true
    } catch {
      return false
    }
  }
  const handleUpdateMatch = (match: NormalizedMatch, values: EditorValues) => updateMatchMutation.mutate({ id: match.id, data: matchRequest(values), headers: { 'Idempotency-Key': requestKey(), 'If-Match': String(match.version) } }, { onSuccess: () => { setConflict(''); invalidateMatches(); toast.success('Карточка матча обновлена.') } })
  const handleDeleteMatch = async (match: NormalizedMatch): Promise<boolean> => {
    if (!window.confirm(`Удалить карточку матча ${match.dateLabel}?`)) return false
    try {
      await deleteMatchMutation.mutateAsync({ id: match.id, headers: { 'Idempotency-Key': requestKey(), 'If-Match': String(match.version) } })
      invalidateMatches()
      toast.success('Карточка матча удаляется из Telegram.')
      return true
    } catch {
      return false
    }
  }
  const handleRepublishMatch = async (match: NormalizedMatch): Promise<boolean> => {
    try {
      await republishMatchMutation.mutateAsync({ id: match.id, headers: { 'Idempotency-Key': requestKey(), 'If-Match': String(match.version) } })
      invalidateMatches()
      toast.success('Карточка матча переопубликовывается.')
      return true
    } catch {
      return false
    }
  }
  const handleCreateVenue = async (values: VenueFormValues) => {
    const response = await createVenueMutation.mutateAsync({ data: values, headers: { 'Idempotency-Key': requestKey() } })
    invalidateVenues()
    return normalizeVenue(response.venue)
  }
  const handleUpdateVenue = async (venue: NormalizedVenue, values: VenueFormValues) => {
    await updateVenueMutation.mutateAsync({ id: venue.id, data: values, headers: { 'Idempotency-Key': requestKey(), 'If-Match': String(venue.version) } })
    invalidateVenues(); invalidateMatches()
  }
  const handleArchiveVenue = async (venue: NormalizedVenue): Promise<boolean> => {
    try {
      await archiveVenueMutation.mutateAsync({ id: venue.id, headers: { 'Idempotency-Key': requestKey(), 'If-Match': String(venue.version) } })
      invalidateVenues(); invalidateMatches()
      return true
    } catch {
      return false
    }
  }
  const handleRestoreVenue = async (venue: NormalizedVenue): Promise<boolean> => {
    try {
      await restoreVenueMutation.mutateAsync({ id: venue.id, headers: { 'Idempotency-Key': requestKey(), 'If-Match': String(venue.version) } })
      invalidateVenues(); invalidateMatches()
      return true
    } catch {
      return false
    }
  }
  const matchSaving = [createMatchMutation, updateMatchMutation, deleteMatchMutation, republishMatchMutation].some((mutation) => mutation.isPending)
  const pollSaving = createPollMutation.isPending || archivePollMutation.isPending
  const venueSaving = [createVenueMutation, updateVenueMutation, archiveVenueMutation, restoreVenueMutation].some((mutation) => mutation.isPending)
  const loading = matchesQuery.isLoading || pollsQuery.isLoading || venuesQuery.isLoading
  const failure = [matchesQuery.error, pollsQuery.error, venuesQuery.error].find((error) => error !== null && error !== undefined)

  return <div className="mx-auto flex min-h-svh w-full max-w-[480px] flex-col bg-background">
    <header className="flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur-sm"><div className="flex items-center gap-2.5"><img src={applicationBrand.logo} alt="" width="36" height="36" className="size-9 rounded-full object-cover" /><p className="text-base font-semibold leading-none">{applicationBrand.name}</p></div><div className="flex items-center gap-1"><Button variant="ghost" size="sm" onClick={() => weatherMutation.mutate()} disabled={weatherMutation.isPending}><CloudSun data-icon="inline-start" />Погода</Button><ThemeToggle /></div></header>
    <main className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-5">
      {failure !== undefined ? <Alert variant="destructive" className="mb-4"><TriangleAlert /><AlertTitle>Не удалось загрузить данные</AlertTitle><AlertDescription>{errorMessage(failure)}</AlertDescription></Alert> : null}
      {loading ? <StateScreen kind="loading" title="Загружаем данные" copy="Синхронизируем данные…" /> : tab === 'matches' ? <MatchesPanel matches={matches} venues={venues} saving={matchSaving} conflict={conflict} onClearConflict={() => setConflict('')} onCreate={handleCreateMatch} onUpdate={handleUpdateMatch} onDelete={handleDeleteMatch} onRepublish={handleRepublishMatch} onCreateVenue={handleCreateVenue} /> : tab === 'polls' ? <PollsPanel polls={pollsQuery.data?.polls ?? []} saving={pollSaving} onCreate={handleCreatePoll} onArchive={handleArchivePoll} /> : <VenuesPanel venues={venues} saving={venueSaving} onCreate={handleCreateVenue} onUpdate={handleUpdateVenue} onArchive={handleArchiveVenue} onRestore={handleRestoreVenue} />}
    </main>
    <TabBar value={tab} onChange={setTab} />
  </div>
}

export default App
