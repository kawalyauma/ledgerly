#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer with sudo: sudo ./printerly-node/install.sh" >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

apt-get update
apt-get install -y cups ca-certificates

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install Node.js 20 or newer, then rerun this installer." >&2
  exit 1
fi
NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20+ is required; found $(node --version)." >&2
  exit 1
fi

getent group printerly >/dev/null 2>&1 || groupadd --system printerly
if ! id printerly >/dev/null 2>&1; then
  useradd --system --gid printerly --home-dir /var/lib/printerly --shell /usr/sbin/nologin printerly
fi
usermod -a -G lp printerly

install -d -o root -g printerly -m 0750 /etc/printerly
install -d -o printerly -g printerly -m 0750 /var/lib/printerly /var/lib/printerly/jobs
install -d -o root -g root -m 0755 /opt/printerly/src

install -o root -g root -m 0644 "$SCRIPT_DIR/src/agent.mjs" /opt/printerly/src/agent.mjs
install -o root -g root -m 0644 "$SCRIPT_DIR/src/lib.mjs" /opt/printerly/src/lib.mjs
install -o root -g root -m 0644 "$SCRIPT_DIR/src/pair.mjs" /opt/printerly/src/pair.mjs
install -o root -g root -m 0644 "$SCRIPT_DIR/systemd/printerly-node.service" /etc/systemd/system/printerly-node.service

if [ ! -f /etc/printerly/config.json ]; then
  install -o root -g printerly -m 0640 "$SCRIPT_DIR/config.example.json" /etc/printerly/config.json
  echo
  echo "Created /etc/printerly/config.json."
  echo "Edit ledgerlyBaseUrl before pairing:"
  echo "  sudo nano /etc/printerly/config.json"
else
  chown root:printerly /etc/printerly/config.json
  chmod 0640 /etc/printerly/config.json
fi

cat >/usr/local/bin/printerly-pair <<'EOF'
#!/bin/sh
set -eu
if [ "$(id -u)" -ne 0 ]; then
  exec sudo "$0" "$@"
fi
exec runuser -u printerly -- env \
  PRINTERLY_CONFIG=/etc/printerly/config.json \
  PRINTERLY_STATE_DIR=/var/lib/printerly \
  /usr/bin/node /opt/printerly/src/pair.mjs "$@"
EOF
chmod 0755 /usr/local/bin/printerly-pair

systemctl daemon-reload
systemctl enable cups

echo
echo "Printerly Node installed."
echo "1. Set ledgerlyBaseUrl in /etc/printerly/config.json"
echo "2. Generate a pairing code in Ledgerly -> Printerly -> Pair node"
echo "3. Run: sudo printerly-pair 123456"
echo "4. Run: sudo systemctl enable --now printerly-node"
echo "5. Check: sudo systemctl status printerly-node"
