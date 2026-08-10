import { useState } from 'react'
import { Bell, BellOff, Plus, Send, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

export interface PollEditorOptionValues {
  readonly key: string
  readonly text: string
  readonly notificationThreshold: string | null
}

export interface PollEditorValues {
  readonly question: string
  readonly options: readonly PollEditorOptionValues[]
  readonly isAnonymous: boolean
  readonly allowsMultipleAnswers: boolean
}

function option(key: number): PollEditorOptionValues {
  return { key: String(key), text: '', notificationThreshold: null }
}

export function validatePollEditorValues(values: PollEditorValues): string | undefined {
  const question = values.question.trim()
  if (question.length < 1 || question.length > 300) return 'Введите вопрос длиной до 300 символов.'
  if (values.options.length < 2 || values.options.length > 12) return 'Добавьте от 2 до 12 вариантов ответа.'
  for (const item of values.options) {
    const text = item.text.trim()
    if (text.length < 1 || text.length > 100) return 'Заполните каждый вариант ответа (до 100 символов).'
    if (item.notificationThreshold !== null) {
      const threshold = Number(item.notificationThreshold)
      if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 1_000_000) {
        return 'Порог оповещения должен быть целым числом от 1 до 1 000 000.'
      }
    }
  }
  return undefined
}

export function PollEditor({ onSave, saving }: { readonly onSave: (values: PollEditorValues) => void; readonly saving: boolean }) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<readonly PollEditorOptionValues[]>([option(1), option(2)])
  const [nextKey, setNextKey] = useState(3)
  const [isAnonymous, setIsAnonymous] = useState(true)
  const [allowsMultipleAnswers, setAllowsMultipleAnswers] = useState(false)
  const [validation, setValidation] = useState('')

  const updateOption = (key: string, patch: Partial<PollEditorOptionValues>) => {
    setOptions((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item))
    setValidation('')
  }
  const addOption = () => {
    if (options.length >= 12) return
    setOptions((current) => [...current, option(nextKey)])
    setNextKey((current) => current + 1)
  }
  const submit = () => {
    const values = { question, options, isAnonymous, allowsMultipleAnswers }
    const error = validatePollEditorValues(values)
    if (error !== undefined) { setValidation(error); return }
    setValidation('')
    onSave(values)
  }

  return <form aria-label="Форма создания опроса" className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); submit() }}>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <FieldGroup className="gap-4">
        <Field data-invalid={validation.startsWith('Введите вопрос')}><FieldLabel htmlFor="poll-question">Вопрос</FieldLabel><Input id="poll-question" maxLength={300} value={question} onChange={(event) => { setQuestion(event.target.value); setValidation('') }} /></Field>
        <div className="flex flex-col gap-3">
          <FieldLabel>Варианты ответа</FieldLabel>
          {options.map((item, index) => <Card key={item.key} size="sm"><CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2"><Input aria-label={`Вариант ${String(index + 1)}`} maxLength={100} value={item.text} onChange={(event) => updateOption(item.key, { text: event.target.value })} placeholder={`Вариант ${String(index + 1)}`} />{options.length > 2 ? <Button type="button" variant="ghost" size="icon" aria-label={`Удалить вариант ${String(index + 1)}`} onClick={() => setOptions((current) => current.filter((candidate) => candidate.key !== item.key))}><Trash2 /></Button> : null}</div>
            <div className="flex items-center gap-2"><Button type="button" variant="ghost" size="sm" aria-pressed={item.notificationThreshold !== null} onClick={() => updateOption(item.key, { notificationThreshold: item.notificationThreshold === null ? '10' : null })}>{item.notificationThreshold === null ? <BellOff data-icon="inline-start" /> : <Bell data-icon="inline-start" />}Оповещение</Button>{item.notificationThreshold === null ? null : <><Input className="w-24" aria-label={`Порог оповещения для варианта ${String(index + 1)}`} type="number" min="1" max="1000000" inputMode="numeric" value={item.notificationThreshold} onChange={(event) => updateOption(item.key, { notificationThreshold: event.target.value })} /><span className="text-sm text-muted-foreground">человек</span></>}</div>
          </CardContent></Card>)}
          <Button type="button" variant="ghost" className="self-start" disabled={options.length >= 12} onClick={addOption}><Plus data-icon="inline-start" />Добавить вариант</Button>
        </div>
        <div className="rounded-xl bg-card p-3 shadow-sm"><p className="mb-3 text-sm font-medium">Настройки</p><div className="flex flex-col gap-3">
          <label className="flex items-center justify-between gap-3 text-sm"><span>Анонимное голосование</span><input aria-label="Анонимное голосование" type="checkbox" className="size-4 accent-primary" checked={isAnonymous} onChange={(event) => setIsAnonymous(event.target.checked)} /></label>
          <label className="flex items-center justify-between gap-3 text-sm"><span>Несколько ответов</span><input aria-label="Несколько ответов" type="checkbox" className="size-4 accent-primary" checked={allowsMultipleAnswers} onChange={(event) => setAllowsMultipleAnswers(event.target.checked)} /></label>
        </div></div>
        <FieldError>{validation}</FieldError>
      </FieldGroup>
    </div>
    <div className="sheet-actions bg-muted/60 px-4 pt-3 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]"><Button type="submit" className="h-10 w-full" disabled={saving}><Send data-icon="inline-start" />{saving ? 'Публикация…' : 'Опубликовать опрос'}</Button></div>
  </form>
}
