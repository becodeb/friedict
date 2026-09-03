import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CaretDown, Plus, Sparkle, X } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import {
  createPredictionSchema,
  roundsBeforeClose,
  type CreatePredictionInput,
} from '@/lib/validation'
import { requiredParticipantsPreview } from '@/lib/prediction'
import { friendlyError } from '@/lib/errors'
import { nextRoundHour, toDateTimeLocalValue } from '@/lib/time'
import { useCreateFromTemplate, useCreatePrediction, useTemplates } from '@/data/predictions'
import { useMembers } from '@/data/groups'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { TextField, TextAreaField } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Toggle } from '@/components/ui/Toggle'
import { HelpTip } from '@/components/ui/HelpTip'
import { useToast } from '@/components/ui/toast-context'

/**
 * Crear una predicción.
 *
 * El formulario está ordenado por lo que de verdad importa: la pregunta y las
 * opciones arriba, el cierre después, y todo lo configurable escondido detrás
 * de "Más opciones". Si alguien tiene que pensar en `votes_visibility` para
 * preguntar quién llega tarde, el producto falló.
 *
 * Zona 2 (El cierre) es la jugada clave: el quórum de cierre NO es un ajuste
 * avanzado cuando no hay fecha — es la única regla de cierre que existe, así
 * que vive junto a la elección que lo crea.
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

// Dos listas y no una: los valores por defecto de cada ajuste son distintos
// (60% para calificar, 50% para cerrar) y un preset que no incluya el default
// deja el grupo de segmentos sin ninguno marcado al abrir el formulario.
const QUALIFICATION_PRESETS = [
  { value: '30' as const, label: 'Pocos', description: '30%' },
  { value: '60' as const, label: 'La mayoría', description: '60%' },
  { value: '80' as const, label: 'Casi todos', description: '80%' },
]

const CLOSE_PRESETS = [
  { value: '30' as const, label: 'Pocos', description: '30%' },
  { value: '50' as const, label: 'La mitad', description: '50%' },
  { value: '80' as const, label: 'Casi todos', description: '80%' },
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
  const members = useMembers(groupId)
  const [advanced, setAdvanced] = useState(false)

  const memberCount = members.data?.length ?? 0
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
      closeMode: 'date',
      closesAt: defaultCloses,
      qualificationPercent: 60,
      closePercent: 50,
      qualificationHours: 48,
    },
  })

  const { control, register, handleSubmit, setValue, reset, formState } = form

  // `useWatch` en vez de `form.watch()`: el segundo devuelve una función nueva
  // en cada render y el compilador de React no puede memoizar el componente.
  //
  // Las opciones son un array de strings y `useFieldArray` sólo soporta arrays
  // de objetos (con uno plano devuelve `fields` vacío y no se dibuja ningún
  // campo). Se observa el array y se lo edita entero con `setValue`.
  const options = useWatch({ control, name: 'options' }) ?? []
  const optionType = useWatch({ control, name: 'optionType' })
  const votingMode = useWatch({ control, name: 'votingMode' })
  const intervalDays = useWatch({ control, name: 'intervalDays' })
  const allowNewOptions = useWatch({ control, name: 'allowNewOptions' })
  const resultsVisibility = useWatch({ control, name: 'resultsVisibility' })
  const votesVisibility = useWatch({ control, name: 'votesVisibility' })
  const closeMode = useWatch({ control, name: 'closeMode' })
  const closesAtValue = useWatch({ control, name: 'closesAt' })
  const qualificationPercent = useWatch({ control, name: 'qualificationPercent' })
  const closePercent = useWatch({ control, name: 'closePercent' })
  const qualificationHours = useWatch({ control, name: 'qualificationHours' })

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

  const requiredParticipants = requiredParticipantsPreview(memberCount, qualificationPercent)
  const rounds =
    votingMode === 'recurring' && intervalDays
      ? roundsBeforeClose(
          closeMode === 'date' && closesAtValue ? new Date(closesAtValue) : null,
          intervalDays,
        )
      : null

  const onSubmit = handleSubmit((values) => {
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
        closesAt:
          values.closeMode === 'date' ? new Date(values.closesAt!).toISOString() : undefined,
        qualificationPercent: values.qualificationPercent,
        closePercent: values.closePercent,
        qualificationHours: values.qualificationHours,
      },
      {
        onSuccess: (predictionId) => {
          const required = requiredParticipantsPreview(memberCount, values.qualificationPercent)
          toast.show({
            message:
              memberCount > 0
                ? `Queda en prueba: necesita ${required} de ${memberCount} personas para seguir.`
                : 'Queda en prueba hasta que junte participación.',
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
      description={
        memberCount > 0
          ? `Empieza en prueba: necesita que la elija el ${qualificationPercent}% del grupo (${requiredParticipants} de ${memberCount}) en las próximas ${qualificationHours} horas.`
          : `Empieza en prueba: necesita que la elija el ${qualificationPercent}% del grupo en las próximas ${qualificationHours} horas.`
      }
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
          <p className="rounded-[var(--r-md)] bg-[var(--bg-sunken)] px-3.5 py-3 text-[0.875rem] text-[var(--ink-2)]">
            Cada integrante del grupo va a ser una opción. Ideal para
            «¿quién llega último?».
          </p>
        ) : (
          <div>
            <span className="mb-1.5 block text-[0.8125rem] font-semibold text-[var(--ink-2)]">
              Opciones
            </span>
            <ul className="space-y-2">
              {options.map((_, index) => (
                <li key={index} className="flex items-start gap-1.5">
                  <TextField
                    label={`Opción ${index + 1}`}
                    hideLabel
                    placeholder={index === 0 ? 'Sí' : index === 1 ? 'No' : 'Otra opción'}
                    maxLength={60}
                    autoComplete="off"
                    {...register(`options.${index}` as const)}
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() =>
                        setValue(
                          'options',
                          options.filter((_, i) => i !== index),
                          { shouldValidate: true },
                        )
                      }
                      aria-label={`Quitar opción ${index + 1}`}
                      className={cn(
                        'grid size-[var(--tap)] shrink-0 place-items-center rounded-full',
                        'text-[var(--ink-3)] hover:bg-[var(--danger-wash)] hover:text-[var(--danger)]',
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
              <p className="mt-1.5 type-micro font-semibold text-[var(--danger)]">
                {formState.errors.options.message ??
                  formState.errors.options.root?.message}
              </p>
            )}

            {options.length < 12 && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setValue('options', [...options, ''])}
                iconLeft={<Plus size={15} weight="bold" aria-hidden="true" />}
              >
                Agregar opción
              </Button>
            )}
          </div>
        )}

        {/* Zona 2: El cierre. La regla de cierre no es un detalle avanzado
            cuando no hay fecha — es la ÚNICA que existe, así que va acá,
            junto a la elección que la crea. */}
        <Segmented
          legend="¿Cuándo cierra?"
          value={closeMode}
          onChange={(next) => setValue('closeMode', next, { shouldValidate: true })}
          options={[
            { value: 'date', label: 'Con fecha' },
            { value: 'open', label: 'Cuando lo pida el grupo' },
          ]}
          help={
            <HelpTip label="cuándo cierra">
              Con fecha, cierra sola. Sin fecha, sigue abierta hasta que una parte del
              grupo pida cerrarla — sirve para preguntas sin un momento claro de cierre.
            </HelpTip>
          }
        />

        {closeMode === 'date' ? (
          <TextField
            label="Fecha y hora de cierre"
            type="datetime-local"
            error={formState.errors.closesAt?.message}
            {...register('closesAt')}
          />
        ) : (
          <Segmented
            legend="¿Cuánta gente tiene que pedir el cierre?"
            columns={3}
            value={String(closePercent)}
            onChange={(next) => setValue('closePercent', Number(next), { shouldValidate: true })}
            options={CLOSE_PRESETS}
            help={
              <HelpTip label="cuánta gente tiene que pedir el cierre">
                Sólo puede pedirlo quien ya votó. Al llegar al número, cierra al
                instante — nadie llega tarde ya sabiendo el resultado.
              </HelpTip>
            }
          />
        )}

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
          <>
            <TextField
              label="Cada cuántos días se puede volver a votar"
              type="number"
              min={1}
              max={90}
              trailing={
                <HelpTip label="cada cuántos días se vuelve a votar">
                  Las rondas se cuentan desde que la creás, no desde que se confirma.
                </HelpTip>
              }
              error={formState.errors.intervalDays?.message}
              {...register('intervalDays', { valueAsNumber: true })}
            />
            <p className="text-[0.8125rem] text-[var(--ink-3)]">
              {rounds === null
                ? 'Sin fecha de cierre, las rondas no tienen techo: se cuentan desde que la creás.'
                : rounds === 1
                  ? 'Entra 1 ronda antes del cierre. Las rondas se cuentan desde que la creás.'
                  : `Entran ${rounds} rondas antes del cierre. Las rondas se cuentan desde que la creás.`}
            </p>
          </>
        )}

        {/* Ajustes finos, plegados. La mayoría de las predicciones no los toca. */}
        <div>
          <button
            type="button"
            onClick={() => setAdvanced((value) => !value)}
            aria-expanded={advanced}
            className={cn(
              'flex min-h-[var(--tap)] w-full items-center justify-between gap-2',
              'border-t-2 border-[var(--line)] pt-4 text-left type-meta text-[var(--ink-2)]',
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
                <div>
                  <h3 className="mb-3 type-meta text-[var(--ink-3)]">
                    Para que la predicción quede
                  </h3>
                  <div className="space-y-4">
                    <Segmented
                      legend="¿Cuánta gente tiene que votar?"
                      columns={3}
                      value={String(qualificationPercent)}
                      onChange={(next) =>
                        setValue('qualificationPercent', Number(next), { shouldValidate: true })
                      }
                      options={QUALIFICATION_PRESETS}
                      help={
                        <HelpTip label="cuánta gente tiene que votar">
                          Porcentaje del grupo, no un número fijo: crece y baja con quién
                          está adentro.
                        </HelpTip>
                      }
                    />
                    {memberCount > 0 && (
                      <p className="text-[0.8125rem] text-[var(--ink-3)]">
                        Con {memberCount} persona{memberCount === 1 ? '' : 's'} en el
                        grupo, necesita {requiredParticipants}.
                      </p>
                    )}
                    <TextField
                      label="¿Cuánto tiempo tiene para juntar gente?"
                      type="number"
                      min={1}
                      max={720}
                      trailing={
                        <HelpTip label="cuánto tiempo tiene para juntar gente">
                          Si no llega al quórum antes de este plazo, se va sola y no
                          ensucia el feed.
                        </HelpTip>
                      }
                      error={formState.errors.qualificationHours?.message}
                      {...register('qualificationHours', { valueAsNumber: true })}
                    />
                  </div>
                </div>

                <div className="border-t-2 border-[var(--line)] pt-5">
                  <h3 className="mb-3 type-meta text-[var(--ink-3)]">Quién ve qué</h3>
                  <div className="space-y-4">
                    <Segmented
                      legend="Ver los números"
                      columns={3}
                      value={resultsVisibility}
                      onChange={(next) => setValue('resultsVisibility', next)}
                      options={RESULTS_OPTIONS}
                      help={
                        <HelpTip label="ver los números">
                          Los recuentos por opción (cuántos votos tiene cada una), sin
                          decir quién eligió qué.
                        </HelpTip>
                      }
                    />
                    <Segmented
                      legend="Ver quién eligió qué"
                      columns={3}
                      value={votesVisibility}
                      onChange={(next) => setValue('votesVisibility', next)}
                      options={VOTES_OPTIONS}
                      help={
                        <HelpTip label="ver quién eligió qué">
                          Los nombres junto a cada opción. "Siempre visible" los muestra
                          desde el primer voto, no sólo al cerrar.
                        </HelpTip>
                      }
                    />
                  </div>
                </div>

                <div className="border-t-2 border-[var(--line)] pt-5">
                  <h3 className="mb-3 type-meta text-[var(--ink-3)]">Extras</h3>
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
        </div>
      </form>

      {/* Propuestas del sistema: matan el estado vacío sin obligar a nada. */}
      {templates.data && templates.data.length > 0 && (
        <section className="mt-7 border-t-2 border-[var(--line)] pt-5">
          <h3 className="type-meta inline-flex items-center gap-1.5 text-[var(--ink-2)]">
            <Sparkle size={13} weight="fill" aria-hidden="true" />
            O usá una propuesta lista
          </h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {templates.data.slice(0, 6).map((template) => (
              <li key={template.id}>
                <button
                  type="button"
                  disabled={createFromTemplate.isPending}
                  onClick={() => applyTemplate(template.id)}
                  className={cn(
                    'min-h-[var(--tap)] rounded-[var(--r-pill)] border-2 border-[var(--line-strong)]',
                    'bg-[var(--surface)] px-3.5 text-left text-[0.8125rem] font-medium text-[var(--ink)]',
                    'hover:bg-[var(--candy-sun)] hover:text-[var(--on-candy)] hover:shadow-[var(--shadow-1)]',
                    'transition-[background-color,box-shadow] duration-[var(--motion-fast)] motion-reduce:transition-none',
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
