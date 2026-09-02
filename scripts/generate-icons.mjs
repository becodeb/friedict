/**
 * Genera los íconos de la PWA a partir de la marca.
 *
 * La marca es la palabra «friedict» con un sticker redondo de chicle al final:
 * la misma bolita con contorno de tinta que marca tu voto en las opciones. El
 * ícono es esa bolita sola, con su sombra dura, sobre el lavanda del fondo.
 * Es geometría exacta, no un SVG dibujado a ojo.
 *
 *   npm run icons
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const LAVANDA = '#f1f0fa'
const CHICLE = '#ff5fa8'
const TINTA = '#17172b'

/** @param {number} scale 1 = a sangre; <1 deja aire para íconos maskable. */
function markSvg(scale, background) {
  const c = 256
  const r = 150 * scale
  const stroke = 22 * scale
  const offset = 26 * scale // desplazamiento de la sombra dura

  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${background}"/>
  <circle cx="${(c + offset).toFixed(1)}" cy="${(c + offset).toFixed(1)}" r="${r.toFixed(1)}" fill="${TINTA}"/>
  <circle cx="${c}" cy="${c}" r="${(r - stroke / 2).toFixed(1)}" fill="${CHICLE}"
          stroke="${TINTA}" stroke-width="${stroke.toFixed(1)}"/>
</svg>`)
}

/** El favicon lleva esquinas redondeadas propias porque se muestra suelto. */
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="${LAVANDA}"/>
  <circle cx="282" cy="282" r="150" fill="${TINTA}"/>
  <circle cx="256" cy="256" r="139" fill="${CHICLE}" stroke="${TINTA}" stroke-width="22"/>
</svg>
`

await mkdir(PUBLIC_DIR, { recursive: true })

await writeFile(join(PUBLIC_DIR, 'favicon.svg'), faviconSvg, 'utf8')

const jobs = [
  { file: 'pwa-192x192.png', size: 192, svg: markSvg(0.92, LAVANDA) },
  { file: 'pwa-512x512.png', size: 512, svg: markSvg(0.92, LAVANDA) },
  // Maskable: el contenido se achica al 72% para caer entero dentro de la zona
  // segura que recortan Android y iOS.
  { file: 'pwa-maskable-512x512.png', size: 512, svg: markSvg(0.66, LAVANDA) },
  { file: 'apple-touch-icon.png', size: 180, svg: markSvg(0.8, LAVANDA) },
]

for (const job of jobs) {
  await sharp(job.svg).resize(job.size, job.size).png({ compressionLevel: 9 }).toFile(
    join(PUBLIC_DIR, job.file),
  )
  console.log(`✓ ${job.file} (${job.size}×${job.size})`)
}

console.log('✓ favicon.svg')
