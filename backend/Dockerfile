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

# Build bgutil-ytdlp-pot-provider
WORKDIR /app/bgutil-ytdlp-pot-provider/server
RUN CXXFLAGS="-include cstdint" npm install && npx tsc
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

# Install cloudflared (Binary download)
ARG TARGETARCH
RUN curl -L --retry 5 --retry-delay 2 --output /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${TARGETARCH:-amd64} && \
    chmod +x /usr/local/bin/cloudflared

# Install deno for yt-dlp --js-runtime support (pinned + checksum verified)
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
# Using --break-system-packages because we are in a container and want to install globally
RUN pip3 install --no-cache-dir \
    "yt-dlp==2026.2.21" \
    "bgutil-ytdlp-pot-provider==1.2.2" \
    "yt-dlp-ejs==0.5.0" \
    "curl-cffi==0.14.0" \
    --break-system-packages

# Environment variables
ENV NODE_ENV=production
ENV PORT=5551
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
ENV SKIP_PROVIDER_BUILD=1
ENV SKIP_FFMPEG_AUTO_INSTALL=1
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
    && npm ci --only=production

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist
# Copy frontend build
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
# Copy drizzle migrations
COPY --from=builder /app/drizzle ./drizzle
# Copy bgutil-ytdlp-pot-provider
COPY --from=builder /app/bgutil-ytdlp-pot-provider /app/bgutil-ytdlp-pot-provider

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

ENTRYPOINT ["/usr/local/bin/mytube-entrypoint.sh"]
CMD ["node", "dist/src/server.js"]
