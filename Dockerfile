FROM node:20-slim AS builder

WORKDIR /app

# Install system deps: OpenSSL for Prisma, build tools for better-sqlite3
RUN apt-get update && apt-get install -y openssl python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Install deps - skip postinstall (tries dual Prisma generate before schemas are available)
# Then rebuild native modules (better-sqlite3 needs compilation)
RUN npm install --legacy-peer-deps --ignore-scripts && \
    npm rebuild better-sqlite3 --ignore-scripts=false

# Cache bust 2026-04-12-v5 - Frame.io animations, blobs, gradient cards
COPY . .

# Generate both Prisma clients (sqlite client needed at compile time for type imports)
RUN npx prisma generate --schema prisma/schema.prisma
RUN npx prisma generate --schema prisma/schema.sqlite.prisma

# Build Next.js (standalone output)
RUN npm run build

# ---- Runtime ----
FROM node:20-slim AS runner

WORKDIR /app

# Install OpenSSL (for Prisma) + ALL Chrome/Chromium shared library
# dependencies so the browser ordering agent can launch headless Chrome.
RUN apt-get update && apt-get install -y \
  openssl \
  libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 \
  libgbm1 libgtk-3-0 libasound2 libxshmfence1 \
  libx11-xcb1 fonts-liberation libpango-1.0-0 \
  libcairo2 libcups2 libdbus-1-3 libexpat1 \
  libfontconfig1 libgcc-s1 libglib2.0-0 libnspr4 \
  libpangocairo-1.0-0 libstdc++6 libxcb1 libxcomposite1 \
  libxdamage1 libxext6 libxfixes3 libxrandr2 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
