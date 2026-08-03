import { expect, test, type Page } from '@playwright/test'

const catalogVenue = {
  id: '1',
  name: 'BOX365 Пушкинская',
  mapUrl: 'https://maps.example.test/box365-pushkin',
  venueType: 'indoor',
  bookingPhones: ['+375 29 123-45-67'],
  websiteUrl: 'https://box365.example.test',
  archivedAt: null,
  version: 1,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
}

async function mockOwnerApp(page: Page): Promise<void> {
  const availableVenues = [catalogVenue]

  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.abort())

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
    if (request.method() === 'GET' && pathname === '/v1/matches') return json({ matches: [] })
    if (request.method() === 'GET' && pathname === '/v1/players') return json({ players: [] })
    if (request.method() === 'GET' && pathname === '/v1/venues') return json({ venues: availableVenues })
    if (request.method() === 'POST' && pathname === '/v1/venues') {
      const values = request.postDataJSON() as Pick<typeof catalogVenue, 'name' | 'mapUrl' | 'venueType' | 'bookingPhones' | 'websiteUrl'>
      const venue = { ...catalogVenue, ...values, id: '2', version: 1 }
      availableVenues.push(venue)
      return json({ venue })
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND' }) })
  })
}

test('shows the owner venue catalog', async ({ page }, testInfo) => {
  await mockOwnerApp(page)
  await page.goto('/')

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
  expect(archiveBox!.y).toBe(editBox!.y)
  await page.screenshot({ path: testInfo.outputPath('venue-catalog.png'), fullPage: false })
})

test('searches by venue name and selects a venue created from the match form', async ({ page }, testInfo) => {
  await mockOwnerApp(page)
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
  await page.getByRole('button', { name: 'Добавить место', exact: true }).click()

  await expect(venueSelect).toContainText('BOX365 Октябрьская')
  await page.screenshot({ path: testInfo.outputPath('venue-autocomplete.png'), fullPage: false })
})
