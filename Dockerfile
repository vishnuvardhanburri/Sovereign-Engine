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
  PUBLIC_REPUTATION_FREE_DAILY_LIMIT=10 \
  PUBLIC_REPUTATION_PRO_DAILY_LIMIT=1000 \
  PUBLIC_REPUTATION_ENTERPRISE_DAILY_LIMIT=100000 \
  PUBLIC_REPUTATION_BLACKLIST_CACHE_SEC=21600 \
  ADAPTIVE_REDIS_PEERS= \
  INVESTOR_LEAD_VALUE_USD=0.5 \
  COST_PER_SEND=0.002 \
  CONTENT_MUTATION_ENABLED=false \
  CONTENT_MUTATION_ENDPOINT=http://ollama:11434/api/generate \
  CONTENT_MUTATION_MODEL=llama3:8b \
  CONTENT_MUTATION_POOL_SIZE=500 \
  CONTENT_MUTATION_FILL_PER_LOCK=500 \
  CONTENT_MUTATION_TIMEOUT_MS=12000 \
  CONTENT_MUTATION_POOL_TTL_SEC=86400 \
  MOCK_SMTP=true

RUN pnpm -C apps/api-gateway build

EXPOSE 3000

CMD ["pnpm", "-C", "apps/api-gateway", "start", "-p", "3000"]
