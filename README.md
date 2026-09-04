# friedict

**Predicciones privadas entre amigos.** Alguien pregunta qué va a pasar, el grupo se
juega, y cuando la cosa se resuelve se ve quién tenía razón.

No hay dinero, saldo, premios ni apuestas de ningún tipo. Los puntos son sólo un
mecanismo de juego: se ganan acertando, nunca se pierden y no valen nada fuera de
la app.

> El nombre junta *friends* y *predict*: predicciones entre amigos. Y cuando una
> se resuelve, la app dice lo que dice cualquier grupo: *«¡estaba cantado!»*,
> eso que todos sabían que iba a pasar.

---

## Qué hace

- **Grupos privados.** Se entra sólo con un link de invitación. Los grupos no
  son visibles desde afuera ni se indexan: sólo la portada y el login llegan a
  un buscador, con lista blanca por ruta (ver «Indexación selectiva»).
- **Predicciones que nunca expiran.** Por default, una predicción queda activa
  apenas se crea. Un grupo puede pedir, como ajuste propio, que se ganen el
  lugar primero: entran *en prueba* hasta que las elige un porcentaje del
  grupo — sin plazo, y sin ensuciar el feed mientras esperan; el umbral es un
  porcentaje de los integrantes vivos, así que crece y baja con el grupo.
- **Cierre por fecha o por pedido.** Una predicción puede cerrar en una fecha o
  quedar abierta hasta que el grupo pida cerrarla. Pedirlo requiere haber
  votado, y hace falta el quórum de cierre del grupo — con 1 alcanza si el
  grupo confía en sí mismo.
- **Nadie se influye.** Hasta el cierre se muestra cuánta gente participó, pero
  no qué eligió cada una. Lo garantiza la base de datos, no la interfaz.
- **El voto se puede corregir, no reescribir con el diario del lunes.** Cada
  preset trae su propia ventana de cambio (de 15 minutos a sin límite);
  pasado ese tiempo el voto queda firme, así que cambiarlo al último momento
  ya sabiendo el resultado no sirve para nada.
- **Presets con override.** Crear una predicción es elegir uno de tres modos de
  juego ("A libro abierto", "A ciegas", "Evolutiva") en vez de configurar
  cuatro campos sueltos; cualquiera se puede tocar aparte, y ahí la fila pasa
  a decir "A medida".
- **Los puntos escalan con lo que duró.** Una predicción que corrió un año vale
  más que una que se resolvió esa misma noche — hasta 3× la base, con una
  curva logarítmica para que esperar de más no valga infinito.
- **Dos modos de votación.** Clásica (un voto, corregible dentro de su ventana)
  y evolutiva (un voto por ronda, con historial y gráfico de cómo fue
  cambiando la opinión del grupo).
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
| Docker | Corriendo, para el Postgres local |
| Espacio | ~500 MB para la imagen de Postgres |

No hace falta ningún CLI de terceros. El backend son dos cosas: un Postgres en
un contenedor y el servidor de `server/`, que corre con Node.

---

## Puesta en marcha

```bash
# 1. Dependencias — la app y el servidor tienen su propio package.json
npm install
npm --prefix server install

# 2. Postgres local (un solo contenedor)
npm run db:start

# 3. Configuración del servidor
cp server/.env.example server/.env
# Los valores por defecto ya apuntan al Postgres del paso 2. Lo único que
# conviene cambiar es JWT_SECRET: `openssl rand -base64 48`.

# 4. Migraciones + datos de ejemplo
npm run db:reset

# 5. A andar: el servidor en una terminal…
npm run dev:server
# …y Vite en otra
npm run dev
```

La app queda en <http://localhost:5183>.

> **Los puertos están corridos a propósito.** Postgres escucha en `54432` en
> lugar del `5432`, Vite en `5183` en lugar del `5173` y el servidor en `8183`,
> para poder convivir con otros proyectos levantados en la misma máquina. Están
> en `docker-compose.dev.yml`, `vite.config.ts` y `server/.env`.

### Servicios locales

| Servicio | URL |
|---|---|
| App (Vite) | <http://localhost:5183> |
| API, auth y realtime (servidor) | <http://127.0.0.1:8183> |
| Base de datos | `postgresql://postgres:postgres@127.0.0.1:54432/friedict` |

En desarrollo Vite proxya `/api` —HTTP y WebSocket— al servidor. No es un
detalle de comodidad: hace que en el navegador todo salga del mismo origen que
en producción, que es lo que necesita la cookie de sesión para viajar.

Se entra con Google o con mail y contraseña. No hay mails de por medio, así que
tampoco hace falta ningún servidor de correo local.

### Cuentas de ejemplo

`npm run db:reset` deja armados dos grupos:

- **Los pibes** — Bauti (creó el grupo), Juan (admin), Agus, Fran, Lu
- **Fútbol 5** — Juan (creó el grupo), Agus, Caro

Caro pertenece sólo al segundo grupo: sirve para comprobar a ojo que no se
filtra nada entre grupos.

Los mails son `bauti@cantado.test`, `juan@cantado.test`, `agus@cantado.test`,
`fran@cantado.test`, `lu@cantado.test` y `caro@cantado.test`. Todas tienen la
contraseña `cantado123`, que **existe sólo dentro del seed**. En desarrollo la
pantalla de ingreso muestra además un atajo para entrar como cualquiera de
ellas con un clic; está detrás de `import.meta.env.DEV`, así que no llega al
build de producción.

Las predicciones sembradas cubren todos los estados: en prueba con 2 de 3
(«Los pibes» tiene la calificación prendida en el seed), abierta, cerrada
esperando resultado, resuelta con puntos repartidos, evolutiva con seis
semanas de historial y una del sistema. La fila `expired` que queda es un
rastro de una fila anterior a este cambio: nada expira más, así que ese
estado ya es inalcanzable para una predicción nueva.

---

## Variables de entorno

**El frontend no necesita ninguna.** No hay `.env.local` que completar: la app
le pega a `/api` en su propio origen, así que no queda ninguna URL horneada en
el bundle — que era justamente lo que obligaba a rebuildear cada vez que
cambiaba el backend. Nada de la configuración lleva el prefijo `VITE_`, y eso
es deliberado: todo lo que lo lleva **termina dentro del bundle que se descarga
el navegador**, y acá no hay nada que pueda vivir ahí.

Todo lo que hay que configurar vive en `server/.env` — copiá
`server/.env.example`:

| Variable | Qué es |
|---|---|
| `ADMIN_DATABASE_URL` | Conexión de superusuario. Sólo migra y crea el rol de la app |
| `DATABASE_URL` | El rol con el que se atienden las peticiones: sin superusuario y sin ser dueño de las tablas, para que la RLS le aplique de verdad |
| `JWT_SECRET` | Firma la cookie de sesión. Mínimo 32 caracteres |
| `PORT` | `8183` en desarrollo |
| `SEED_ON_BOOT` | `1` carga `db/seed.sql` si la base está vacía. Dejalo en `0` salvo que quieras una demo con contenido |
| `PUBLIC_ORIGIN` | *(opcional)* Origen público, con esquema. De ahí sale el `redirect_uri` de Google |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | *(opcionales)* Ingreso con Google |

El servidor las lee **una vez al arrancar y las valida ahí mismo**: un proceso
que levanta con media configuración y explota en la primera petición es mucho
peor que uno que no levanta y dice qué le falta.

### Google

El ingreso admite Google además del mail con contraseña. Las credenciales de
OAuth van en **`server/.env`** — no en ningún `.env.local`, y nunca en el
bundle:

```
PUBLIC_ORIGIN=https://tu-dominio
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

En producción no hay archivo: `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` se
cargan como variables de entorno en Coolify, y `PUBLIC_ORIGIN` la arma el
`docker-compose.yml` solo.

En Google Cloud Console hay que autorizar como *redirect URI* exactamente
`<PUBLIC_ORIGIN>/api/auth/google/callback`. Un carácter de diferencia y el
flujo falla con `redirect_uri_mismatch`, que es un error que no dice por qué.

**`PUBLIC_ORIGIN` tiene que ser una URL absoluta, con esquema.** En producción
`docker-compose.yml` la saca de `SERVICE_URL_APP`, que es la variable que
Coolify llena con la URL completa (`https://…`), y **no** de `SERVICE_FQDN_APP`,
que es el dominio pelado: de ahí salía un `redirect_uri` sin `https://` y
Google lo rechazaba. Y **no le agregues el esquema a `SERVICE_FQDN_APP`**: esa
variable la usa Coolify para su propio proxy y para pedir el certificado, y
espera un dominio sin esquema. Tocarla no rompe el login, rompe el sitio.

Sin Google configurado la app funciona igual: `/api/auth/google` redirige a
`/entrar?error=google_no_configurado` y la pantalla de ingreso lo explica en
castellano, en vez de dejar un botón que falla en silencio.

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Vite, con el proxy de `/api` al servidor |
| `npm run dev:server` | El servidor: API, auth y realtime |
| `npm run build` | Build de producción del frontend (typecheck + Vite) |
| `npm run build:server` | Compila el servidor a `server/dist` |
| `npm run preview` | Sirve el build, en el `4183` |
| `npm run typecheck` | Sólo TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Tests unitarios y de componentes (Vitest) |
| `npm run test:watch` | Los mismos, en watch |
| `npm run test:integration` | Tests contra la base real |
| `npm run test:e2e` | Playwright, cuatro perfiles |
| `npm run test:all` | typecheck + lint + los tres anteriores, en orden |
| `npm run db:start` / `db:stop` | Levanta y baja el Postgres local |
| `npm run db:reset` | Esquema en cero, migraciones y datos de ejemplo |
| `npm run icons` | Regenera los íconos de la PWA |
| `npm run qa:grants` | Qué funciones puede ejecutar de verdad `authenticated` |
| `npm run qa:pwa` | Prueba de humo de la PWA sobre el build (con `preview` levantado) |
| `npm run qa:visual` | Recorre las pantallas, captura y busca errores de consola |
| `npm run qa:audit` | Audita objetivos táctiles y desbordes horizontales |
| `npm run abrir` | Abre dos ventanas listas para recorrer a mano |

Los tests de integración y los E2E **necesitan el Postgres local levantado**, y
los E2E además el servidor (`npm run dev:server`) y, la primera vez,
`npx playwright install` para bajar los navegadores. Los E2E reinician la base
antes de empezar (se puede saltear con `E2E_SKIP_RESET=1`).

> **Cuatro scripts quedaron atados al stack viejo y hoy no corren.** `abrir`,
> `qa:visual` y `qa:audit` importan `@supabase/supabase-js`, que ya no es
> dependencia del proyecto. Y `qa:grants` se conecta al puerto del Postgres de
> Supabase y su lista de funciones previstas quedó corta frente a las
> migraciones nuevas; mientras tanto la referencia buena es
> `integration/grants.test.ts`, que comprueba lo mismo y sí corre.

---

## Estructura

```
db/
  migrations/                 se aplican en orden alfabético, una sola vez
    000_identity.sql          usuarios propios y current_user_id()
    100_schema.sql            tablas, enums, índices, vista de ranking, grants
    200_functions.sql         toda la lógica de dominio (SECURITY DEFINER)
    300_rls.sql               políticas de lectura + helpers de autorización
    400_notify_and_cron.sql   triggers de pg_notify y cierre automático
    5xx–7xx_*.sql             auth propia, quórum de cierre, ajustes de grupo
  seed.sql                    datos de ejemplo
  rpc-functions.json          lista blanca de funciones expuestas por /api/rpc

server/src/
  index.ts                    Express: la API y los estáticos del frontend
  auth.ts                     contraseña y Google, cookie de sesión httpOnly
  rpc.ts                      puente a las funciones de dominio
  routes.ts                   lecturas
  realtime.ts                 LISTEN/NOTIFY de Postgres → WebSocket
  migrate.ts                  aplica db/migrations al arrancar
  robots.ts                   lista blanca de indexación

src/
  auth/                       sesión y perfil (Google + contraseña)
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
scripts/                      reset de la base, íconos y auditorías
```

---

## Arquitectura

### El cliente sólo lee

Las tablas otorgan **únicamente `SELECT`** a `authenticated`. Toda escritura
pasa por una función `SECURITY DEFINER` que resuelve el usuario con
`public.current_user_id()` y verifica membresía, rol y ventana de tiempo antes
de tocar nada.

Esto tiene una consecuencia práctica: no existe forma de mandar un `group_id` o
un `created_by` ajeno y que la base lo acepte, porque el cliente nunca escribe
esas columnas.

`current_user_id()` ocupa el lugar exacto que ocupaba `auth.uid()` de Supabase:
lee la GUC `app.user_id`, que el servidor fija **local a la transacción** antes
de cualquier otra cosa. Al ser local se limpia sola al terminar, así que una
conexión reciclada del pool nunca arrastra el usuario de la petición anterior.
Y el rol con el que la app consulta no es superusuario ni dueño de las tablas
—Postgres le saltearía la RLS al dueño, y entonces todas las políticas del
proyecto no harían absolutamente nada—.

### El umbral de participación (opcional, del grupo, sin plazo)

Es un ajuste de `groups`, apagado por default: `qualification_enabled`. Con el
toggle apagado, toda predicción nueva nace directamente `active`. Prendido,
nace `proposed` y un trigger sobre `prediction_votes` mantiene
`participant_count` y la promueve a `active` en cuanto llega el porcentaje del
grupo configurado en `groups.qualification_percent` — sin ningún plazo: una
predicción "en prueba" espera el tiempo que haga falta. Nada expira nunca por
falta de participación; `qualification_deadline` en `predictions` es un rastro
de auditoría de filas anteriores a este ajuste, ya no se escribe.

`finalize_predictions()` es idempotente y se invoca desde **cuatro** lugares,
para que el estado sea confiable aunque falle cualquiera:

1. el servidor, con un intervalo de un minuto;
2. `pg_cron`, también cada minuto, *si la extensión está disponible* — la imagen
   oficial de Postgres no la trae, así que en la práctica la que corre es la de
   arriba y la migración lo deja anotado con un `raise notice` en vez de fallar;
3. `cast_vote()` y `propose_resolution()`, antes de aceptar la operación;
4. el cliente, al abrir el feed de un grupo.

### Cómo se mantiene el voto secreto

Este es el punto de diseño más delicado del producto.

- La RLS de `prediction_votes` deja ver **el voto propio siempre**, y los ajenos
  sólo cuando la predicción cerró (o si está configurada como visible).
- Los recuentos por opción viven en una tabla aparte,
  `prediction_option_tallies`, cuya RLS implementa `results_visibility`. Un
  trigger la mantiene al día.
- `prediction_votes` está **deliberadamente afuera** de los triggers de
  `pg_notify`. Los avisos salen del servidor sin volver a pasar por RLS, así que
  emitir uno por cada voto sería contar quién votó y cuándo. El cliente escucha
  `predictions` (que trae `participant_count`) y las tallies, y el payload que
  viaja es mínimo a propósito: dice "cambió esto", no qué cambió.

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

Un WebSocket contra el propio servidor (`/api/realtime`), alimentado por
`LISTEN/NOTIFY` de Postgres: los triggers emiten `pg_notify`, el servidor
mantiene un `LISTEN friedict` y reenvía cada aviso a quienes estén mirando ese
grupo. Es una sola conexión para toda la app, compartida entre los hooks, que
se abre con el primer suscriptor y se cierra con el último; abrir un socket por
componente daría conexiones duplicadas en cada re-render. Se reconecta sola con
una espera creciente, porque un servidor que se reinicia y deja la app muda es
la peor forma de fallar: la pantalla sigue mostrando datos, sólo que viejos.

Los eventos invalidan la query que corresponde en lugar de reconstruir estado a
mano, y el dato se vuelve a pedir por HTTP, donde la RLS decide otra vez qué se
puede ver. La suscripción del grupo se monta en `GroupShell` y no en cada
pantalla, para no suscribirse de nuevo al navegar entre feed, ranking e
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
- **Service worker**: precachea sólo el app shell — JS, CSS, HTML, SVG y
  fuentes. Nada de lo que devuelve `/api` entra al caché; cachear contenido
  privado en `CacheStorage` sería filtrarlo a quien abra el navegador después.
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
| `src/**/*.test.ts(x)` | Umbral, ciclos, scoring, presets, fechas y zonas horarias, componentes | 186 en 15 archivos |
| `integration/` | Ciclo de vida completo, RLS, grants, realtime, paridad de la fórmula, Google, robots | 129 en 14 archivos |
| `e2e/` | Flujos de creador e invitado, ingreso con contraseña, accesibilidad, layout | 67 en 7 archivos |

Los de integración van directo a Postgres con **el mismo mecanismo que usa el
servidor en producción**: una conexión con el rol de la aplicación —que no es
superusuario ni dueño de las tablas— y la GUC `app.user_id` puesta por
transacción. Si la conexión fuera de superusuario, Postgres saltearía la RLS y
la suite entera pasaría sin demostrar nada.

Aparte tienen una segunda conexión, esa sí de superusuario, para dos cosas que
un cliente no puede ni debe hacer: viajar en el tiempo (correr `closes_at` al
pasado) y leer estado sin pasar por RLS, para comprobar que la RLS
efectivamente ocultó algo.

Los E2E cubren cuatro perfiles: `mobile` (Pixel 7, flujos completos), `tablet`
(820px), `desktop` (1280px) y `reduced-motion`. Los flujos que cambian el estado
de la base corren una sola vez, en mobile: correrlos en los tres perfiles contra
la misma base haría que el segundo encontrara predicciones ya resueltas y
fallara por arrastre, no por un defecto real.

Uno de los tests de autenticación hace el recorrido completo sin atajos: crea
una cuenta desde el formulario, cierra sesión y vuelve a entrar con las mismas
credenciales. Google no se puede probar de punta a punta acá, porque implica
salir del sitio hacia un tercero.

---

## Diseño

**Design Read: «Caramelo».** El grupo de WhatsApp hecho interfaz: stickers,
colores de golosina y contornos gruesos que parecen impresos. Divertida sin
ser infantil: lo que la mantiene adulta es el contorno de tinta y que la
tipografía no sea redondeada.

- **Contorno de 2 px y sombra dura.** Todo lo que se toca —tarjetas, píldoras,
  botones, campos, diálogos— lleva un borde de tinta y una sombra desplazada sin
  desenfoque. Al apretar un botón se hunde sobre su sombra. Los tokens son
  `--outline-w` y `--shadow-1/2/3`; las piezas compartidas (`.card-pop`,
  `.opt-pill`, `.sticker`, `.burst`) viven en `src/styles/base.css`.
- **Un color por estado, y siempre con texto.** Sol para *en prueba*, lima para
  *abierta* y para la opción que pasó, cielo para *cerrada* y para las
  evolutivas, tinta para *resuelta*, gris para lo que no juntó gente. Cuatro
  golosinas es el máximo que aguanta sin volverse infantil. El estado es un
  `Sticker` pegado sobre el borde de la tarjeta, con filete troquelado, y el
  texto va siempre: quien no distingue el sol de la lima lee igual «En prueba»
  y «Abierta».
- **El chicle es tu voto y la acción.** Un solo acento (`--accent`, #FF5FA8)
  para la opción que elegiste, el botón principal y el FAB. El texto sobre
  cualquier golosina es siempre tinta oscura (`--on-candy`), también en modo
  oscuro: las golosinas no cambian de tema, sólo cambian la tinta y las
  superficies.
- **Tipografía**: Bricolage Grotesque 800 para preguntas, títulos y cifras;
  Instrument Sans para texto y controles. Las dos self-hosted vía fontsource.
- **El umbral se cuenta con caritas.** Una carita por persona que ya se jugó y
  un círculo punteado por cada una que falta. Sin iniciales: hasta el cierre
  nadie sabe quién votó, y eso lo garantiza la base, no la interfaz.
- **Resolver y rankear son festejo.** La explosión «¡Estaba cantado!» aparece
  en la esquina de toda predicción resuelta, y los tres primeros del ranking
  suben a un podio de golosina. El confeti sigue reservado para cuando
  acertaste vos.
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
| `tabs-sliding` | Abiertas / En prueba / Cerradas: la píldora de tinta viaja entre pestañas |
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

El bundle inicial se reparte en tres chunks que bajan en paralelo:

| Chunk | Tamaño | gzip |
|---|---|---|
| `react` | 232 kB | 74 kB |
| `index` (app) | 224 kB | 63 kB |
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

Docker Compose sobre Coolify. `docker-compose.yml` levanta dos servicios y nada
más: Postgres y la app. La base **no publica puertos** — sólo se llega a ella
por la red interna de Docker, así que el único punto de entrada desde afuera es
la app, y a esa la expone Coolify por su proxy.

El `Dockerfile` arma **una sola imagen** en tres etapas: una compila el
frontend, otra el servidor, y la última sólo corre. Un contenedor sirve la API
y los archivos estáticos: al compartir origen no hay CORS que configurar, la
cookie de sesión es de primera parte —y por lo tanto sobrevive a lo que los
navegadores le hacen a las de terceros— y el deploy es un contenedor en vez de
dos.

1. Variables de entorno en Coolify:

   | Variable | Qué es |
   |---|---|
   | `POSTGRES_PASSWORD` | Contraseña del superusuario de la base |
   | `APP_DB_PASSWORD` | Contraseña del rol con el que consulta la app |
   | `JWT_SECRET` | Firma las cookies de sesión (`openssl rand -base64 48`) |
   | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Opcionales, para el ingreso con Google |
   | `SEED_ON_BOOT` | Dejalo en `0`: el seed son usuarios falsos con contraseñas conocidas |

   `SERVICE_FQDN_APP` y `SERVICE_URL_APP` las pone Coolify solo al asignar el
   dominio; `PUBLIC_ORIGIN` sale de la segunda (ver «Google» más arriba).

2. **Las migraciones no se aplican a mano.** El servidor corre los
   `db/migrations/*.sql` pendientes al arrancar (`server/src/migrate.ts`),
   anota el nombre de cada archivo aplicado en `public._migrations` y no lo
   vuelve a ejecutar nunca. Un deploy contra una base vacía la deja lista sin
   ningún paso manual, y uno contra una base al día no ejecuta nada.

   Corren con el superusuario y no con el rol de la app, por dos motivos: crear
   roles y extensiones necesita privilegios que la app no tiene (ni debe
   tener), y el **dueño** de las tablas tiene que ser otro rol — Postgres le
   saltea la RLS al dueño, así que si la app fuera la dueña, todas las
   políticas del proyecto no harían nada.

3. En Google Cloud Console, autorizá
   `https://tu-dominio/api/auth/google/callback` como redirect URI.

El healthcheck de la imagen consulta `/api/health`, que a su vez consulta la
base: un servidor que responde pero no llega a Postgres no sirve para nada, y
Coolify tiene que enterarse.

> **Antes de desplegar `db/migrations/730_drop_prediction_quorum_columns.sql`,
> sacá un backup manual.** Esa migración borra columnas de `predictions` y el
> único modo de recuperarlas es restaurar desde un backup anterior a que corra
> — y corre sola, al reiniciar el servicio con el código nuevo.

> Lo que hay en `deploy/` (Caddy + el camino de self-hosting de Supabase) es
> del stack anterior y todavía no se portó. No lo sigas.

---

## Decisiones que vale la pena conocer

**React + Vite, no Next.js.** Es una SPA autenticada, en tiempo real, donde
todas las pantallas están detrás de sesión y ninguna se beneficia de renderizado
en el servidor ni de SEO: los grupos son privados y llevan `noindex`. Sí hay un
servidor propio, pero es una API con auth y realtime: no renderiza HTML ni
participa de la navegación, así que el renderizado en el servidor que Next
agregaría seguiría siendo infraestructura sin contrapartida.

**Sin fotos de perfil.** Avatares por iniciales sobre una paleta de ocho
colores. Cero subida de archivos, cero moderación de imágenes, y una identidad
visual consistente desde el primer segundo.

**Google o mail con contraseña, sin Magic Link.** El Magic Link era lindo hasta
que se mira de qué depende: un proveedor de mail saliente, SPF y DKIM bien
configurados, y que el mensaje no caiga en spam. Una app de amigos no puede
depender de que el mail funcione para que alguien pueda entrar — cuando falla
no parece un problema de correo, parece que la app está rota. Google entra
directo y la contraseña es el piso que siempre está. El mismo formulario sirve
para entrar y para registrarse: son los mismos dos campos, y obligar a elegir
entre dos pantallas idénticas antes de escribir nada es fricción sin beneficio.

**El umbral es un porcentaje del GRUPO, no un número fijo por predicción.**
`groups.qualification_percent` fija el porcentaje, y el requisito se calcula
EN VIVO contra los integrantes del grupo con `required_participants()`,
acotado siempre al conteo real. Antes era un mínimo fijo de 3 por predicción
acotado con `greatest(3, …)`, y eso tenía un agujero: en un grupo de 2 el
requisito era inalcanzable. Antes de eso, el umbral vivía en cada predicción y
tenía un plazo (`qualification_deadline`) que la hacía `expired` si no
llegaba; el dueño lo pidió más simple todavía: es un ajuste del grupo, apagado
por default, sin plazo — nada expira, y un porcentaje con tope en la cantidad
de integrantes no puede pedir más gente de la que existe.

**El quórum de cierre es un número absoluto, no un porcentaje.**
`groups.close_request_quorum` guarda una cantidad directa — "con 1 alcanza si
confío en el grupo" fue el pedido — acotada al conteo vivo por
`required_close_requests(member_count, quorum)`, nunca escrita más allá de ese
tope.

**El voto se puede corregir, no cambiar para siempre.** `cast_vote()` mide
`prediction_votes.first_cast_at` — el momento del PRIMER voto de esa fila,
nunca reescrito por un cambio posterior — contra `predictions.vote_change_window`.
Pasada la ventana, cambiar el voto levanta `vote_locked`. Cierra el agujero
por el que alguien podía enterarse del resultado y cambiar su voto al último
momento para cobrar puntos: la anticipación del puntaje también se corrigió,
midiéndose desde `prediction_votes.option_selected_at` (cuándo se eligió la
opción que terminó ganando) en vez de desde el primer voto de la fila.

**Indexación selectiva.** `server/src/robots.ts` es una lista blanca
*default-deny*: toda ruta manda `noindex, nofollow` salvo `/` y `/entrar`. Una
ruta nueva nace privada; para hacerla indexable hay que sumarla a propósito.
`src/lib/indexing.ts` mantiene la copia del meta del cliente y un test compara
las dos listas para que no deriven. El header del servidor es el que manda: no
depende de JS, y los crawlers combinan header y meta quedándose con la
directiva más restrictiva.

**Las predicciones del sistema entran por otra puerta.** `is_default` no es un
parámetro de `create_prediction()`: existe una función aparte que copia texto,
opciones y modo desde la fila del template leída en el servidor. Deducir
`is_default` de un `template_id` enviado junto con un título libre dejaría colar
cualquier pregunta como si fuera del sistema.

**`@layer` en el CSS propio.** En Tailwind v4 el CSS sin capa gana sobre todas
las capas. Dejar `base.css` suelto hacía que `button { color: inherit }` anulara
`text-[…]` y que `p { margin: 0 }` anulara los `mt-*`. Todo el CSS propio vive
dentro de `@layer base` o `@layer components`.
