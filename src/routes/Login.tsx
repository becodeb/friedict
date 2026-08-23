import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, EnvelopeSimple } from '@phosphor-icons/react'
import { useAuth } from '@/auth/useAuth'
import { emailSchema } from '@/lib/validation'
import { friendlyError } from '@/lib/errors'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Reveal, RevealLine } from '@/components/ui/Reveal'

/**
 * Ingreso con Magic Link.
 *
 * No hay contraseña a propósito: pedirle a alguien que invente y recuerde una
 * clave para votar si Fran llega tarde es fricción sin beneficio. Un mail, un
 * link, adentro.
 */
export function Login() {
  const { signInWithEmail } = useAuth()
  const [params] = useSearchParams()
  const next = params.get('next') ?? undefined

  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [sending, setSending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setError(undefined)

    const parsed = emailSchema.safeParse(email)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Ese email no parece válido.')
      return
    }

    setSending(true)
    try {
      await signInWithEmail(parsed.data, next)
      setSentTo(parsed.data)
    } catch (caught) {
      setError(friendlyError(caught, 'No pudimos mandar el mail. Probá otra vez.'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="feed-column flex items-center justify-between pt-5">
        <Link to="/" className="inline-flex items-center gap-2 text-[var(--ink-3)]">
          <ArrowLeft size={16} weight="bold" aria-hidden="true" />
          <span className="sr-only">Volver a la portada</span>
        </Link>
        <Logo size="sm" />
      </header>

      <main className="feed-column flex flex-1 flex-col justify-center pb-24 pt-10">
        {sentTo ? (
          <Reveal key="sent">
            <RevealLine index={1}>
              <span
                className="grid size-11 place-items-center rounded-full bg-[var(--accent-wash)] text-[var(--accent-ink)]"
                aria-hidden="true"
              >
                <EnvelopeSimple size={20} weight="bold" />
              </span>
            </RevealLine>
            <RevealLine as="h1" index={2} className="type-title mt-5 max-w-[16ch]">
              Te mandamos un link
            </RevealLine>
            <RevealLine as="p" index={3} className="mt-3 max-w-[38ch] text-[var(--ink-2)]">
              Está en <strong className="font-medium text-[var(--ink)]">{sentTo}</strong>.
              Abrilo desde este mismo dispositivo y entrás directo.
            </RevealLine>
            <RevealLine index={4} className="mt-6">
              <Button
                variant="secondary"
                onClick={() => {
                  setSentTo(null)
                  setEmail('')
                }}
              >
                Usar otro email
              </Button>
            </RevealLine>
          </Reveal>
        ) : (
          <>
            <h1 className="type-title max-w-[14ch]">Entrá con tu mail</h1>
            <p className="mt-3 max-w-[38ch] text-[var(--ink-2)]">
              Te mandamos un link para entrar. No hace falta contraseña.
            </p>

            <form onSubmit={onSubmit} className="mt-7 max-w-sm" noValidate>
              <TextField
                label="Tu email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="vos@ejemplo.com"
                value={email}
                error={error}
                onChange={(event) => {
                  setEmail(event.target.value)
                  if (error) setError(undefined)
                }}
              />
              <Button type="submit" size="lg" block className="mt-4" loading={sending}>
                Mandame el link
              </Button>
            </form>
          </>
        )}
      </main>
    </div>
  )
}
