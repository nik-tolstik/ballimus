import { useState, type FormEvent } from 'react'
import {
  getErrorCode,
  getListMiniAppAdminsQueryKey,
  useGrantMiniAppAdmin,
  useListMiniAppAdmins,
  useListMiniAppGroupMembers,
  useRevokeMiniAppAdmin,
  type MiniAppGroupMemberResponseDto,
} from '@football/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { Alert, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmationSheet } from './confirmation-sheet'

function memberLabel(member: MiniAppGroupMemberResponseDto, members: readonly MiniAppGroupMemberResponseDto[]): string {
  if (member.username !== null) return `${member.displayName} · @${member.username}`
  const duplicateName = members.some((entry) => entry.telegramUserId !== member.telegramUserId
    && entry.username === null && entry.displayName === member.displayName)
  return duplicateName ? `${member.displayName} · ${member.telegramUserId}` : member.displayName
}

export function AdminsPanel() {
  const [selectedId, setSelectedId] = useState('')
  const [revokeId, setRevokeId] = useState<string>()
  const [formError, setFormError] = useState('')
  const queryClient = useQueryClient()
  const admins = useListMiniAppAdmins()
  const group = useListMiniAppGroupMembers()
  const refreshAdmins = () => queryClient.invalidateQueries({ queryKey: getListMiniAppAdminsQueryKey() })
  const grant = useGrantMiniAppAdmin({ mutation: { onSuccess: refreshAdmins } })
  const revoke = useRevokeMiniAppAdmin({ mutation: { onSuccess: refreshAdmins } })
  const pending = grant.isPending || revoke.isPending
  const adminIds = new Set(admins.data?.telegramUserIds)
  const members = group.data?.members ?? []
  const available = members.filter((member) => !adminIds.has(member.telegramUserId))
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'ru') || left.telegramUserId.localeCompare(right.telegramUserId))
  const selected = available.find((member) => member.telegramUserId === selectedId)
  const revokeMember = members.find((member) => member.telegramUserId === revokeId)
  const rosterMissing = getErrorCode(group.error) === 'TELEGRAM_GROUP_MEMBERS_NOT_CONFIGURED'

  async function addAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selected === undefined || group.isError || admins.isError) return

    try {
      await grant.mutateAsync({ telegramUserId: selected.telegramUserId })
      setSelectedId('')
      toast.success('Доступ администратора выдан.')
    } catch (error) {
      const code = getErrorCode(error)
      if (code === 'TELEGRAM_GROUP_MEMBER_REQUIRED') {
        setSelectedId('')
        setFormError('Этот человек больше недоступен для назначения.')
        void group.refetch()
      } else {
        setFormError('Не удалось выдать доступ. Попробуйте ещё раз.')
      }
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
        <Label htmlFor="admin-group-member">Участник группы</Label>
        <div className="flex gap-2">
          <Select value={selected?.telegramUserId ?? ''} onValueChange={(id) => { setSelectedId(id); setFormError('') }}
            disabled={pending || group.isError || admins.isError || admins.isPending || available.length === 0}>
            <SelectTrigger id="admin-group-member" className="min-w-0 flex-1" aria-invalid={formError !== ''}
              aria-describedby={formError === '' ? undefined : 'admin-member-error'}>
              <SelectValue placeholder={group.isPending ? 'Загрузка…' : group.isError ? 'Список недоступен' : available.length === 0 ? 'Нет доступных участников' : 'Выберите участника'} />
            </SelectTrigger>
            <SelectContent position="popper" align="start" className="max-w-[calc(100vw-2rem)]">
              {available.map((member) => <SelectItem key={member.telegramUserId} value={member.telegramUserId}>
                <span className="min-w-0 truncate">{memberLabel(member, members)}</span>
              </SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="submit" className="h-10" disabled={pending || group.isError || admins.isError || selected === undefined}>
            <Plus data-icon="inline-start" />Добавить
          </Button>
        </div>
        {formError === '' ? null : <p id="admin-member-error" className="text-sm text-destructive" role="alert">{formError}</p>}
      </form>
      {group.isError ? <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>{rosterMissing ? 'Список участников ещё не настроен' : 'Не удалось загрузить участников группы'}</AlertTitle>
        {rosterMissing ? null : <Button type="button" variant="ghost" className="col-start-2 mt-2 w-fit" disabled={group.isFetching} onClick={() => void group.refetch()}>Повторить</Button>}
      </Alert> : null}
      {admins.isError ? (
        <Alert variant="destructive">
          <TriangleAlert /><AlertTitle>Не удалось загрузить список</AlertTitle>
          <Button type="button" variant="ghost" className="col-start-2 mt-2 w-fit" disabled={admins.isFetching} onClick={() => void admins.refetch()}>Повторить</Button>
        </Alert>
      ) : admins.isPending ? <Skeleton className="h-14 w-full" /> : admins.data.telegramUserIds.length === 0 ? (
        <p className="rounded-xl border border-border px-4 py-4 text-center text-sm text-muted-foreground">Администраторов пока нет</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card" aria-label="Список администраторов">
          {admins.data.telegramUserIds.map((id) => {
            const member = members.find((entry) => entry.telegramUserId === id)
            const label = member === undefined ? id : memberLabel(member, members)
            return <li key={id} className="flex min-h-14 items-center justify-between gap-2 px-3">
              <span className="min-w-0 truncate text-sm">{label}</span>
              <Button type="button" variant="ghost" size="sm" disabled={pending} aria-label={`Отозвать доступ у ${label}`} onClick={() => setRevokeId(id)}>Отозвать</Button>
            </li>
          })}
        </ul>
      )}
      <ConfirmationSheet
        open={revokeId !== undefined}
        title="Отозвать доступ?"
        description={`Аккаунт ${revokeMember === undefined ? revokeId ?? '' : memberLabel(revokeMember, members)} потеряет доступ к управлению Ballimus.`}
        confirmLabel="Отозвать"
        destructive
        pending={revoke.isPending}
        onOpenChange={(open) => { if (!open) setRevokeId(undefined) }}
        onConfirm={() => { if (revokeId !== undefined) void revokeAdmin(revokeId) }}
      />
    </section>
  )
}
