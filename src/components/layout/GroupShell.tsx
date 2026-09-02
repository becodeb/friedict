import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import {
  DotsThree,
  Gear,
  SignOut,
  UserPlus,
  Users,
} from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { useAuth } from '@/auth/useAuth'
import { useGroup, useLeaveGroup, useMembers } from '@/data/groups'
import { useGroupRealtime } from '@/data/realtime'
import { friendlyError } from '@/lib/errors'
import { ThemeToggle } from '@/components/ThemeToggle'
import { AvatarStack } from '@/components/ui/Avatar'
import { DropdownMenu } from '@/components/ui/DropdownMenu'
import { ErrorState, OfflineBanner } from '@/components/ui/States'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/toast-context'
import { InviteDialog } from '@/components/group/InviteDialog'
import { GroupSwitcher } from './GroupSwitcher'
import { BottomNav } from './BottomNav'
import { navDestinations } from './navigation'

/**
 * Layout del grupo.
 *
 * Acá vive el ÚNICO canal Realtime del grupo. Montarlo en el layout y no en
 * cada pantalla evita suscripciones duplicadas al navegar entre feed, ranking e
 * historial, y garantiza que se cierre una sola vez al salir del grupo.
 */
export function GroupShell() {
  const { groupId } = useParams<{ groupId: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const { user, profile } = useAuth()

  const group = useGroup(groupId)
  const members = useMembers(groupId)
  const leaveGroup = useLeaveGroup()

  const [inviteOpen, setInviteOpen] = useState(false)
  const [hasNews, setHasNews] = useState(false)
  const [offline, setOffline] = useState(
    () => typeof navigator !== 'undefined' && !navigator.onLine,
  )

  useEffect(() => {
    const goOnline = (): void => setOffline(false)
    const goOffline = (): void => setOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  useGroupRealtime(groupId, {
    onQualified: (prediction) => {
      setHasNews(true)
      toast.show({
        message: `«${prediction.title}» juntó las ${prediction.minimum_participants} personas. Queda.`,
        tone: 'success',
      })
    },
    onResolved: (prediction) => {
      setHasNews(true)
      toast.show({ message: `Se resolvió «${prediction.title}».`, tone: 'neutral' })
    },
    onMemberJoined: () => {
      setHasNews(true)
      toast.show({ message: 'Se sumó alguien al grupo.', tone: 'neutral' })
    },
    onNewPrediction: (prediction) => {
      if (prediction.created_by === user?.id) return
      setHasNews(true)
      toast.show({ message: 'Hay una predicción nueva.', tone: 'neutral' })
    },
  })

  const myRole = members.data?.find((member) => member.user_id === user?.id)?.role
  const isAdmin = myRole === 'owner' || myRole === 'admin'

  // RLS devuelve vacío para un grupo del que no sos parte. No se distingue de
  // "no existe" a propósito.
  if (group.isError) {
    return (
      <div className="feed-column py-16">
        <ErrorState
          title="No encontramos este grupo"
          body="O no existe, o no sos parte. Si te pasaron un link de invitación, abrilo de nuevo."
          onRetry={() => navigate('/')}
        />
      </div>
    )
  }

  const destinations = groupId ? navDestinations(groupId) : []

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a href="#contenido" className="skip-link">
        Saltar al contenido
      </a>

      {offline && <OfflineBanner />}

      {/* Cabecera opaca y con línea de tinta: la sombra dura de las tarjetas no
          combina con un desenfoque, así que acá no lo hay. */}
      <header
        className={cn(
          'sticky top-0 z-30 border-b-2 border-[var(--line-strong)] bg-[var(--bg)]',
          'pt-[var(--safe-t)]',
        )}
      >
        <div className="feed-column flex items-center gap-2 py-2">
          <div className="min-w-0 flex-1">
            {group.data && groupId ? (
              <GroupSwitcher groupId={groupId} groupName={group.data.name} />
            ) : (
              <Skeleton className="h-7 w-36" />
            )}
          </div>

          {members.data && members.data.length > 0 && (
            <NavLink
              to={`/g/${groupId}/miembros`}
              className={cn(
                'hidden shrink-0 items-center rounded-[var(--r-pill)] px-2',
                'min-h-[var(--tap)] hover:bg-[var(--bg-sunken)] sm:flex',
              )}
              aria-label={`Ver los ${members.data.length} integrantes`}
            >
              <AvatarStack
                people={members.data.map((member) => member.profile)}
                max={4}
                size="xs"
              />
            </NavLink>
          )}

          <ThemeToggle className="shrink-0" />

          <DropdownMenu
            label="Opciones del grupo"
            align="top-right"
            actions={[
              {
                label: 'Invitar gente',
                icon: <UserPlus size={16} weight="bold" aria-hidden="true" />,
                onSelect: () => setInviteOpen(true),
                disabled: !isAdmin,
              },
              {
                label: 'Integrantes',
                icon: <Users size={16} weight="bold" aria-hidden="true" />,
                onSelect: () => navigate(`/g/${groupId}/miembros`),
              },
              {
                label: 'Ajustes del grupo',
                icon: <Gear size={16} weight="bold" aria-hidden="true" />,
                onSelect: () => navigate(`/g/${groupId}/ajustes`),
              },
              {
                label: 'Salir del grupo',
                icon: <SignOut size={16} weight="bold" aria-hidden="true" />,
                tone: 'danger',
                disabled: myRole === 'owner',
                onSelect: () => {
                  if (!groupId) return
                  leaveGroup.mutate(groupId, {
                    onSuccess: () => navigate('/', { replace: true }),
                    onError: (error) =>
                      toast.show({ message: friendlyError(error), tone: 'error' }),
                  })
                },
              },
            ]}
            trigger={(props) => (
              <button
                type="button"
                {...props}
                aria-label="Opciones del grupo"
                className={cn(
                  'grid size-[var(--tap)] shrink-0 place-items-center rounded-full',
                  'text-[var(--ink)] hover:bg-[var(--bg-sunken)]',
                  'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
                )}
              >
                <DotsThree size={24} weight="bold" aria-hidden="true" />
              </button>
            )}
          />
        </div>

        {/* Navegación en desktop: la misma que abajo en mobile. */}
        <nav aria-label="Secciones del grupo" className="hidden sm:block">
          <ul className="feed-column flex gap-2 pb-2.5">
            {destinations.map((destination) => (
              <li key={destination.to}>
                <NavLink
                  to={destination.to}
                  end={destination.end}
                  className={({ isActive }) =>
                    cn(
                      'inline-flex min-h-[40px] items-center rounded-[var(--r-pill)] border-2 px-3.5',
                      'text-[0.8125rem] font-semibold',
                      'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
                      isActive
                        ? 'border-[var(--line-strong)] bg-[var(--ink)] text-[var(--bg)]'
                        : 'border-transparent text-[var(--ink-2)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)]',
                    )
                  }
                >
                  {destination.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {/* `overflow-x: clip` contiene el desplazamiento lateral de la transición
          de entrada, que en pantallas angostas empujaría unos píxeles fuera del
          viewport mientras dura. Se usa `clip` y no `hidden` porque no crea un
          contenedor de scroll; y va acá y no en el <html> para no romper el
          `position: sticky` del encabezado, que vive fuera de <main>. */}
      <main
        id="contenido"
        className="flex-1 overflow-x-clip pb-[calc(var(--bottom-nav-h)+var(--safe-b)+1rem)] sm:pb-16"
      >
        <Outlet context={{ groupId, isAdmin, myRole, profile }} />
      </main>

      {groupId && <BottomNav groupId={groupId} historyBadge={hasNews} />}

      {groupId && (
        <InviteDialog
          groupId={groupId}
          groupName={group.data?.name ?? ''}
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
        />
      )}
    </div>
  )
}
