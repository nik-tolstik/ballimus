import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { ru } from 'react-day-picker/locale'

import { calendarDateFromValue, calendarValueFromDate, formatCalendarValue } from '@/lib/date-format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

function NativeTemporalInput({
  type,
  value,
  onChange,
  invalid,
  ariaLabel,
  className,
  step,
}: {
  readonly type: 'date' | 'time'
  readonly value: string
  readonly onChange: (value: string) => void
  readonly invalid: boolean
  readonly ariaLabel: string
  readonly className?: string
  readonly step?: number
}) {
  return (
    <div className={cn(
      'native-temporal-input-frame h-10 w-full min-w-0 overflow-hidden rounded-lg border border-transparent bg-input/70 px-2.5 shadow-inner transition-colors focus-within:ring-3 focus-within:ring-ring/45',
      invalid && 'ring-3 ring-destructive/35',
      className,
    )}>
      <Input
        type={type}
        {...(step === undefined ? {} : { step })}
        value={value}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className="h-full max-w-full rounded-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

export function normalizeTimeInput(value: string): string {
  const digits = value.replace(/\D/gu, '').slice(0, 4)
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`
}

export function DatePicker({ value, onChange, invalid = false }: { readonly value: string; readonly onChange: (value: string) => void; readonly invalid?: boolean }) {
  const [open, setOpen] = useState(false)
  const date = calendarDateFromValue(value)

  return (
    <>
      <NativeTemporalInput
        type="date"
        value={value}
        ariaLabel="Дата матча"
        invalid={invalid}
        className="mobile-native-date-picker"
        onChange={onChange}
      />
      <div className="desktop-custom-date-picker">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="form" className="w-full justify-start bg-input/70 shadow-inner hover:bg-input/70 aria-expanded:bg-input/70 dark:bg-input/70 dark:hover:bg-input/70 dark:aria-expanded:bg-input/70" data-empty={date === undefined} aria-label="Дата матча" aria-invalid={invalid}>
              <CalendarDays data-icon="inline-start" />
              <span className={cn('truncate', date === undefined && 'text-muted-foreground')}>{formatCalendarValue(value)}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              selected={date}
              onSelect={(selected) => {
                if (selected === undefined) return
                onChange(calendarValueFromDate(selected))
                setOpen(false)
              }}
              locale={ru}
              weekStartsOn={1}
              autoFocus
            />
          </PopoverContent>
        </Popover>
      </div>
    </>
  )
}

export function TimePicker({ value, onChange, invalid = false, ariaLabel = 'Время матча' }: { readonly value: string; readonly onChange: (value: string) => void; readonly invalid?: boolean; readonly ariaLabel?: string }) {
  return (
    <Input
      type="text"
      inputMode="numeric"
      pattern="[0-2][0-9]:[0-5][0-9]"
      maxLength={5}
      value={value}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      placeholder="18:00"
      onChange={(event) => onChange(normalizeTimeInput(event.target.value))}
      onBlur={() => {
        if (/^\d{1,2}$/u.test(value)) onChange(`${value.padStart(2, '0')}:00`)
      }}
    />
  )
}
