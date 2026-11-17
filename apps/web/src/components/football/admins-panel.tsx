import { useState, type FormEvent } from 'react'
import {
  getErrorCode,
  getListMiniAppAdminsQueryKey,
  useGrantMiniAppAdmin,
  useListMiniAppAdmins,
  useRevokeMiniAppAdmin,
} from '@football/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { Alert, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmationSheet } from './confirmation-sheet'

export function AdminsPanel() {
  const [input, setInput] = useState('')
  const [revokeId, setRevokeId] = useState<string>()
  const [formError, setFormError] = useState('')
  const queryClient = useQueryClient()
  const admins = useListMiniAppAdmins()
  const refreshAdmins = () => queryClient.invalidateQueries({ queryKey: getListMiniAppAdminsQueryKey() })
  const grant = useGrantMiniAppAdmin({ mutation: { onSuccess: refreshAdmins } })
  const revoke = useRevokeMiniAppAdmin({ mutation: { onSuccess: refreshAdmins } })
  const pending = grant.isPending || revoke.isPending

  async function addAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const id = input.trim()
    if (!/^[1-9]\d*$/u.test(id) || !Number.isSafeInteger(Number(id))) {
      setFormError('Введите числовой Telegram ID.')
      return
    }

    try {
      await grant.mutateAsync({ telegramUserId: id })
      setInput('')
      toast.success('Доступ администратора выдан.')
    } catch (error) {
      const code = getErrorCode(error)
      setFormError(code === 'TELEGRAM_OWNER_IMMUTABLE'
        ? 'У владельца уже есть полный доступ.'
        : 'Не удалось выдать доступ. Попробуйте ещё раз.')
    }
  }

  async function revokeAdmin(telegramUserId: string) {
    try {
      await revoke.mutateAsync({ telegramUserId })
      setRevokeId(undefined)
      toast.success('Доступ администратора отозван.')
    } catch {
      toast.error('Не удалось отозвать доступ. Попробуйте ещё раз.')
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Администраторы</h1>
      <form className="grid gap-2" onSubmit={(event) => void addAdmin(event)}>
        <Label htmlFor="admin-telegram-id">Telegram ID</Label>
        <div className="flex gap-2">
          <Input
            id="admin-telegram-id"
            inputMode="numeric"
            autoComplete="off"
            value={input}
            disabled={pending}
            aria-invalid={formError !== ''}
            aria-describedby={formError === '' ? 'admin-id-hint' : 'admin-id-error'}
            onChange={(event) => { setInput(event.target.value); setFormError('') }}
          />
          <Button type="submit" className="h-10" disabled={pending || input.trim() === ''}>
            <Plus data-icon="inline-start" />Добавить
          </Button>
        </div>
        {formError === ''
          ? <p id="admin-id-hint" className="text-sm text-muted-foreground">Попросите человека открыть Ballimus и прислать свой Telegram ID.</p>
          : <p id="admin-id-error" className="text-sm text-destructive" role="alert">{formError}</p>}
      </form>
      {admins.isError ? (
        <Alert variant="destructive">
          <TriangleAlert /><AlertTitle>Не удалось загрузить список</AlertTitle>
          <Button type="button" variant="ghost" className="col-start-2 mt-2 w-fit" disabled={admins.isFetching} onClick={() => void admins.refetch()}>Повторить</Button>
        </Alert>
      ) : admins.isPending ? <Skeleton className="h-14 w-full" /> : admins.data.telegramUserIds.length === 0 ? (
        <p className="rounded-xl border border-border px-4 py-4 text-center text-sm text-muted-foreground">Администраторов пока нет</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card" aria-label="Список администраторов">
          {admins.data.telegramUserIds.map((id) => (
            <li key={id} className="flex min-h-14 items-center justify-between gap-2 px-3">
              <span className="font-mono text-sm">{id}</span>
              <Button type="button" variant="ghost" size="sm" disabled={pending} aria-label={`Отозвать доступ у ${id}`} onClick={() => setRevokeId(id)}>Отозвать</Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmationSheet
        open={revokeId !== undefined}
        title="Отозвать доступ?"
        description={`Аккаунт ${revokeId ?? ''} потеряет доступ к управлению Ballimus.`}
        confirmLabel="Отозвать"
        destructive
        pending={revoke.isPending}
        onOpenChange={(open) => { if (!open) setRevokeId(undefined) }}
        onConfirm={() => { if (revokeId !== undefined) void revokeAdmin(revokeId) }}
      />
    </section>
  )
}
