/**
 * Presets del formulario de crear predicción.
 *
 * Módulo puro, sin React: cuatro combinaciones de settings, con la sexta
 * opción — "A medida" — derivada, nunca guardada. Ver design.md § D.
 *
 * El preset NO se persiste. Si se guardara una columna aparte, redefinir un
 * preset más adelante (por ejemplo, que "A ciegas" pase a 30 minutos)
 * cambiaría retroactivamente qué significó una predicción vieja. Guardando
 * sólo las columnas, una fila vieja conserva exactamente lo que fue creada
 * siendo — la misma razón por la que la etiqueta de una opción "los del
 * grupo" tampoco se reescribe cuando alguien cambia de nombre.
 */

export type PresetId = 'open_book' | 'blind' | 'evolving'

export interface PresetSettings {
  votingMode: 'single' | 'recurring'
  resultsVisibility: 'always' | 'after_vote' | 'on_close'
  votesVisibility: 'visible' | 'on_close' | 'anonymous'
  voteChangeWindow: 'until_close' | '1d' | '15m' | 'never'
}

export const PREDICTION_PRESETS: Record<PresetId, PresetSettings> = {
  open_book: {
    votingMode: 'single',
    resultsVisibility: 'always',
    votesVisibility: 'visible',
    voteChangeWindow: 'until_close',
  },
  blind: {
    votingMode: 'single',
    resultsVisibility: 'on_close',
    votesVisibility: 'on_close',
    voteChangeWindow: '15m',
  },
  evolving: {
    votingMode: 'recurring',
    resultsVisibility: 'on_close',
    votesVisibility: 'on_close',
    voteChangeWindow: 'never',
  },
}

export const PRESET_LABEL: Record<PresetId, string> = {
  open_book: 'A libro abierto',
  blind: 'A ciegas',
  evolving: 'Evolutiva',
}

export const PRESET_DESCRIPTION: Record<PresetId, string> = {
  open_book: 'Se ve todo desde el primer voto, y se puede cambiar hasta el cierre.',
  blind: 'Nadie ve nada hasta que cierra. 15 minutos para corregir el voto.',
  evolving: 'Un voto por ronda, con historial de cómo cambió la opinión del grupo.',
}

/**
 * ¿Cuál preset coincide exactamente con esta combinación de settings? Se
 * llama durante el render (no en un efecto), el mismo patrón que ya usa
 * `CreatePredictionSheet.tsx` para derivar otros valores del formulario.
 */
export function presetFor(settings: PresetSettings): PresetId | 'custom' {
  for (const [id, preset] of Object.entries(PREDICTION_PRESETS) as Array<
    [PresetId, PresetSettings]
  >) {
    if (
      preset.votingMode === settings.votingMode &&
      preset.resultsVisibility === settings.resultsVisibility &&
      preset.votesVisibility === settings.votesVisibility &&
      preset.voteChangeWindow === settings.voteChangeWindow
    ) {
      return id
    }
  }
  return 'custom'
}
