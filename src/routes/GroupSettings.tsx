import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { useAuth } from '@/auth/useAuth'
import {
  useGroup,
  useLeaveGroup,
  useMembers,
  useUpdateGroupSettings,
  useUpdateProfile,
} from '@/data/groups'
import { friendlyError } from '@/lib/errors'
import { formatDate } from '@/lib/time'
import { groupSettingsSchema } from '@/lib/validation'
import { AvatarPicker } from '@/components/AvatarPicker'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Skeleton } from '@/components/ui/Skeleton'
import { Toggle } from '@/components/ui/Toggle'
import { useToast } from '@/components/ui/toast-context'

interface GroupContext {
  groupId: string
  isAdmin: boolean
}

/**
 * Ajustes.
 *
 * Deliberadamente corto. Lo único configurable de verdad es cómo te ve el
 * grupo; el resto son datos y la salida. Cada preferencia que se agregue acá es
 * una decisión que alguien tiene que tomar antes de poder jugar.
 */
export function GroupSettings() {
  const { groupId, isAdmin } = useOutletContext<GroupContext>()
  const navigate = useNavigate()
  const toast = useToast()
  const { user, profile, signOut, refreshProfile } = useAuth()

  const group = useGroup(groupId)
  const members = useMembers(groupId)
  const updateProfile = useUpdateProfile()
  const updateGroupSettings = useUpdateGroupSettings(groupId)
  const leaveGroup = useLeaveGroup()

  const [displayName, setDisplayName] = useState('')
  const [accent, setAccent] = useState(0)
  const [saved, setSaved] = useState(false)
  const [syncedProfileId, setSyncedProfileId] = useState<string | null>(null)

  // El formulario se siembra con el perfil apenas llega, ajustando el estado
  // durante el render en vez de con un efecto. La clave es el id: así se
  // siembra una sola vez y un refresco posterior del perfil no pisa lo que la
  // persona esté escribiendo.
  if (profile && profile.id !== syncedProfileId) {
    setSyncedProfileId(profile.id)
    setDisplayName(profile.display_name)
    setAccent(profile.accent)
  }

  useEffect(() => {
    if (!saved) return
    const timer = window.setTimeout(() => setSaved(false), 2200)
    return () => window.clearTimeout(timer)
  }, [saved])

  // Mismo patrón de siembra que el perfil de arriba: el formulario parte de
  // valores por default sensatos (nadie ve un campo vacío mientras carga) y
  // se resiembra una única vez apenas llega la fila real del grupo.
  const [closeRequestQuorum, setCloseRequestQuorum] = useState(1)
  const [qualificationEnabled, setQualificationEnabled] = useState(false)
  const [qualificationPercent, setQualificationPercent] = useState(60)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [syncedGroupId, setSyncedGroupId] = useState<string | null>(null)

  if (group.data && group.data.id !== syncedGroupId) {
    setSyncedGroupId(group.data.id)
    setCloseRequestQuorum(group.data.close_request_quorum)
    setQualificationEnabled(group.data.qualification_enabled)
    setQualificationPercent(group.data.qualification_percent)
  }

  useEffect(() => {
    if (!settingsSaved) return
    const timer = window.setTimeout(() => setSettingsSaved(false), 2200)
    return () => window.clearTimeout(timer)
  }, [settingsSaved])

  const myRole = members.data?.find((member) => member.user_id === user?.id)?.role
  const dirty =
    profile && (displayName !== profile.display_name || accent !== profile.accent)

  const memberCount = members.data?.length
  const settingsParsed = groupSettingsSchema.safeParse({
    closeRequestQuorum,
    qualificationEnabled,
    qualificationPercent,
  })
  const settingsDirty =
    group.data !== undefined &&
    (closeRequestQuorum !== group.data.close_request_quorum ||
      qualificationEnabled !== group.data.qualification_enabled ||
      qualificationPercent !== group.data.qualification_percent)

  return (
    <div className="feed-column pt-5">
      <h1 className="type-title text-[1.375rem]">Ajustes</h1>

      <section className="mt-7" aria-labelledby="perfil-titulo">
        <h2 id="perfil-titulo" className="type-meta text-[var(--ink-3)]">
          Cómo te ve el grupo
        </h2>

        <div className="mt-3 max-w-md space-y-5">
          <TextField
            label="Tu nombre"
            maxLength={40}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <AvatarPicker value={accent} onChange={setAccent} name={displayName} />

          <Button
            disabled={!dirty || displayName.trim().length < 2}
            loading={updateProfile.isPending}
            succeeded={saved}
            onClick={() =>
              updateProfile.mutate(
                { displayName: displayName.trim(), accent },
                {
                  onSuccess: () => {
                    setSaved(true)
                    void refreshProfile()
                  },
                  onError: (error) =>
                    toast.show({ message: friendlyError(error), tone: 'error' }),
                },
              )
            }
          >
            Guardar cambios
          </Button>
        </div>
      </section>

      <section className="mt-10 border-t border-[var(--line)] pt-5" aria-labelledby="grupo-titulo">
        <h2 id="grupo-titulo" className="type-meta text-[var(--ink-3)]">
          El grupo
        </h2>

        {group.isLoading ? (
          <Skeleton className="mt-3 h-5 w-40" />
        ) : (
          <dl className="mt-3 space-y-2 text-[0.9375rem]">
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--ink-3)]">Nombre</dt>
              <dd className="text-right font-medium">{group.data?.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--ink-3)]">Integrantes</dt>
              <dd className="text-right tabular">{members.data?.length ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--ink-3)]">Creado</dt>
              <dd className="text-right">
                {group.data ? formatDate(group.data.created_at) : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--ink-3)]">Tu rol</dt>
              <dd className="text-right">
                {myRole === 'owner'
                  ? 'Creaste el grupo'
                  : myRole === 'admin'
                    ? 'Administrás'
                    : 'Integrante'}
              </dd>
            </div>
          </dl>
        )}

        <p className="mt-4 max-w-[46ch] text-[0.875rem] leading-relaxed text-[var(--ink-2)]">
          Este grupo es privado. Sólo quien tiene un link de invitación vigente
          puede entrar, y nada de lo que pasa acá adentro es visible desde afuera
          ni aparece en buscadores.
        </p>
      </section>

      <section
        className="mt-10 border-t border-[var(--line)] pt-5"
        aria-labelledby="funcionamiento-titulo"
      >
        <h2 id="funcionamiento-titulo" className="type-meta text-[var(--ink-3)]">
          Cómo funciona este grupo
        </h2>

        {isAdmin ? (
          <div className="mt-3 max-w-md space-y-4">
            <Toggle
              label="Calificación opcional"
              description="Prendida, una predicción nueva nace «en prueba» hasta que el grupo la elija. Apagada (default), nace activa directamente."
              checked={qualificationEnabled}
              onChange={setQualificationEnabled}
            />
            {qualificationEnabled && (
              <TextField
                label="Porcentaje del grupo que tiene que elegirla"
                type="number"
                min={1}
                max={100}
                value={qualificationPercent}
                onChange={(event) => setQualificationPercent(Number(event.target.value))}
              />
            )}
            <TextField
              label="Quórum de cierre: cuánta gente tiene que pedirlo en una predicción sin fecha"
              hint="Con 1 alcanza si confiás en el grupo. Se acota solo al conteo vivo de integrantes."
              type="number"
              min={1}
              max={memberCount}
              value={closeRequestQuorum}
              onChange={(event) => setCloseRequestQuorum(Number(event.target.value))}
            />
            <Button
              disabled={!settingsDirty || !settingsParsed.success}
              loading={updateGroupSettings.isPending}
              succeeded={settingsSaved}
              onClick={() =>
                updateGroupSettings.mutate(
                  { closeRequestQuorum, qualificationEnabled, qualificationPercent },
                  {
                    onSuccess: () => setSettingsSaved(true),
                    onError: (error) =>
                      toast.show({ message: friendlyError(error), tone: 'error' }),
                  },
                )
              }
            >
              Guardar ajustes del grupo
            </Button>
          </div>
        ) : (
          <dl className="mt-3 space-y-2 text-[0.9375rem]">
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--ink-3)]">Calificación</dt>
              <dd className="text-right">
                {group.data?.qualification_enabled
                  ? `Prendida (${group.data.qualification_percent}%)`
                  : 'Apagada'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--ink-3)]">Quórum de cierre</dt>
              <dd className="text-right tabular">{group.data?.close_request_quorum ?? '—'}</dd>
            </div>
            <p className="mt-3 max-w-[46ch] type-micro text-[var(--ink-3)]">
              Sólo quien administra el grupo puede cambiar esto.
            </p>
          </dl>
        )}
      </section>

      <section className="mt-10 border-t border-[var(--line)] pt-5" aria-labelledby="cuenta-titulo">
        <h2 id="cuenta-titulo" className="type-meta text-[var(--ink-3)]">
          Tu cuenta
        </h2>

        <p className="mt-3 text-[0.875rem] text-[var(--ink-2)]">
          Entraste con <strong className="font-medium text-[var(--ink)]">{user?.email}</strong>.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void signOut().then(() => navigate('/', { replace: true }))
            }}
          >
            Cerrar sesión
          </Button>

          {myRole !== 'owner' && (
            <Button
              variant="danger"
              size="sm"
              loading={leaveGroup.isPending}
              onClick={() =>
                leaveGroup.mutate(groupId, {
                  onSuccess: () => navigate('/', { replace: true }),
                  onError: (error) =>
                    toast.show({ message: friendlyError(error), tone: 'error' }),
                })
              }
            >
              Salir del grupo
            </Button>
          )}
        </div>

        {myRole === 'owner' && (
          <p className="mt-3 type-micro text-[var(--ink-3)]">
            Creaste este grupo, así que no podés salir sin dejarlo sin dueño.
          </p>
        )}
      </section>
    </div>
  )
}
