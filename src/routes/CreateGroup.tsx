import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from '@phosphor-icons/react'
import { useAuth } from '@/auth/useAuth'
import { useCreateGroup } from '@/data/groups'
import { createGroupSchema } from '@/lib/validation'
import { friendlyError } from '@/lib/errors'
import { Logo } from '@/components/Logo'
import { AvatarPicker } from '@/components/AvatarPicker'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { useToast } from '@/components/ui/toast-context'

/**
 * Crear grupo: dos campos y un color. Nada más.
 *
 * El perfil se crea en la misma llamada RPC que el grupo, así que no hay una
 * pantalla de onboarding aparte pidiendo datos que a nadie le importan.
 */
export function CreateGroup() {
  const navigate = useNavigate()
  const toast = useToast()
  const { profile } = useAuth()
  const createGroup = useCreateGroup()

  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [accent, setAccent] = useState(profile?.accent ?? 0)
  const [errors, setErrors] = useState<{ name?: string; displayName?: string }>({})

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()

    const parsed = createGroupSchema.safeParse({ name, displayName, accent })
    if (!parsed.success) {
      const next: { name?: string; displayName?: string } = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0]
        if (field === 'name') next.name = issue.message
        if (field === 'displayName') next.displayName = issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})

    createGroup.mutate(parsed.data, {
      onSuccess: (group) => navigate(`/g/${group.id}?nuevo=1`, { replace: true }),
      onError: (error) =>
        toast.show({
          message: friendlyError(error, 'No pudimos crear el grupo.'),
          tone: 'error',
        }),
    })
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="feed-column flex items-center justify-between pt-5">
        <Link
          to="/"
          aria-label="Volver"
          className="grid size-[var(--tap)] -ml-3 place-items-center rounded-full text-[var(--ink)] hover:bg-[var(--bg-sunken)]"
        >
          <ArrowLeft size={18} weight="bold" aria-hidden="true" />
        </Link>
        <Logo size="sm" />
      </header>

      <main className="feed-column flex-1 pb-24 pt-10">
        <h1 className="type-title max-w-[16ch]">Armá tu grupo</h1>
        <p className="mt-3 max-w-[38ch] text-[var(--ink-2)]">
          Después vas a poder compartir un link para que se sumen los demás.
        </p>

        <form onSubmit={onSubmit} className="mt-8 max-w-md space-y-5" noValidate>
          <TextField
            label="Nombre del grupo"
            placeholder="Los pibes"
            autoComplete="off"
            maxLength={48}
            value={name}
            error={errors.name}
            onChange={(event) => {
              setName(event.target.value)
              if (errors.name) setErrors((e) => ({ ...e, name: undefined }))
            }}
          />

          <TextField
            label="Cómo te llamás"
            hint="Es el nombre que va a ver el grupo."
            placeholder="Bauti"
            autoComplete="nickname"
            maxLength={40}
            value={displayName}
            error={errors.displayName}
            onChange={(event) => {
              setDisplayName(event.target.value)
              if (errors.displayName) setErrors((e) => ({ ...e, displayName: undefined }))
            }}
          />

          <AvatarPicker value={accent} onChange={setAccent} name={displayName} />

          <Button type="submit" size="lg" block loading={createGroup.isPending}>
            Crear grupo
          </Button>
        </form>
      </main>
    </div>
  )
}
