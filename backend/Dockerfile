# Stage 1: Frontend builder
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY frontend/ ./

ENV VITE_API_URL=/api
ENV VITE_BACKEND_URL=

RUN npm run build

# Stage 2: Builder
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install dependencies
COPY backend/package*.json ./
COPY backend/scripts ./scripts
COPY backend/vendor ./vendor
# Skip Puppeteer download during build as we only need to compile TS
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
ENV SKIP_PROVIDER_BUILD=1
ENV SKIP_FFMPEG_AUTO_INSTALL=1

# Install build dependencies for native modules (python3, make, g++)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    pkg-config \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Use BuildKit cache mount for npm to speed up subsequent builds
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Copy backend source
COPY backend/ .

# Build bgutil-ytdlp-pot-provider, then drop its dev dependencies so the
# final stage can copy production node_modules only.
WORKDIR /app/bgutil-ytdlp-pot-provider/server
RUN CXXFLAGS="-include cstdint" npm install && npx tsc && npm prune --omit=dev
WORKDIR /app

RUN npm run build

# Stage 2: Production
FROM node:22-bookworm-slim

WORKDIR /app

# Install system dependencies
# chromium: for Puppeteer
# ffmpeg: for video processing
# python3: for yt-dlp
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    gosu \
    unzip \
    libcairo2 \
    libpango-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python

# Install cloudflared (pinned + checksum verified — same policy as deno below;
# `releases/latest` made image builds non-reproducible). Upstream publishes no
# per-asset checksum files, so the digests are recorded here at pin time.
# To upgrade: bump the version, download both arch binaries, sha256sum them.
ARG TARGETARCH
ARG CLOUDFLARED_VERSION=2026.6.1
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) CLOUDFLARED_SHA256="5861a10a438fe8ddcfebb3b830f83966cbf193edafce0fe2eeb198fbae1f7a22" ;; \
      arm64) CLOUDFLARED_SHA256="59816ce9b16db71f5bc2a86d59b3632a96c8c3ee934bde2bc8641ee83a6070eb" ;; \
      *) echo "Unsupported TARGETARCH for cloudflared: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL --retry 5 --retry-delay 2 \
      "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${TARGETARCH:-amd64}" \
      -o /usr/local/bin/cloudflared; \
    echo "${CLOUDFLARED_SHA256}  /usr/local/bin/cloudflared" | sha256sum -c -; \
    chmod +x /usr/local/bin/cloudflared; \
    cloudflared --version

# Install deno for yt-dlp JavaScript runtime support (pinned + checksum verified)
ARG DENO_VERSION=2.3.1
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) DENO_ARCH="x86_64" ;; \
      arm64) DENO_ARCH="aarch64" ;; \
      *) echo "Unsupported TARGETARCH for deno: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    DENO_ZIP="deno-${DENO_ARCH}-unknown-linux-gnu.zip"; \
    DENO_URL="https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/${DENO_ZIP}"; \
    curl -fsSL --retry 5 --retry-delay 2 "${DENO_URL}" -o "/tmp/${DENO_ZIP}"; \
    curl -fsSL --retry 5 --retry-delay 2 "${DENO_URL}.sha256sum" -o "/tmp/${DENO_ZIP}.sha256sum"; \
    (cd /tmp && sha256sum -c "${DENO_ZIP}.sha256sum"); \
    unzip -q "/tmp/${DENO_ZIP}" -d /usr/local/bin; \
    chmod +x /usr/local/bin/deno; \
    rm -f "/tmp/${DENO_ZIP}" "/tmp/${DENO_ZIP}.sha256sum"; \
    deno --version

# Install yt-dlp and related packages. Versions are pinned for reproducible builds.
# To upgrade: check https://pypi.org/project/yt-dlp/ and update versions below.
# yt-dlp-ejs and curl-cffi must track the yt-dlp release:
#  - yt-dlp 2026.6.9 expects EJS 0.8.0 for the YouTube JS challenge solver.
#  - it also pins the curl-cffi extra to 0.15.0, which adds the newer Chrome
#    impersonation targets (chrome145/146). Staying on 0.14.0 would cap
#    --impersonate at the older chrome142 fingerprint.
# Keep all three bumped in lockstep with yt-dlp.
# Note: bgutil-ytdlp-pot-provider is coupled to the Node server under
# backend/bgutil-ytdlp-pot-provider/server — bump both in lockstep, not just here.
# Using --break-system-packages because we are in a container and want to install globally
RUN pip3 install --no-cache-dir \
    "yt-dlp==2026.6.9" \
    "bgutil-ytdlp-pot-provider==1.2.2" \
    "yt-dlp-ejs==0.8.0" \
    "curl-cffi==0.15.0" \
    --break-system-packages

ARG BUILD_DATE=unknown

# Environment variables
ENV NODE_ENV=production
ENV PORT=5551
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
ENV SKIP_PROVIDER_BUILD=1
ENV SKIP_FFMPEG_AUTO_INSTALL=1
ENV MYTUBE_BUILD_DATE=${BUILD_DATE}
ENV PUID=1000
ENV PGID=1000
ENV MYTUBE_AUTO_FIX_PERMISSIONS=1
# Debian chromium path
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install production dependencies only
COPY backend/package*.json ./
COPY backend/entrypoint.sh /usr/local/bin/mytube-entrypoint.sh
COPY backend/scripts ./scripts
COPY backend/vendor ./vendor
RUN chmod +x /usr/local/bin/mytube-entrypoint.sh \
    && npm ci --omit=dev

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist
# Copy frontend build
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
# Copy drizzle migrations
COPY --from=builder /app/drizzle ./drizzle
# Copy bgutil-ytdlp-pot-provider runtime pieces only: the built server, its
# production node_modules, and the yt-dlp plugin package. TS sources, dev
# dependencies, and repo metadata stay in the builder (tens of MB smaller).
# Runtime consumers: server/build/generate_once.js and plugin/yt_dlp_plugins
# (see ytdlpHelpers.ts).
COPY --from=builder /app/bgutil-ytdlp-pot-provider/server/build /app/bgutil-ytdlp-pot-provider/server/build
COPY --from=builder /app/bgutil-ytdlp-pot-provider/server/node_modules /app/bgutil-ytdlp-pot-provider/server/node_modules
COPY --from=builder /app/bgutil-ytdlp-pot-provider/server/package.json /app/bgutil-ytdlp-pot-provider/server/package.json
COPY --from=builder /app/bgutil-ytdlp-pot-provider/plugin /app/bgutil-ytdlp-pot-provider/plugin

# Create necessary directories
RUN mkdir -p \
    uploads/videos \
    uploads/images \
    uploads/images-small \
    uploads/subtitles \
    uploads/avatars \
    uploads/cloud-thumbnail-cache \
    data \
    && chown -R 1000:1000 uploads data

# The container starts as root only long enough for the entrypoint to reconcile
# bind-mount ownership. The backend process itself is then launched as PUID:PGID
# (default 1000:1000) via gosu.

EXPOSE 5551

# The entrypoint starts as root only to reconcile bind-mount ownership,
# then drops to PUID:PGID via gosu before executing CMD.
# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint
ENTRYPOINT ["/usr/local/bin/mytube-entrypoint.sh"]
# nosemgrep: dockerfile.security.missing-user.missing-user
CMD ["node", "dist/src/server.js"]
