import { useEffect, useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CaretDown, Plus, Sparkle, X } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { createPredictionSchema, type CreatePredictionInput } from '@/lib/validation'
import { friendlyError } from '@/lib/errors'
import { nextRoundHour, toDateTimeLocalValue } from '@/lib/time'
import { useCreateFromTemplate, useCreatePrediction, useTemplates } from '@/data/predictions'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { TextField, TextAreaField } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Toggle } from '@/components/ui/Toggle'
import { useToast } from '@/components/ui/toast-context'

/**
 * Crear una predicción.
 *
 * El formulario está ordenado por lo que de verdad importa: la pregunta y las
 * opciones arriba, el cierre después, y todo lo configurable escondido detrás
 * de "Más opciones". Si alguien tiene que pensar en `votes_visibility` para
 * preguntar quién llega tarde, el producto falló.
 *
 * Validación con React Hook Form + Zod, con el mismo esquema que se usa en los
 * tests. Los límites reales igual están como CHECK constraints en la base.
 */
const RESULTS_OPTIONS = [
  { value: 'on_close' as const, label: 'Al cerrar', description: 'Nadie se influye' },
  { value: 'after_vote' as const, label: 'Después de votar' },
  { value: 'always' as const, label: 'Siempre' },
]

const VOTES_OPTIONS = [
  { value: 'on_close' as const, label: 'Al cerrar' },
  { value: 'visible' as const, label: 'Siempre visible' },
  { value: 'anonymous' as const, label: 'Nunca' },
]

export function CreatePredictionSheet({
  groupId,
  open,
  onClose,
  onCreated,
}: {
  groupId: string
  open: boolean
  onClose: () => void
  onCreated?: (predictionId: string) => void
}) {
  const toast = useToast()
  const createPrediction = useCreatePrediction()
  const createFromTemplate = useCreateFromTemplate()
  const templates = useTemplates()
  const [advanced, setAdvanced] = useState(false)

  const defaultCloses = toDateTimeLocalValue(nextRoundHour(new Date(), 48))

  const form = useForm<CreatePredictionInput>({
    resolver: zodResolver(createPredictionSchema),
    defaultValues: {
      title: '',
      description: '',
      optionType: 'manual',
      options: ['', ''],
      votingMode: 'single',
      intervalDays: 7,
      allowNewOptions: false,
      resultsVisibility: 'on_close',
      votesVisibility: 'on_close',
      closesAt: defaultCloses,
      qualificationHours: 48,
    },
  })

  const { control, register, handleSubmit, setValue, reset, formState } = form
  const optionsArray = useFieldArray({
    control,
    // Un array de strings no tiene id propio: RHF necesita el cast.
    name: 'options' as never,
  })

  // `useWatch` en vez de `form.watch()`: el segundo devuelve una función nueva
  // en cada render y el compilador de React no puede memoizar el componente.
  const optionType = useWatch({ control, name: 'optionType' })
  const votingMode = useWatch({ control, name: 'votingMode' })
  const allowNewOptions = useWatch({ control, name: 'allowNewOptions' })
  const resultsVisibility = useWatch({ control, name: 'resultsVisibility' })
  const votesVisibility = useWatch({ control, name: 'votesVisibility' })

  // Al cerrarse, el formulario vuelve a cero. `setAdvanced` se ajusta durante
  // el render comparando contra el valor anterior; `reset()` no es estado de
  // este componente sino del store de React Hook Form, así que sí va en efecto.
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) setAdvanced(false)
  }

  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  const onSubmit = handleSubmit((values) => {
    const closesAt = new Date(values.closesAt).toISOString()

    createPrediction.mutate(
      {
        groupId,
        title: values.title,
        description: values.description || undefined,
        options: values.options.filter((option) => option.trim() !== ''),
        optionType: values.optionType,
        votingMode: values.votingMode,
        intervalDays: values.intervalDays,
        allowNewOptions: values.allowNewOptions,
        resultsVisibility: values.resultsVisibility,
        votesVisibility: values.votesVisibility,
        closesAt,
        qualificationHours: values.qualificationHours,
      },
      {
        onSuccess: (predictionId) => {
          toast.show({
            message: 'Queda en prueba: necesita 3 personas para seguir.',
            tone: 'success',
          })
          onClose()
          onCreated?.(predictionId)
        },
        onError: (error) =>
          toast.show({
            message: friendlyError(error, 'No pudimos crear la predicción.'),
            tone: 'error',
          }),
      },
    )
  })

  const applyTemplate = (templateId: string): void => {
    createFromTemplate.mutate(
      {
        groupId,
        templateId,
        closesAt: nextRoundHour(new Date(), 48).toISOString(),
      },
      {
        onSuccess: (predictionId) => {
          toast.show({ message: 'Listo, ya está en el feed.', tone: 'success' })
          onClose()
          onCreated?.(predictionId)
        },
        onError: (error) =>
          toast.show({ message: friendlyError(error), tone: 'error' }),
      },
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Nueva predicción"
      description="Empieza en prueba. Si en 48 horas la eligen 3 personas, queda."
      size="lg"
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1 sm:flex-none">
            Cancelar
          </Button>
          <Button
            onClick={() => void onSubmit()}
            loading={createPrediction.isPending}
            className="flex-1 sm:flex-none sm:ml-auto"
          >
            Crear predicción
          </Button>
        </div>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void onSubmit()
        }}
        className="space-y-5"
        noValidate
      >
        <TextField
          label="¿Qué va a pasar?"
          placeholder="¿Bauti llega después de las 22:30?"
          maxLength={140}
          autoComplete="off"
          error={formState.errors.title?.message}
          {...register('title')}
        />

        <TextAreaField
          label="Contexto (opcional)"
          placeholder="El sábado en lo de Agus. Dijo que sale 21:45."
          maxLength={400}
          rows={2}
          error={formState.errors.description?.message}
          {...register('description')}
        />

        <Segmented
          legend="Las opciones son…"
          value={optionType}
          onChange={(next) => setValue('optionType', next, { shouldValidate: true })}
          options={[
            { value: 'manual', label: 'Las que yo escriba' },
            { value: 'members', label: 'Los del grupo' },
          ]}
        />

        {optionType === 'members' ? (
          <p className="rounded-[var(--r-sm)] bg-[var(--surface-2)] px-3.5 py-3 text-[0.875rem] text-[var(--ink-2)]">
            Cada integrante del grupo va a ser una opción. Ideal para
            «¿quién llega último?».
          </p>
        ) : (
          <div>
            <span className="mb-1.5 block text-[0.8125rem] font-medium text-[var(--ink-2)]">
              Opciones
            </span>
            <ul className="space-y-1.5">
              {optionsArray.fields.map((field, index) => (
                <li key={field.id} className="flex items-start gap-1.5">
                  <TextField
                    label={`Opción ${index + 1}`}
                    hideLabel
                    placeholder={index === 0 ? 'Sí' : index === 1 ? 'No' : 'Otra opción'}
                    maxLength={60}
                    autoComplete="off"
                    {...register(`options.${index}` as const)}
                  />
                  {optionsArray.fields.length > 2 && (
                    <button
                      type="button"
                      onClick={() => optionsArray.remove(index)}
                      aria-label={`Quitar opción ${index + 1}`}
                      className={cn(
                        'grid size-[var(--tap)] shrink-0 place-items-center rounded-[var(--r-sm)]',
                        'text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--danger)]',
                        'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
                      )}
                    >
                      <X size={16} weight="bold" aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {formState.errors.options && (
              <p className="mt-1.5 type-micro font-medium text-[var(--danger)]">
                {formState.errors.options.message ??
                  formState.errors.options.root?.message}
              </p>
            )}

            {optionsArray.fields.length < 12 && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => optionsArray.append('' as never)}
                iconLeft={<Plus size={15} weight="bold" aria-hidden="true" />}
              >
                Agregar opción
              </Button>
            )}
          </div>
        )}

        <TextField
          label="¿Cuándo cierra?"
          type="datetime-local"
          error={formState.errors.closesAt?.message}
          {...register('closesAt')}
        />

        <Segmented
          legend="Modo"
          value={votingMode}
          onChange={(next) => setValue('votingMode', next, { shouldValidate: true })}
          options={[
            { value: 'single', label: 'Un voto', description: 'Cambiable hasta el cierre' },
            { value: 'recurring', label: 'Evolutiva', description: 'Un voto por ronda' },
          ]}
        />

        {votingMode === 'recurring' && (
          <TextField
            label="Cada cuántos días se puede volver a votar"
            type="number"
            min={1}
            max={90}
            error={formState.errors.intervalDays?.message}
            {...register('intervalDays', { valueAsNumber: true })}
          />
        )}

        {/* Ajustes finos, plegados. La mayoría de las predicciones no los toca. */}
        <div>
          <button
            type="button"
            onClick={() => setAdvanced((value) => !value)}
            aria-expanded={advanced}
            className={cn(
              'flex min-h-[var(--tap)] w-full items-center justify-between gap-2',
              'border-t border-[var(--line)] pt-4 text-left type-meta text-[var(--ink-3)]',
              'hover:text-[var(--ink)]',
              'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
            )}
          >
            Más opciones
            <CaretDown
              size={14}
              weight="bold"
              aria-hidden="true"
              className={cn(
                'transition-transform duration-[var(--motion-base)] ease-[var(--ease-standard)]',
                'motion-reduce:transition-none',
                advanced && 'rotate-180',
              )}
            />
          </button>

          {/* card-resize: el panel crece de 0fr a 1fr sin altura fija. */}
          <div className="t-collapse" data-open={advanced}>
            <div>
              <div className="space-y-5 pt-4">
                <Segmented
                  legend="Ver los resultados"
                  columns={3}
                  value={resultsVisibility}
                  onChange={(next) => setValue('resultsVisibility', next)}
                  options={RESULTS_OPTIONS}
                />
                <Segmented
                  legend="Ver quién votó qué"
                  columns={3}
                  value={votesVisibility}
                  onChange={(next) => setValue('votesVisibility', next)}
                  options={VOTES_OPTIONS}
                />
                {optionType === 'manual' && (
                  <Toggle
                    label="Dejar que agreguen opciones"
                    description="Cualquiera del grupo puede sumar alternativas hasta el cierre."
                    checked={allowNewOptions}
                    onChange={(next) => setValue('allowNewOptions', next)}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </form>

      {/* Propuestas del sistema: matan el estado vacío sin obligar a nada. */}
      {templates.data && templates.data.length > 0 && (
        <section className="mt-7 border-t border-[var(--line)] pt-5">
          <h3 className="type-meta inline-flex items-center gap-1.5 text-[var(--ink-3)]">
            <Sparkle size={13} weight="fill" aria-hidden="true" />
            O usá una propuesta lista
          </h3>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {templates.data.slice(0, 6).map((template) => (
              <li key={template.id}>
                <button
                  type="button"
                  disabled={createFromTemplate.isPending}
                  onClick={() => applyTemplate(template.id)}
                  className={cn(
                    'min-h-[var(--tap)] rounded-[var(--r-sm)] border border-[var(--line-strong)]',
                    'px-3 text-left text-[0.8125rem] text-[var(--ink-2)]',
                    'hover:border-[var(--ink-3)] hover:text-[var(--ink)]',
                    'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                  )}
                >
                  {template.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Sheet>
  )
}
