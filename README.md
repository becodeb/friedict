# Cantado

**Predicciones privadas entre amigos.** Alguien pregunta qué va a pasar, el grupo se
juega, y cuando la cosa se resuelve se ve quién tenía razón.

No hay dinero, saldo, premios ni apuestas de ningún tipo. Los puntos son sólo un
mecanismo de juego: se ganan acertando, nunca se pierden y no valen nada fuera de
la app.

> El nombre viene de *«estaba cantado que llegaba tarde»*: eso que todos sabían
> que iba a pasar. Es exactamente lo que hace el producto, y funciona como
> reacción cuando se resuelve una predicción.

---

## Qué hace

- **Grupos privados.** Se entra sólo con un link de invitación. Nada es visible
  desde afuera ni se indexa en buscadores.
- **Predicciones que se ganan el lugar.** Toda predicción creada por alguien
  entra *en prueba*: si en 48 horas no la eligen al menos 3 personas, se va sola
  y no ensucia el feed.
- **Nadie se influye.** Hasta el cierre se muestra cuánta gente participó, pero
  no qué eligió cada una. Lo garantiza la base de datos, no la interfaz.
- **Dos modos de votación.** Clásica (un voto, cambiable hasta el cierre) y
  evolutiva (un voto por ronda, con historial y gráfico de cómo fue cambiando la
  opinión del grupo).
- **Resolución comunitaria.** Nadie decide el resultado solo: se propone y hace
  falta que lo confirmen otras dos personas. Si hay desacuerdo, la propuesta se
  cae y cualquiera puede proponer otra.
- **Ranking por grupo**, con una fórmula de puntos explicada en pantalla.
- **Tiempo real**: la participación, las predicciones nuevas y las resoluciones
  llegan sin recargar.
- **PWA instalable**, con tema claro y oscuro.

---

## Requisitos

| | |
|---|---|
| Node.js | 20 o superior (probado en 22) |
| Docker | Corriendo, para el stack local de Supabase |
| Espacio | ~3 GB para las imágenes de Docker |

No hace falta instalar el CLI de Supabase por separado: viene como dependencia
de desarrollo y se invoca con `npx supabase`.

---

## Puesta en marcha

```bash
# 1. Dependencias
npm install

# 2. Backend local (Postgres + Auth + Realtime + Studio + servidor de mail)
npm run db:start

# 3. Variables de entorno
cp .env.example .env.local
# Completá los valores con lo que imprimió el paso 2:
#   VITE_SUPABASE_URL      → API URL
#   VITE_SUPABASE_ANON_KEY → anon key

# 4. Migraciones + datos de ejemplo
npm run db:reset

# 5. A andar
npm run dev
```

La app queda en <http://localhost:5183>.

> **Los puertos están corridos a propósito.** El stack usa la serie `544xx` en
> lugar de los `543xx` por defecto, y Vite el `5183` en lugar del `5173`, para
> poder convivir con otros proyectos Supabase/Vite levantados en la misma
> máquina. Están en `supabase/config.toml` y `vite.config.ts`.

### Servicios locales

| Servicio | URL |
|---|---|
| App | <http://localhost:5183> |
| API de Supabase | <http://127.0.0.1:54421> |
| Base de datos | `postgresql://postgres:postgres@127.0.0.1:54422/postgres` |
| Studio | <http://127.0.0.1:54423> |
| Mail (Mailpit) | <http://127.0.0.1:54424> |

Como la autenticación es por Magic Link, **los mails de acceso llegan a
Mailpit**, no a una casilla real. Abrí <http://127.0.0.1:54424> y hacé clic en
el link del último mensaje.

### Cuentas de ejemplo

`npm run db:reset` deja armados dos grupos:

- **Los pibes** — Bauti (creó el grupo), Juan (admin), Agus, Fran, Lu
- **Fútbol 5** — Juan (creó el grupo), Agus, Caro

Caro pertenece sólo al segundo grupo: sirve para comprobar a ojo que no se
filtra nada entre grupos.

Los mails son `bauti@cantado.test`, `juan@cantado.test`, `agus@cantado.test`,
`fran@cantado.test`, `lu@cantado.test` y `caro@cantado.test`. Todas tienen la
contraseña `cantado123`, que **existe sólo para que los tests puedan iniciar
sesión sin pasar por el mail**: la app no ofrece login con contraseña.

Las predicciones sembradas cubren todos los estados: en prueba con 2 de 3,
abierta, cerrada esperando resultado, resuelta con puntos repartidos, expirada
por falta de gente, evolutiva con seis semanas de historial y una del sistema.

---

## Variables de entorno

Sólo dos, y las dos son públicas:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Todo lo que empieza con `VITE_` **termina dentro del bundle que se descarga el
navegador**. Ahí sólo puede vivir la clave anónima, que está diseñada para
exponerse y que sin RLS no sirve de nada. La `service_role` key no aparece en
ninguna parte del código de la aplicación.

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción (typecheck + Vite) |
| `npm run preview` | Sirve el build |
| `npm run typecheck` | Sólo TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Tests unitarios y de componentes (Vitest) |
| `npm run test:integration` | Tests contra la base real |
| `npm run test:e2e` | Playwright, cuatro perfiles |
| `npm run test:all` | Todo lo anterior, en orden |
| `npm run db:start` / `db:stop` | Levanta y baja el stack local |
| `npm run db:reset` | Reaplica migraciones y datos de ejemplo |
| `npm run db:types` | Regenera `src/lib/database.types.ts` |
| `npm run icons` | Regenera los íconos de la PWA |
| `npm run qa:visual` | Recorre las pantallas, captura y busca errores de consola |
| `npm run qa:audit` | Audita objetivos táctiles y desbordes horizontales |

Los tests de integración y los E2E **necesitan el stack local levantado**. Los
E2E reinician la base antes de empezar (se puede saltear con
`E2E_SKIP_RESET=1`).

---

## Estructura

```
supabase/
  migrations/
    …_schema.sql              tablas, enums, índices, vista de ranking, grants
    …_functions.sql           toda la lógica de dominio (SECURITY DEFINER)
    …_rls.sql                 políticas de lectura + helpers de autorización
    …_realtime_and_cron.sql   publicación de Realtime y cierre automático
  seed.sql                    datos de ejemplo
  config.toml                 configuración del stack local

src/
  auth/                       sesión y perfil (Magic Link)
  components/
    ui/                       primitivos: Button, Sheet, Tabs, Toast, Avatar…
    prediction/               PredictionCard, VoteOption, ResolutionPanel…
    group/                    InviteDialog
    layout/                   GroupShell, BottomNav, GroupSwitcher
  data/                       queries y mutaciones (TanStack Query) + Realtime
  lib/                        dominio puro: scoring, prediction, time, validation
  routes/                     una pantalla por archivo
  styles/
    tokens.css                paleta, tipografía, radios, sombras
    motion.css                biblioteca de transiciones
    base.css                  reglas de elemento y utilidades propias

e2e/                          Playwright
integration/                  Vitest contra la base real
scripts/                      generación de íconos y auditorías
```

---

## Arquitectura

### El cliente sólo lee

Las tablas otorgan **únicamente `SELECT`** a `authenticated`. Toda escritura
pasa por una función `SECURITY DEFINER` que resuelve el usuario con
`auth.uid()` y verifica membresía, rol y ventana de tiempo antes de tocar nada.

Esto tiene una consecuencia práctica: no existe forma de mandar un `group_id` o
un `created_by` ajeno y que la base lo acepte, porque el cliente nunca escribe
esas columnas.

### El umbral de participación

Una predicción creada por alguien nace en `proposed`. Un trigger sobre
`prediction_votes` mantiene `participant_count` y la promueve a `active` en
cuanto llega la tercera persona distinta. Si vence `qualification_deadline` sin
llegar, pasa a `expired`.

`finalize_predictions()` es idempotente y se invoca desde **tres** lugares, para
que el estado sea confiable aunque falle cualquiera:

1. `pg_cron`, cada minuto;
2. `cast_vote()` y `propose_resolution()`, antes de aceptar la operación;
3. el cliente, al abrir el feed de un grupo.

### Cómo se mantiene el voto secreto

Este es el punto de diseño más delicado del producto.

- La RLS de `prediction_votes` deja ver **el voto propio siempre**, y los ajenos
  sólo cuando la predicción cerró (o si está configurada como visible).
- Los recuentos por opción viven en una tabla aparte,
  `prediction_option_tallies`, cuya RLS implementa `results_visibility`. Un
  trigger la mantiene al día.
- `prediction_votes` está **deliberadamente fuera** de la publicación de
  Realtime. Como Realtime aplica RLS, los eventos de votos ajenos no llegarían
  igual, y los contadores quedarían congelados. El cliente escucha
  `predictions` (que trae `participant_count`) y las tallies.

Resultado: la participación se ve moverse en vivo y la elección de cada persona
sigue siendo secreta hasta el cierre.

### Puntos

```
puntos = 100
       × rareza       1.00 … 1.80   cuanto menos gente eligió la correcta
       × anticipación 1.00 … 1.25   cuanto antes la elegiste
       × convicción   0.50 … 1.00   qué parte de tus votos le pusiste
```

Techo 225, piso de un acierto 50, nunca negativo. La rareza necesita una muestra
mínima de 4 votos: sin ese piso, una opción con 1 voto sobre 2 daría un
multiplicador alto por puro ruido.

La fórmula vive dos veces —en `public.calculate_points()`, que es la que reparte
los puntos, y en `src/lib/scoring.ts`, que se usa en los tests y para explicar el
puntaje en pantalla—. Duplicar lógica es aceptable sólo si algo garantiza que no
se separen: el test `integration/scoring-parity.test.ts` recorre 2000
combinaciones y exige que ambas den el mismo entero.

### Realtime

Un solo canal por grupo, montado en `GroupShell`. Los eventos invalidan la query
que corresponde en lugar de reconstruir estado a mano, y el canal se cierra con
`supabase.removeChannel` al desmontar. Montarlo en el layout y no en cada
pantalla evita suscripciones duplicadas al navegar entre feed, ranking e
historial.

---

## Seguridad

- **RLS habilitado en todas las tablas privadas.** Hay un test que lo verifica
  consultando `pg_class` y falla si alguna queda sin activar.
- **Aislamiento entre grupos probado por comportamiento, no por inspección.**
  `integration/rls.test.ts` intenta leer, votar, resolver, invitar y expulsar en
  un grupo ajeno, y exige que todo falle.
- **Invitaciones**: 32 caracteres base32 (~160 bits), generadas en el servidor,
  con vencimiento y baja manual. Un token inexistente, vencido, revocado o
  agotado devuelven todos exactamente la misma respuesta: nunca se filtra si un
  grupo existe.
- **Rate limiting** por usuario en creación de grupos, invitaciones,
  predicciones y votos.
- **Service worker**: precachea sólo el app shell. Las respuestas de Supabase
  están declaradas `NetworkOnly`; cachear contenido privado en `CacheStorage`
  sería filtrarlo a quien abra el navegador después.
- `noindex, nofollow` y `referrer: same-origin` en el documento.

### Una nota sobre `NULL` en las comprobaciones de permisos

Vale la pena dejarlo escrito porque es un error fácil de cometer y difícil de
ver. `group_role()` devuelve `NULL` para quien no es integrante, y en SQL
`NULL IN ('owner','admin')` vale `NULL`, no `false`. Un
`if not public.is_group_admin(...) then raise` evalúa entonces `not NULL` =
`NULL`, **no entra al branch, y la comprobación de permisos queda desactivada en
silencio**.

Por eso `is_group_admin()` envuelve la comparación en `coalesce(..., false)` y
`update_member_role()` usa `is distinct from`. Los tests de RLS cubren
exactamente ese caso.

---

## Tests

| Suite | Qué cubre | Cantidad |
|---|---|---|
| `src/**/*.test.ts(x)` | Umbral, ciclos, scoring, fechas y zonas horarias, componentes | 68 |
| `integration/` | Ciclo de vida completo, RLS, Realtime, paridad de la fórmula | 55 |
| `e2e/` | Flujos de creador e invitado, Magic Link real, accesibilidad, layout | 57 |

Los tests de integración usan un acceso directo a Postgres para dos cosas que un
cliente no puede ni debe hacer: viajar en el tiempo (correr `closes_at` al
pasado) y leer estado sin pasar por RLS, para comprobar que la RLS efectivamente
ocultó algo.

Los E2E cubren cuatro perfiles: `mobile` (Pixel 7, flujos completos), `tablet`
(820px), `desktop` (1280px) y `reduced-motion`. Los flujos que cambian el estado
de la base corren una sola vez, en mobile: correrlos en los tres perfiles contra
la misma base haría que el segundo encontrara predicciones ya resueltas y
fallara por arrastre, no por un defecto real.

Uno de los tests de autenticación hace el recorrido completo del Magic Link:
escribe el mail en el formulario, lee el mensaje de la API de Mailpit y abre el
link como lo haría una persona.

---

## Diseño

**Design Read** — aplicación social privada para amigos. Minimalismo editorial,
tipografía fuerte, interacción táctil y motion expresivo. Divertida sin ser
infantil, cuidada sin parecer una fintech.

- **Un solo acento**: tomate. `L = 0.58` no es casual, es el punto donde el texto
  blanco encima llega a 4.7:1 y cumple AA.
- **Tipografía**: Geist y Geist Mono, self-hosted. El mono se usa para
  metadatos, cuentas regresivas y cifras.
- **El feed no son tarjetas.** Cada predicción es un bloque separado por una
  línea de pelo sobre el fondo de la página, con un rail de color a la izquierda
  que codifica el estado. Encajar cada una en un rectángulo con borde y sombra
  —y adentro otro rectángulo por opción— es el apilado de cajas que hace que una
  app se vea generada.
- **El estado siempre se comunica por texto además de por color.** Quien no
  distingue el ocre del tomate lee igual «En prueba» y «Abierta».
- **Objetivo táctil de 44 px** en todo control, verificado por un test.

### Motion

Todas las recetas salen del catálogo local `transitions-dev-react-css/`
(transitions.dev). El CSS conserva su comportamiento; lo único que cambia es que
duraciones, curvas, distancias y blurs apuntan a tokens centralizados en
`src/styles/motion.css` en lugar de declararse sueltos por receta.

| Transición | Dónde se usa |
|---|---|
| `texts-reveal` | Encabezados, onboarding, estados vacíos |
| `page-side-by-side` | Entrada al detalle de una predicción |
| `card-resize` | Panel plegable de «Más opciones» |
| `tabs-sliding` | Abiertas / En prueba / Cerradas |
| `text-states-swap` | «En prueba» → «Abierta», contador de participación |
| `number-pop-in` | Puntos del ranking y participantes |
| `success-check` | Voto guardado, resultado confirmado |
| `modal` + `panel-reveal` | Diálogos: sheet en mobile, modal en desktop |
| `menu-dropdown` | Menú del grupo y selector de grupos |
| `toast` | Avisos de Realtime |
| `skeleton-reveal` | Carga inicial del feed y del ranking |
| `error-state-shake` | Validación inválida en formularios |
| `notification-badge` | Actividad nueva en la barra inferior |
| `toggle` | Preferencias |
| `checkbox-check` | Marca de la opción elegida (el tilde se dibuja) |
| `tooltip` | Iconos sin etiqueta visible |
| `avatar-group-hover` | Pila de integrantes |
| `plus-menu-morph` | Rotación del «+» del botón flotante |
| `confetti-burst` | Sólo al resolverse una predicción que acertaste |
| `smoky-dissolve` *(adaptado)* | Salida de una predicción que expiró |

Sobre `smoky-dissolve`: la receta original disuelve con ruido sobre canvas. Acá
se usa su idea —desvanecer con blur creciente y una leve deriva hacia arriba—
resuelta con una animación compositable, porque lo que desaparece es una fila de
una lista que tiene que seguir siendo un nodo real del documento y no puede
quedar atrapada en un `<canvas>`.

`prefers-reduced-motion` se resuelve en un solo lugar, al final de
`motion.css`: neutraliza el movimiento pero nunca la visibilidad. El spinner es
la única excepción —sin él no habría forma de saber que algo está en curso— y se
limita a bajar la velocidad.

---

## Rendimiento

El bundle inicial se reparte en cuatro chunks que bajan en paralelo:

| Chunk | Tamaño | gzip |
|---|---|---|
| `react` | 232 kB | 74 kB |
| `index` (app) | 220 kB | 60 kB |
| `supabase` | 217 kB | 57 kB |
| `query` | 36 kB | 11 kB |

Cargan bajo demanda:

- `charts` (Recharts, 105 kB gzip) — sólo con el detalle de una evolutiva que
  tenga varias rondas.
- `CreatePredictionSheet` (17 kB gzip) — al abrir el formulario por primera vez.
- Cada pantalla secundaria, en su propio chunk.

Otras decisiones: fuentes self-hosted y precacheadas, alturas reservadas para
gráfico y avatares (nada de CLS), `100dvh` en lugar de `100vh`, e índices en
todas las relaciones y timestamps que se consultan.

---

## Despliegue

1. Creá un proyecto en Supabase y aplicá las migraciones:

   ```bash
   npx supabase link --project-ref <tu-ref>
   npx supabase db push
   ```

2. En el panel del proyecto:
   - **Authentication → URL Configuration**: poné tu dominio como *Site URL* y
     agregá `https://tu-dominio/auth/callback` a las *Redirect URLs*.
   - **Authentication → Rate limits**: dejá los valores por defecto. El
     `sign_in_sign_ups = 200` de `config.toml` está elevado sólo para que la
     suite de integración pueda crear varias cuentas seguidas desde la misma IP.

3. Build y publicación:

   ```bash
   npm run build   # deja todo en dist/
   ```

   `dist/` es estático. Configurá el hosting para servir `index.html` en
   cualquier ruta que no sea un archivo (es una SPA).

4. Variables de entorno del hosting: `VITE_SUPABASE_URL` y
   `VITE_SUPABASE_ANON_KEY`.

---

## Decisiones que vale la pena conocer

**React + Vite, no Next.js.** Es una SPA autenticada, en tiempo real, donde
todas las pantallas están detrás de sesión y ninguna se beneficia de renderizado
en el servidor ni de SEO: los grupos son privados y llevan `noindex`. El
servidor que Next agregaría sería infraestructura sin contrapartida.

**Sin fotos de perfil.** Avatares por iniciales sobre una paleta de ocho
colores. Cero subida de archivos, cero moderación de imágenes, y una identidad
visual consistente desde el primer segundo.

**Magic Link y nada más.** Pedirle a alguien que invente y recuerde una
contraseña para votar si Fran llega tarde es fricción sin beneficio.

**El umbral no se puede configurar hacia abajo.** `create_prediction()` acota
`minimum_participants` a un mínimo de 3 en el servidor. Si el cliente pudiera
mandar 1, cualquiera calificaría su propia predicción con su propio voto y el
estado «En prueba» dejaría de existir.

**Las predicciones del sistema entran por otra puerta.** `is_default` no es un
parámetro de `create_prediction()`: existe una función aparte que copia texto,
opciones y modo desde la fila del template leída en el servidor. Deducir
`is_default` de un `template_id` enviado junto con un título libre dejaría colar
cualquier pregunta como si fuera del sistema.

**`@layer` en el CSS propio.** En Tailwind v4 el CSS sin capa gana sobre todas
las capas. Dejar `base.css` suelto hacía que `button { color: inherit }` anulara
`text-[…]` y que `p { margin: 0 }` anulara los `mt-*`. Todo el CSS propio vive
dentro de `@layer base` o `@layer components`.
