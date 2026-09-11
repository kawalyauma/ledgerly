FROM node:20-alpine

WORKDIR /app

# Local/offline AI knowledge ingestion extracts PDFs without a remote document service.
RUN apk add --no-cache poppler-utils

COPY package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

RUN mkdir -p /var/lib/ledgerly/storage \
  && chown -R node:node /app /var/lib/ledgerly

USER node

ENV LEDGERLY_API_HOST=0.0.0.0 \
    LEDGERLY_API_PORT=8788 \
    LEDGERLY_STORAGE_PATH=/var/lib/ledgerly/storage

EXPOSE 8788

CMD ["node", "src/index.mjs"]
