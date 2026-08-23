/**
 * Genera los íconos de la PWA a partir del logotipo.
 *
 * La marca es la palabra «cantado.» — acá reducida a su inicial: un arco
 * abierto hacia la derecha (la «c») y el punto. Es geometría exacta, no un SVG
 * dibujado a ojo: el arco es un tramo de circunferencia de radio 120 centrado
 * en el lienzo, y el punto está sobre la prolongación de su abertura.
 *
 *   npm run icons
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const TOMATE = '#cf4526'
const HUESO = '#f7f5f2'

/** @param {number} scale 1 = a sangre; <1 deja aire para íconos maskable. */
function markSvg(scale, background) {
  const c = 256
  const r = 120 * scale
  const stroke = 56 * scale
  const offset = r * Math.SQRT1_2 // cos(45°) = sin(45°)
  const startX = c + offset
  const startY = c - offset
  const endY = c + offset
  const dotR = 30 * scale
  const dotX = c + (188 * scale)
  const dotY = c + (92 * scale)

  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${background}"/>
  <path d="M ${startX.toFixed(1)} ${startY.toFixed(1)} A ${r} ${r} 0 1 0 ${startX.toFixed(1)} ${endY.toFixed(1)}"
        fill="none" stroke="${HUESO}" stroke-width="${stroke.toFixed(1)}" stroke-linecap="round"/>
  <circle cx="${dotX.toFixed(1)}" cy="${dotY.toFixed(1)}" r="${dotR.toFixed(1)}" fill="${HUESO}"/>
</svg>`)
}

/** El favicon lleva esquinas redondeadas propias porque se muestra suelto. */
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="${TOMATE}"/>
  <path d="M 340.9 171.1 A 120 120 0 1 0 340.9 340.9"
        fill="none" stroke="${HUESO}" stroke-width="56" stroke-linecap="round"/>
  <circle cx="444.0" cy="348.0" r="30.0" fill="${HUESO}"/>
</svg>
`

await mkdir(PUBLIC_DIR, { recursive: true })

await writeFile(join(PUBLIC_DIR, 'favicon.svg'), faviconSvg, 'utf8')

const jobs = [
  { file: 'pwa-192x192.png', size: 192, svg: markSvg(1, TOMATE) },
  { file: 'pwa-512x512.png', size: 512, svg: markSvg(1, TOMATE) },
  // Maskable: el contenido se achica al 72% para caer entero dentro de la zona
  // segura que recortan Android y iOS.
  { file: 'pwa-maskable-512x512.png', size: 512, svg: markSvg(0.72, TOMATE) },
  { file: 'apple-touch-icon.png', size: 180, svg: markSvg(0.82, TOMATE) },
]

for (const job of jobs) {
  await sharp(job.svg).resize(job.size, job.size).png({ compressionLevel: 9 }).toFile(
    join(PUBLIC_DIR, job.file),
  )
  console.log(`✓ ${job.file} (${job.size}×${job.size})`)
}

console.log('✓ favicon.svg')
