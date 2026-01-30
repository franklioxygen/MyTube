# Stage 1: Builder
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install dependencies
COPY backend/package*.json ./
# Skip Puppeteer download during build as we only need to compile TS
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
ENV SKIP_PROVIDER_BUILD=1

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

# Copy frontend source for building
COPY frontend/ /app/frontend/

# Build frontend
WORKDIR /app/frontend
# Install frontend dependencies
RUN npm ci
# Build frontend with relative paths
ENV VITE_API_URL=/api
ENV VITE_BACKEND_URL=
RUN npm run build
WORKDIR /app

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

# Install yt-dlp, bgutil-ytdlp-pot-provider, and yt-dlp-ejs for YouTube n challenge solving
# Using --break-system-packages because we are in a container and want to install globally
RUN pip3 install yt-dlp bgutil-ytdlp-pot-provider yt-dlp-ejs curl-cffi --break-system-packages

# Environment variables
ENV NODE_ENV=production
ENV PORT=5551
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
ENV SKIP_PROVIDER_BUILD=1
# Debian chromium path
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install production dependencies only
COPY backend/package*.json ./
RUN npm ci --only=production

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist
# Copy frontend build
COPY --from=builder /app/frontend/dist ./frontend/dist
# Copy drizzle migrations
COPY --from=builder /app/drizzle ./drizzle
# Copy bgutil-ytdlp-pot-provider
COPY --from=builder /app/bgutil-ytdlp-pot-provider /app/bgutil-ytdlp-pot-provider

# Create necessary directories
RUN mkdir -p uploads/videos uploads/images uploads/subtitles data

EXPOSE 5551

CMD ["node", "dist/src/server.js"]