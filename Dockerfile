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

# Pre-bake Chrome for Testing (Stable channel) into the image so the
# browser-ordering agent + product-metadata puppeteer fallback never
# hit a runtime download failure. Previously we downloaded at first-
# use into /tmp/.chrome-cache, which wiped on container restart and
# occasionally failed mid-download. This moves the download to build
# time (reliable network, proper error propagation) and puts the
# binary in /opt/chrome which survives container lifetime.
RUN apt-get update && apt-get install -y wget unzip && \
    CHROME_JSON=$(wget -qO- https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json) && \
    CHROME_URL=$(echo "$CHROME_JSON" | grep -oE '"url":\s*"[^"]+linux64/chrome-linux64.zip"' | head -1 | sed -E 's/.*"(https:[^"]+)".*/\1/') && \
    echo "Downloading Chrome from: $CHROME_URL" && \
    wget -qO /tmp/chrome.zip "$CHROME_URL" && \
    unzip -q /tmp/chrome.zip -d /opt && \
    mv /opt/chrome-linux64 /opt/chrome && \
    chmod -R 755 /opt/chrome && \
    rm /tmp/chrome.zip && \
    /opt/chrome/chrome --version && \
    apt-get remove -y wget unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Point puppeteer-core at the baked binary. chrome-launcher.ts
# respects this env var first.
ENV PUPPETEER_EXECUTABLE_PATH=/opt/chrome/chrome

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
