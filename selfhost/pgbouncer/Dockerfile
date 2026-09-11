ARG PGBOUNCER_BASE_IMAGE=alpine:3.22
FROM ${PGBOUNCER_BASE_IMAGE}

RUN apk add --no-cache pgbouncer postgresql17-client \
  && addgroup -S ledgerly \
  && adduser -S -D -H -G ledgerly ledgerly \
  && mkdir -p /etc/pgbouncer \
  && chown -R ledgerly:ledgerly /etc/pgbouncer

COPY entrypoint.sh /usr/local/bin/ledgerly-pgbouncer-entrypoint
RUN chmod 0755 /usr/local/bin/ledgerly-pgbouncer-entrypoint

USER ledgerly
EXPOSE 6432
ENTRYPOINT ["/usr/local/bin/ledgerly-pgbouncer-entrypoint"]
