import { LoaderCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

interface ConfirmationSheetProps {
  readonly open: boolean
  readonly title: string
  readonly description?: string
  readonly confirmLabel: string
  readonly destructive?: boolean
  readonly pending?: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onConfirm: () => void
}

export function ConfirmationSheet({ open, title, description, confirmLabel, destructive = false, pending = false, onOpenChange, onConfirm }: ConfirmationSheetProps) {
  return <Sheet open={open} onOpenChange={(nextOpen) => { if (!pending) onOpenChange(nextOpen) }}>
    <SheetContent side="bottom" showCloseButton={false} className="mx-auto w-full max-w-[480px] gap-0 rounded-t-2xl p-0">
      <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/35" />
      <SheetHeader className="px-4 pt-3 pb-4">
        <SheetTitle className="text-lg">{title}</SheetTitle>
        {description === undefined ? null : <SheetDescription>{description}</SheetDescription>}
      </SheetHeader>
      <div className="flex flex-col gap-2 px-4 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]">
        <Button type="button" className={destructive ? 'h-11 bg-destructive text-destructive-foreground hover:bg-destructive/80' : 'h-11'} disabled={pending} onClick={onConfirm}>
          {pending ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
          {confirmLabel}
        </Button>
        <Button type="button" variant="ghost" className="h-11" disabled={pending} onClick={() => onOpenChange(false)}>Отмена</Button>
      </div>
    </SheetContent>
  </Sheet>
}
