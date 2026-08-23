import { z } from 'zod'

/**
 * Esquemas compartidos entre formularios y llamadas.
 *
 * Son la primera barrera, no la única: los mismos límites están como CHECK
 * constraints en PostgreSQL. Si alguien saltea el formulario, la base rechaza
 * igual.
 */

const trimmed = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, `Escribí al menos ${min} caracteres.`)
    .max(max, `Máximo ${max} caracteres.`)

export const displayNameSchema = trimmed(2, 40)

export const groupNameSchema = trimmed(2, 48)

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Escribí tu email.')
  .email('Ese email no parece válido.')

export const createGroupSchema = z.object({
  name: groupNameSchema,
  displayName: displayNameSchema,
  accent: z.number().int().min(0).max(7),
})
export type CreateGroupInput = z.infer<typeof createGroupSchema>

export const joinGroupSchema = z.object({
  displayName: displayNameSchema,
  accent: z.number().int().min(0).max(7),
})
export type JoinGroupInput = z.infer<typeof joinGroupSchema>

export const optionLabelSchema = trimmed(1, 60)

export const createPredictionSchema = z
  .object({
    title: trimmed(4, 140),
    description: z.string().trim().max(400, 'Máximo 400 caracteres.').optional(),
    optionType: z.enum(['manual', 'members', 'open']),
    options: z.array(optionLabelSchema).max(12, 'Máximo 12 opciones.'),
    votingMode: z.enum(['single', 'recurring']),
    intervalDays: z.number().int().min(1).max(90).optional(),
    allowNewOptions: z.boolean(),
    resultsVisibility: z.enum(['always', 'after_vote', 'on_close']),
    votesVisibility: z.enum(['visible', 'on_close', 'anonymous']),
    closesAt: z.string().min(1, 'Elegí cuándo cierra.'),
    qualificationHours: z.number().int().min(1).max(720),
  })
  .superRefine((value, ctx) => {
    if (value.optionType !== 'members') {
      const unique = new Set(value.options.map((o) => o.trim().toLowerCase()))
      if (unique.size < 2) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'Cargá al menos dos opciones distintas.',
        })
      }
      if (unique.size !== value.options.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'Hay opciones repetidas.',
        })
      }
    }

    const closes = new Date(value.closesAt)
    if (Number.isNaN(closes.getTime())) {
      ctx.addIssue({
        code: 'custom',
        path: ['closesAt'],
        message: 'Esa fecha no es válida.',
      })
    } else if (closes.getTime() <= Date.now()) {
      ctx.addIssue({
        code: 'custom',
        path: ['closesAt'],
        message: 'El cierre tiene que ser en el futuro.',
      })
    }

    if (value.votingMode === 'recurring' && !value.intervalDays) {
      ctx.addIssue({
        code: 'custom',
        path: ['intervalDays'],
        message: 'Elegí cada cuánto se puede volver a votar.',
      })
    }
  })

export type CreatePredictionInput = z.infer<typeof createPredictionSchema>

// Se construyen con `new RegExp` y escapes para que este archivo no contenga
// literalmente los caracteres que justamente queremos eliminar.
// Control C0 y C1. La regla `no-control-regex` está para avisar de rangos de
// control escritos sin querer; acá son exactamente lo que se quiere borrar.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]', 'g')
// Espacios de ancho cero, marcas bidi y BOM: sirven para disfrazar texto.
const INVISIBLE_CHARS = new RegExp('[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]', 'g')

/**
 * Sanea texto libre antes de mandarlo. No escapa HTML: React no interpreta el
 * texto como markup, así que escaparlo sólo ensuciaría el contenido.
 */
export function cleanText(value: string): string {
  return value
    .replace(CONTROL_CHARS, '')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
}
