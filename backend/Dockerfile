# Stage 1: Builder
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
# Install dependencies
COPY backend/package*.json ./
# Skip Puppeteer download during build as we only need to compile TS
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
# Install build dependencies for native modules (python3, make, g++)
RUN apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev libjpeg-turbo-dev giflib-dev librsvg-dev
RUN npm ci

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
FROM node:22-alpine

WORKDIR /app

# Install system dependencies
# chromium: for Puppeteer (saves ~300MB vs bundled)
# ffmpeg: for video processing
# python3: for yt-dlp
RUN apk add --no-cache \
    chromium \
    ffmpeg \
    python3 \
    py3-pip \
    curl \
    cairo \
    pango \
    libjpeg-turbo \
    giflib \
    librsvg && \
    ln -sf python3 /usr/bin/python



# Install cloudflared (Binary download)
ARG TARGETARCH
RUN curl -L --output /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${TARGETARCH:-amd64} && \
    chmod +x /usr/local/bin/cloudflared

# Install yt-dlp, bgutil-ytdlp-pot-provider, and yt-dlp-ejs for YouTube n challenge solving
RUN pip3 install yt-dlp bgutil-ytdlp-pot-provider yt-dlp-ejs --break-system-packages

# Environment variables
ENV NODE_ENV=production
ENV PORT=5551
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

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