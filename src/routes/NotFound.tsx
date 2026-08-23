import { Link, useNavigate } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { Reveal, RevealLine } from '@/components/ui/Reveal'
import { Button } from '@/components/ui/Button'

export function NotFound() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="feed-column pt-5">
        <Link to="/">
          <Logo size="sm" />
        </Link>
      </header>

      <main className="feed-column flex flex-1 flex-col justify-center pb-24">
        <Reveal>
          <RevealLine as="p" index={1} className="type-meta text-[var(--ink-3)]">
            Error 404
          </RevealLine>
          <RevealLine as="h1" index={2} className="type-title mt-2 max-w-[16ch]">
            Esta página no existe
          </RevealLine>
          <RevealLine as="p" index={3} className="mt-3 max-w-[36ch] text-[var(--ink-2)]">
            Puede que el link esté cortado o que la predicción ya no esté.
          </RevealLine>
          <RevealLine index={4} className="mt-6">
            <Button onClick={() => navigate('/')}>Ir al inicio</Button>
          </RevealLine>
        </Reveal>
      </main>
    </div>
  )
}
