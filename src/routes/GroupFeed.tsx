import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { Plus } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { useAuth } from '@/auth/useAuth'
import { usePredictions } from '@/data/predictions'
import { effectiveStatus, sortFeed } from '@/lib/prediction'
import { cssMs } from '@/lib/css'
import type { Prediction } from '@/lib/types'
import { Tabs } from '@/components/ui/Tabs'
import { Button } from '@/components/ui/Button'
import { SkeletonFeed } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { PredictionCard } from '@/components/prediction/PredictionCard'

/**
 * El formulario de crear arrastra React Hook Form y el resolver de Zod. Sacarlo
 * del bundle inicial deja el feed —que es lo que todo el mundo abre primero—
 * más liviano, y el sheet llega cuando de verdad se lo pide.
 */
const CreatePredictionSheet = lazy(() =>
  import('@/components/prediction/CreatePredictionSheet').then((m) => ({
    default: m.CreatePredictionSheet,
  })),
)

type TabValue = 'abiertas' | 'prueba' | 'cerradas'

interface GroupContext {
  groupId: string
  isAdmin: boolean
}

/**
 * Cuando una predicción sale de la lista, se la mantiene montada el tiempo que
 * dura la disolución y recién ahí se descarta.
 *
 * Es la idea de transitions-dev-react-css/smoky-dissolve/ resuelta con una
 * animación compositable en lugar de un canvas con ruido: lo que desaparece es
 * una fila de una lista, tiene que seguir siendo un nodo real del documento y no
 * puede quedar atrapada en un `<canvas>`.
 */
function useDissolvingList(items: Prediction[]): Array<Prediction & { leaving?: boolean }> {
  const [leaving, setLeaving] = useState<Prediction[]>([])
  const previous = useRef<Prediction[]>([])
  const timers = useRef<number[]>([])

  useEffect(() => {
    const currentIds = new Set(items.map((item) => item.id))
    const gone = previous.current.filter((item) => !currentIds.has(item.id))
    previous.current = items

    if (gone.length === 0) return

    setLeaving((current) => [...current, ...gone])
    const timer = window.setTimeout(() => {
      const goneIds = new Set(gone.map((item) => item.id))
      setLeaving((current) => current.filter((item) => !goneIds.has(item.id)))
    }, cssMs('--dissolve-dur', 520))
    timers.current.push(timer)
  }, [items])

  useEffect(() => {
    const list = timers.current
    return () => {
      list.forEach((timer) => window.clearTimeout(timer))
    }
  }, [])

  return useMemo(
    () => [...items, ...leaving.map((item) => ({ ...item, leaving: true }))],
    [items, leaving],
  )
}

export function GroupFeed() {
  const { groupId } = useOutletContext<GroupContext>()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()

  const predictions = usePredictions(groupId, user?.id ?? null)
  const [tab, setTab] = useState<TabValue>('abiertas')
  const [createOpen, setCreateOpen] = useState(params.get('nueva') === '1')
  const [everOpened, setEverOpened] = useState(createOpen)

  if (createOpen && !everOpened) setEverOpened(true)

  // Alguien recién creó el grupo: se le ofrece crear la primera predicción.
  useEffect(() => {
    if (params.get('nuevo') === '1') {
      const next = new URLSearchParams(params)
      next.delete('nuevo')
      setParams(next, { replace: true })
    }
  }, [params, setParams])

  const buckets = useMemo(() => {
    const all = predictions.data ?? []
    const open: Prediction[] = []
    const testing: Prediction[] = []
    const done: Prediction[] = []

    for (const prediction of all) {
      const status = effectiveStatus(prediction)
      if (status === 'proposed') testing.push(prediction)
      else if (status === 'active') open.push(prediction)
      else done.push(prediction)
    }

    return {
      abiertas: sortFeed([...open, ...testing]),
      prueba: sortFeed(testing),
      cerradas: sortFeed(done),
    }
  }, [predictions.data])

  const visible = useDissolvingList(buckets[tab])
  const isEmpty = !predictions.isLoading && (predictions.data ?? []).length === 0

  return (
    <div className="feed-column pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="type-title text-[1.375rem]">¿Qué va a pasar?</h1>
        {/* El envoltorio hace el `hidden`, no el botón: `hidden` y el
            `inline-flex` propio del Button son ambos utilidades de display y
            cuál gana depende del orden en la hoja, no del orden de las clases. */}
        <div className="hidden sm:block">
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            iconLeft={<Plus size={16} weight="bold" aria-hidden="true" />}
          >
            Nueva predicción
          </Button>
        </div>
      </div>

      {!isEmpty && (
        <div className="mt-4">
          <Tabs
            label="Filtrar predicciones"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'abiertas', label: 'Abiertas', count: buckets.abiertas.length },
              { value: 'prueba', label: 'En prueba', count: buckets.prueba.length },
              { value: 'cerradas', label: 'Cerradas', count: buckets.cerradas.length },
            ]}
          />
        </div>
      )}

      <div className="mt-4">
        {predictions.isLoading ? (
          <SkeletonFeed />
        ) : predictions.isError ? (
          <ErrorState onRetry={() => void predictions.refetch()} />
        ) : isEmpty ? (
          <EmptyState
            title="Todavía no hay nada acá"
            body="Arrancá con una predicción sobre lo que se viene. Con que tres personas elijan, queda."
            action={
              <Button size="lg" onClick={() => setCreateOpen(true)}>
                Crear la primera
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={
              tab === 'prueba'
                ? 'Ninguna en prueba'
                : tab === 'cerradas'
                  ? 'Todavía no cerró ninguna'
                  : 'No hay predicciones abiertas'
            }
            body={
              tab === 'prueba'
                ? 'Cuando alguien proponga una, aparece acá hasta que junte 3 personas.'
                : tab === 'cerradas'
                  ? 'Acá van a quedar las que ya cerraron, con su resultado.'
                  : 'Creá una nueva y que el grupo se juegue.'
            }
            action={
              tab === 'abiertas' ? (
                <Button onClick={() => setCreateOpen(true)}>Crear una</Button>
              ) : undefined
            }
          />
        ) : (
          <ul>
            {visible.map((prediction, index) => (
              <li
                key={prediction.id}
                className={cn(prediction.leaving && 't-dissolve-out')}
                aria-hidden={prediction.leaving ? 'true' : undefined}
              >
                <PredictionCard
                  prediction={prediction}
                  groupId={groupId}
                  userId={user?.id ?? null}
                  index={index}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* FAB en mobile. El icono rota 45° al abrir:
          transitions-dev-react-css/plus-menu-morph/plus-menu-morph.txt */}
      <div
        className="t-morph fixed right-4 z-30 sm:hidden"
        data-open={createOpen}
        style={{ bottom: 'calc(var(--bottom-nav-h) + var(--safe-b) + 1rem)' }}
      >
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          aria-label="Nueva predicción"
          className={cn(
            'grid size-14 place-items-center rounded-full',
            'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--shadow-3)]',
            'active:scale-95 motion-reduce:active:scale-100',
            'transition-transform duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
            'motion-reduce:transition-none',
          )}
        >
          <Plus size={24} weight="bold" aria-hidden="true" className="t-morph-icon" />
        </button>
      </div>

      {/* Una vez cargado se queda montado: si se desmontara al cerrar, la
          animación de salida no llegaría a verse. */}
      {everOpened && (
        <Suspense fallback={null}>
          <CreatePredictionSheet
            groupId={groupId}
            open={createOpen}
            onClose={() => setCreateOpen(false)}
          />
        </Suspense>
      )}
    </div>
  )
}
