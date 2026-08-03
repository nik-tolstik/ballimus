import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryState = vi.hoisted(() => ({
  bootstrap: { data: undefined as unknown, error: null as unknown, isPending: false },
  matches: { data: undefined as unknown, error: null as unknown, isPending: false },
  venues: { data: undefined as unknown, error: null as unknown, isPending: false },
  players: { data: undefined as unknown, error: null as unknown, isPending: false },
  match: { data: undefined as unknown, error: null as unknown, isPending: false },
  mutation: { isPending: false, error: null as unknown, mutate: vi.fn(), mutateAsync: vi.fn() },
}))

vi.mock('@football/api-client', () => ({
  getErrorCode: (error: unknown) => (typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined),
  getErrorStatus: (error: unknown) => (typeof error === 'object' && error !== null && 'status' in error ? (error as { status?: unknown }).status : undefined),
  getGetOwnerBootstrapQueryKey: () => ['/v1/bootstrap'],
  getGetOwnerMatchQueryKey: (id: unknown) => ['/v1/matches', id],
  getListOwnerMatchesQueryKey: () => ['/v1/matches'],
  getListOwnerPlayersQueryKey: () => ['/v1/players'],
  getListOwnerVenuesQueryKey: () => ['/v1/venues'],
  useGetOwnerBootstrap: () => queryState.bootstrap,
  useGetOwnerMatch: () => queryState.match,
  useListOwnerMatches: () => queryState.matches,
  useListOwnerPlayers: () => queryState.players,
  useListOwnerVenues: () => queryState.venues,
  usePatchOwnerMatch: () => queryState.mutation,
  useCreateOwnerMatch: () => queryState.mutation,
  useCreateOwnerVenue: () => queryState.mutation,
  useUpdateOwnerVenue: () => queryState.mutation,
  useArchiveOwnerVenue: () => queryState.mutation,
  useRestoreOwnerVenue: () => queryState.mutation,
  usePublishOwnerMatch: () => queryState.mutation,
  useRefreshOwnerMatchCard: () => queryState.mutation,
  useFinalizeOwnerMatch: () => queryState.mutation,
  useConfirmOwnerMatch: () => queryState.mutation,
  useCompleteOwnerMatch: () => queryState.mutation,
  useCancelOwnerMatch: () => queryState.mutation,
  useReconcileOwnerMatchCard: () => queryState.mutation,
  useSendOwnerMatchWeather: () => queryState.mutation,
  useCorrectOwnerMatchVote: () => queryState.mutation,
  useRemoveOwnerMatchVote: () => queryState.mutation,
  useCreateOwnerExternalParticipant: () => queryState.mutation,
  useUpdateOwnerExternalParticipant: () => queryState.mutation,
  useRemoveOwnerExternalParticipant: () => queryState.mutation,
  useUpdateOwnerPlayerReadableName: () => queryState.mutation,
}))

import App, { MatchEditor, TabBar, weatherWarningMessage } from './App'
import { brandForEnvironment } from './brand'
import { DatePicker } from './components/football/date-time-picker'
import { currentHourTime, editorTimeConfiguration, validateEditorValues } from './components/football/match-editor'
import { availabilityCountAt, cancellationReasonText, CancellationReasonFields, initialsForName, MatchesPanel, MatchRoster, MatchSettings, playerAvatarColor, PlayersPanel, rosterGroupCount, validateCancellationReason, validateExternalParticipantName, validateExternalParticipantValues, validateFinalMatchDetails, validatePlayerPseudonym, voteDropZoneStyle, voteOptionFromDropTarget, voteRemovalAction } from './components/football/panels'
import type { NormalizedMatch, NormalizedPlayer } from './normalize'
import type { TelegramSession } from './telegram'

const readySession: TelegramSession = {
  status: 'ready',
  initData: 'signed-init-data',
  theme: {
    backgroundColor: undefined,
    secondaryBackgroundColor: undefined,
    textColor: undefined,
    hintColor: undefined,
    buttonColor: undefined,
    buttonTextColor: undefined,
    headerBackgroundColor: undefined,
  },
  safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
}

const normalizedMatch: NormalizedMatch = {
  id: '9',
  title: 'Матч',
  dateLabel: 'Среда, 29 июля · 19:30',
  date: '2026-07-29',
  time: '19:30',
  timeMode: 'exact',
  timeOptions: [],
  selectedTime: undefined,
  location: 'Поле',
  venueType: 'indoor',
  status: 'active',
  planningStage: 'recruiting_players',
  statusLabel: 'Набираем игроков',
  statusShortLabel: 'Набираем игроков',
  goingCount: 3,
  requiredPlayers: 7,
  fieldPriceByn: 120,
  version: 2,
  cancellationReason: undefined,
  publicCardState: 'published',
  reconciliationRequired: false,
  telegramMessageId: '10',
  roster: { votes: [], externalParticipants: [] },
}

function renderApp(session: TelegramSession = readySession): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(<QueryClientProvider client={client}><App telegramSession={session} /></QueryClientProvider>)
}

beforeEach(() => {
  queryState.bootstrap = { data: undefined, error: null, isPending: false }
  queryState.matches = { data: undefined, error: null, isPending: false }
  queryState.venues = { data: undefined, error: null, isPending: false }
  queryState.players = { data: undefined, error: null, isPending: false }
  queryState.match = { data: undefined, error: null, isPending: false }
  queryState.mutation = { isPending: false, error: null, mutate: vi.fn(), mutateAsync: vi.fn() }
})

describe('Mini App access states', () => {
  it('renders the Telegram loading state before session initialization', () => {
    expect(renderApp({ ...readySession, status: 'loading', initData: undefined })).toContain('Подготавливаем команду')
  })

  it('fails closed outside Telegram', () => {
    const markup = renderApp({ ...readySession, status: 'outside-telegram', initData: undefined })
    expect(markup).toContain('Откройте приложение в Telegram')
    expect(markup).not.toContain('Предстоящие матчи')
  })

  it('fails closed after an unauthorized API response', () => {
    queryState.matches = { data: undefined, error: { status: 403 }, isPending: false }
    const markup = renderApp()
    expect(markup).toContain('Нужен доступ владельца')
    expect(markup).toContain('нет прав')
  })

  it('tells the owner to reopen the Mini App after initData expires', () => {
    queryState.matches = { data: undefined, error: { status: 401, code: 'TELEGRAM_INIT_DATA_EXPIRED' }, isPending: false }
    const markup = renderApp()
    expect(markup).toContain('Сессия Telegram истекла')
    expect(markup).toContain('заново откройте Mini App')
  })
})

describe('API-backed surface states', () => {
  it('uses a warning for repeated manual weather delivery', () => {
    expect(weatherWarningMessage({ code: 'WEATHER_ALREADY_SENT_MANUALLY' })).toBe('Вы уже отправляли прогноз погоды для этого дня.')
    expect(weatherWarningMessage({ code: 'WEATHER_ALREADY_SENT' })).toBe('Прогноз погоды для этого дня уже отправлен ботом.')
  })

  it('renders an explicit empty state when normalized API data is absent', () => {
    const markup = renderApp()
    expect(markup).toContain('Матчей пока нет')
    expect(markup).not.toContain('Создайте матч — карточка сразу появится в группе Telegram.')
    expect(markup).not.toContain('Создать матч')
    expect(markup).toContain('Новый матч')
    expect(markup).not.toContain('Предпросмотр карточки Telegram')
    expect(markup).not.toContain('Владелец')
    expect(markup).toContain('Ballimus Dev')
    expect(markup).not.toContain('Футбольная команда')
    expect(markup).not.toContain('Управление составом')
    expect(brandForEnvironment(true).name).toBe('Ballimus')
    expect(brandForEnvironment(false).name).toBe('Ballimus Dev')
  })

  it('renders a persistent mutation-error state', () => {
    queryState.mutation = { isPending: false, error: { status: 500 }, mutate: vi.fn(), mutateAsync: vi.fn() }
    expect(renderApp()).toContain('Не удалось сохранить изменения')
  })

  it('renders the conflict editor state without hiding the save surface', () => {
    const markup = renderToStaticMarkup(<MatchEditor match={normalizedMatch} onSave={vi.fn()} conflict="Матч изменился на сервере." onClearConflict={vi.fn()} saving={false} />)
    expect(markup).toContain('Данные изменились')
    expect(markup).toContain('Матч изменился на сервере.')
    expect(markup).toContain('Сохранить')
    expect(markup).toContain('<form aria-label="Форма редактирования матча"')
    expect(markup).toContain('type="submit"')
    expect(markup).toContain('type="button"')
    expect(markup).toContain('data-size="form"')
    expect(markup).toContain('h-10')
    expect(markup).toContain('text-base')
    expect(markup).toContain('md:text-sm')
  })

  it('uses the native date input on mobile while keeping the custom desktop calendar', () => {
    const markup = renderToStaticMarkup(<DatePicker value="2026-08-02" onChange={vi.fn()} />)

    expect(markup).toContain('type="date"')
    expect(markup).toContain('value="2026-08-02"')
    expect(markup).toContain('mobile-native-date-picker')
    expect(markup).toContain('desktop-custom-date-picker')
    expect(markup).toContain('native-temporal-input-frame')
    expect(markup).toContain('max-w-full')
    expect(markup).toContain('p-0')
  })

  it('publishes a new match directly without a draft step', () => {
    const markup = renderToStaticMarkup(<MatchEditor onSave={vi.fn()} conflict="" onClearConflict={vi.fn()} saving={false} />)

    expect(markup).toContain('Опубликовать матч')
    expect(markup).not.toContain('черновик')
    expect(markup).not.toContain('Матч начнётся в указанное время.')
  })

  it('uses native submit semantics for every save form', async () => {
    const panelsSource = await readFile(new URL('./components/football/panels.tsx', import.meta.url), 'utf8')

    expect(panelsSource.match(/<form\b/gu)).toHaveLength(5)
    expect(panelsSource.match(/onSubmit=/gu)).toHaveLength(5)
    expect(panelsSource.match(/type="submit"/gu)).toHaveLength(5)
    expect(panelsSource).toContain('Форма дополнительных игроков')
    expect(panelsSource).toContain('Форма редактирования дополнительного игрока')
    expect(panelsSource).toContain('Форма сверки Telegram-карточки')
    expect(panelsSource).toContain('Форма отмены матча')
    expect(panelsSource).toContain('Форма псевдонима игрока')
  })

  it('prevents the match editor sheet from auto-focusing the native date picker', async () => {
    const panelsSource = await readFile(new URL('./components/football/panels.tsx', import.meta.url), 'utf8')

    expect(panelsSource).toContain('onOpenAutoFocus={(event) => {')
    expect(panelsSource).toContain('event.preventDefault()')
    expect(panelsSource).toContain("querySelector<HTMLButtonElement>('[data-slot=\"sheet-close\"]')?.focus()")
  })

  it('exposes all primary tabs and marks the active tab accessibly', () => {
    const markup = renderToStaticMarkup(<TabBar value="players" onChange={vi.fn()} />)
    expect(markup).toContain('Матчи')
    expect(markup).toContain('Места')
    expect(markup).toContain('Игроки')
    expect(markup).toContain('История')
    expect(markup).toContain('aria-current="page"')
  })

  it('separates the match list from the dedicated match detail screen', () => {
    const sharedProps = {
      matches: [normalizedMatch],
      onSelect: vi.fn(),
      onCreate: vi.fn().mockResolvedValue(undefined),
      onPatch: vi.fn(),
      onPublish: vi.fn(),
      onFinalize: vi.fn().mockResolvedValue(undefined),
      onConfirm: vi.fn(),
      onComplete: vi.fn(),
      onSendWeather: vi.fn(),
      onCancel: vi.fn(),
      onCorrectVote: vi.fn(),
      onRemoveVote: vi.fn(),
      onAddExternal: vi.fn(),
      onUpdateExternal: vi.fn(),
      onRemoveExternal: vi.fn(),
      onReconcile: vi.fn(),
      conflict: '',
      onClearConflict: vi.fn(),
      saving: false,
      actionPending: false,
    }
    const listMarkup = renderToStaticMarkup(<MatchesPanel {...sharedProps} selected={undefined} />)
    const detailMarkup = renderToStaticMarkup(<MatchesPanel {...sharedProps} selected={normalizedMatch} />)

    expect(listMarkup).toContain('Предстоящие матчи')
    expect(listMarkup).not.toContain('Разделы матча')
    expect(detailMarkup).toContain('Вернуться к списку матчей')
    expect(detailMarkup).toContain('Разделы матча')
    expect(detailMarkup).toContain('Обзор')
    expect(detailMarkup).toContain('Состав')
    expect(detailMarkup).toContain('Настройки')
    expect(detailMarkup).toContain('Отменить матч')
    expect(detailMarkup).not.toContain('Обновить карточку')
    expect(detailMarkup.indexOf('Сводка')).toBeLessThan(detailMarkup.indexOf('Ближайшее действие'))
    expect(detailMarkup.indexOf('Карточка опубликована')).toBeLessThan(detailMarkup.indexOf(normalizedMatch.dateLabel))
    expect(detailMarkup).not.toContain('>Telegram</span>')
  })

  it('shows the next action for every planning stage', () => {
    const sharedProps = {
      matches: [normalizedMatch],
      onSelect: vi.fn(),
      onCreate: vi.fn().mockResolvedValue(undefined),
      onPatch: vi.fn(),
      onPublish: vi.fn(),
      onFinalize: vi.fn().mockResolvedValue(undefined),
      onConfirm: vi.fn(),
      onComplete: vi.fn(),
      onSendWeather: vi.fn(),
      onCancel: vi.fn(),
      onCorrectVote: vi.fn(),
      onRemoveVote: vi.fn(),
      onAddExternal: vi.fn(),
      onUpdateExternal: vi.fn(),
      onRemoveExternal: vi.fn(),
      onReconcile: vi.fn(),
      conflict: '',
      onClearConflict: vi.fn(),
      saving: false,
      actionPending: false,
    }
    const finalizing = { ...normalizedMatch, timeMode: 'availability' as const, timeOptions: ['19:00', '20:00'], time: '', goingCount: 7, location: 'Место уточняется', planningStage: 'finalizing_details' as const, statusLabel: 'Уточняем время и место', statusShortLabel: 'Уточнить детали' }
    const ready = { ...normalizedMatch, goingCount: 7, planningStage: 'ready_to_confirm' as const, statusLabel: 'Готов к подтверждению', statusShortLabel: 'Можно подтверждать' }
    const outdoor = { ...normalizedMatch, venueType: 'outdoor' as const }

    expect(renderToStaticMarkup(<MatchesPanel {...sharedProps} selected={normalizedMatch} />)).toContain('Посмотреть состав')
    expect(renderToStaticMarkup(<MatchesPanel {...sharedProps} selected={finalizing} />)).toContain('Уточнить время и место')
    expect(renderToStaticMarkup(<MatchesPanel {...sharedProps} selected={ready} />)).toContain('Подтвердить матч')
    expect(renderToStaticMarkup(<MatchesPanel {...sharedProps} selected={outdoor} />)).toContain('Отправить погоду сейчас')
  })

  it('validates the booked details before final confirmation', () => {
    expect(validateFinalMatchDetails(normalizedMatch, { time: '', venueId: undefined, fieldPriceRubles: '' })).toEqual({
      time: 'Укажите точное время матча.',
      location: 'Выберите место игры.',
      fieldPriceRubles: 'Укажите стоимость поля целым числом.',
    })
    expect(validateFinalMatchDetails(normalizedMatch, { time: '20:30', venueId: 'venue-1', fieldPriceRubles: '120' })).toEqual({})
  })

  it('validates cancellation reasons and builds colored roster avatar initials', () => {
    expect(validateCancellationReason(undefined, '')).toBe('Выберите причину отмены.')
    expect(validateCancellationReason('other', '   ')).toBe('Опишите другую причину.')
    expect(validateCancellationReason('bad_weather', '')).toBeUndefined()
    expect(cancellationReasonText('bad_weather', '')).toBe('Плохая погода')
    expect(cancellationReasonText('not_enough_players', '')).toBe('Недостаточно игроков')
    expect(cancellationReasonText('other', '  Техническая проблема  ')).toBe('Техническая проблема')
    expect(initialsForName('Иван Петров')).toBe('ИП')
    expect(initialsForName('')).toBe('?')
    expect(playerAvatarColor('player-1')).toBe(playerAvatarColor('player-1'))
    expect(playerAvatarColor('player-1')).not.toBe(playerAvatarColor('player-2'))
  })

  it('shows a custom cancellation field only for the Other option', () => {
    const selectMarkup = renderToStaticMarkup(<CancellationReasonFields option={undefined} otherReason="" validation="" onOptionChange={vi.fn()} onOtherReasonChange={vi.fn()} />)
    const otherMarkup = renderToStaticMarkup(<CancellationReasonFields option="other" otherReason="" validation="" onOptionChange={vi.fn()} onOtherReasonChange={vi.fn()} />)

    expect(selectMarkup).toContain('Выберите причину')
    expect(selectMarkup).toContain('data-size="default"')
    expect(selectMarkup).toContain('data-[size=default]:h-10')
    expect(selectMarkup).toContain('text-base')
    expect(selectMarkup).toContain('md:text-sm')
    expect(selectMarkup).not.toContain('Другая причина')
    expect(otherMarkup).toContain('Другая причина')
    expect(otherMarkup).toContain('Опишите причину отмены')
  })

  it('keeps Telegram card controls out of match settings', () => {
    const markup = renderToStaticMarkup(<MatchSettings match={normalizedMatch} openEdit={vi.fn()} onReconcile={vi.fn()} disabled={false} />)

    expect(markup).toContain('Параметры матча')
    expect(markup).not.toContain('Карточка Telegram')
  })

  it('renders drag-and-drop roster groups without vote-state buttons', () => {
    const match = {
      ...normalizedMatch,
      roster: {
        votes: [{ playerId: 'player-1', telegramUserId: '1', username: 'ivan', readableName: 'Иван Петров', avatarUrl: 'data:image/jpeg;base64,YXZhdGFy', option: 'going' as const, exactTimes: [] }],
        externalParticipants: [
          { id: 'external-1', displayName: 'От Никиты #1', quantity: 1 },
          { id: 'external-2', displayName: 'От Никиты #2', quantity: 1 },
        ],
      },
    }
    const markup = renderToStaticMarkup(<MatchRoster match={match} onCorrectVote={vi.fn(async () => undefined)} onRemoveVote={vi.fn()} onAddExternal={vi.fn()} onUpdateExternal={vi.fn()} onRemoveExternal={vi.fn()} disabled={false} />)

    expect(markup).not.toContain('Перетащите игрока за маркер')
    expect(markup).toContain('Перетащить Иван Петров')
    expect(markup).toContain('transition-[border-color,box-shadow]')
    expect(markup).not.toContain('transition-[border-color,box-shadow,opacity]')
    expect(markup).toContain('Добавить дополнительных игроков')
    expect(markup).toContain('От Никиты #1')
    expect(markup).toContain('От Никиты #2')
    expect(markup).not.toContain('×1')
    expect(markup).not.toContain('×2')
    expect(markup).toContain('>?<')
    expect(markup).not.toContain('>Иду<')
    expect(markup).not.toContain('>Может<')
    expect(markup).not.toContain('>Не иду<')
    expect(voteOptionFromDropTarget('maybe')).toBe('maybe')
    expect(voteOptionFromDropTarget('unknown')).toBeUndefined()
    expect(voteDropZoneStyle('going')).toMatchObject({ zone: expect.stringContaining('success'), label: 'text-success' })
    expect(voteDropZoneStyle('maybe')).toMatchObject({ zone: expect.stringContaining('warning'), label: 'text-warning' })
    expect(voteDropZoneStyle('not_going')).toMatchObject({ zone: expect.stringContaining('destructive'), label: 'text-destructive' })
    expect(rosterGroupCount('going', match.roster.votes, match.roster.externalParticipants)).toBe(3)
    expect(validateExternalParticipantValues('', '2')).toBe('Укажите источник.')
    expect(validateExternalParticipantValues('От Никиты', '0')).toContain('целым числом')
    expect(validateExternalParticipantValues('От Никиты', '2')).toBeUndefined()
    expect(validateExternalParticipantValues('От Никиты', '51')).toContain('от 1 до 50')
    expect(validateExternalParticipantName('')).toBe('Укажите имя игрока.')
    expect(validateExternalParticipantName('Саша')).toBeUndefined()
  })

  it('renders cumulative availability groups for flexible-time matches', () => {
    const match: NormalizedMatch = {
      ...normalizedMatch,
      time: '',
      timeMode: 'availability',
      timeOptions: ['19:00', '20:00'],
      roster: {
        votes: [
          { playerId: 'player-1', telegramUserId: '1', username: 'early', readableName: 'Ранний', avatarUrl: undefined, option: 'going', availableAfter: '19:00', exactTimes: [] },
          { playerId: 'player-2', telegramUserId: '2', username: 'late', readableName: 'Поздний', avatarUrl: undefined, option: 'going', availableAfter: '20:00', exactTimes: [] },
        ],
        externalParticipants: [
          { id: 'external-1', displayName: 'От Никиты #1', availableAfter: '19:00', quantity: 1 },
          { id: 'external-2', displayName: 'От Алексея #1', quantity: 1 },
        ],
      },
    }
    const markup = renderToStaticMarkup(<MatchRoster match={match} onCorrectVote={vi.fn(async () => undefined)} onRemoveVote={vi.fn()} onAddExternal={vi.fn()} onUpdateExternal={vi.fn()} onRemoveExternal={vi.fn()} disabled={false} />)
    expect(markup).toContain('После 19:00')
    expect(markup).toContain('После 20:00')
    expect(markup).toContain(playerAvatarColor('player-1'))
    expect(markup).toContain(playerAvatarColor('player-2'))
    expect(markup).toContain('Доп. игроки без указанного времени')
    expect(markup).toContain('От Алексея #1')
    expect(markup.match(/aria-label="Добавить дополнительных игроков"/gu)).toHaveLength(2)
    expect(voteOptionFromDropTarget('after:20:00')).toBe('after:20:00')
    expect(voteDropZoneStyle('after:19:00')).toMatchObject({ zone: expect.stringContaining('success') })
    expect(availabilityCountAt(match, '19:00')).toBe(2)
    expect(availabilityCountAt(match, '20:00')).toBe(3)
  })

  it('renders several precise time groups without after-time labels', () => {
    const match: NormalizedMatch = {
      ...normalizedMatch,
      time: '',
      timeMode: 'exact_options',
      timeOptions: ['19:00', '20:00'],
      roster: {
        votes: [
          { playerId: 'player-1', telegramUserId: '1', username: 'early', readableName: 'Ранний', avatarUrl: undefined, option: 'going', exactTimes: ['19:00', '20:00'] },
          { playerId: 'player-2', telegramUserId: '2', username: 'late', readableName: 'Поздний', avatarUrl: undefined, option: 'going', exactTimes: ['20:00'] },
        ],
        externalParticipants: [],
      },
    }
    const markup = renderToStaticMarkup(<MatchRoster match={match} onCorrectVote={vi.fn(async () => undefined)} onRemoveVote={vi.fn()} onAddExternal={vi.fn()} onUpdateExternal={vi.fn()} onRemoveExternal={vi.fn()} disabled={false} />)

    expect(markup).toContain('aria-label="Группа 19:00"')
    expect(markup).toContain('aria-label="Группа 20:00"')
    expect(markup).toContain('aria-label="Удалить Ранний из 19:00"')
    expect(markup).toContain('aria-label="Удалить Ранний из 20:00"')
    expect(markup).not.toContain('После 19:00')
    expect(markup.match(/>Ранний<\/span>/gu)).toHaveLength(2)
    expect(voteRemovalAction(match, match.roster.votes[0]!, 'at:19:00')).toEqual({
      type: 'replace_exact_times',
      exactTimes: ['20:00'],
    })
    expect(voteRemovalAction(match, match.roster.votes[1]!, 'at:20:00')).toEqual({ type: 'remove_vote' })
    expect(voteOptionFromDropTarget('at:20:00')).toBe('at:20:00')
    expect(availabilityCountAt(match, '19:00')).toBe(1)
    expect(availabilityCountAt(match, '20:00')).toBe(2)
  })

  it('only allows pseudonyms for players who already appeared through Telegram', () => {
    const confirmedPlayer: NormalizedPlayer = {
      id: 'player-1',
      displayName: 'Шоколадка228',
      avatarUrl: undefined,
      username: 'chocolate228',
      aliases: [],
      confirmed: true,
      confirmationState: 'confirmed',
      telegramUserId: '101',
      initials: 'Ш',
    }
    const unconfirmedPlayer: NormalizedPlayer = {
      ...confirmedPlayer,
      id: 'player-2',
      displayName: 'Заранее созданный',
      confirmed: false,
      confirmationState: 'unconfirmed',
      telegramUserId: undefined,
    }
    const markup = renderToStaticMarkup(<PlayersPanel players={[confirmedPlayer, unconfirmedPlayer]} onUpdatePlayer={vi.fn()} saving={false} />)

    expect(markup).toContain('Задавайте понятные имена')
    expect(markup).toContain('Добавить псевдоним Шоколадка228')
    expect(markup).toContain('@chocolate228')
    expect(markup).toContain(playerAvatarColor(confirmedPlayer.id))
    expect(markup).not.toContain('Заранее созданный')
    expect(markup).not.toContain('Добавить игрока')
    expect(validatePlayerPseudonym('')).toBe('Укажите понятное имя игрока.')
    expect(validatePlayerPseudonym('Никита')).toBeUndefined()
  })

  it('validates structured match values before a mutation is sent', () => {
    expect(validateEditorValues({ date: '2026-08-03', time: '20:00', timeMode: 'exact', timeOptions: [], location: 'A', venueType: 'outdoor', requiredPlayers: 10, fieldPriceByn: '' })).toBeUndefined()
    expect(validateEditorValues({ date: '2026-08-03', time: '20:00', timeMode: 'exact', timeOptions: [], location: 'Поле', venueType: 'outdoor', requiredPlayers: 10, fieldPriceByn: '12.5' })).toContain('целым')
    expect(validateEditorValues({ date: '2026-08-03', time: '20:00', timeMode: 'exact', timeOptions: [], location: 'Поле', venueType: 'outdoor', requiredPlayers: 10, fieldPriceByn: '12' })).toBeUndefined()
    expect(validateEditorValues({ date: '2026-08-03', time: '', timeMode: 'availability', timeOptions: ['19:00'], location: 'Поле', venueType: 'outdoor', requiredPlayers: 10, fieldPriceByn: '' })).toBeUndefined()
    expect(validateEditorValues({ date: '2026-08-03', time: '', timeMode: 'exact_options', timeOptions: ['19:00', '20:00'], location: 'Поле', venueType: 'outdoor', requiredPlayers: 10, fieldPriceByn: '' })).toBeUndefined()
  })

  it('keeps exact and after-time modes separate for the same selected time', () => {
    expect(editorTimeConfiguration(['19:00'], 'exact')).toEqual({ time: '19:00', timeMode: 'exact', timeOptions: [] })
    expect(editorTimeConfiguration(['19:00'], 'availability')).toEqual({ time: '', timeMode: 'availability', timeOptions: ['19:00'] })
    expect(editorTimeConfiguration(['20:00', '19:00'], 'exact')).toEqual({ time: '', timeMode: 'exact_options', timeOptions: ['19:00', '20:00'] })
    expect(editorTimeConfiguration(['20:00', '19:00'], 'availability')).toEqual({ time: '', timeMode: 'availability', timeOptions: ['19:00', '20:00'] })
  })

  it('defaults a new match time to the current local hour', () => {
    expect(currentHourTime(new Date(2026, 7, 3, 13, 23))).toBe('13:00')
    expect(currentHourTime(new Date(2026, 7, 3, 0, 59))).toBe('00:00')
  })

  it('lets the owner choose exact time or after-time availability explicitly', () => {
    const match = { ...normalizedMatch, time: '', timeMode: 'availability' as const, timeOptions: ['19:00', '20:00'] }
    const markup = renderToStaticMarkup(<MatchEditor match={match} onSave={vi.fn()} conflict="" onClearConflict={vi.fn()} saving={false} />)

    expect(markup).toContain('aria-label="Формат времени"')
    expect(markup).toContain('После 19:00')
    expect(markup).toContain('Добавить ещё время')
    expect(markup.match(/type="time"/gu)).toHaveLength(2)
    expect(markup).toContain('step="900"')
    expect(markup).not.toContain('Шаг — 15 минут')
    expect(markup).toContain('grid-cols-[minmax(0,1fr)_2.5rem]')
    expect(markup).toContain('aria-label="Удалить время 19:00"')
    expect(markup).toContain('aria-label="Удалить время 20:00"')

    const exactMarkup = renderToStaticMarkup(<MatchEditor match={normalizedMatch} onSave={vi.fn()} conflict="" onClearConflict={vi.fn()} saving={false} />)
    expect(exactMarkup).toContain('19:30')
    expect(exactMarkup).toContain('После 19:30')
    expect(exactMarkup).toContain('Добавить ещё время')
    expect(exactMarkup).not.toContain('aria-label="Удалить время')
  })

  it('uses a name-only venue autocomplete instead of manual place fields', async () => {
    const markup = renderToStaticMarkup(<MatchEditor match={normalizedMatch} onSave={vi.fn()} conflict="" onClearConflict={vi.fn()} saving={false} />)
    const autocompleteSource = await readFile(new URL('./components/football/venue-autocomplete.tsx', import.meta.url), 'utf8')

    expect(markup).toContain('role="combobox"')
    expect(markup).toContain('Выберите место')
    expect(markup).not.toContain('Тип площадки')
    expect(autocompleteSource).toContain('venue.name.toLocaleLowerCase().includes(needle)')
    expect(autocompleteSource).toContain('Добавить новое место')
  })
})
