import type {
  BootstrapResponseDto,
  MatchEnvelopeResponseDto,
  MatchListResponseDto,
  MatchResponseDto,
  PlayerListResponseDto,
} from '@football/api-client'

import { formatMatchDate } from './lib/date-format'

export type NormalizedMatchStatus = MatchResponseDto['status']
export type NormalizedVoteOption = 'going' | 'maybe' | 'not_going'
export type NormalizedTimeMode = 'exact' | 'exact_options' | 'availability'
export type NormalizedPlanningStage = NonNullable<MatchResponseDto['planningStage']>
export type NormalizedRosterTarget = NormalizedVoteOption | `after:${string}` | `at:${string}`

export interface NormalizedVote {
  readonly playerId: string
  readonly telegramUserId: string
  readonly username: string | undefined
  readonly readableName: string
  readonly avatarUrl: string | undefined
  readonly option: NormalizedVoteOption
  readonly availableAfter?: string | undefined
  readonly exactTimes: readonly string[]
}

export interface NormalizedExternalParticipant {
  readonly id: string
  readonly displayName: string
  readonly quantity: number
}

export interface NormalizedRoster {
  readonly votes: readonly NormalizedVote[]
  readonly externalParticipants: readonly NormalizedExternalParticipant[]
}

export interface NormalizedMatch {
  readonly id: string
  readonly title: string
  readonly dateLabel: string
  readonly date: string
  readonly time: string
  readonly timeMode: NormalizedTimeMode
  readonly timeOptions: readonly string[]
  readonly selectedTime: string | undefined
  readonly location: string
  readonly venueType: 'outdoor' | 'indoor' | undefined
  readonly status: NormalizedMatchStatus
  readonly planningStage: NormalizedPlanningStage | undefined
  readonly statusLabel: string
  readonly statusShortLabel: string
  readonly goingCount: number
  readonly requiredPlayers: number
  readonly fieldPriceByn: number | undefined
  readonly version: number
  readonly cancellationReason: string | undefined
  readonly publicCardState: string
  readonly reconciliationRequired: boolean
  readonly telegramMessageId: string | undefined
  readonly roster: NormalizedRoster
}

export interface NormalizedPlayerAlias {
  readonly username: string
  readonly normalizedUsername: string
}

export interface NormalizedPlayer {
  readonly id: string
  readonly displayName: string
  readonly avatarUrl: string | undefined
  readonly username: string | undefined
  readonly aliases: readonly NormalizedPlayerAlias[]
  readonly confirmed: boolean
  readonly confirmationState: 'confirmed' | 'unconfirmed'
  readonly telegramUserId: string | undefined
  readonly initials: string
}

export interface NormalizedDashboard {
  readonly matches: readonly NormalizedMatch[]
  readonly players: readonly NormalizedPlayer[]
  readonly history: readonly NormalizedMatch[]
}

const PLANNING_STAGE_LABELS: Record<NormalizedPlanningStage, string> = {
  recruiting_players: 'Набираем игроков',
  finalizing_details: 'Уточняем время и место',
  ready_to_confirm: 'Готов к подтверждению',
}

const PLANNING_STAGE_SHORT_LABELS: Record<NormalizedPlanningStage, string> = {
  recruiting_players: 'Набираем игроков',
  finalizing_details: 'Уточнить детали',
  ready_to_confirm: 'Можно подтверждать',
}

function statusLabel(status: NormalizedMatchStatus, planningStage: NormalizedPlanningStage | undefined): string {
  if (status === 'active') return planningStage === undefined ? 'Открыт' : PLANNING_STAGE_LABELS[planningStage]
  if (status === 'confirmed') return 'Подтверждён'
  if (status === 'completed') return 'Завершён'
  if (status === 'cancelled') return 'Отменён'
  return 'Черновик'
}

function statusShortLabel(status: NormalizedMatchStatus, planningStage: NormalizedPlanningStage | undefined): string {
  if (status === 'active' && planningStage !== undefined) return PLANNING_STAGE_SHORT_LABELS[planningStage]
  return statusLabel(status, planningStage)
}

export function normalizeMatch(match: MatchResponseDto): NormalizedMatch {
  const date = match.schedule.date ?? ''
  const time = match.schedule.time ?? ''
  const planningStage = match.planningStage ?? undefined
  return {
    id: match.id,
    title: match.displayTitle || match.title || `Матч ${match.id}`,
    dateLabel: formatMatchDate(date, match.timeMode !== 'exact' && match.selectedTime === null ? 'время выбираем' : time),
    date,
    time,
    timeMode: match.timeMode,
    timeOptions: match.timeOptions,
    selectedTime: match.selectedTime ?? undefined,
    location: match.location ?? 'Место уточняется',
    venueType: match.venueType ?? undefined,
    status: match.status,
    planningStage,
    statusLabel: statusLabel(match.status, planningStage),
    statusShortLabel: statusShortLabel(match.status, planningStage),
    goingCount: match.roster.counts.goingCount,
    requiredPlayers: match.requiredPlayers,
    fieldPriceByn: match.fieldPriceRubles ?? undefined,
    version: match.version,
    cancellationReason: match.cancellationReason ?? undefined,
    publicCardState: match.publicCard.publicationState,
    reconciliationRequired: match.publicCard.reconciliationRequired,
    telegramMessageId: match.publicCard.telegramMessageId ?? undefined,
    roster: {
      votes: match.roster.votes.map((vote) => ({
        playerId: vote.playerId,
        telegramUserId: vote.telegramUserId,
        username: vote.username ?? undefined,
        readableName: vote.readableName ?? (vote.username === null ? `Игрок ${vote.playerId}` : `@${vote.username}`),
        avatarUrl: vote.avatarUrl ?? undefined,
        option: vote.option,
        availableAfter: vote.availableAfter ?? undefined,
        exactTimes: vote.exactTimes,
      })),
      externalParticipants: match.roster.externalParticipants.map((participant) => ({
        id: participant.id,
        displayName: participant.displayName ?? 'Дополнительные игроки',
        quantity: participant.quantity,
      })),
    },
  }
}

export function normalizeMatchEnvelope(response: MatchEnvelopeResponseDto | undefined): NormalizedMatch | undefined {
  return response === undefined ? undefined : normalizeMatch(response.match)
}

function collectMatches(
  bootstrap: BootstrapResponseDto | undefined,
  matchesResponse: MatchListResponseDto | undefined,
): readonly MatchResponseDto[] {
  if (matchesResponse !== undefined) return matchesResponse.matches
  if (bootstrap === undefined) return []
  return [
    ...bootstrap.matches.drafts,
    ...bootstrap.matches.active,
    ...bootstrap.matches.confirmed,
    ...bootstrap.matches.history,
  ]
}

export function normalizeMatches(
  bootstrap: BootstrapResponseDto | undefined,
  matchesResponse: MatchListResponseDto | undefined,
): readonly NormalizedMatch[] {
  return collectMatches(bootstrap, matchesResponse).map(normalizeMatch)
}

function initials(displayName: string): string {
  const parts = displayName.split(/\s+/u).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('')
}

export function normalizePlayers(playersResponse: PlayerListResponseDto | undefined): readonly NormalizedPlayer[] {
  if (playersResponse === undefined) return []
  return playersResponse.players.map((player) => {
    const aliases = player.usernames.map((alias) => ({
      username: alias.username,
      normalizedUsername: alias.normalizedUsername,
    }))
    const username = player.telegramUsernameSnapshot ?? aliases[0]?.username
    const displayName = player.displayName
      ?? player.telegramFirstNameSnapshot
      ?? (username === undefined ? 'Игрок без имени' : `@${username.replace(/^@/u, '')}`)
    return {
      id: player.id,
      displayName,
      avatarUrl: player.avatarUrl ?? undefined,
      username,
      aliases,
      confirmed: player.confirmed,
      confirmationState: player.confirmationState,
      telegramUserId: player.telegramUserId ?? undefined,
      initials: initials(displayName),
    }
  })
}

export function normalizeDashboard(
  bootstrap: BootstrapResponseDto | undefined,
  matchesResponse: MatchListResponseDto | undefined,
  playersResponse: PlayerListResponseDto | undefined,
): NormalizedDashboard {
  const matches = normalizeMatches(bootstrap, matchesResponse)
  return {
    matches,
    players: normalizePlayers(playersResponse),
    history: matches.filter((match) => match.status === 'completed' || match.status === 'cancelled'),
  }
}
