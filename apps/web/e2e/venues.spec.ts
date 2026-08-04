import { expect, test, type Page } from '@playwright/test'

const catalogVenue = {
  id: '1',
  name: 'BOX365 Пушкинская',
  mapUrl: 'https://maps.example.test/box365-pushkin',
  venueType: 'indoor',
  bookingContacts: [{ name: 'Администратор', phone: '+375 29 123-45-67' }],
  websiteUrl: 'https://box365.example.test',
  archivedAt: null,
  version: 1,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
}

function matchFixture(overrides: Record<string, unknown>) {
  return {
    id: '1',
    chatId: '-100',
    scheduledAt: '2026-08-12T17:00:00.000Z',
    timeMode: 'exact',
    timeOptions: [],
    selectedTime: null,
    schedule: { date: '2026-08-12', time: '20:00', timezone: 'Europe/Minsk' },
    location: 'BOX365 Пушкинская',
    venueType: 'indoor',
    venue: catalogVenue,
    fieldPriceRubles: 120,
    title: 'Устаревший заголовок матча',
    displayTitle: 'Устаревший заголовок матча',
    requiredPlayers: 10,
    status: 'active',
    planningStage: 'recruiting_players',
    version: 1,
    cancellationReason: null,
    creatorTelegramUserId: '1',
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    roster: { counts: { goingVotes: 4, externalParticipants: 0, goingCount: 4, requiredPlayers: 10, thresholdReached: false, remainingToThreshold: 6 }, votes: [], externalParticipants: [] },
    publicCard: { publicationState: 'published', reconciliationState: 'none', reconciliationRequired: false, telegramChatId: '-100', telegramTopicId: '1', telegramMessageId: '10', publicationAttemptedAt: null, publicationUncertainAt: null },
    ...overrides,
  }
}

async function mockOwnerApp(page: Page, matches: readonly Record<string, unknown>[] = []): Promise<string[]> {
  const availableVenues = [catalogVenue]
  const consoleErrors: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }))

  await page.addInitScript(() => {
    Object.defineProperty(window, '__FOOTBALL_API_BASE_URL__', {
      configurable: true,
      value: 'http://127.0.0.1:6174',
    })

    Object.defineProperty(window, 'Telegram', {
      configurable: true,
      value: {
        WebApp: {
          initData: 'playwright-owner-fixture',
          colorScheme: 'light',
          themeParams: {},
          safeAreaInset: {},
          contentSafeAreaInset: {},
          ready: () => undefined,
          expand: () => undefined,
        },
      },
    })
  })

  await page.route(/\/v1(?:\/|$)/, async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })

    if (request.method() === 'GET' && pathname === '/v1/bootstrap') {
      return json({
        owner: { telegramUserId: '1' },
        group: { telegramChatId: '-100', generalTopicId: '1', chatTopicId: '2' },
        timezone: 'Europe/Minsk',
        matches: { drafts: [], active: [], confirmed: [], history: [] },
      })
    }
    if (request.method() === 'GET' && pathname === '/v1/matches') return json({ matches })
    if (request.method() === 'GET' && pathname === '/v1/players') return json({ players: [] })
    if (request.method() === 'GET' && pathname === '/v1/venues') return json({ venues: availableVenues })
    if (request.method() === 'POST' && pathname === '/v1/venues') {
      const values = request.postDataJSON() as Pick<typeof catalogVenue, 'name' | 'mapUrl' | 'venueType' | 'bookingContacts' | 'websiteUrl'>
      const venue = { ...catalogVenue, ...values, id: '2', version: 1 }
      availableVenues.push(venue)
      return json({ venue })
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND' }) })
  })

  return consoleErrors
}

test('shows the owner venue catalog', async ({ page }, testInfo) => {
  const consoleErrors = await mockOwnerApp(page)
  await page.goto('/')

  await expect(page).toHaveTitle(/Ballimus/u)
  await expect(page).toHaveURL(/127\.0\.0\.1:6174/u)
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  await expect(page.getByText('Матчей пока нет')).toBeVisible()
  await page.getByRole('button', { name: 'Места', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Места', exact: true })).toBeVisible()
  await expect(page.getByText(catalogVenue.name, { exact: true })).toBeVisible()
  const searchInput = page.getByPlaceholder('Поиск по названию')
  const archiveToggle = page.getByRole('button', { name: 'Архив', exact: true })
  const editButton = page.getByRole('button', { name: `Редактировать ${catalogVenue.name}`, exact: true })
  const archiveButton = page.getByRole('button', { name: `В архив ${catalogVenue.name}`, exact: true })
  const [searchBox, archiveToggleBox, editBox, archiveBox] = await Promise.all([
    searchInput.boundingBox(),
    archiveToggle.boundingBox(),
    editButton.boundingBox(),
    archiveButton.boundingBox(),
  ])
  expect(searchBox).not.toBeNull()
  expect(archiveToggleBox).not.toBeNull()
  expect(editBox).not.toBeNull()
  expect(archiveBox).not.toBeNull()
  expect(archiveToggleBox!.height).toBe(searchBox!.height)
  expect(archiveBox!.x).toBeGreaterThan(editBox!.x)
  expect(Math.abs(archiveBox!.y - editBox!.y)).toBeLessThan(1)
  expect(consoleErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('venue-catalog.png'), fullPage: false })
  await page.getByRole('button', { name: 'Включить тёмную тему', exact: true }).click()
  await expect(page.locator('html')).toHaveClass(/dark/u)
  await page.screenshot({ path: testInfo.outputPath('venue-catalog-dark.png'), fullPage: false })
})

test('searches by venue name and selects a venue created from the match form', async ({ page }, testInfo) => {
  const consoleErrors = await mockOwnerApp(page)
  await page.goto('/')

  await page.getByRole('button', { name: 'Новый матч', exact: true }).click()
  const venueSelect = page.getByRole('combobox', { name: 'Выбор места', exact: true })
  await venueSelect.click()
  await page.getByPlaceholder('Поиск по названию').fill('Пушкинская')
  await page.getByRole('option', { name: catalogVenue.name, exact: true }).click()
  await expect(venueSelect).toContainText(catalogVenue.name)

  await venueSelect.click()
  await page.getByRole('button', { name: 'Добавить новое место', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Новое место', exact: true })).toBeVisible()
  await page.locator('#venue-name').fill('BOX365 Октябрьская')
  await page.locator('#venue-map-url').fill('https://maps.example.test/box365-october')
  const phoneInput = page.getByLabel('Телефон для бронирования 1')
  const nameInput = page.getByLabel('Имя контакта 1')
  const [phoneBox, nameBox] = await Promise.all([phoneInput.boundingBox(), nameInput.boundingBox()])
  expect(phoneBox).not.toBeNull()
  expect(nameBox).not.toBeNull()
  expect(phoneBox!.x).toBeLessThan(nameBox!.x)
  expect(phoneBox!.width).toBeGreaterThan(nameBox!.width)
  await page.screenshot({ path: testInfo.outputPath('venue-contact-fields.png'), fullPage: false })
  await phoneInput.fill('+375 29 123-45-67')
  await nameInput.fill('Администратор')
  await page.getByRole('button', { name: 'Добавить место', exact: true }).click()

  await expect(venueSelect).toContainText('BOX365 Октябрьская')
  expect(consoleErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('venue-autocomplete.png'), fullPage: false })
})

test('orders match cards by progression without duplicating the pending-time label', async ({ page }, testInfo) => {
  const consoleErrors = await mockOwnerApp(page, [
    matchFixture({ id: '1', status: 'draft', planningStage: null }),
    matchFixture({ id: '2', timeMode: 'availability', timeOptions: ['19:00', '20:00'], scheduledAt: null, schedule: { date: '2026-08-12', time: null, timezone: 'Europe/Minsk' }, displayTitle: 'Вторник, 12 августа · время выбираем' }),
    matchFixture({ id: '3', status: 'confirmed', planningStage: null }),
    matchFixture({ id: '4', planningStage: 'finalizing_details' }),
  ])
  await page.goto('/')

  await expect(page.locator('[aria-label="Предстоящие матчи"] > section')).toHaveCount(3)
  const groupOrder = await page.locator('[aria-label="Предстоящие матчи"] > section').evaluateAll((sections) => sections.map((section) => section.getAttribute('aria-labelledby')))
  const activeMatchOrder = await page.locator('[aria-labelledby="match-group-active"] [aria-label^="Открыть матч"]').evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label')))
  expect(groupOrder).toEqual(['match-group-confirmed', 'match-group-active', 'match-group-draft'])
  expect(activeMatchOrder).toEqual(['Открыть матч #4', 'Открыть матч #2'])
  await expect(page.getByRole('heading', { name: 'Черновики', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Открытые', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Подтверждённые', exact: true })).toBeVisible()
  const pendingTimeCard = page.getByRole('button', { name: 'Открыть матч #2', exact: true })
  await expect(pendingTimeCard).not.toContainText('Дата и время')
  await expect(pendingTimeCard).not.toContainText('Место')
  await expect(pendingTimeCard.locator('[data-slot="separator"]')).toHaveCount(0)
  await expect(pendingTimeCard).toContainText('время выбираем')
  await expect(pendingTimeCard).toContainText('4 из 10')
  await expect(pendingTimeCard).not.toContainText('Устаревший заголовок матча')
  const pendingTimeCardText = await pendingTimeCard.textContent()
  expect(pendingTimeCardText?.match(/время выбираем/gu) ?? []).toHaveLength(1)
  await expect(pendingTimeCard.locator('[data-match-status-label="active"]')).toHaveClass(/text-blue-700/u)
  await expect(page.locator('[data-match-status-accent="active"].bg-blue-500')).toHaveCount(1)
  await expect(page.locator('[data-match-status-label="confirmed"]')).toHaveClass(/text-success/u)
  expect(consoleErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('match-lifecycle-groups.png'), fullPage: false })
})
