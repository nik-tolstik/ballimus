import { expect, test, type Page } from '@playwright/test'

const venue = {
  id: '1', name: 'BOX365 Пушкинская', mapUrl: 'https://maps.example.test/box365-pushkin', venueType: 'indoor',
  bookingContacts: [], websiteUrl: null, archivedAt: null, version: 1,
  createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-01T12:00:00.000Z',
}

const match = {
  id: '1', chatId: '-100', scheduledAt: '2026-08-12T17:00:00.000Z',
  schedule: { date: '2026-08-12', time: '20:00', timezone: 'Europe/Minsk' }, durationMinutes: 90, venue,
  fieldPriceRubles: 120, version: 1, creatorTelegramUserId: '1', deletionRequestedAt: null,
  createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-01T12:00:00.000Z',
  publicCard: { publicationState: 'pending', telegramMessageId: '10', publicationAttemptedAt: '2026-08-01T12:00:01.000Z', lastError: null },
}

async function mockOwnerApp(page: Page): Promise<{ readonly weatherRequests: string[] }> {
  const weatherRequests: string[] = []
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }))
  await page.addInitScript(() => {
    Object.defineProperty(window, '__FOOTBALL_API_BASE_URL__', { configurable: true, value: 'http://127.0.0.1:6174' })
    Object.defineProperty(window, 'Telegram', { configurable: true, value: { WebApp: { initData: 'playwright-owner-fixture', colorScheme: 'light', themeParams: {}, safeAreaInset: {}, contentSafeAreaInset: {}, ready: () => undefined, expand: () => undefined } } })
  })
  await page.route(/\/v1(?:\/|$)/, async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
    if (request.method() === 'GET' && pathname === '/v1/matches') return json({ matches: [
      match,
      { ...match, id: '2', schedule: { ...match.schedule, time: '21:00' }, venue: { ...venue, id: '2', name: 'BOX365 Второй' }, fieldPriceRubles: 121, publicCard: { ...match.publicCard, publicationState: 'published' } },
      { ...match, id: '3', schedule: { ...match.schedule, time: '22:00' }, venue: { ...venue, id: '3', name: 'BOX365 Третий' }, fieldPriceRubles: 122, publicCard: { ...match.publicCard, publicationState: 'failed', lastError: 'Telegram unavailable' } },
    ] })
    if (request.method() === 'GET' && pathname === '/v1/venues') return json({ venues: [venue] })
    if (request.method() === 'POST' && pathname === '/v1/weather/current') { weatherRequests.push(pathname); return json({ sent: true, observedAt: '2026-08-10T12:00' }) }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND' }) })
  })
  return { weatherRequests }
}

test('shows static information cards without roster or voting controls', async ({ page }) => {
  await mockOwnerApp(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Матчи', exact: true })).toBeVisible()
  await expect(page.getByText('Среда, 12 августа · 20:00-21:30', { exact: true })).toBeVisible()
  const mapLink = page.getByRole('link', { name: 'BOX365 Пушкинская · В помещении', exact: true })
  await expect(mapLink).toHaveAttribute('href', venue.mapUrl)
  await page.context().route(`${venue.mapUrl}**`, (route) => route.fulfill({ contentType: 'text/html', body: '<title>Map</title>' }))
  const mapPage = page.waitForEvent('popup')
  await mapLink.click()
  await expect(await mapPage).toHaveURL(venue.mapUrl)
  await expect(page.getByText('120 руб.', { exact: true })).toBeVisible()
  await expect(page.getByText('Публикуется', { exact: true })).toHaveAttribute('data-variant', 'info')
  await expect(page.getByText('Опубликована', { exact: true })).toHaveAttribute('data-variant', 'success')
  await expect(page.getByText('Ошибка публикации', { exact: true })).toHaveAttribute('data-variant', 'destructive')
  await expect(page.getByRole('status', { name: 'Публикация карточки' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Карта', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Редактировать матч/u })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Удалить матч', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Открыть матч Среда, 12 августа · 20:00-21:30', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Редактировать матч', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Удалить матч', exact: true })).toBeVisible()
  await expect(page.getByText(/Игроки|Голосования|Состав/u)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Игроки', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'История', exact: true })).toHaveCount(0)
})

test('sends current weather globally and keeps the venue catalog available', async ({ page }) => {
  const mocked = await mockOwnerApp(page)
  await page.goto('/')

  await page.getByRole('button', { name: 'Погода', exact: true }).click()
  await expect.poll(() => mocked.weatherRequests).toEqual(['/v1/weather/current'])
  await page.getByRole('button', { name: 'Места', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Места', exact: true })).toBeVisible()
  await expect(page.getByText('BOX365 Пушкинская', { exact: true })).toBeVisible()
})
