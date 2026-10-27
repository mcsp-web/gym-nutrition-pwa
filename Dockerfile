# For self-hosting on Coolify (Launchpad VPS). Vercel ignores this file.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Build-time env (Vite inlines VITE_* at build). Set these as build args in Coolify.
ARG VITE_DATA_MODE=mock
ARG VITE_SUPABASE_URL=
ARG VITE_SUPABASE_ANON_KEY=
ENV VITE_DATA_MODE=$VITE_DATA_MODE VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
