FROM alpine:3.22

RUN apk add --no-cache pgbouncer postgresql17-client

COPY entrypoint.sh /usr/local/bin/ledgerly-pgbouncer-entrypoint
RUN chmod 0755 /usr/local/bin/ledgerly-pgbouncer-entrypoint

EXPOSE 6432
ENTRYPOINT ["/usr/local/bin/ledgerly-pgbouncer-entrypoint"]
