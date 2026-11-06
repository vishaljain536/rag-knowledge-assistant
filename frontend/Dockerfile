FROM node:24-alpine AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/index.html frontend/tsconfig.json frontend/vite.config.ts ./
COPY frontend/src ./src
COPY frontend/public ./public
COPY README.md CHANGELOG.md CODE_WALKTHROUGH.md DEPLOYMENT.md PROJECT_GUIDE.md /app/
ARG VITE_API_URL
ARG VITE_ENABLE_URL_INGESTION=false
RUN npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
