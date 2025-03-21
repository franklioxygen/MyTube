FROM node:21-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Set default build-time arguments that can be overridden during build
ARG VITE_API_URL=http://localhost:5551/api
ARG VITE_BACKEND_URL=http://localhost:5551
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

RUN npm run build

# Production stage
FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5556

# Add a script to replace environment variables at runtime
RUN apk add --no-cache bash
COPY ./entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"] 