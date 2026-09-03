import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/auth/useAuth'
import { useJoinGroup, usePeekInvite } from '@/data/invites'
import { joinGroupSchema } from '@/lib/validation'
import { friendlyError } from '@/lib/errors'
import { Logo } from '@/components/Logo'
import { AvatarPicker } from '@/components/AvatarPicker'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Reveal, RevealLine } from '@/components/ui/Reveal'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/toast-context'

/**
 * Entrada por link de invitación.
 *
 * Un token inexistente, vencido, revocado o agotado producen exactamente la
 * misma pantalla. Distinguirlos filtraría si un grupo existe, y estos links
 * circulan por WhatsApp a manos de cualquiera.
 */
export function JoinInvite() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const { user, profile, loading: authLoading } = useAuth()

  const preview = usePeekInvite(token)
  const joinGroup = useJoinGroup()

  const [displayName, setDisplayName] = useState('')
  const [accent, setAccent] = useState(0)
  const [error, setError] = useState<string | undefined>(undefined)
  const [syncedProfileId, setSyncedProfileId] = useState<string | null>(null)

  // Si ya tenías perfil de otro grupo, el formulario viene precargado. Se
  // ajusta durante el render y una sola vez por perfil, para no pisar el
  // nombre si lo estabas cambiando.
  if (profile && profile.id !== syncedProfileId) {
    setSyncedProfileId(profile.id)
    setDisplayName(profile.display_name)
    setAccent(profile.accent)
  }

  // Si ya sos del grupo, el link te lleva adentro sin preguntar nada.
  useEffect(() => {
    const data = preview.data
    if (data?.valid && data.already_member && data.group_id) {
      navigate(`/g/${data.group_id}`, { replace: true })
    }
  }, [preview.data, navigate])

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (!token) return

    const parsed = joinGroupSchema.safeParse({ displayName, accent })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisá tu nombre.')
      return
    }
    setError(undefined)

    joinGroup.mutate(
      { token, displayName: parsed.data.displayName, accent: parsed.data.accent },
      {
        onSuccess: (groupId) => navigate(`/g/${groupId}`, { replace: true }),
        onError: (caught) =>
          toast.show({
            message: friendlyError(caught, 'No pudimos sumarte al grupo.'),
            tone: 'error',
          }),
      },
    )
  }

  const invalid = preview.isError || (preview.data && !preview.data.valid)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="feed-column pt-5">
        <Logo size="sm" />
      </header>

      <main className="feed-column flex-1 pb-24 pt-12">
        {preview.isLoading || authLoading ? (
          <div className="max-w-md space-y-4" aria-busy="true">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-[70%]" />
            <Skeleton className="h-4 w-[45%]" />
          </div>
        ) : invalid ? (
          <Reveal>
            <RevealLine as="h1" index={1} className="type-title max-w-[18ch]">
              Este link no sirve
            </RevealLine>
            <RevealLine as="p" index={2} className="mt-3 max-w-[40ch] text-[var(--ink-2)]">
              Puede que haya vencido o que lo hayan dado de baja. Pedile a
              alguien del grupo que te mande uno nuevo.
            </RevealLine>
            <RevealLine index={3} className="mt-6">
              <Button variant="secondary" onClick={() => navigate('/')}>
                Ir a la portada
              </Button>
            </RevealLine>
          </Reveal>
        ) : !user ? (
          <Reveal>
            <RevealLine as="p" index={1} className="type-meta text-[var(--ink-3)]">
              Te invitaron a
            </RevealLine>
            <RevealLine as="h1" index={2} className="type-display mt-2 max-w-[14ch] text-[2.5rem]">
              {preview.data?.group_name}
            </RevealLine>
            <RevealLine as="p" index={3} className="mt-4 max-w-[38ch] text-[var(--ink-2)]">
              {preview.data?.member_count === 1
                ? 'Sos la primera persona en sumarte.'
                : `Ya son ${preview.data?.member_count} en el grupo.`}{' '}
              Entrá con tu mail y elegís tu nombre en el paso siguiente.
            </RevealLine>
            <RevealLine index={4} className="mt-7">
              <Button
                size="lg"
                onClick={() =>
                  navigate(`/entrar?next=${encodeURIComponent(`/join/${token}`)}`)
                }
              >
                Entrar para sumarme
              </Button>
            </RevealLine>
          </Reveal>
        ) : (
          <>
            <p className="type-meta text-[var(--ink-3)]">Te invitaron a</p>
            <h1 className="type-display mt-2 max-w-[14ch] text-[2.5rem]">
              {preview.data?.group_name}
            </h1>

            <form onSubmit={onSubmit} className="mt-8 max-w-md space-y-5" noValidate>
              <TextField
                label="Cómo te llamás"
                hint="Es el nombre que va a ver el grupo."
                placeholder="Agus"
                autoComplete="nickname"
                maxLength={40}
                value={displayName}
                error={error}
                onChange={(event) => {
                  setDisplayName(event.target.value)
                  if (error) setError(undefined)
                }}
              />

              <AvatarPicker value={accent} onChange={setAccent} name={displayName} />

              <Button type="submit" size="lg" block loading={joinGroup.isPending}>
                Sumarme al grupo
              </Button>
            </form>
          </>
        )}
      </main>

      <footer className="feed-column py-6">
        <Link to="/" className="type-micro text-[var(--ink-3)] underline underline-offset-2">
          ¿Qué es friedict?
        </Link>
      </footer>
    </div>
  )
}
