FROM node:21-alpine

WORKDIR /app

# Install Python and other dependencies needed for youtube-dl-exec
RUN apk add --no-cache python3 ffmpeg py3-pip && \
    ln -sf python3 /usr/bin/python

COPY package*.json ./
# Skip Python check as we've already installed it
ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1
RUN npm install

COPY . .

# Build TypeScript code
RUN npm run build

# Set environment variables
ENV PORT=5551

# Create necessary directories
RUN mkdir -p uploads/videos uploads/images data

EXPOSE 5551

CMD ["node", "dist/server.js"] 