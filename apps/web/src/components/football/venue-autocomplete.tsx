import { useMemo, useState } from 'react'
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react'

import type { NormalizedVenue } from '@/normalize'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface VenueAutocompleteProps {
  readonly venues: readonly NormalizedVenue[]
  readonly value: string | null | undefined
  readonly onValueChange: (value: string | null) => void
  readonly onCreate: () => void
  readonly placeholder?: string
  readonly ariaLabel?: string
}

export function VenueAutocomplete({ venues, value, onValueChange, onCreate, placeholder = 'Выберите место', ariaLabel = 'Выбор места' }: VenueAutocompleteProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selected = venues.find((venue) => venue.id === value)
  const results = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return venues.filter((venue) => venue.archivedAt === undefined && (needle === '' || venue.name.toLocaleLowerCase().includes(needle)))
  }, [search, venues])

  const choose = (venueId: string) => {
    onValueChange(venueId)
    setSearch('')
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearch('') }}>
      <div className="flex gap-2">
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" role="combobox" aria-expanded={open} aria-label={ariaLabel} className="h-10 min-w-0 flex-1 justify-between bg-input/70 px-3 font-normal shadow-inner hover:bg-input/70 dark:bg-input/70 dark:hover:bg-input/70 dark:aria-expanded:bg-input/70">
            <span className={cn('truncate text-left', selected === undefined ? 'text-muted-foreground' : '')}>{selected?.name ?? placeholder}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        {value !== undefined && value !== null ? <Button type="button" variant="ghost" size="icon" className="size-10 shrink-0" onClick={() => onValueChange(null)} aria-label="Очистить место"><X /></Button> : null}
      </div>
      <PopoverContent align="start" className="z-[60] w-[min(28rem,calc(100vw-2rem))] p-2">
        <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по названию" className="pl-9" /></div>
        <div className="mt-2 max-h-56 overflow-y-auto" role="listbox" aria-label="Найденные места">
          {results.length === 0 ? <p className="px-2 py-5 text-center text-sm text-muted-foreground">Ничего не найдено</p> : results.map((venue) => <button key={venue.id} type="button" role="option" aria-selected={venue.id === value} className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent" onClick={() => choose(venue.id)}><span className="truncate">{venue.name}</span>{venue.id === value ? <Check className="size-4 shrink-0 text-primary" /> : null}</button>)}
        </div>
        <div className="mt-2 border-t pt-2"><Button type="button" variant="ghost" className="w-full justify-start" onClick={() => { setOpen(false); setSearch(''); onCreate() }}><Plus data-icon="inline-start" />Добавить</Button></div>
      </PopoverContent>
    </Popover>
  )
}
