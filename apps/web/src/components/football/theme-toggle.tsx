import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  const label = dark ? 'Включить светлую тему' : 'Включить тёмную тему'

  return (
    <Button type="button" variant="ghost" size="icon" aria-label={label} title={label} onClick={() => setTheme(dark ? 'light' : 'dark')}>
      {dark ? <Sun /> : <Moon />}
    </Button>
  )
}
