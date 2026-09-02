import { useNavigate } from 'react-router-dom'
import { CaretDown, Plus } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { useMyGroups } from '@/data/groups'
import { DropdownMenu } from '@/components/ui/DropdownMenu'

export function GroupSwitcher({
  groupId,
  groupName,
}: {
  groupId: string
  groupName: string
}) {
  const navigate = useNavigate()
  const { data: groups } = useMyGroups()

  const others = (groups ?? []).filter((group) => group.id !== groupId)

  return (
    <DropdownMenu
      label="Cambiar de grupo"
      align="top-left"
      actions={[
        ...others.map((group) => ({
          label: group.name,
          onSelect: () => navigate(`/g/${group.id}`),
        })),
        {
          label: 'Crear otro grupo',
          icon: <Plus size={16} weight="bold" aria-hidden="true" />,
          onSelect: () => navigate('/crear-grupo'),
        },
      ]}
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className={cn(
            'flex min-h-[var(--tap)] max-w-[min(60vw,18rem)] items-center gap-1.5',
            '-ml-2 rounded-[var(--r-sm)] px-2 text-left',
            'hover:bg-[var(--bg-sunken)]',
            'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
          )}
        >
          <span className="type-title truncate text-[1.25rem]">{groupName}</span>
          <CaretDown
            size={15}
            weight="bold"
            aria-hidden="true"
            className={cn(
              'shrink-0 text-[var(--ink)]',
              'transition-transform duration-[var(--motion-base)] ease-[var(--ease-standard)]',
              'motion-reduce:transition-none',
              props['aria-expanded'] && 'rotate-180',
            )}
          />
          <span className="sr-only">Cambiar de grupo</span>
        </button>
      )}
    />
  )
}
