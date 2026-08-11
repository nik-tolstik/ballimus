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

const poll = {
  id: '1', question: 'Кто играет в воскресенье?',
  options: [
    { text: 'Буду', notificationEnabled: true, voterCount: 0, notificationQueuedAt: null },
    { text: 'Не буду', notificationEnabled: false, voterCount: 0, notificationQueuedAt: null },
  ],
  notificationThreshold: 10, isAnonymous: false, allowsMultipleAnswers: false, allowsRevoting: true,
  publicationState: 'published', closedAt: null, archivedAt: null, lastError: null,
  createdAt: '2026-08-11T12:00:00.000Z', updatedAt: '2026-08-11T12:00:00.000Z',
}

async function mockOwnerApp(page: Page, options: { readonly existingPoll?: boolean } = {}): Promise<{ readonly weatherRequests: string[]; readonly republishRequests: string[]; readonly pollRequests: unknown[]; readonly archivePollRequests: string[] }> {
  const weatherRequests: string[] = []
  const republishRequests: string[] = []
  const pollRequests: unknown[] = []
  const archivePollRequests: string[] = []
  let pollListRequests = 0
  let pollArchived = false
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
    if (request.method() === 'GET' && pathname === '/v1/polls') {
      pollListRequests += 1
      const currentPoll = pollListRequests < 2 ? poll : { ...poll, options: [{ ...poll.options[0], voterCount: 1 }, poll.options[1]] }
      return json({ polls: options.existingPoll === true && !pollArchived ? [currentPoll] : [] })
    }
    if (request.method() === 'POST' && pathname === '/v1/polls') {
      const body = request.postDataJSON() as Record<string, unknown>
      pollRequests.push(body)
      return json({ poll: { id: '1', ...body, options: [], publicationState: 'pending', closedAt: null, archivedAt: null, lastError: null, createdAt: '2026-08-11T12:00:00.000Z', updatedAt: '2026-08-11T12:00:00.000Z' } })
    }
    if (request.method() === 'POST' && pathname === '/v1/polls/1/archive') { archivePollRequests.push(pathname); pollArchived = true; return json({ poll: { ...poll, archivedAt: '2026-08-11T12:30:00.000Z' } }) }
    if (request.method() === 'POST' && pathname === '/v1/weather/current') { weatherRequests.push(pathname); return json({ sent: true, observedAt: '2026-08-10T12:00' }) }
    if (request.method() === 'POST' && pathname === '/v1/matches/1/republish') { republishRequests.push(pathname); return json({ match: { ...match, version: 2 } }) }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND' }) })
  })
  return { weatherRequests, republishRequests, pollRequests, archivePollRequests }
}

async function faviconCornerAlpha(page: Page): Promise<number> {
  return page.locator('link[rel="icon"]').evaluate(async (element) => {
    const image = new Image()
    image.src = (element as HTMLLinkElement).href
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('Canvas is unavailable')
    context.drawImage(image, 0, 0)
    return context.getImageData(0, 0, 1, 1).data[3]
  })
}

test('shows static information cards without roster or voting controls', async ({ page }) => {
  const mocked = await mockOwnerApp(page)
  await page.goto('/')

  await expect(page).toHaveTitle('Ballimus Dev')
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /^data:image\/png;base64,/u)
  await expect.poll(() => faviconCornerAlpha(page)).toBe(0)
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
  await expect(page.getByRole('button', { name: 'Удалить', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Открыть матч Среда, 12 августа · 20:00-21:30', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Редактировать матч', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Удалить', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Действия матча', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Действия с матчем', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Переопубликовать матч', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Удалить', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Переопубликовать матч', exact: true }).click()
  await expect.poll(() => mocked.republishRequests).toEqual(['/v1/matches/1/republish'])
  await expect(page.getByRole('heading', { name: 'Действия с матчем', exact: true })).toHaveCount(0)
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
  const mapLink = page.getByRole('link', { name: 'В помещении', exact: true })
  await expect(mapLink).toHaveAttribute('href', venue.mapUrl)
  await page.context().route(`${venue.mapUrl}**`, (route) => route.fulfill({ contentType: 'text/html', body: '<title>Map</title>' }))
  const mapPage = page.waitForEvent('popup')
  await mapLink.click()
  await expect(await mapPage).toHaveURL(venue.mapUrl)
  await expect(page.getByRole('heading', { name: 'Места', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Карта', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Редактировать BOX365/u })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /В архив BOX365/u })).toHaveCount(0)
  await page.getByRole('button', { name: 'Открыть место BOX365 Пушкинская', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Редактировать место', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'В архив', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Действия места', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Действия с местом', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'В архив', exact: true })).toBeVisible()
})

test('creates a native poll with an option threshold notification', async ({ page }) => {
  const mocked = await mockOwnerApp(page)
  await page.goto('/')

  await page.getByRole('button', { name: 'Опросы', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Опросы', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Новый опрос', exact: true }).click()
  const publishPoll = page.getByRole('button', { name: 'Опубликовать опрос', exact: true })
  const newOption = page.getByLabel('Новый вариант', { exact: true })
  await expect(newOption).toBeVisible()
  await expect(newOption).toHaveAttribute('placeholder', 'Новый вариант')
  await expect(page.getByLabel('Вариант 1', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Переместить вариант/u })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Оповещение для варианта/u })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Удалить вариант/u })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Добавить вариант', exact: true })).toHaveCount(0)
  await expect(publishPoll).toBeDisabled()
  await page.getByLabel('Вопрос', { exact: true }).fill('Кто играет в воскресенье?')
  await page.waitForTimeout(250)
  const draftTopBeforeCreation = await newOption.evaluate((input) => {
    const row = input.closest('li')
    if (row === null) throw new Error('New poll option row is unavailable')
    return row.getBoundingClientRect().top
  })
  await newOption.fill('Буду')
  const creationAnimation = await page.evaluate(async () => {
    const samples: { createdTop: number; draftTop: number; draftHeight: number }[] = []
    for (let frame = 0; frame < 10; frame += 1) {
      const createdRow = document.querySelector('input[aria-label="Вариант 1"]')?.closest('li')
      const draftRow = document.querySelector('input[aria-label="Новый вариант"]')?.closest('li')
      if (createdRow === null || createdRow === undefined || draftRow === null || draftRow === undefined) throw new Error('Poll option animation rows are unavailable')
      const createdRect = createdRow.getBoundingClientRect()
      const draftRect = draftRow.getBoundingClientRect()
      samples.push({ createdTop: createdRect.top, draftTop: draftRect.top, draftHeight: draftRect.height })
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
    return samples
  })
  const createdTops = creationAnimation.map((sample) => sample.createdTop)
  const draftTops = creationAnimation.map((sample) => sample.draftTop)
  const draftHeights = creationAnimation.map((sample) => sample.draftHeight)
  expect(Math.max(...createdTops) - Math.min(...createdTops)).toBeLessThan(1)
  expect(Math.abs(createdTops[0]! - draftTopBeforeCreation)).toBeLessThan(1)
  expect(Math.max(...draftTops) - Math.min(...draftTops)).toBeLessThan(1)
  expect(draftHeights.at(-1)).toBeGreaterThan(draftHeights[0] ?? 0)
  expect(draftHeights.every((height, index) => index === 0 || height >= draftHeights[index - 1]!)).toBe(true)
  await expect(page.getByLabel('Вариант 1', { exact: true })).toHaveValue('Буду')
  await expect(newOption).toBeVisible()
  await expect(publishPoll).toBeDisabled()
  await newOption.fill('Не буду')
  await expect(page.getByLabel('Вариант 2', { exact: true })).toHaveValue('Не буду')
  await expect(newOption).toBeVisible()
  await expect(page.getByRole('button', { name: 'Удалить вариант 1', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Удалить вариант 2', exact: true })).toBeEnabled()
  await expect(publishPoll).toBeEnabled()
  const notification = page.getByRole('switch', { name: 'Оповестить о количестве', exact: true })
  await expect(notification).toBeChecked()
  await expect(page.getByLabel('Количество для оповещения', { exact: true })).toHaveValue('10')
  const secondOptionNotification = page.getByRole('button', { name: 'Оповещение для варианта 2', exact: true })
  await expect(secondOptionNotification).toHaveAttribute('aria-pressed', 'true')
  await secondOptionNotification.click()
  await expect(secondOptionNotification).toHaveAttribute('aria-pressed', 'false')
  await notification.click()
  await expect(notification).not.toBeChecked()
  await expect(page.getByRole('button', { name: /Оповещение для варианта/u })).toHaveCount(0)
  await notification.click()
  await expect(notification).toBeChecked()
  await expect(secondOptionNotification).toHaveAttribute('aria-pressed', 'false')
  await newOption.fill('Временно')
  await expect(page.getByLabel('Вариант 3', { exact: true })).toHaveValue('Временно')
  await expect(newOption).toBeVisible()
  await page.getByLabel('Вариант 3', { exact: true }).fill('')
  await expect(page.getByLabel('Вариант 3', { exact: true })).toBeFocused()
  await expect(page.getByLabel('Вариант 3', { exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Удалить вариант 3', exact: true })).toBeVisible()
  await page.getByLabel('Вариант 3', { exact: true }).press('Backspace')
  const deletionAnimation = await page.evaluate(async () => {
    const samples: { groupHeight: number; deletedHeight: number | null; maxOverflow: number }[] = []
    for (let frame = 0; frame < 16; frame += 1) {
      const group = document.querySelector('input[aria-label="Новый вариант"]')?.closest('ul')
      if (group === null || group === undefined) throw new Error('Poll option group is unavailable during deletion')
      const groupRect = group.getBoundingClientRect()
      const rows = [...group.querySelectorAll(':scope > li')]
      const deletedRow = group.querySelector('input[aria-label="Вариант 3"]')?.closest('li')
      const overflow = rows.flatMap((row) => {
        const rect = row.getBoundingClientRect()
        return [rect.bottom - groupRect.bottom, groupRect.top - rect.top]
      })
      samples.push({
        groupHeight: groupRect.height,
        deletedHeight: deletedRow?.getBoundingClientRect().height ?? null,
        maxOverflow: Math.max(0, ...overflow),
      })
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
    return samples
  })
  const deletionGroupHeights = deletionAnimation.map((sample) => sample.groupHeight)
  const deletedOptionHeights = deletionAnimation.flatMap((sample) => sample.deletedHeight === null ? [] : [sample.deletedHeight])
  const deletionGroupHeightIncreases = deletionGroupHeights.slice(1).map((height, index) => height - deletionGroupHeights[index]!)
  expect(deletionAnimation.every((sample) => sample.maxOverflow < 1)).toBe(true)
  expect(Math.max(0, ...deletionGroupHeightIncreases)).toBeLessThan(1)
  expect(deletedOptionHeights.at(-1)).toBeLessThan(deletedOptionHeights[0] ?? 0)
  await expect(page.getByLabel('Вариант 3', { exact: true })).toHaveCount(0)
  await expect(newOption).toBeFocused()
  await newOption.fill('Возможно')
  await expect(page.getByLabel('Вариант 3', { exact: true })).toHaveValue('Возможно')
  await expect(newOption).toBeVisible()
  await expect(page.getByRole('button', { name: 'Удалить вариант 3', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Переместить вариант 3', exact: true }).press('ArrowUp')
  await expect(page.getByLabel('Вариант 2', { exact: true })).toHaveValue('Возможно')
  await expect(page.getByLabel('Вариант 3', { exact: true })).toHaveValue('Не буду')
  await expect(page.getByText('Голос можно отменять', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Анонимное голосование', { exact: true })).toHaveCount(0)
  const multipleAnswers = page.getByRole('switch', { name: 'Несколько ответов', exact: true })
  await expect(multipleAnswers).not.toBeChecked()
  await multipleAnswers.click()
  await expect(multipleAnswers).toBeChecked()
  await publishPoll.click()

  await expect.poll(() => mocked.pollRequests).toEqual([{
    question: 'Кто играет в воскресенье?',
    options: [
      { text: 'Буду', notificationEnabled: true },
      { text: 'Возможно', notificationEnabled: true },
      { text: 'Не буду', notificationEnabled: false },
    ],
    notificationThreshold: 10,
    allowsMultipleAnswers: true,
  }])
  await expect(page.getByText('Опрос отправлен в Telegram.', { exact: true })).toBeVisible()
})

test('opens a poll, refreshes Telegram vote counts, and archives it', async ({ page }) => {
  const mocked = await mockOwnerApp(page, { existingPoll: true })
  await page.goto('/')

  await page.getByRole('button', { name: 'Опросы', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Опросы', exact: true })).toBeVisible()
  await page.getByRole('button', { name: `Открыть опрос ${poll.question}`, exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Опрос', exact: true })).toBeVisible()
  await expect(page.getByText('Неанонимное голосование', { exact: true })).toBeVisible()
  await expect(page.getByText('Голос можно отменять', { exact: true })).toBeVisible()
  await expect(page.getByText('Оповестить о количестве', { exact: true })).toBeVisible()
  await expect(page.getByLabel('1 голосов', { exact: true })).toBeVisible({ timeout: 5_000 })
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Опрос будет удалён из Telegram')
    await dialog.accept()
  })
  await page.getByRole('button', { name: 'В архив', exact: true }).click()
  await expect.poll(() => mocked.archivePollRequests).toEqual(['/v1/polls/1/archive'])
  await expect(page.getByRole('heading', { name: 'Опрос', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: `Открыть опрос ${poll.question}`, exact: true })).toHaveCount(0)
  await expect(page.getByText('Опрос перемещён в архив и удаляется из Telegram.', { exact: true })).toBeVisible()
})
