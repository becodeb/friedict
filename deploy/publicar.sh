#!/usr/bin/env bash
# ============================================================================
# Publica una versión nueva de Cantado en la VM.
#
#   ./deploy/publicar.sh
#
# Compila localmente y copia el resultado al volumen que sirve Caddy. No compila
# en la VM a propósito: el build necesita Node y las dependencias de desarrollo,
# y no hay motivo para tener eso en un servidor de producción.
# ============================================================================
set -euo pipefail

: "${VM_HOST:?Definí VM_HOST, por ejemplo: export VM_HOST=usuario@203.0.113.10}"
: "${APP_URL:?Definí APP_URL, por ejemplo: export APP_URL=https://api.cantado.tudominio.com}"
: "${SUPABASE_ANON_KEY:?Definí SUPABASE_ANON_KEY (la anon key de tu instancia)}"

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

echo "▸ Verificando antes de compilar"
npm run typecheck
npm run lint
npm run test

echo
echo "▸ Compilando contra $APP_URL"
# VITE_SUPABASE_URL se hornea en el bundle en tiempo de compilación. Compilar
# con el valor de desarrollo dejaría una app que le pega a localhost desde el
# navegador de cada persona.
VITE_SUPABASE_URL="$APP_URL" \
VITE_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
  npm run build

echo
echo "▸ Subiendo a $VM_HOST"
tar -czf - -C dist . | ssh "$VM_HOST" '
  set -euo pipefail
  TMP=$(mktemp -d)
  tar -xzf - -C "$TMP"

  # Se escribe en el volumen a través de un contenedor efímero: el volumen es
  # de Docker y no tiene por qué estar montado en el sistema de archivos del
  # host.
  docker run --rm -v cantado_dist:/dst -v "$TMP":/src:ro alpine \
    sh -c "rm -rf /dst/* && cp -a /src/. /dst/"

  rm -rf "$TMP"
  echo "  contenido publicado"
'

echo
echo "▸ Listo. Caddy sirve la versión nueva enseguida."
echo "  El service worker se actualiza solo (registerType: autoUpdate)."
