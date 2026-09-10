FROM node:20-alpine

WORKDIR /app

COPY package.json ./package.json
COPY src ./src

RUN mkdir -p /var/lib/ledgerly/storage \
  && chown -R node:node /app /var/lib/ledgerly

USER node

ENV LEDGERLY_API_HOST=0.0.0.0 \
    LEDGERLY_API_PORT=8788 \
    LEDGERLY_STORAGE_PATH=/var/lib/ledgerly/storage

EXPOSE 8788

CMD ["node", "src/index.mjs"]
