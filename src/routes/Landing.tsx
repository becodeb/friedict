import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Check } from '@phosphor-icons/react'
import { useAuth } from '@/auth/useAuth'
import { useMyGroups } from '@/data/groups'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/Button'
import { Reveal, RevealLine } from '@/components/ui/Reveal'
import { Sticker } from '@/components/ui/Sticker'
import { ParticipationThreshold } from '@/components/prediction/ParticipationThreshold'
import { PredictionStatusLabel } from '@/components/prediction/PredictionStatus'
import { cn } from '@/lib/cn'

/**
 * Portada.
 *
 * A propósito NO es un hero centrado con tres columnas de features. Es la
 * pregunta del producto en grande, una frase que dice qué es, y debajo una
 * predicción de ejemplo con la misma gramática visual que el feed real:
 * tarjeta, stickers y píldoras. Mostrar el mecanismo convence más que
 * describirlo.
 */
const EXAMPLE_OPTIONS = ['Sí', 'No', 'Dice que está llegando pero sigue en su casa']

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
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {!session && (
            <Link
              to="/entrar"
              className={cn(
                'inline-flex min-h-[var(--tap)] items-center rounded-[var(--r-pill)] border-2',
                'border-[var(--line-strong)] bg-[var(--surface)] px-4 text-[0.875rem] font-semibold',
                'hover:bg-[var(--surface-2)] hover:shadow-[var(--shadow-1)]',
                'transition-[background-color,box-shadow] duration-[var(--motion-fast)] motion-reduce:transition-none',
              )}
            >
              Entrar
            </Link>
          )}
        </div>
      </header>

      <main id="contenido" className="page-column flex-1 pb-16">
        <Reveal className="pt-14 sm:pt-20">
          <RevealLine index={1} className="flex flex-wrap gap-2.5">
            <Sticker tone="sun" tilt={-3}>
              Sin plata
            </Sticker>
            <Sticker tone="lime" tilt={2}>
              Sin apuestas
            </Sticker>
            <Sticker tone="sky" tilt={-2}>
              Sin premios
            </Sticker>
          </RevealLine>

          <RevealLine as="h1" index={2} className="type-display mt-7 max-w-[11ch]">
            ¿Qué va a pasar?
          </RevealLine>

          <RevealLine
            as="p"
            index={3}
            className="mt-6 max-w-[42ch] text-[1.0625rem] leading-relaxed text-[var(--ink-2)]"
          >
            Predicciones privadas entre amigos. Elegís qué creés que va a pasar y
            después se ve quién tenía razón. Puntos y cargadas, nada más.
          </RevealLine>

          <RevealLine index={4} className="mt-8">
            <Button
              size="lg"
              onClick={() => navigate(session ? '/crear-grupo' : '/entrar?next=/crear-grupo')}
              iconRight={<ArrowRight size={17} weight="bold" />}
            >
              Crear un grupo
            </Button>
          </RevealLine>
        </Reveal>

        {/* Ejemplo: misma gramática visual que el feed real. */}
        <section className="mt-20 max-w-[34rem]" aria-labelledby="ejemplo-titulo">
          <h2 id="ejemplo-titulo" className="type-meta text-[var(--ink-3)]">
            Así se ve una predicción
          </h2>

          <div className="card-pop relative mt-8 px-4 pb-4 pt-6 sm:px-5" aria-hidden="true">
            <div className="pointer-events-none absolute inset-x-3 -top-[15px] flex items-start justify-between gap-2 sm:inset-x-4">
              <PredictionStatusLabel status="proposed" animate={false} cut tilt={-4} />
              <Sticker cut tilt={3}>
                cierra en 2 d
              </Sticker>
            </div>

            <p className="type-question mt-1">¿Bauti llega después de las 22:30?</p>
            <p className="mt-2 text-[0.875rem] leading-snug text-[var(--ink-2)]">
              El sábado en lo de Agus. Dijo que sale 21:45.
            </p>

            <div className="mt-4 space-y-2">
              {EXAMPLE_OPTIONS.map((label, i) => {
                const chosen = i === 0
                return (
                  <div
                    key={label}
                    className={cn(
                      'opt-pill',
                      chosen && 'bg-[var(--accent)] text-[var(--on-candy)] shadow-[var(--shadow-1)]',
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-[18px] shrink-0 place-items-center rounded-full border-2 border-[var(--line-strong)]',
                        chosen ? 'bg-[var(--ink)] text-[var(--bg)]' : 'text-transparent',
                      )}
                    >
                      <Check size={11} weight="bold" />
                    </span>
                    <span className={cn('text-[0.9375rem] leading-snug', chosen ? 'font-semibold' : 'font-medium')}>
                      {label}
                    </span>
                  </div>
                )
              })}
            </div>

            <div className="mt-3.5">
              <ParticipationThreshold
                participantCount={2}
                minimumParticipants={3}
                qualified={false}
              />
            </div>
          </div>
        </section>

        <section className="mt-16 grid gap-5 sm:grid-cols-2" aria-label="Cómo funciona">
          <div className="card-pop relative px-5 pb-5 pt-7">
            <Sticker tone="sun" cut tilt={-3} className="absolute -top-[15px] left-4">
              En prueba
            </Sticker>
            <h2 className="type-title text-[1.25rem]">Las predicciones se ganan el lugar</h2>
            <p className="mt-2.5 leading-relaxed text-[var(--ink-2)]">
              Cuando alguien propone una, entra <em>en prueba</em>. Si en 48 horas no
              eligieron al menos tres personas, se va sola y no ensucia el feed. Si
              llegan a tres, queda hasta su fecha de cierre.
            </p>
          </div>
          <div className="card-pop relative px-5 pb-5 pt-7">
            <Sticker tone="sky" cut tilt={2} className="absolute -top-[15px] left-4">
              Al cierre
            </Sticker>
            <h2 className="type-title text-[1.25rem]">Nadie se influye</h2>
            <p className="mt-2.5 leading-relaxed text-[var(--ink-2)]">
              Nadie ve qué eligieron los demás hasta que cierra. Recién ahí se
              revela todo junto y alguien propone el resultado, que tienen que
              confirmar otras dos personas del grupo.
            </p>
          </div>
        </section>
      </main>

      <footer className="page-column border-t-2 border-[var(--line)] py-6">
        <p className="type-micro text-[var(--ink-3)]">
          friedict es un juego social privado. No hay dinero, saldo, premios ni
          apuestas de ningún tipo.
        </p>
      </footer>
    </div>
  )
}
