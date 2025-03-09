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

# Set environment variables
ENV PORT=5551

# Create uploads directory
RUN mkdir -p uploads
RUN mkdir -p data

EXPOSE 5551

CMD ["node", "server.js"] 