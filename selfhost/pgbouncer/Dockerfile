ARG PGBOUNCER_BASE_IMAGE=alpine:3.22
FROM ${PGBOUNCER_BASE_IMAGE}

RUN apk add --no-cache pgbouncer postgresql17-client

COPY entrypoint.sh /usr/local/bin/ledgerly-pgbouncer-entrypoint
RUN chmod 0755 /usr/local/bin/ledgerly-pgbouncer-entrypoint

EXPOSE 6432
ENTRYPOINT ["/usr/local/bin/ledgerly-pgbouncer-entrypoint"]
