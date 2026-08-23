import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight } from '@phosphor-icons/react'
import { useAuth } from '@/auth/useAuth'
import { useMyGroups } from '@/data/groups'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/Button'
import { Reveal, RevealLine } from '@/components/ui/Reveal'
import { cn } from '@/lib/cn'

/**
 * Landing.
 *
 * A propósito NO es un hero centrado con tres columnas de features. Es una
 * portada editorial: la pregunta del producto en grande, una frase que dice qué
 * es, y debajo una predicción de ejemplo con la misma gramática visual que el
 * feed real. Mostrar el mecanismo convence más que describirlo.
 */
export function Landing() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const { data: groups } = useMyGroups(Boolean(session))

  // Quien ya tiene sesión y grupo no necesita ver la portada.
  useEffect(() => {
    if (loading || !session || !groups) return
    if (groups.length > 0 && groups[0]) navigate(`/g/${groups[0].id}`, { replace: true })
  }, [loading, session, groups, navigate])

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a href="#contenido" className="skip-link">
        Saltar al contenido
      </a>

      <header className="page-column flex items-center justify-between pt-5">
        <Logo />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {!session && (
            <Link
              to="/entrar"
              className={cn(
                'inline-flex min-h-[var(--tap)] items-center rounded-[var(--r-sm)] px-3',
                'text-[0.875rem] font-medium text-[var(--ink-2)] hover:text-[var(--ink)]',
                'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
              )}
            >
              Entrar
            </Link>
          )}
        </div>
      </header>

      <main id="contenido" className="page-column flex-1 pb-16">
        <Reveal className="pt-16 sm:pt-24">
          <RevealLine as="h1" index={1} className="type-display max-w-[11ch]">
            ¿Qué va a pasar?
          </RevealLine>

          <RevealLine
            as="p"
            index={2}
            className="mt-6 max-w-[42ch] text-[1.0625rem] leading-relaxed text-[var(--ink-2)]"
          >
            Predicciones privadas entre amigos. Elegís qué creés que va a pasar y
            después se ve quién tenía razón.
          </RevealLine>

          <RevealLine index={3} className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              onClick={() => navigate(session ? '/crear-grupo' : '/entrar?next=/crear-grupo')}
              iconRight={<ArrowRight size={17} weight="bold" />}
            >
              Crear un grupo
            </Button>
            <p className="type-micro max-w-[22ch] text-[var(--ink-3)]">
              Sin plata, sin apuestas, sin premios. Puntos y cargadas nada más.
            </p>
          </RevealLine>
        </Reveal>

        {/* Ejemplo: misma gramática visual que el feed real. */}
        <section className="mt-20" aria-labelledby="ejemplo-titulo">
          <h2 id="ejemplo-titulo" className="type-meta text-[var(--ink-3)]">
            Así se ve una predicción
          </h2>

          <div
            className="relative mt-4 border-t border-[var(--line)] py-5 pl-4"
            aria-hidden="true"
          >
            <span
              className="status-rail"
              style={{ '--rail': 'var(--status-testing)' } as React.CSSProperties}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="type-meta text-[var(--status-testing)]">En prueba</span>
              <span className="type-meta text-[var(--ink-3)]">cierra en 2 d</span>
            </div>

            <p className="type-question mt-2.5">¿Bauti llega después de las 22:30?</p>

            <div className="mt-3.5 space-y-1.5">
              {['Sí', 'No', 'Dice que está llegando pero sigue en su casa'].map(
                (label, i) => (
                  <div
                    key={label}
                    className={cn(
                      'flex min-h-[48px] items-center gap-3 rounded-[var(--r-sm)] border px-3 py-2',
                      i === 0
                        ? 'border-[var(--accent)] bg-[var(--accent-wash)]'
                        : 'border-[var(--line-strong)] bg-[var(--surface)]',
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-5 shrink-0 place-items-center rounded-full border-2',
                        i === 0
                          ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]'
                          : 'border-[var(--line-strong)] text-transparent',
                      )}
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M3.5 8.5l3 3 6-6.5"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <span className="text-[0.9375rem] leading-snug">{label}</span>
                  </div>
                ),
              )}
            </div>

            <div className="mt-3 flex items-center gap-2.5">
              <span className="flex items-center gap-1">
                <span className="size-[7px] rounded-full bg-[var(--status-testing)]" />
                <span className="size-[7px] rounded-full bg-[var(--status-testing)]" />
                <span className="size-[7px] scale-90 rounded-full bg-[var(--line-strong)]" />
              </span>
              <span className="type-meta text-[var(--ink-2)]">2 de 3</span>
              <span className="text-[0.8125rem] text-[var(--ink-3)]">
                Falta una persona para que siga
              </span>
            </div>
          </div>
        </section>

        <section className="mt-14 max-w-[52ch] border-t border-[var(--line)] pt-8">
          <h2 className="type-title text-[1.125rem]">Las predicciones se ganan el lugar</h2>
          <p className="mt-2.5 leading-relaxed text-[var(--ink-2)]">
            Cuando alguien propone una, entra <em>en prueba</em>. Si en 48 horas no
            eligieron al menos tres personas, se va sola y no ensucia el feed. Si
            llegan a tres, queda hasta su fecha de cierre.
          </p>
          <p className="mt-3 leading-relaxed text-[var(--ink-2)]">
            Nadie ve qué eligieron los demás hasta que cierra. Recién ahí se
            revela todo junto y alguien propone el resultado, que tienen que
            confirmar otras dos personas del grupo.
          </p>
        </section>
      </main>

      <footer className="page-column border-t border-[var(--line)] py-6">
        <p className="type-micro text-[var(--ink-3)]">
          Cantado es un juego social privado. No hay dinero, saldo, premios ni
          apuestas de ningún tipo.
        </p>
      </footer>
    </div>
  )
}
