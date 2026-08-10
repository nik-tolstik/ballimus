import { useLayoutEffect, useRef, useState } from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import { Bell, Check, GripVertical, ListChecks, Plus, RotateCcw, Send, Trash2, UsersRound, type LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'

export interface PollEditorOptionValues {
  readonly key: string
  readonly text: string
  readonly notificationEnabled: boolean
}

export interface PollEditorValues {
  readonly question: string
  readonly options: readonly PollEditorOptionValues[]
  readonly notificationThreshold: string | null
  readonly allowsMultipleAnswers: boolean
}

interface PollEditorOptionItem extends PollEditorOptionValues {
  readonly isDraft: boolean
}

function option(key: number, isDraft: boolean): PollEditorOptionItem {
  return { key: String(key), text: '', notificationEnabled: true, isDraft }
}

const settingTone = {
  notification: 'bg-warning/10 text-warning',
  multiple: 'bg-chart-4/10 text-chart-4',
  revoting: 'bg-success/10 text-success',
} as const

function SettingIcon({ icon: Icon, tone }: { readonly icon: LucideIcon; readonly tone: keyof typeof settingTone }) {
  return <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', settingTone[tone])}><Icon className="size-4.5" aria-hidden="true" /></span>
}

function PollSetting({
  id,
  label,
  icon,
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
      <SettingIcon icon={icon} tone={tone} />
      <span className="truncate">{label}</span>
    </FieldLabel>
    <Switch id={id} aria-label={label} checked={checked} onCheckedChange={onCheckedChange} />
  </Field>
}

function NotificationSetting({
  threshold,
  onThresholdChange,
}: {
  readonly threshold: string | null
  readonly onThresholdChange: (threshold: string | null) => void
}) {
  const enabled = threshold !== null
  return <div className="rounded-lg bg-muted/55">
    <Field orientation="horizontal" className="p-2.5">
      <FieldLabel htmlFor="poll-notification-enabled" className="min-w-0 flex-1 cursor-pointer items-center font-normal">
        <SettingIcon icon={UsersRound} tone="notification" />
        <span className="truncate">Оповестить о количестве</span>
      </FieldLabel>
      <Switch id="poll-notification-enabled" aria-label="Оповестить о количестве" checked={enabled} onCheckedChange={(checked) => onThresholdChange(checked ? '10' : null)} />
    </Field>
    <div aria-hidden={!enabled} className={cn('grid transition-[grid-template-rows,opacity] duration-200 ease-out', enabled ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
      <div className="overflow-hidden">
        <Field orientation="horizontal" className="px-2.5 pb-2.5 pl-14">
          <FieldLabel htmlFor="poll-notification-threshold" className="font-normal">Количество</FieldLabel>
          <Input id="poll-notification-threshold" className="w-20 bg-card text-center tabular-nums focus-visible:ring-inset" aria-label="Количество для оповещения" type="number" min="1" max="1000000" inputMode="numeric" disabled={!enabled} value={threshold ?? '10'} onChange={(event) => onThresholdChange(event.target.value)} />
        </Field>
      </div>
    </div>
  </div>
}

function RevotingCapability() {
  return <Field orientation="horizontal" className="rounded-lg bg-muted/55 p-2.5">
    <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
      <SettingIcon icon={RotateCcw} tone="revoting" />
      <span className="truncate">Голос можно отменять</span>
    </div>
    <Check className="size-4.5 shrink-0 text-success" aria-hidden="true" />
  </Field>
}

function OptionNotificationToggle({
  optionNumber,
  enabled,
  onEnabledChange,
}: {
  readonly optionNumber: string
  readonly enabled: boolean
  readonly onEnabledChange: (enabled: boolean) => void
}) {
  return <Toggle
    type="button"
    variant="notification"
    size="icon"
    pressed={enabled}
    aria-label={`Оповещение для варианта ${optionNumber}`}
    onPressedChange={onEnabledChange}
  >
    <Bell />
  </Toggle>
}

function PollOptionRow({
  item,
  index,
  notificationsEnabled,
  inputRef,
  onTextChange,
  onUpdate,
  onDelete,
  onMove,
}: {
  readonly item: PollEditorOptionItem
  readonly index: number
  readonly notificationsEnabled: boolean
  readonly inputRef: (node: HTMLInputElement | null) => void
  readonly onTextChange: (key: string, text: string) => void
  readonly onUpdate: (key: string, patch: Partial<PollEditorOptionValues>) => void
  readonly onDelete: (key: string) => void
  readonly onMove: (key: string, direction: -1 | 1) => void
}) {
  const dragControls = useDragControls()
  const [dragging, setDragging] = useState(false)
  const optionNumber = String(index + 1)

  return <Reorder.Item
    value={item}
    dragListener={false}
    dragControls={dragControls}
    onDragStart={() => setDragging(true)}
    onDragEnd={() => setDragging(false)}
    whileDrag={{ scale: 1.015 }}
    className={cn('relative list-none rounded-xl', dragging && 'z-10 shadow-lg')}
  >
    <Field className="rounded-xl bg-card p-3 shadow-sm transition-shadow">
      <div className="flex items-center gap-2">
        {item.isDraft ? <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground" aria-hidden="true"><Plus className="size-4" /></span> : <Button
          type="button"
          variant="ghost"
          size="icon"
          className="touch-none cursor-grab text-muted-foreground active:cursor-grabbing"
          aria-label={`Переместить вариант ${optionNumber}`}
          onPointerDown={(event) => dragControls.start(event)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault()
            onMove(item.key, event.key === 'ArrowUp' ? -1 : 1)
          }}
        >
          <GripVertical />
        </Button>}
        <Input
          ref={inputRef}
          aria-label={item.isDraft ? 'Новый вариант' : `Вариант ${optionNumber}`}
          maxLength={100}
          value={item.text}
          onChange={(event) => onTextChange(item.key, event.target.value)}
          onKeyDown={(event) => {
            if (item.isDraft || item.text !== '' || (event.key !== 'Backspace' && event.key !== 'Delete')) return
            event.preventDefault()
            onDelete(item.key)
          }}
          placeholder={item.isDraft ? 'Новый вариант' : `Вариант ${optionNumber}`}
        />
        {!item.isDraft && notificationsEnabled ? <OptionNotificationToggle optionNumber={optionNumber} enabled={item.notificationEnabled} onEnabledChange={(notificationEnabled) => onUpdate(item.key, { notificationEnabled })} /> : null}
        {item.isDraft ? null : <Button type="button" variant="ghost" size="icon" aria-label={`Удалить вариант ${optionNumber}`} onClick={() => onDelete(item.key)}><Trash2 /></Button>}
      </div>
    </Field>
  </Reorder.Item>
}

export function validatePollEditorValues(values: PollEditorValues): string | undefined {
  const question = values.question.trim()
  if (question.length < 1 || question.length > 300) return 'Введите вопрос длиной до 300 символов.'
  if (values.options.length < 2 || values.options.length > 12) return 'Добавьте от 2 до 12 вариантов ответа.'
  for (const item of values.options) {
    const text = item.text.trim()
    if (text.length < 1 || text.length > 100) return 'Заполните каждый вариант ответа (до 100 символов).'
    if (typeof item.notificationEnabled !== 'boolean') return 'Проверьте настройки оповещений для вариантов.'
  }
  if (values.notificationThreshold !== null) {
    const threshold = Number(values.notificationThreshold)
    if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 1_000_000) {
      return 'Количество для оповещения должно быть целым числом от 1 до 1 000 000.'
    }
  }
  return undefined
}

export function PollEditor({ onSave, saving }: { readonly onSave: (values: PollEditorValues) => void; readonly saving: boolean }) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<PollEditorOptionItem[]>([option(1, true)])
  const [notificationThreshold, setNotificationThreshold] = useState<string | null>('10')
  const [allowsMultipleAnswers, setAllowsMultipleAnswers] = useState(false)
  const [validation, setValidation] = useState('')
  const nextKeyRef = useRef(2)
  const optionInputRefs = useRef(new Map<string, HTMLInputElement>())
  const pendingFocusKeyRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    const pendingFocusKey = pendingFocusKeyRef.current
    if (pendingFocusKey === null) return
    optionInputRefs.current.get(pendingFocusKey)?.focus()
    pendingFocusKeyRef.current = null
  }, [options])

  const updateOption = (key: string, patch: Partial<PollEditorOptionValues>) => {
    setOptions((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item))
    setValidation('')
  }
  const updateOptionText = (key: string, text: string) => {
    setOptions((current) => {
      const index = current.findIndex((item) => item.key === key)
      if (index < 0) return current

      const currentOption = current[index]
      if (currentOption === undefined) return current
      const createsOption = currentOption.isDraft && text.trim().length > 0
      const updated = current.map((item) => item.key === key ? { ...item, text, isDraft: createsOption ? false : item.isDraft } : item)
      if (createsOption && current.length < 12) {
        return [...updated, option(nextKeyRef.current++, true)]
      }
      return updated
    })
    setValidation('')
  }
  const deleteOption = (key: string) => {
    setOptions((current) => {
      if (current.length <= 1) return current
      const index = current.findIndex((item) => item.key === key)
      if (index < 0) return current
      pendingFocusKeyRef.current = current[index + 1]?.key ?? current[index - 1]?.key ?? null
      const remaining = current.filter((candidate) => candidate.key !== key)
      return remaining.some((candidate) => candidate.isDraft) || remaining.length >= 12 ? remaining : [...remaining, option(nextKeyRef.current++, true)]
    })
    setValidation('')
  }
  const moveOption = (key: string, direction: -1 | 1) => {
    setOptions((current) => {
      const from = current.findIndex((item) => item.key === key)
      const to = from + direction
      if (from < 0 || to < 0 || to >= current.length) return current
      if (current[from]?.isDraft === true || current[to]?.isDraft === true) return current
      const next = [...current]
      const [moved] = next.splice(from, 1)
      if (moved === undefined) return current
      next.splice(to, 0, moved)
      return next
    })
    setValidation('')
  }
  const updateThreshold = (threshold: string | null) => {
    setNotificationThreshold(threshold)
    setValidation('')
  }
  const submit = () => {
    const completedOptions = options
      .filter((item) => !item.isDraft && item.text.trim().length > 0)
      .map(({ key, text, notificationEnabled }) => ({ key, text, notificationEnabled }))
    const values = { question, options: completedOptions, notificationThreshold, allowsMultipleAnswers }
    const error = validatePollEditorValues(values)
    if (error !== undefined) { setValidation(error); return }
    setValidation('')
    onSave(values)
  }

  const completedOptionsCount = options.filter((item) => !item.isDraft && item.text.trim().length > 0).length

  return <form aria-label="Форма создания опроса" className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); submit() }}>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <FieldGroup className="gap-4">
        <Field data-invalid={validation.startsWith('Введите вопрос')}><FieldLabel htmlFor="poll-question">Вопрос</FieldLabel><Input id="poll-question" maxLength={300} value={question} onChange={(event) => { setQuestion(event.target.value); setValidation('') }} /></Field>
        <div className="flex flex-col gap-3">
          <FieldLabel>Варианты ответа</FieldLabel>
          <Reorder.Group axis="y" values={options} onReorder={(next) => { setOptions([...next.filter((item) => !item.isDraft), ...next.filter((item) => item.isDraft)]); setValidation('') }} className="flex flex-col gap-3" layoutScroll>
            {options.map((item, index) => <PollOptionRow key={item.key} item={item} index={index} notificationsEnabled={notificationThreshold !== null} inputRef={(node) => { if (node === null) optionInputRefs.current.delete(item.key); else optionInputRefs.current.set(item.key, node) }} onTextChange={updateOptionText} onUpdate={updateOption} onDelete={deleteOption} onMove={moveOption} />)}
          </Reorder.Group>
        </div>
        <FieldSet className="gap-0"><FieldLegend variant="label" className="mb-0 px-3">Настройки</FieldLegend>
          <FieldGroup className="mt-2 gap-2 rounded-xl bg-card p-3 shadow-sm">
            <NotificationSetting threshold={notificationThreshold} onThresholdChange={updateThreshold} />
            <PollSetting id="poll-multiple-answers" label="Несколько ответов" icon={ListChecks} tone="multiple" checked={allowsMultipleAnswers} onCheckedChange={setAllowsMultipleAnswers} />
            <RevotingCapability />
          </FieldGroup>
        </FieldSet>
        <FieldError>{validation}</FieldError>
      </FieldGroup>
    </div>
    <div className="sheet-actions bg-muted/60 px-4 pt-3 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]"><Button type="submit" className="h-10 w-full" disabled={saving || completedOptionsCount < 2}><Send data-icon="inline-start" />{saving ? 'Публикация…' : 'Опубликовать опрос'}</Button></div>
  </form>
}
