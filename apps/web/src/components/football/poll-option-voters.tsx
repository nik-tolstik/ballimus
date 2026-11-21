import { useRef, useState } from 'react'
import { getErrorStatus, useGetOwnerPollOptionVoters } from '@football/api-client'
import { Copy, LoaderCircle, UsersRound } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'

interface PollOptionVotersProps {
  readonly pollId: string
  readonly optionIndex: number
  readonly optionText: string
}

function VoterMentions({ pollId, optionIndex }: Pick<PollOptionVotersProps, 'pollId' | 'optionIndex'>) {
  // The generated default treats option index zero as missing.
  const voters = useGetOwnerPollOptionVoters(pollId, optionIndex, { query: { enabled: true } })
  const textArea = useRef<HTMLTextAreaElement>(null)
  const [copyFailed, setCopyFailed] = useState(false)

  if (voters.isPending) {
    return <LoaderCircle className="mx-auto size-5 animate-spin" role="status" aria-label="Загрузка списка голосовавших" />
  }
  if (voters.isError) {
    const status = getErrorStatus(voters.error)
    if (status === 404 || status === 409) {
      return <p className="text-sm text-muted-foreground" role="status">Список для этого варианта недоступен.</p>
    }
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground" role="alert">Не удалось загрузить список голосовавших.</p>
        <Button type="button" variant="ghost" onClick={() => void voters.refetch()}>Повторить</Button>
      </div>
    )
  }

  const { usernames, withoutUsernameCount, unidentifiedVoteCount } = voters.data
  const mentions = usernames.map((username) => `@${username}`).join(' ')

  async function copyMentions() {
    try {
      await navigator.clipboard.writeText(mentions)
      setCopyFailed(false)
      toast.success('Упоминания скопированы.')
    } catch {
      textArea.current?.focus()
      textArea.current?.select()
      setCopyFailed(true)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {mentions === '' ? (
        <p className="text-sm text-muted-foreground">Нет упоминаний для копирования.</p>
      ) : (
        <textarea
          ref={textArea}
          aria-label="Упоминания"
          className="min-h-20 w-full resize-none rounded-lg bg-input/70 p-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/45 md:text-sm"
          readOnly
          rows={3}
          value={mentions}
        />
      )}
      {withoutUsernameCount > 0 || unidentifiedVoteCount > 0 ? (
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          {withoutUsernameCount > 0 ? <p>Участники без @username — {withoutUsernameCount}</p> : null}
          {unidentifiedVoteCount > 0 ? <p>Голоса без данных об участнике — {unidentifiedVoteCount}</p> : null}
        </div>
      ) : null}
      {copyFailed ? <p className="text-sm text-muted-foreground" role="status">Скопируйте выделенный текст вручную.</p> : null}
      {mentions === '' ? null : (
        <Button type="button" className="h-10 w-full" disabled={voters.isFetching} onClick={() => void copyMentions()}>
          <Copy data-icon="inline-start" />Скопировать упоминания
        </Button>
      )}
    </div>
  )
}

export function PollOptionVoters({ pollId, optionIndex, optionText }: PollOptionVotersProps) {
  const label = `Кто выбрал «${optionText}»`
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="text-muted-foreground" aria-label={label} title={label}>
          <UsersRound aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="mx-auto w-full max-w-[480px] gap-0 rounded-t-2xl p-0">
        <SheetHeader className="px-4 pt-4 pr-12 pb-3">
          <SheetTitle className="text-lg">Кто выбрал вариант</SheetTitle>
          <SheetDescription className="break-words">{optionText}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-[max(1rem,calc(1rem+var(--tg-safe-bottom)))]">
          <VoterMentions pollId={pollId} optionIndex={optionIndex} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
