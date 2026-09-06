FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . ./

ARG SUPABASE_URL
ARG SUPABASE_ANON_KEY
ARG AUTH_ALLOWED_REDIRECT_ORIGINS
ENV SUPABASE_URL=$SUPABASE_URL \
    SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY \
    AUTH_ALLOWED_REDIRECT_ORIGINS=$AUTH_ALLOWED_REDIRECT_ORIGINS

RUN pnpm build

FROM nginx:1.29-alpine

ENV AUTH_ALLOWED_FRAME_ANCESTORS="'none'"

COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
