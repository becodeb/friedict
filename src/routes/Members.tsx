import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { DotsThree, UserPlus } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { useAuth } from '@/auth/useAuth'
import { useGroup, useMembers, useRemoveMember, useUpdateMemberRole } from '@/data/groups'
import { friendlyError } from '@/lib/errors'
import { formatRelative } from '@/lib/time'
import type { MemberRole } from '@/lib/types'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { DropdownMenu } from '@/components/ui/DropdownMenu'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/toast-context'
import { InviteDialog } from '@/components/group/InviteDialog'

interface GroupContext {
  groupId: string
  isAdmin: boolean
}

const ROLE_LABEL: Record<MemberRole, string> = {
  owner: 'creó el grupo',
  admin: 'administra',
  member: '',
}

export function Members() {
  const { groupId, isAdmin } = useOutletContext<GroupContext>()
  const { user } = useAuth()
  const toast = useToast()

  const group = useGroup(groupId)
  const members = useMembers(groupId)
  const updateRole = useUpdateMemberRole(groupId)
  const removeMember = useRemoveMember(groupId)
  const [inviteOpen, setInviteOpen] = useState(false)

  const myRole = members.data?.find((member) => member.user_id === user?.id)?.role
  const isOwner = myRole === 'owner'

  return (
    <div className="feed-column pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="type-title text-[1.375rem]">Integrantes</h1>
        {isAdmin && (
          <Button
            size="sm"
            onClick={() => setInviteOpen(true)}
            iconLeft={<UserPlus size={16} weight="bold" aria-hidden="true" />}
          >
            Invitar
          </Button>
        )}
      </div>

      {members.isLoading ? (
        <ul className="mt-4 space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </li>
          ))}
        </ul>
      ) : members.isError ? (
        <div className="mt-4">
          <ErrorState onRetry={() => void members.refetch()} />
        </div>
      ) : (
        <ul className="mt-4">
          {(members.data ?? []).map((member) => {
            const isMe = member.user_id === user?.id
            const roleNote = ROLE_LABEL[member.role]

            return (
              <li
                key={member.user_id}
                className="flex items-center gap-3 border-t border-[var(--line)] py-3.5"
              >
                <Avatar person={member.profile} size="md" />

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem] font-medium">
                    {member.profile.display_name}
                    {isMe && (
                      <span className="ml-1.5 type-micro font-normal text-[var(--ink-3)]">
                        vos
                      </span>
                    )}
                  </span>
                  <span className="type-micro text-[var(--ink-3)]">
                    {roleNote ? `${roleNote} · ` : ''}
                    se sumó {formatRelative(member.joined_at)}
                  </span>
                </span>

                {isOwner && !isMe && member.role !== 'owner' && (
                  <DropdownMenu
                    label={`Opciones de ${member.profile.display_name}`}
                    align="top-right"
                    actions={[
                      {
                        label:
                          member.role === 'admin'
                            ? 'Quitar administración'
                            : 'Hacer administrador/a',
                        onSelect: () =>
                          updateRole.mutate(
                            {
                              userId: member.user_id,
                              role: member.role === 'admin' ? 'member' : 'admin',
                            },
                            {
                              onError: (error) =>
                                toast.show({
                                  message: friendlyError(error),
                                  tone: 'error',
                                }),
                            },
                          ),
                      },
                      {
                        label: 'Sacar del grupo',
                        tone: 'danger',
                        onSelect: () =>
                          removeMember.mutate(member.user_id, {
                            onSuccess: () =>
                              toast.show({
                                message: `${member.profile.display_name} ya no está en el grupo.`,
                                tone: 'neutral',
                              }),
                            onError: (error) =>
                              toast.show({ message: friendlyError(error), tone: 'error' }),
                          }),
                      },
                    ]}
                    trigger={(props) => (
                      <button
                        type="button"
                        {...props}
                        aria-label={`Opciones de ${member.profile.display_name}`}
                        className={cn(
                          'grid size-[var(--tap)] shrink-0 place-items-center rounded-[var(--r-sm)]',
                          'text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]',
                          'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
                        )}
                      >
                        <DotsThree size={20} weight="bold" aria-hidden="true" />
                      </button>
                    )}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      <InviteDialog
        groupId={groupId}
        groupName={group.data?.name ?? ''}
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
      />
    </div>
  )
}
