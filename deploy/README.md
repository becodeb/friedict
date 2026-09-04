# Despliegue self-hosted

Todo corre en tu VM. Nada depende de una cuenta de terceros.

**Un solo puerto abierto al mundo: el 443** (más el 80, que sólo redirige a
HTTPS). Postgres, Auth, Realtime y Kong quedan en la red interna de Docker y
nunca se publican.

```
Internet ──443──> Caddy ──┬── cantado.tudominio.com      → dist/ (archivos estáticos)
                          └── api.cantado.tudominio.com  → kong:8000 (interno)
```

> **Nota de honestidad:** estos archivos siguen el camino documentado de
> self-hosting de Supabase, pero **no los probé end-to-end en una VM real** en
> esta sesión. Lo que sí está verificado es la app: corre, compila y pasa los
> tests contra el mismo esquema y las mismas migraciones que vas a subir.
> El paso que más se rompe la primera vez es el SMTP — está explicado abajo.

---

## 0. Antes de empezar

| Necesitás | Detalle |
|---|---|
| Una VM | 2 vCPU y 4 GB de RAM alcanzan. Postgres + 7 servicios |
| Docker + Compose v2 | `docker --version` |
| Un dominio | Dos registros **A** apuntando a la IP de la VM |
| Un SMTP | Para mandar los links de acceso. Ver el paso 4 |

Los dos registros DNS, **antes** de levantar Caddy (Let's Encrypt valida
resolviendo el nombre):

```
cantado.tudominio.com.      A    203.0.113.10
api.cantado.tudominio.com.  A    203.0.113.10
```

---

## 1. El stack de Supabase en la VM

```bash
ssh usuario@tu-vm

git clone --depth 1 https://github.com/supabase/supabase
mkdir -p ~/cantado-infra
cp -r supabase/docker/* ~/cantado-infra/
cp supabase/docker/.env.example ~/cantado-infra/.env
cd ~/cantado-infra
```

### Generar los secretos

**No dejes ni uno de los valores de ejemplo.** El `.env` que viene en el repo
trae claves de demo públicas: si las dejás, cualquiera con tu URL tiene acceso
de `service_role` a toda la base.

```bash
# Contraseña de Postgres y secreto del dashboard
openssl rand -base64 32   # → POSTGRES_PASSWORD
openssl rand -base64 32   # → DASHBOARD_PASSWORD

# Secreto de firma de los JWT (mínimo 32 caracteres)
openssl rand -base64 48   # → JWT_SECRET
```

Con ese `JWT_SECRET`, generá las claves `ANON_KEY` y `SERVICE_ROLE_KEY` en
<https://supabase.com/docs/guides/self-hosting#api-keys> (la página tiene un
generador que corre en tu navegador, no manda nada a ningún servidor).

### El resto del `.env`

```bash
SITE_URL=https://cantado.tudominio.com
API_EXTERNAL_URL=https://api.cantado.tudominio.com
SUPABASE_PUBLIC_URL=https://api.cantado.tudominio.com

ADDITIONAL_REDIRECT_URLS=https://cantado.tudominio.com/**

DISABLE_SIGNUP=false
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=false
ENABLE_ANONYMOUS_USERS=false

JWT_EXPIRY=3600
```

### Cerrar los puertos

En `docker-compose.yml` del stack, **comentá el bloque `ports:` de `kong`**:

```yaml
  kong:
    # ports:
    #   - ${KONG_HTTP_PORT}:8000/tcp
    #   - ${KONG_HTTPS_PORT}:8443/tcp
```

Kong tiene que ser alcanzable sólo desde Caddy, por la red interna. Si lo dejás
publicado, tu API queda accesible por HTTP sin certificado, salteando el proxy.

Lo mismo con `db`: si el bloque `ports:` de Postgres está descomentado,
comentalo. No hay ninguna razón para exponer 5432 a internet.

---

## 2. Caddy

```bash
# Volumen donde vive el build de la app
docker volume create cantado_dist

# Copiá deploy/Caddyfile y deploy/docker-compose.caddy.yml de este repo
# a ~/cantado-infra/ y editá el dominio y el mail en el Caddyfile.

docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
```

Caddy pide el certificado a Let's Encrypt solo, la primera vez que alguien
entra. `docker compose logs -f caddy` para verlo.

---

## 3. Migraciones

Desde tu máquina, con el repo de Cantado:

```bash
npx supabase db push --db-url "postgresql://postgres:LA_PASSWORD@tu-vm:5432/postgres"
```

Si cerraste el 5432 al exterior —que es lo correcto—, hacelo por un túnel SSH:

```bash
ssh -L 5433:localhost:5432 usuario@tu-vm     # en una terminal aparte
npx supabase db push --db-url "postgresql://postgres:LA_PASSWORD@localhost:5433/postgres"
```

Esto aplica las cuatro migraciones: esquema, funciones, RLS y Realtime + cron.

**No corras `supabase/seed.sql` en producción.** Son datos de ejemplo con
usuarios falsos y contraseñas conocidas.

### Verificar que quedó bien

```bash
# Debería dar 0
psql "$DB_URL" -c "select count(*) from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity=false;"

# Debería dar sólo peek_invite
psql "$DB_URL" -c "select p.proname from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and has_function_privilege('anon', p.oid, 'EXECUTE');"

# El cron de cierre automático debería estar programado
psql "$DB_URL" -c "select jobname, schedule from cron.job;"
```

---

## 4. SMTP — el paso que más se rompe

La app entra por Magic Link. **Sin SMTP no se puede iniciar sesión.** El
Inbucket/Mailpit del entorno local es sólo para desarrollo y no está en el stack
self-hosted.

En el `.env`:

```bash
SMTP_HOST=smtp.tu-proveedor.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_ADMIN_EMAIL=hola@tudominio.com
SMTP_SENDER_NAME=Cantado
```

Sirve cualquier proveedor transaccional (Resend, Postmark, SES, Brevo). **No uses
Gmail**: limita fuerte y los mails terminan en spam.

Configurá **SPF y DKIM** en el DNS de tu dominio. Sin eso, los links de acceso
van a la carpeta de correo no deseado y la app va a parecer rota.

Después de cambiar el `.env`: `docker compose restart auth`.

---

## 5. Publicar la app

Desde tu máquina:

```bash
export VM_HOST=usuario@tu-vm
export APP_URL=https://api.cantado.tudominio.com
export SUPABASE_ANON_KEY=la_anon_key_que_generaste

./deploy/publicar.sh
```

El script compila localmente —después de correr typecheck, lint y tests—, sube
el resultado y lo deja en el volumen que sirve Caddy.

`VITE_SUPABASE_URL` se hornea en el bundle al compilar. Por eso el build va con
la URL pública: compilar con la de desarrollo dejaría una app que le pega a
`localhost` desde el navegador de cada persona.

---

## 6. Comprobar

```bash
curl -I https://cantado.tudominio.com                    # 200, con certificado válido
curl -I https://cantado.tudominio.com/g/algo             # 200 (la SPA responde en cualquier ruta)
curl -s https://api.cantado.tudominio.com/rest/v1/ -H "apikey: $ANON" | head
curl -I https://cantado.tudominio.com/manifest.webmanifest
```

Y a mano, en el navegador:

1. Entrá a `https://cantado.tudominio.com`, pedí un link con tu mail. **Tiene que
   llegar.** Si no llega, es el paso 4.
2. Creá un grupo, sacá el link de invitación, abrilo en una ventana de incógnito.
3. Con las dos ventanas abiertas, votá en una. El contador de la otra tiene que
   moverse solo — eso confirma que los WebSockets pasan por el proxy.
4. En el móvil, el navegador debería ofrecer «Agregar a la pantalla de inicio».

---

## Mantenimiento

**Backups.** Es lo único que no se recupera si se pierde la VM:

```bash
# Diario, a las 3 AM
0 3 * * * docker exec supabase-db pg_dump -U postgres postgres \
  | gzip > /var/backups/cantado-$(date +\%F).sql.gz
```

Probá restaurar uno alguna vez. Un backup que nunca se restauró no es un backup.

> **Antes de desplegar `db/migrations/730_drop_prediction_quorum_columns.sql`
> (change `simpler-prediction-setup`): sacá un backup manual inmediato,**
> además del cron diario. Esa migración borra `qualification_percent`,
> `close_percent` y `minimum_participants` de `predictions`, y el único modo de
> recuperarlos es restaurar desde un backup tomado antes de que corra. El
> servidor aplica las migraciones pendientes de `db/migrations` solo al
> arrancar (`server/src/migrate.ts`), así que el backup tiene que existir
> antes de reiniciar el servicio con el código nuevo.

**Actualizaciones.**

```bash
cd ~/cantado-infra && docker compose pull && docker compose up -d
```

**Qué mirar si algo falla:**

| Síntoma | Dónde |
|---|---|
| No llegan los mails | `docker compose logs auth` |
| El tiempo real no actualiza | `docker compose logs realtime` + WS en la pestaña Network |
| Error de certificado | `docker compose logs caddy` — casi siempre es DNS |
| Predicciones que no cierran solas | `select * from cron.job_run_details order by start_time desc limit 5;` |

---

## Si algún día querés pasarlo a la nube

Las mismas migraciones aplican sin cambios: `supabase link` + `supabase db push`,
recompilás con la URL nueva y listo. No hay nada atado al self-hosting.
