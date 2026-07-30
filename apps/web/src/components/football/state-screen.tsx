import type { ReactNode } from 'react'
import { AlertCircle, ArrowUpRight, LoaderCircle, LockKeyhole } from 'lucide-react'

import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'

type StateKind = 'loading' | 'outside' | 'unauthorized' | 'error'

export function StateScreen({ kind, title, copy, action }: { readonly kind: StateKind; readonly title: string; readonly copy: string; readonly action?: ReactNode }) {
  const Icon = kind === 'loading' ? LoaderCircle : kind === 'outside' ? ArrowUpRight : kind === 'unauthorized' ? LockKeyhole : AlertCircle
  return (
    <main className="grid min-h-svh place-items-center bg-background px-5 py-[max(2rem,calc(2rem+var(--tg-safe-top)))] text-foreground">
      <Empty className="max-w-sm">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Icon className={kind === 'loading' ? 'animate-spin text-primary' : kind === 'outside' ? 'text-primary' : 'text-destructive'} /></EmptyMedia>
          <EmptyTitle className="text-base">{title}</EmptyTitle>
          <EmptyDescription>{copy}</EmptyDescription>
        </EmptyHeader>
        {kind === 'loading' && <EmptyContent className="w-48"><Skeleton className="h-2 w-full" /><Skeleton className="h-2 w-2/3" /></EmptyContent>}
        {action && <EmptyContent>{action}</EmptyContent>}
      </Empty>
    </main>
  )
}
