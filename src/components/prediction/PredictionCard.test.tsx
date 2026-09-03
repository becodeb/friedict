import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PredictionCard } from './PredictionCard'
import { ToastContext } from '@/components/ui/toast-context'
import type { Prediction } from '@/lib/types'

function makePrediction(overrides: Partial<Prediction> = {}): Prediction {
  const now = new Date()
  return {
    id: 'p1',
    group_id: 'g1',
    created_by: 'u1',
    template_id: null,
    title: '¿Cierra alguna vez?',
    description: null,
    option_type: 'manual',
    voting_mode: 'single',
    vote_interval: null,
    allow_new_options: false,
    results_visibility: 'on_close',
    votes_visibility: 'on_close',
    minimum_participants: 3,
    qualification_percent: 60,
    close_percent: 50,
    close_request_count: 0,
    closed_at: null,
    qualification_deadline: new Date(now.getTime() + 6 * 3_600_000).toISOString(),
    opens_at: new Date(now.getTime() - 3_600_000).toISOString(),
    closes_at: new Date(now.getTime() + 48 * 3_600_000).toISOString(),
    is_default: false,
    status: 'active',
    participant_count: 4,
    vote_count: 4,
    resolved_option_id: null,
    resolved_at: null,
    created_at: new Date(now.getTime() - 3_600_000).toISOString(),
    updated_at: new Date(now.getTime() - 3_600_000).toISOString(),
    member_count: 5,
    required_participants: 3,
    close_required: 3,
    my_close_request: false,
    options: [
      {
        id: 'o1',
        prediction_id: 'p1',
        label: 'Sí',
        member_id: null,
        position: 0,
        created_by: 'u1',
        created_at: now.toISOString(),
        tally: null,
      },
      {
        id: 'o2',
        prediction_id: 'p1',
        label: 'No',
        member_id: null,
        position: 1,
        created_by: 'u1',
        created_at: now.toISOString(),
        tally: null,
      },
    ],
    votes: [],
    myVote: null,
    myVotes: [],
    author: null,
    ...overrides,
  }
}

function renderCard(prediction: Prediction) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastContext.Provider value={{ show: () => {}, dismiss: () => {} }}>
        <MemoryRouter>
          <PredictionCard prediction={prediction} groupId="g1" userId="u1" />
        </MemoryRouter>
      </ToastContext.Provider>
    </QueryClientProvider>,
  )
}

describe('PredictionCard — cierre opcional', () => {
  it('con closes_at, muestra la cuenta regresiva de cierre', () => {
    renderCard(makePrediction())
    expect(screen.getAllByText(/cierra en/i).length).toBeGreaterThan(0)
  })

  it('con closes_at nulo, NO renderiza ninguna cuenta regresiva de cierre', () => {
    renderCard(makePrediction({ closes_at: null }))
    expect(screen.queryAllByText(/cierra en/i)).toHaveLength(0)
    expect(screen.getByText('sin fecha de cierre')).toBeInTheDocument()
  })
})
