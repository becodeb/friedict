import { describe, expect, it } from 'vitest'
import { PREDICTION_PRESETS, type PresetId, type PresetSettings, presetFor } from './presets'

describe('presetFor', () => {
  it.each(Object.keys(PREDICTION_PRESETS) as PresetId[])(
    'el preset "%s" hace round-trip: presetFor(PREDICTION_PRESETS[id]) === id',
    (id) => {
      expect(presetFor(PREDICTION_PRESETS[id])).toBe(id)
    },
  )

  it('la tabla coincide exactamente con lo aprobado por el dueño', () => {
    expect(PREDICTION_PRESETS.open_book).toEqual({
      votingMode: 'single',
      resultsVisibility: 'always',
      votesVisibility: 'visible',
      voteChangeWindow: 'until_close',
    })
    expect(PREDICTION_PRESETS.blind).toEqual({
      votingMode: 'single',
      resultsVisibility: 'on_close',
      votesVisibility: 'on_close',
      voteChangeWindow: '15m',
    })
    expect(PREDICTION_PRESETS.evolving).toEqual({
      votingMode: 'recurring',
      resultsVisibility: 'on_close',
      votesVisibility: 'on_close',
      voteChangeWindow: 'never',
    })
  })

  it('sobreescribir un solo campo da "custom"', () => {
    const overridden: PresetSettings = { ...PREDICTION_PRESETS.blind, voteChangeWindow: 'never' }
    expect(presetFor(overridden)).toBe('custom')
  })

  it('restaurar el campo overrideado vuelve a dar el preset original', () => {
    const overridden: PresetSettings = { ...PREDICTION_PRESETS.open_book, votesVisibility: 'anonymous' }
    expect(presetFor(overridden)).toBe('custom')

    const restored: PresetSettings = { ...overridden, votesVisibility: 'visible' }
    expect(presetFor(restored)).toBe('open_book')
  })

  it('una combinación que no coincide con ningún preset da "custom"', () => {
    expect(
      presetFor({
        votingMode: 'recurring',
        resultsVisibility: 'always',
        votesVisibility: 'anonymous',
        voteChangeWindow: '1d',
      }),
    ).toBe('custom')
  })
})
