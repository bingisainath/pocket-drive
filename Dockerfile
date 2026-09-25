# Pocket Drive image. Multi-stage so the runtime carries no compilers or build caches.
# Pinned to the Node 20 line the app declares (engines: >=20.12) and that CI builds against.

# --- 1. build the web app -------------------------------------------------------------------
FROM node:20.19.6-bookworm-slim AS web
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- 2. backend production dependencies -----------------------------------------------------
# better-sqlite3 and sharp ship prebuilt binaries for this platform, but keep the toolchain here
# so a version without a prebuild still installs rather than failing the build.
FROM node:20.19.6-bookworm-slim AS deps
WORKDIR /src/backend
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY backend/package*.json ./
RUN npm ci --omit=dev

# --- 3. runtime -----------------------------------------------------------------------------
FROM node:20.19.6-bookworm-slim AS runtime

# ffmpeg/ffprobe make the HLS streaming versions; libheif decodes iPhone HEIC photos that
# sharp's prebuilt binary cannot (they are HEVC-coded).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg libheif-examples \
 && rm -rf /var/lib/apt/lists/* \
 # libheif <1.18 ships "heif-convert"; newer ones "heif-dec". The app calls "heif-dec" with
 # arguments both accept, so alias it rather than branching in the code.
 && if ! command -v heif-dec >/dev/null; then ln -s "$(command -v heif-convert)" /usr/local/bin/heif-dec; fi \
 && heif-dec --help >/dev/null 2>&1 || heif-dec -h >/dev/null 2>&1 || (echo "no working HEIF decoder" && exit 1) \
 && ffmpeg -version >/dev/null && ffprobe -version >/dev/null

WORKDIR /app
COPY --from=deps /src/backend/node_modules ./backend/node_modules
COPY backend/package.json ./backend/
COPY backend/src ./backend/src
COPY backend/scripts ./backend/scripts
COPY --from=web /src/frontend/dist ./frontend/dist

# The bind-mounted data directories on the host are owned by uid/gid 1000; the node user in this
# image is already 1000, so files created in the container keep the same ownership.
USER node
WORKDIR /app/backend

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    STORAGE_DIR=/files \
    FRONTEND_DIST=/app/frontend/dist

EXPOSE 3000
# Uses the app's own health endpoint, so the container is "unhealthy" if Express stops answering.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
