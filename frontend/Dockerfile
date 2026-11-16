FROM node:24-alpine AS base
WORKDIR /app
ENV NODE_EXTRA_CA_CERTS=/tmp/Zscalar_root_CA.crt \
    npm_config_cafile=/tmp/Zscalar_root_CA.crt \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=certs Zscalar_root_CA.cer /tmp/Zscalar_root_CA.crt

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund

# Hot-reloading dev server: docker compose -f docker-compose.yml -f docker-compose.dev.yml up
FROM deps AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]

FROM deps AS build
# NEXT_PUBLIC_* values are inlined into the browser bundle, so they must be known at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NODE_ENV=production
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "server.js"]
