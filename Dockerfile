FROM node:20-slim AS builder

WORKDIR /app

# Install OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Skip postinstall (which tries to generate SQLite client) and install deps
RUN npm install --legacy-peer-deps --ignore-scripts

COPY . .

# Generate only Postgres Prisma client
RUN npx prisma generate --schema prisma/schema.prisma

# Build Next.js (standalone output)
RUN npm run build

# ---- Runtime ----
FROM node:20-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
