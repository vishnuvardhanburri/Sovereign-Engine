FROM node:22-bookworm-slim

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1 \
  PUPPETEER_SKIP_DOWNLOAD=true \
  PNPM_HOME=/pnpm \
  PATH=/pnpm:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@9.0.0 --activate

COPY . .

RUN pnpm install --frozen-lockfile

# Build with safe placeholder values. Runtime configuration is supplied by Compose/Kubernetes/EC2.
ENV NODE_ENV=production \
  DATABASE_URL=postgresql://postgres:password@postgres:5432/xavira_orbit?sslmode=disable \
  REDIS_URL=redis://redis:6379 \
  APP_DOMAIN=localhost:3000 \
  APP_PROTOCOL=http \
  SMTP_HOST=mock.local \
  SMTP_PORT=587 \
  SMTP_USER=mock@localhost \
  SMTP_PASS=mock \
  SMTP_SECURE=false \
  ZEROBOUNCE_API_KEY=mock \
  SECURITY_KILL_SWITCH_TOKEN=build-only \
  REPUTATION_PUBLIC_API_KEY= \
  ADAPTIVE_REDIS_PEERS= \
  INVESTOR_LEAD_VALUE_USD=1 \
  COST_PER_SEND=0.002 \
  MOCK_SMTP=true

RUN pnpm -C apps/api-gateway build

EXPOSE 3000

CMD ["pnpm", "-C", "apps/api-gateway", "start", "-p", "3000"]
