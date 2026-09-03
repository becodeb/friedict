import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/useAuth'
import { Spinner } from '@/components/ui/Spinner'
import { SeoRobots } from '@/components/SeoRobots'
import { Landing } from '@/routes/Landing'
import { Login } from '@/routes/Login'
import { GroupShell } from '@/components/layout/GroupShell'
import { GroupFeed } from '@/routes/GroupFeed'

/**
 * Rutas.
 *
 * La landing, el login y el feed entran en el bundle inicial porque son el
 * camino que recorre todo el mundo. Lo demás se carga cuando hace falta: crear
 * un grupo, el detalle, el ranking, el historial y la administración son
 * pantallas que no toca cada persona en cada sesión.
 */
const CreateGroup = lazy(() =>
  import('@/routes/CreateGroup').then((m) => ({ default: m.CreateGroup })),
)
const JoinInvite = lazy(() =>
  import('@/routes/JoinInvite').then((m) => ({ default: m.JoinInvite })),
)
const PredictionDetail = lazy(() =>
  import('@/routes/PredictionDetail').then((m) => ({ default: m.PredictionDetail })),
)
const Leaderboard = lazy(() =>
  import('@/routes/Leaderboard').then((m) => ({ default: m.Leaderboard })),
)
const History = lazy(() =>
  import('@/routes/History').then((m) => ({ default: m.History })),
)
const Members = lazy(() =>
  import('@/routes/Members').then((m) => ({ default: m.Members })),
)
const GroupSettings = lazy(() =>
  import('@/routes/GroupSettings').then((m) => ({ default: m.GroupSettings })),
)
const NotFound = lazy(() =>
  import('@/routes/NotFound').then((m) => ({ default: m.NotFound })),
)

function RouteFallback() {
  return (
    <div className="grid min-h-[60dvh] place-items-center" role="status">
      <Spinner size={22} className="text-[var(--ink-3)]" />
      <span className="sr-only">Cargando</span>
    </div>
  )
}

/** Puerta de sesión. Guarda a dónde iba para volver después del Magic Link. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <RouteFallback />
  if (!user) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/entrar?next=${encodeURIComponent(next)}`} replace />
  }
  return <>{children}</>
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <SeoRobots />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/entrar" element={<Login />} />
        <Route path="/join/:token" element={<JoinInvite />} />

        <Route
          path="/crear-grupo"
          element={
            <RequireAuth>
              <CreateGroup />
            </RequireAuth>
          }
        />

        <Route
          path="/g/:groupId"
          element={
            <RequireAuth>
              <GroupShell />
            </RequireAuth>
          }
        >
          <Route index element={<GroupFeed />} />
          <Route path="p/:predictionId" element={<PredictionDetail />} />
          <Route path="ranking" element={<Leaderboard />} />
          <Route path="historial" element={<History />} />
          <Route path="miembros" element={<Members />} />
          <Route path="ajustes" element={<GroupSettings />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
