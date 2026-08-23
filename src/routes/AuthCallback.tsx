import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/useAuth'
import { Logo } from '@/components/Logo'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'

/**
 * Vuelta del Magic Link.
 *
 * El cliente de Supabase está configurado con `detectSessionInUrl`, así que
 * canjea el código apenas carga el módulo. Acá sólo se espera a que la sesión
 * aparezca y se redirige a donde la persona quería ir.
 *
 * Si el link ya se usó o venció, Supabase devuelve el error en el hash, no en
 * el query string.
 */
export function AuthCallback() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [timedOut, setTimedOut] = useState(false)

  const next = params.get('next')
  const hashError = new URLSearchParams(window.location.hash.slice(1)).get(
    'error_description',
  )
  const queryError = params.get('error_description') ?? params.get('error')
  const linkError = hashError ?? queryError

  useEffect(() => {
    if (session) {
      navigate(next && next.startsWith('/') ? next : '/', { replace: true })
    }
  }, [session, next, navigate])

  useEffect(() => {
    if (session || linkError) return
    const timer = window.setTimeout(() => setTimedOut(true), 8000)
    return () => window.clearTimeout(timer)
  }, [session, linkError])

  const failed = Boolean(linkError) || (timedOut && !session && !loading)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="feed-column pt-5">
        <Logo size="sm" />
      </header>

      <main className="feed-column flex flex-1 flex-col justify-center pb-24">
        {failed ? (
          <div role="alert">
            <h1 className="type-title max-w-[18ch]">Este link ya no sirve</h1>
            <p className="mt-3 max-w-[38ch] text-[var(--ink-2)]">
              Los links para entrar duran poco y se usan una sola vez. Pedí uno
              nuevo y listo.
            </p>
            <Button className="mt-6" onClick={() => navigate('/entrar', { replace: true })}>
              Pedir otro link
            </Button>
          </div>
        ) : (
          <div role="status" className="flex items-center gap-3 text-[var(--ink-2)]">
            <Spinner size={18} />
            Entrando…
          </div>
        )}
      </main>

      <footer className="feed-column py-6">
        <Link to="/" className="type-micro text-[var(--ink-3)] underline underline-offset-2">
          Volver a la portada
        </Link>
      </footer>
    </div>
  )
}
