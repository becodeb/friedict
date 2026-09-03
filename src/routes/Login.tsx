import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from '@phosphor-icons/react'
import { useAuth } from '@/auth/useAuth'
import { emailSchema } from '@/lib/validation'
import { friendlyError } from '@/lib/errors'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Avatar } from '@/components/ui/Avatar'
import { useToast } from '@/components/ui/toast-context'

/** El isotipo de Google es una marca de terceros: colores oficiales, sin
 * retocar, y sólo como icono de un botón «Continuar con Google» — el uso que
 * sus propias guías de marca piden. */
function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.9c1.7-1.57 2.68-3.87 2.68-6.61Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z"
      />
    </svg>
  )
}

/**
 * Cuentas del seed local (`db/seed.sql`), para entrar sin escribir nada
 * mientras se prueba en la propia máquina. La contraseña es siempre
 * `cantado123` y sólo existe en ese seed.
 */
const DEV_ACCOUNTS = [
  { id: 'bauti', email: 'bauti@cantado.test', display_name: 'Bauti', avatar_seed: 'BA', accent: 0 },
  { id: 'juan', email: 'juan@cantado.test', display_name: 'Juan', avatar_seed: 'JU', accent: 1 },
  { id: 'agus', email: 'agus@cantado.test', display_name: 'Agus', avatar_seed: 'AG', accent: 2 },
  { id: 'fran', email: 'fran@cantado.test', display_name: 'Fran', avatar_seed: 'FR', accent: 3 },
  { id: 'lu', email: 'lu@cantado.test', display_name: 'Lu', avatar_seed: 'LU', accent: 4 },
  { id: 'caro', email: 'caro@cantado.test', display_name: 'Caro', avatar_seed: 'CA', accent: 5 },
] as const

function DevQuickLogin({ onPick, busy }: { onPick: (email: string) => void; busy: string | null }) {
  return (
    <div className="mt-10 rounded-[var(--r-md)] border-2 border-dashed border-[var(--line-strong)] p-4">
      <p className="type-meta text-[var(--ink-3)]">Sólo en local · seed de prueba</p>
      <p className="mt-1.5 text-[0.8125rem] text-[var(--ink-2)]">
        Entrá directo como alguien del seed, sin escribir nada.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {DEV_ACCOUNTS.map((account) => (
          <li key={account.email}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => onPick(account.email)}
              className="flex min-h-[var(--tap)] items-center gap-2 rounded-[var(--r-pill)] border-2 border-[var(--line-strong)] bg-[var(--surface)] py-1 pl-1.5 pr-3.5 text-[0.8125rem] font-semibold text-[var(--ink)] transition-[background-color,box-shadow] duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] hover:shadow-[var(--shadow-1)] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
            >
              <Avatar person={account} size="xs" />
              {busy === account.email ? 'Entrando…' : account.display_name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Ingreso.
 *
 * Dos caminos: Google, que entra directo, y mail con contraseña. El Magic Link
 * quedó afuera porque necesita un proveedor de mail saliente, y una app de
 * amigos no puede depender de que el mail funcione para poder entrar.
 *
 * El mismo formulario sirve para entrar y para registrarse: son los mismos dos
 * campos, y obligar a elegir entre dos pantallas idénticas antes de escribir
 * nada es fricción sin ningún beneficio.
 */
export function Login() {
  const { signIn, signUp, signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const next = params.get('next') ?? undefined
  const googleError = params.get('error')

  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState<string | undefined>(undefined)
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)

  const goNext = (): void => {
    navigate(next && next.startsWith('/') ? next : '/', { replace: true })
  }

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setEmailError(undefined)
    setPasswordError(undefined)

    const parsed = emailSchema.safeParse(email)
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? 'Ese email no parece válido.')
      return
    }
    if (password.length < 8) {
      setPasswordError('La contraseña necesita al menos 8 caracteres.')
      return
    }

    setBusy('form')
    try {
      if (mode === 'signup') await signUp(parsed.data, password)
      else await signIn(parsed.data, password)
      goNext()
    } catch (error) {
      toast.show({
        message: friendlyError(
          error,
          mode === 'signup'
            ? 'No pudimos crear la cuenta.'
            : 'Mail o contraseña incorrectos.',
        ),
        tone: 'error',
      })
      setBusy(null)
    }
  }

  const onQuickLogin = async (accountEmail: string): Promise<void> => {
    setBusy(accountEmail)
    try {
      await signIn(accountEmail, 'cantado123')
      goNext()
    } catch (error) {
      toast.show({
        message: friendlyError(error, '¿Corriste `npm run db:reset`? Esa cuenta no existe.'),
        tone: 'error',
      })
      setBusy(null)
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="feed-column flex items-center justify-between pt-5">
        <Link
          to="/"
          className="grid size-[var(--tap)] -ml-3 place-items-center rounded-full text-[var(--ink)] hover:bg-[var(--bg-sunken)]"
        >
          <ArrowLeft size={18} weight="bold" aria-hidden="true" />
          <span className="sr-only">Volver a la portada</span>
        </Link>
        <Logo size="sm" />
      </header>

      <main className="feed-column flex flex-1 flex-col justify-center pb-24 pt-10">
        <h1 className="type-title max-w-[14ch]">
          {mode === 'signup' ? 'Creá tu cuenta' : 'Entrá a friedict'}
        </h1>
        <p className="mt-3 max-w-[38ch] text-[var(--ink-2)]">
          Con Google entrás directo. También podés usar tu mail y una contraseña.
        </p>

        {googleError && (
          <p
            role="alert"
            className="mt-4 max-w-sm rounded-[var(--r-md)] border-2 border-[var(--danger)] bg-[var(--danger-wash)] px-3.5 py-3 text-[0.875rem] text-[var(--ink)]"
          >
            No pudimos completar el ingreso con Google. Probá de nuevo o entrá con tu mail.
          </p>
        )}

        <div className="mt-7 max-w-sm">
          <Button
            variant="secondary"
            size="lg"
            block
            onClick={() => signInWithGoogle(next)}
            iconLeft={<GoogleGlyph />}
          >
            Continuar con Google
          </Button>

          <div className="my-5 flex items-center gap-3" aria-hidden="true">
            <span className="h-0.5 flex-1 bg-[var(--line)]" />
            <span className="type-meta text-[var(--ink-3)]">o con tu mail</span>
            <span className="h-0.5 flex-1 bg-[var(--line)]" />
          </div>

          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <TextField
              label="Tu email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="vos@ejemplo.com"
              value={email}
              error={emailError}
              onChange={(event) => {
                setEmail(event.target.value)
                if (emailError) setEmailError(undefined)
              }}
            />
            <TextField
              label="Tu contraseña"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              placeholder="Al menos 8 caracteres"
              value={password}
              error={passwordError}
              onChange={(event) => {
                setPassword(event.target.value)
                if (passwordError) setPasswordError(undefined)
              }}
            />
            <Button type="submit" size="lg" block loading={busy === 'form'}>
              {mode === 'signup' ? 'Crear cuenta' : 'Entrar'}
            </Button>
          </form>

          <p className="mt-4 text-[0.875rem] text-[var(--ink-2)]">
            {mode === 'signup' ? '¿Ya tenés cuenta?' : '¿Todavía no tenés cuenta?'}{' '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'signup' ? 'signin' : 'signup')
                setEmailError(undefined)
                setPasswordError(undefined)
              }}
              className="font-semibold text-[var(--accent-ink)] underline underline-offset-2"
            >
              {mode === 'signup' ? 'Entrá' : 'Creá una'}
            </button>
          </p>

          {import.meta.env.DEV && (
            <DevQuickLogin onPick={(value) => void onQuickLogin(value)} busy={busy} />
          )}
        </div>
      </main>
    </div>
  )
}
