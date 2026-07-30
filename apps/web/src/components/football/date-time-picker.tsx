import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { ru } from 'react-day-picker/locale'

import { calendarDateFromValue, calendarValueFromDate, formatCalendarValue } from '@/lib/date-format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function DatePicker({ value, onChange, invalid = false }: { readonly value: string; readonly onChange: (value: string) => void; readonly invalid?: boolean }) {
  const [open, setOpen] = useState(false)
  const date = calendarDateFromValue(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" size="form" className="w-full justify-start" data-empty={date === undefined} aria-invalid={invalid}>
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
  )
}

export function TimePicker({ value, onChange, invalid = false, ariaLabel = 'Время матча' }: { readonly value: string; readonly onChange: (value: string) => void; readonly invalid?: boolean; readonly ariaLabel?: string }) {
  return (
    <Input
      type="time"
      step={900}
      value={value}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
