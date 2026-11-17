import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { BarChart3, CalendarDays, MapPinned, ShieldCheck } from 'lucide-react'

export type Tab = 'matches' | 'polls' | 'venues' | 'admins'

const tabs: readonly { readonly value: Tab; readonly label: string; readonly icon: typeof CalendarDays }[] = [
  { value: 'polls', label: 'Опросы', icon: BarChart3 },
  { value: 'matches', label: 'Матчи', icon: CalendarDays },
  { value: 'venues', label: 'Места', icon: MapPinned },
  { value: 'admins', label: 'Админы', icon: ShieldCheck },
]

export function TabBar({ value, onChange, canManageAdmins }: {
  readonly value: Tab
  readonly onChange: (tab: Tab) => void
  readonly canManageAdmins: boolean
}) {
  const reduceMotion = useReducedMotion()

  return (
    <nav className="telegram-nav" aria-label="Основная навигация">
      {tabs.filter(({ value: tabValue }) => tabValue !== 'admins' || canManageAdmins).map(({ value: tabValue, label, icon: Icon }) => {
        const active = value === tabValue
        return (
          <button
            key={tabValue}
            type="button"
            className="relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onChange(tabValue)}
            aria-current={active ? 'page' : undefined}
          >
            <Icon className={active ? 'size-5 text-primary' : 'size-5'} aria-hidden="true" />
            <span className={active ? 'text-primary' : undefined}>{label}</span>
            <AnimatePresence>
              {active && (
                <motion.span
                  layoutId="active-tab"
                  className="absolute top-0 h-0.5 w-8 rounded-full bg-primary"
                  initial={reduceMotion ? false : { opacity: 0, scaleX: 0.5 }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  exit={reduceMotion ? {} : { opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                />
              )}
            </AnimatePresence>
          </button>
        )
      })}
    </nav>
  )
}
