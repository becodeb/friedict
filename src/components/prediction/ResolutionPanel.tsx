import { useState } from 'react'
import { Check, Scales, X } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { friendlyError } from '@/lib/errors'
import { formatRelative } from '@/lib/time'
import type { Prediction } from '@/lib/types'
import {
  useConfirmResolution,
  useProposeResolution,
  useResolution,
} from '@/data/predictions'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/toast-context'

/**
 * Resolución con confirmación de la comunidad.
 *
 * Nadie define un resultado solo. Quien propone no puede confirmarse a sí mismo
 * —lo bloquea la base, no esta pantalla— y hacen falta dos confirmaciones
 * ajenas (o una, en grupos de dos personas) para que el resultado quede firme.
 *
 * Si dos personas están en desacuerdo, la propuesta se cae y CUALQUIER
 * integrante puede proponer otra. Sin esa salida, un creador porfiado podría
 * dejar la predicción trabada para siempre.
 */
export function ResolutionPanel({
  prediction,
  groupId,
  userId,
  canPropose,
  onResolved,
}: {
  prediction: Prediction
  groupId: string
  userId: string | null
  canPropose: boolean
  onResolved?: () => void
}) {
  const toast = useToast()
  const resolution = useResolution(prediction.id)
  const propose = useProposeResolution(groupId)
  const confirm = useConfirmResolution(groupId, prediction.id)
  const [picked, setPicked] = useState<string | null>(null)

  const current = resolution.data
  const isOpenProposal = current?.status === 'proposed'
  const proposedOption = prediction.options.find(
    (option) => option.id === current?.proposed_option_id,
  )

  const myConfirmation = current?.confirmations?.find(
    (confirmation) => confirmation.user_id === userId,
  )
  const agreeCount = current?.confirmations?.filter((c) => c.agrees).length ?? 0
  const isProposer = current?.proposed_by === userId
  const wasRejected = current?.status === 'rejected'

  if (resolution.isLoading) {
    return (
      <div className="flex items-center gap-2.5 py-4 text-[var(--ink-2)]" role="status">
        <Spinner size={16} />
        Cargando la resolución…
      </div>
    )
  }

  // --- Hay una propuesta esperando confirmaciones --------------------------
  if (isOpenProposal && current) {
    const required = current.required_confirmations

    return (
      <section aria-labelledby="resolucion-titulo" className="card-pop p-5">
        <h2
          id="resolucion-titulo"
          className="type-meta inline-flex items-center gap-1.5 text-[var(--ink-3)]"
        >
          <Scales size={13} weight="bold" aria-hidden="true" />
          Resultado propuesto
        </h2>

        <p className="type-question mt-2.5">{proposedOption?.label ?? 'Opción'}</p>
        <p className="mt-1.5 type-micro text-[var(--ink-3)]">
          Lo propusieron {formatRelative(current.created_at)}. Faltan{' '}
          {Math.max(0, required - agreeCount)} de {required} confirmaciones.
        </p>

        {isProposer ? (
          <p className="mt-4 rounded-[var(--r-md)] bg-[var(--bg-sunken)] px-3.5 py-3 text-[0.875rem] text-[var(--ink-2)]">
            Lo propusiste vos, así que ahora esperá a que lo confirme el grupo.
          </p>
        ) : myConfirmation ? (
          <p className="mt-4 inline-flex items-center gap-2 text-[0.875rem] text-[var(--ink-2)]">
            <Check
              size={16}
              weight="bold"
              className="text-[var(--status-resolved-ink)]"
              aria-hidden="true"
            />
            Ya dijiste que {myConfirmation.agrees ? 'estás de acuerdo' : 'no estás de acuerdo'}.
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Button
              loading={confirm.isPending}
              iconLeft={<Check size={16} weight="bold" aria-hidden="true" />}
              onClick={() =>
                confirm.mutate(
                  { resolutionId: current.id, agrees: true },
                  {
                    onSuccess: (result) => {
                      if (result.outcome === 'resolved') {
                        toast.show({ message: 'Resultado confirmado.', tone: 'success' })
                        onResolved?.()
                      } else {
                        toast.show({ message: 'Listo, quedó tu confirmación.', tone: 'neutral' })
                      }
                    },
                    onError: (error) =>
                      toast.show({ message: friendlyError(error), tone: 'error' }),
                  },
                )
              }
            >
              Sí, fue eso
            </Button>

            <Button
              variant="secondary"
              loading={confirm.isPending}
              iconLeft={<X size={16} weight="bold" aria-hidden="true" />}
              onClick={() =>
                confirm.mutate(
                  { resolutionId: current.id, agrees: false },
                  {
                    onSuccess: (result) => {
                      toast.show({
                        message:
                          result.outcome === 'rejected'
                            ? 'La propuesta se cayó. Cualquiera puede proponer otra.'
                            : 'Quedó registrado que no estás de acuerdo.',
                        tone: 'neutral',
                      })
                    },
                    onError: (error) =>
                      toast.show({ message: friendlyError(error), tone: 'error' }),
                  },
                )
              }
            >
              No fue eso
            </Button>
          </div>
        )}
      </section>
    )
  }

  // --- Cerrada, sin propuesta abierta --------------------------------------
  if (!canPropose && !wasRejected) {
    return (
      <p className="rounded-[var(--r-md)] bg-[var(--bg-sunken)] px-4 py-3.5 text-[0.875rem] text-[var(--ink-2)]">
        Se cerraron las predicciones. Falta que quien la creó —o alguien que
        administre el grupo— proponga el resultado.
      </p>
    )
  }

  return (
    <section aria-labelledby="proponer-titulo" className="card-pop p-5">
      <h2 id="proponer-titulo" className="type-title text-[1.25rem]">
        Resolver resultado
      </h2>
      <p className="mt-1.5 text-[0.875rem] text-[var(--ink-2)]">
        {wasRejected
          ? 'La propuesta anterior no convenció. Proponé otra y que el grupo confirme.'
          : 'Elegí qué pasó. Después lo tienen que confirmar otras dos personas.'}
      </p>

      <div role="radiogroup" aria-label="Qué pasó" className="mt-4 space-y-2">
        {prediction.options.map((option) => {
          const isPicked = picked === option.id
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isPicked}
              onClick={() => setPicked(option.id)}
              className={cn(
                'opt-pill',
                'transition-[background-color,box-shadow,transform] duration-[var(--motion-fast)]',
                'ease-[var(--ease-standard)] motion-reduce:transition-none',
                isPicked
                  ? 'bg-[var(--accent)] text-[var(--on-candy)] shadow-[var(--shadow-1)]'
                  : 'hover:bg-[var(--surface-2)]',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-[18px] shrink-0 place-items-center rounded-full border-2 border-[var(--line-strong)]',
                  isPicked ? 'bg-[var(--ink)] text-[var(--bg)]' : 'text-transparent',
                )}
              >
                <Check size={11} weight="bold" />
              </span>
              <span className={cn('text-[0.9375rem]', isPicked ? 'font-semibold' : 'font-medium')}>
                {option.label}
              </span>
            </button>
          )
        })}
      </div>

      <Button
        className="mt-5"
        disabled={!picked}
        loading={propose.isPending}
        onClick={() => {
          if (!picked) return
          propose.mutate(
            { predictionId: prediction.id, optionId: picked },
            {
              onSuccess: () =>
                toast.show({
                  message: 'Listo. Ahora falta que lo confirme el grupo.',
                  tone: 'success',
                }),
              onError: (error) =>
                toast.show({ message: friendlyError(error), tone: 'error' }),
            },
          )
        }}
      >
        Proponer este resultado
      </Button>
    </section>
  )
}
