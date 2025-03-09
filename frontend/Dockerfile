FROM node:21-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Create a production build with environment variables
ARG VITE_API_URL=http://192.168.1.105:5551/api
ARG VITE_BACKEND_URL=http://192.168.1.105:5551
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

RUN npm run build

# Production stage
FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5556
CMD ["nginx", "-g", "daemon off;"] 