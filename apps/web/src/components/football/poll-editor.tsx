import { useState } from 'react'
import { Bell, BellRing, ListChecks, Plus, Send, ShieldCheck, Trash2, UsersRound, type LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'

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

const settingTone = {
  primary: 'bg-primary/10 text-primary',
  multiple: 'bg-chart-4/10 text-chart-4',
} as const

function PollSetting({
  id,
  label,
  icon: Icon,
  tone,
  checked,
  onCheckedChange,
}: {
  readonly id: string
  readonly label: string
  readonly icon: LucideIcon
  readonly tone: keyof typeof settingTone
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
}) {
  return <Field orientation="horizontal" className="rounded-lg bg-muted/55 p-2.5">
    <FieldLabel htmlFor={id} className="min-w-0 flex-1 cursor-pointer items-center font-normal">
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', settingTone[tone])}><Icon className="size-4.5" aria-hidden="true" /></span>
      <span className="truncate">{label}</span>
    </FieldLabel>
    <Switch id={id} aria-label={label} checked={checked} onCheckedChange={onCheckedChange} />
  </Field>
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
          {options.map((item, index) => {
            const notificationEnabled = item.notificationThreshold !== null
            const optionNumber = String(index + 1)
            return <Field key={item.key} className="rounded-xl bg-card p-3 shadow-sm">
              <div className="flex items-center gap-2">
                <Input aria-label={`Вариант ${optionNumber}`} maxLength={100} value={item.text} onChange={(event) => updateOption(item.key, { text: event.target.value })} placeholder={`Вариант ${optionNumber}`} />
                <Toggle type="button" variant="notification" size="icon-form" pressed={notificationEnabled} aria-label={`${notificationEnabled ? 'Выключить' : 'Включить'} оповещение для варианта ${optionNumber}`} title={notificationEnabled ? 'Оповещение включено' : 'Включить оповещение'} onPressedChange={(pressed) => updateOption(item.key, { notificationThreshold: pressed ? '10' : null })}>{notificationEnabled ? <BellRing /> : <Bell />}</Toggle>
                {options.length > 2 ? <Button type="button" variant="ghost" size="icon" aria-label={`Удалить вариант ${optionNumber}`} onClick={() => setOptions((current) => current.filter((candidate) => candidate.key !== item.key))}><Trash2 /></Button> : null}
              </div>
              {notificationEnabled ? <Field orientation="horizontal" className="rounded-lg bg-warning/10 p-2.5">
                <UsersRound className="size-4 shrink-0 text-warning" aria-hidden="true" />
                <FieldLabel htmlFor={`poll-threshold-${item.key}`} className="font-normal">Оповестить при</FieldLabel>
                <Input id={`poll-threshold-${item.key}`} className="w-20 bg-card text-center tabular-nums" aria-label={`Порог оповещения для варианта ${optionNumber}`} type="number" min="1" max="1000000" inputMode="numeric" value={item.notificationThreshold} onChange={(event) => updateOption(item.key, { notificationThreshold: event.target.value })} />
                <span className="text-sm text-muted-foreground">чел.</span>
              </Field> : null}
            </Field>
          })}
          <Button type="button" variant="ghost" className="self-start" disabled={options.length >= 12} onClick={addOption}><Plus data-icon="inline-start" />Добавить вариант</Button>
        </div>
        <FieldSet className="gap-2 rounded-xl bg-card p-3 shadow-sm"><FieldLegend variant="label">Настройки</FieldLegend>
          <PollSetting id="poll-anonymous" label="Анонимное голосование" icon={ShieldCheck} tone="primary" checked={isAnonymous} onCheckedChange={setIsAnonymous} />
          <PollSetting id="poll-multiple-answers" label="Несколько ответов" icon={ListChecks} tone="multiple" checked={allowsMultipleAnswers} onCheckedChange={setAllowsMultipleAnswers} />
        </FieldSet>
        <FieldError>{validation}</FieldError>
      </FieldGroup>
    </div>
    <div className="sheet-actions bg-muted/60 px-4 pt-3 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]"><Button type="submit" className="h-10 w-full" disabled={saving}><Send data-icon="inline-start" />{saving ? 'Публикация…' : 'Опубликовать опрос'}</Button></div>
  </form>
}
