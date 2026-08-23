import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cssNumber, prefersReducedMotion } from '@/lib/css'

/**
 * transitions-dev-react-css/confetti-burst/confetti-burst.txt
 *
 * Física de la receta original: gravedad, vaivén lateral, tumble con squish y
 * hasta dos rebotes antes de quedar en reposo. Se conserva el substepping del
 * loop, que es lo que mantiene la simulación estable cuando el navegador
 * throttlea `requestAnimationFrame` (pestaña en segundo plano, por ejemplo).
 *
 * Cambios respecto del original, a propósito:
 *   · La paleta sale de los tokens (--series-*), no de una lista de colores
 *     genéricos. El confeti tiene que ser de esta app.
 *   · No hay superficie de botón: acá los papelitos se apoyan en el piso del
 *     contenedor.
 *   · `prefers-reduced-motion` corta antes de crear una sola partícula.
 *
 * Se dispara SÓLO cuando se resuelve una predicción y acertaste. No en cada
 * voto: si celebra todo, no celebra nada.
 */
const SERIES_TOKENS = [
  '--series-0',
  '--series-1',
  '--series-2',
  '--series-3',
  '--series-4',
  '--series-5',
]

interface Particle {
  start: number
  x: number
  y: number
  py: number
  vx: number
  vy: number
  w: number
  h: number
  maxFall: number
  rot: number
  vr: number
  tumble: number
  tumbleSpeed: number
  squish: number
  phase: number
  swayFreq: number
  swayScale: number
  color: string
  bounces: number
  resting: boolean
  dead: boolean
}

export function ConfettiBurst({ trigger }: { trigger: number }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const state = useRef({
    particles: [] as Particle[],
    running: false,
    lastT: 0,
    burstEnd: 0,
    fadeStart: null as number | null,
    stageW: 0,
    stageH: 0,
    raf: 0,
  })

  const sizeCanvas = useCallback(() => {
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = stage.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    state.current.stageW = rect.width
    state.current.stageH = rect.height
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [])

  const burst = useCallback(() => {
    if (prefersReducedMotion()) return

    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    sizeCanvas()
    const s = state.current
    const now = performance.now()
    const count = Math.round(cssNumber('--confetti-count', 110))
    const size = cssNumber('--confetti-size', 8)
    const spawnWindow = 500

    const styles = getComputedStyle(document.documentElement)
    const colors = SERIES_TOKENS.map((token) => styles.getPropertyValue(token).trim())

    s.particles = []
    s.fadeStart = null
    for (let i = 0; i < count; i++) {
      s.particles.push({
        start: now + Math.random() * spawnWindow,
        x: Math.random() * s.stageW,
        y: -12 - Math.random() * 30,
        py: -12,
        vx: (Math.random() - 0.5) * 60,
        vy: 40 + Math.random() * 120,
        w: size * (0.7 + Math.random() * 0.6),
        h: size * (0.5 + Math.random() * 0.5),
        maxFall: 420 + Math.random() * 280,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 7,
        tumble: Math.random() * Math.PI * 2,
        tumbleSpeed: 4 + Math.random() * 8,
        squish: 1,
        phase: Math.random() * Math.PI * 2,
        swayFreq: 2 + Math.random() * 3,
        swayScale: 0.5 + Math.random(),
        color: colors[i % colors.length] || 'var(--accent)',
        bounces: 0,
        resting: false,
        dead: false,
      })
    }
    s.burstEnd = now + spawnWindow + 100

    const step = (dt: number, at: number): void => {
      const gravity = cssNumber('--confetti-gravity', 1300)
      const sway = cssNumber('--confetti-sway', 16)
      const restitution = cssNumber('--confetti-bounce', 0.3)

      for (const p of s.particles) {
        if (p.resting || p.dead || at < p.start) continue
        p.py = p.y
        p.vy += gravity * dt
        if (p.vy > p.maxFall) p.vy = p.maxFall
        p.phase += p.swayFreq * dt
        p.x += (p.vx + Math.cos(p.phase) * sway * p.swayScale) * dt
        p.y += p.vy * dt
        p.rot += p.vr * dt
        p.tumble += p.tumbleSpeed * dt
        p.squish = 0.25 + 0.75 * Math.abs(Math.cos(p.tumble))

        const half = p.h / 2
        if (p.y + half >= s.stageH - 1) {
          if (p.vy > 170 && p.bounces < 2) {
            p.bounces++
            p.vy = -p.vy * restitution * (0.5 + Math.random() * 0.4)
            p.vx *= 0.7
            p.y = s.stageH - 1 - half
          } else {
            p.resting = true
            p.y = s.stageH - 1 - half
            p.vx = 0
            p.vy = 0
          }
        }
        if (p.x < -30 || p.x > s.stageW + 30 || p.y > s.stageH + 30) p.dead = true
      }
    }

    const draw = (alpha: number, at: number): void => {
      ctx.clearRect(0, 0, s.stageW, s.stageH)
      ctx.globalAlpha = alpha
      for (const p of s.particles) {
        if (p.dead || at < p.start) continue
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.scale(1, p.squish)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }
      ctx.globalAlpha = 1
    }

    const frame = (at: number): void => {
      if (!s.running) return

      // Substepping: la física avanza con el reloj real aunque rAF se atrase.
      let remaining = Math.min((at - s.lastT) / 1000, 0.25)
      s.lastT = at
      while (remaining > 0) {
        const dt = Math.min(remaining, 1 / 60)
        step(dt, at)
        remaining -= dt
      }

      const settled = at > s.burstEnd && s.particles.every((p) => p.resting || p.dead)
      if (settled && s.fadeStart === null) {
        s.fadeStart = at + cssNumber('--confetti-hold', 1400)
      }

      let alpha = 1
      if (s.fadeStart !== null && at >= s.fadeStart) {
        const fade = Math.max(cssNumber('--confetti-fade', 600), 1)
        alpha = 1 - (at - s.fadeStart) / fade
        if (alpha <= 0) {
          s.running = false
          s.particles = []
          ctx.clearRect(0, 0, s.stageW, s.stageH)
          return
        }
      }

      draw(alpha, at)
      s.raf = requestAnimationFrame(frame)
    }

    if (!s.running) {
      s.running = true
      s.lastT = now
      s.raf = requestAnimationFrame(frame)
    }
  }, [sizeCanvas])

  useEffect(() => {
    if (trigger > 0) burst()
  }, [trigger, burst])

  // Limpieza: si el componente se va mientras corre la simulación, se cancela
  // el frame pendiente. Si no, el loop seguiría dibujando sobre un canvas
  // desmontado.
  useEffect(() => {
    const s = state.current
    return () => {
      s.running = false
      if (s.raf) cancelAnimationFrame(s.raf)
    }
  }, [])

  useEffect(() => {
    const onResize = (): void => {
      if (state.current.running) sizeCanvas()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [sizeCanvas])

  // Va por portal al <body>: cualquier ancestro con `transform` (por ejemplo la
  // transición de entrada de la página) se volvería su bloque contenedor y el
  // `fixed` dejaría de estar anclado al viewport.
  return createPortal(
    <div
      ref={stageRef}
      className="pointer-events-none fixed inset-0 z-[70] overflow-hidden"
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="size-full" />
    </div>,
    document.body,
  )
}
