FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV N8N_USER_FOLDER=/data
ENV N8N_HOST=0.0.0.0
ENV N8N_PORT=5678
ENV GENERIC_TIMEZONE=America/Toronto

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY workflows ./workflows
COPY scripts ./scripts
COPY .env.example ./.env.example

RUN mkdir -p /data && chown -R node:node /app /data

USER node

EXPOSE 5678

CMD ["npm", "run", "start:hosted"]
