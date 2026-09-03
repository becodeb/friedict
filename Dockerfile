# ============================================================================
# friedict — imagen de producción
# ----------------------------------------------------------------------------
# Un solo contenedor sirve la API y el frontend. Compartir origen evita CORS,
# hace que la cookie de sesión sea de primera parte (y por lo tanto sobreviva a
# las restricciones que los navegadores le ponen a las de terceros) y deja el
# deploy en un contenedor en lugar de dos.
#
# Tres etapas: dos compilan y la última sólo corre. La imagen final no tiene
# Vite, ni TypeScript, ni las dependencias de desarrollo.
# ============================================================================

# ---------------------------------------------------------------------------
# 1. El frontend
# ---------------------------------------------------------------------------
FROM node:22-alpine AS frontend
WORKDIR /app

# Las dependencias primero: mientras el lockfile no cambie, Docker reusa esta
# capa y no vuelve a bajar todo el árbol en cada deploy.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# No hay variables de entorno acá a propósito. El frontend habla con su propio
# origen (`/api`), así que no hay ninguna URL que hornear en el bundle — que era
# justamente lo que obligaba a rebuildear al cambiar de backend.
RUN npx vite build

# ---------------------------------------------------------------------------
# 2. El servidor
# ---------------------------------------------------------------------------
FROM node:22-alpine AS server
WORKDIR /srv

COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/tsconfig.json ./
COPY server/src ./src
RUN npx tsc -p tsconfig.json

# Se descartan las dependencias de desarrollo (TypeScript y los @types) para
# que no viajen a la imagen final.
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# 3. Lo que corre
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /srv

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=server /srv/node_modules ./node_modules
COPY --from=server /srv/dist ./dist
COPY --from=frontend /app/dist ./public

# Las migraciones y el seed viajan con la imagen: el servidor las aplica al
# arrancar, así que un deploy sobre una base vacía la deja lista sin ningún
# paso manual.
COPY db ./db

# No corre como root. La imagen de Node ya trae el usuario `node`.
USER node

EXPOSE 8080

# El healthcheck consulta la base, no sólo el proceso: un servidor que responde
# pero no llega a Postgres no sirve para nada, y Coolify tiene que saberlo.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>r.json()).then(b=>process.exit(b.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
