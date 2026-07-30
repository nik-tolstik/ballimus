import { useEffect, useState } from 'react'

import { configureApiClient } from '@football/api-client'

export interface TelegramInsets {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

export interface TelegramTheme {
  readonly backgroundColor: string | undefined
  readonly secondaryBackgroundColor: string | undefined
  readonly textColor: string | undefined
  readonly hintColor: string | undefined
  readonly buttonColor: string | undefined
  readonly buttonTextColor: string | undefined
  readonly headerBackgroundColor: string | undefined
}

export interface TelegramWebAppApi {
  readonly initData?: unknown
  readonly colorScheme?: unknown
  readonly themeParams?: unknown
  readonly safeAreaInset?: unknown
  readonly contentSafeAreaInset?: unknown
  readonly ready: () => void
  readonly expand?: () => void
}

export type TelegramSessionStatus = 'loading' | 'ready' | 'outside-telegram' | 'unauthorized' | 'error'

export interface TelegramSession {
  readonly status: TelegramSessionStatus
  readonly initData: string | undefined
  readonly theme: TelegramTheme
  readonly safeArea: TelegramInsets
  readonly reason?: string
}

const EMPTY_INSETS: TelegramInsets = { top: 0, bottom: 0, left: 0, right: 0 }
const EMPTY_THEME: TelegramTheme = {
  backgroundColor: undefined,
  secondaryBackgroundColor: undefined,
  textColor: undefined,
  hintColor: undefined,
  buttonColor: undefined,
  buttonTextColor: undefined,
  headerBackgroundColor: undefined,
}

interface TelegramWindow {
  readonly Telegram?: { readonly WebApp?: TelegramWebAppApi }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function readInsets(value: unknown): TelegramInsets {
  const source = isRecord(value) ? value : {}
  return {
    top: numberValue(source['top']) ?? 0,
    bottom: numberValue(source['bottom']) ?? 0,
    left: numberValue(source['left']) ?? 0,
    right: numberValue(source['right']) ?? 0,
  }
}

function readTheme(value: unknown): TelegramTheme {
  const source = isRecord(value) ? value : {}
  return {
    backgroundColor: stringValue(source['bg_color']),
    secondaryBackgroundColor: stringValue(source['secondary_bg_color']),
    textColor: stringValue(source['text_color']),
    hintColor: stringValue(source['hint_color']),
    buttonColor: stringValue(source['button_color']),
    buttonTextColor: stringValue(source['button_text_color']),
    headerBackgroundColor: stringValue(source['header_bg_color']),
  }
}

function webAppFromWindow(): TelegramWebAppApi | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as TelegramWindow).Telegram?.WebApp
}

function setCssVariable(name: string, value: string | number | undefined): void {
  if (typeof document === 'undefined' || value === undefined) return
  document.documentElement.style.setProperty(name, String(value))
}

export function applyTelegramTheme(theme: TelegramTheme, safeArea: TelegramInsets): void {
  setCssVariable('--tg-bg-color', theme.backgroundColor)
  setCssVariable('--tg-secondary-bg-color', theme.secondaryBackgroundColor)
  setCssVariable('--tg-text-color', theme.textColor)
  setCssVariable('--tg-hint-color', theme.hintColor)
  setCssVariable('--tg-button-color', theme.buttonColor)
  setCssVariable('--tg-button-text-color', theme.buttonTextColor)
  setCssVariable('--tg-header-bg-color', theme.headerBackgroundColor)
  setCssVariable('--tg-safe-top', `${safeArea.top}px`)
  setCssVariable('--tg-safe-bottom', `${safeArea.bottom}px`)
  setCssVariable('--tg-safe-left', `${safeArea.left}px`)
  setCssVariable('--tg-safe-right', `${safeArea.right}px`)
}

export function initializeTelegramWebApp(): TelegramSession {
  const webApp = webAppFromWindow()
  if (webApp === undefined) {
    return { status: 'outside-telegram', initData: undefined, theme: EMPTY_THEME, safeArea: EMPTY_INSETS, reason: 'Откройте мини-приложение из Telegram.' }
  }

  const initData = stringValue(webApp.initData)
  const theme = readTheme(webApp.themeParams)
  const safeArea = readInsets(webApp.safeAreaInset)
  applyTelegramTheme(theme, safeArea)
  if (initData === undefined) {
    return { status: 'unauthorized', initData: undefined, theme, safeArea, reason: 'Telegram не передал подписанную сессию мини-приложения.' }
  }

  try {
    webApp.ready()
    webApp.expand?.()
    configureApiClient({ telegramInitData: initData })
    return { status: 'ready', initData, theme, safeArea }
  } catch {
    return { status: 'error', initData, theme, safeArea, reason: 'Telegram не смог запустить мини-приложение.' }
  }
}

export function useTelegramWebApp(): TelegramSession {
  const [session, setSession] = useState<TelegramSession>({ status: 'loading', initData: undefined, theme: EMPTY_THEME, safeArea: EMPTY_INSETS })
  useEffect(() => { setSession(initializeTelegramWebApp()) }, [])
  return session
}
