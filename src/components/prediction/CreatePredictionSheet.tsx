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
import { requiredCloseRequestsPreview } from '@/lib/prediction'
import { PREDICTION_PRESETS, PRESET_DESCRIPTION, PRESET_LABEL, presetFor } from '@/lib/presets'
import type { PresetId } from '@/lib/presets'
import { durationMultiplier } from '@/lib/scoring'
import { DAY } from '@/lib/time'
import { friendlyError } from '@/lib/errors'
import { nextRoundHour, toDateTimeLocalValue } from '@/lib/time'
import { useCreateFromTemplate, useCreatePrediction, useTemplates } from '@/data/predictions'
import { useGroup, useMembers } from '@/data/groups'
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
 * opciones arriba, el preset justo después ("pregunta → opciones → preset →
 * listo"), y todo lo configurable escondido detrás de "Más opciones".
 *
 * Zona 2 (¿Cómo se juega?) reemplaza al viejo segmentado de "Modo" en el área
 * siempre visible: cuatro presets que fijan `votingMode`, `resultsVisibility`,
 * `votesVisibility` y `voteChangeWindow` a la vez. El panel avanzado sigue
 * dejando tocar cada campo por separado — "A medida" es lo que se ve cuando la
 * combinación deja de coincidir con ningún preset, nunca algo que se elige a
 * mano.
 *
 * El quórum de cierre y la calificación ya no se piden acá: son ajustes del
 * GRUPO (`src/routes/GroupSettings.tsx`), no de cada predicción.
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

const VOTE_WINDOW_OPTIONS = [
  { value: 'until_close' as const, label: 'Hasta el cierre' },
  { value: '1d' as const, label: '1 día' },
  { value: '15m' as const, label: '15 minutos' },
  { value: 'never' as const, label: 'Nunca' },
]

const PRESET_OPTIONS = (Object.keys(PREDICTION_PRESETS) as PresetId[]).map((id) => ({
  value: id as PresetId | 'custom',
  label: PRESET_LABEL[id],
  description: PRESET_DESCRIPTION[id],
}))
PRESET_OPTIONS.push({
  value: 'custom',
  label: 'A medida',
  description: 'Cada campo elegido a mano.',
})

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
  const group = useGroup(groupId)
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
      votingMode: PREDICTION_PRESETS.blind.votingMode,
      intervalDays: 7,
      allowNewOptions: false,
      resultsVisibility: PREDICTION_PRESETS.blind.resultsVisibility,
      votesVisibility: PREDICTION_PRESETS.blind.votesVisibility,
      closeMode: 'date',
      closesAt: defaultCloses,
      voteChangeWindow: PREDICTION_PRESETS.blind.voteChangeWindow,
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
  const voteChangeWindow = useWatch({ control, name: 'voteChangeWindow' })

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

  // Derivado en cada render, no guardado en estado propio: el mismo patrón
  // que ya usa este archivo para requiredParticipants más abajo. Cambiar
  // CUALQUIER campo avanzado re-deriva esto solo, sin ningún efecto.
  const preset = presetFor({ votingMode, resultsVisibility, votesVisibility, voteChangeWindow })

  const applyPreset = (next: PresetId | 'custom'): void => {
    if (next === 'custom') {
      // "A medida" no es una acción con settings propios: sólo abre el panel
      // avanzado para que se vea qué está overrideado.
      setAdvanced(true)
      return
    }
    const settings = PREDICTION_PRESETS[next]
    setValue('votingMode', settings.votingMode, { shouldValidate: true })
    setValue('resultsVisibility', settings.resultsVisibility)
    setValue('votesVisibility', settings.votesVisibility)
    setValue('voteChangeWindow', settings.voteChangeWindow, { shouldValidate: true })
  }

  const closeQuorum = group.data?.close_request_quorum
  const requiredClose =
    closeQuorum !== undefined ? requiredCloseRequestsPreview(memberCount, closeQuorum) : null

  const rounds =
    votingMode === 'recurring' && intervalDays
      ? roundsBeforeClose(
          closeMode === 'date' && closesAtValue ? new Date(closesAtValue) : null,
          intervalDays,
        )
      : null

  // "Cuanto más dure, más vale": la línea de previsualización de puntos que
  // aparece en el momento en que se elige el horizonte de la predicción.
  const pointsPreview =
    closeMode === 'date' && closesAtValue
      ? (() => {
          const days = Math.max(0, (new Date(closesAtValue).getTime() - new Date().getTime()) / DAY)
          const multiplier = durationMultiplier(days)
          return `Si dura hasta esa fecha, vale ~${multiplier.toFixed(1)}× puntos.`
        })()
      : 'Cuanto más dure, más vale — hasta 3× puntos.'

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
        voteChangeWindow: values.voteChangeWindow,
        closesAt:
          values.closeMode === 'date' ? new Date(values.closesAt!).toISOString() : undefined,
      },
      {
        onSuccess: (predictionId) => {
          toast.show({
            message: group.data?.qualification_enabled
              ? 'Queda en prueba hasta que junte participación.'
              : 'Ya está en el feed.',
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
        group.data?.qualification_enabled
          ? 'Empieza en prueba hasta que el grupo la elija — el umbral se ajusta en los ajustes del grupo.'
          : 'Queda activa apenas la creás.'
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

        {/* Zona 2: ¿Cómo se juega? — pregunta → opciones → preset → listo.
            Cuatro presets fijan votingMode/resultsVisibility/votesVisibility/
            voteChangeWindow a la vez; "A medida" es lo que se ve cuando ya no
            coincide con ninguno, nunca algo que se elige directamente. */}
        <Segmented
          legend="¿Cómo se juega?"
          columns={2}
          value={preset}
          onChange={applyPreset}
          options={PRESET_OPTIONS}
          help={
            <HelpTip label="cómo se juega">
              Un preset fija de una el modo de votación, quién ve qué y cuánto tiempo hay
              para corregir el voto. Podés tocar cada uno por separado en "Más opciones":
              ahí la fila pasa a decir "A medida".
            </HelpTip>
          }
        />

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
          <p className="rounded-[var(--r-md)] bg-[var(--bg-sunken)] px-3.5 py-3 text-[0.875rem] text-[var(--ink-2)]">
            {requiredClose !== null
              ? `Cierra cuando ${requiredClose} persona${requiredClose === 1 ? '' : 's'} lo pida${requiredClose === 1 ? '' : 'n'}.`
              : 'Cierra cuando el grupo lo pida.'}{' '}
            Ese número se cambia en los ajustes del grupo, no acá.
          </p>
        )}

        <p className="text-[0.8125rem] text-[var(--ink-3)]">{pointsPreview}</p>

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
                  <h3 className="mb-3 type-meta text-[var(--ink-3)]">Cómo se juega, campo por campo</h3>
                  <div className="space-y-4">
                    <Segmented
                      legend="Modo"
                      value={votingMode}
                      onChange={(next) => setValue('votingMode', next, { shouldValidate: true })}
                      options={[
                        // El "hasta cuándo se puede cambiar" ya NO vive acá: lo
                        // decide la ventana de cambio, que es el control de
                        // abajo. Esta descripción decía "Cambiable hasta el
                        // cierre" y se contradecía con él a tres líneas de
                        // distancia.
                        { value: 'single', label: 'Un voto', description: 'Uno para toda la predicción' },
                        { value: 'recurring', label: 'Evolutiva', description: 'Un voto por ronda' },
                      ]}
                    />
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
                    <Segmented
                      legend="¿Hasta cuándo se puede corregir el voto?"
                      columns={2}
                      value={voteChangeWindow}
                      onChange={(next) => setValue('voteChangeWindow', next, { shouldValidate: true })}
                      options={VOTE_WINDOW_OPTIONS}
                      help={
                        <HelpTip label="hasta cuándo se puede corregir el voto">
                          Después de tu primer voto en modo "Un voto", tenés esta ventana
                          para corregirlo. Pasado ese tiempo queda firme — así nadie cambia
                          de opinión ya sabiendo el resultado. No aplica a "Evolutiva",
                          que ya vota una vez por ronda.
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
