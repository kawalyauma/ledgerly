#!/bin/sh
set -eu
if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo: sudo ./printerly-node/install.sh" >&2; exit 1; fi
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
apt-get update
apt-get install -y cups cups-client cups-ipp-utils sane-utils img2pdf imagemagick ca-certificates
command -v node >/dev/null 2>&1 || { echo "Node.js 20+ is required." >&2; exit 1; }
NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])"); [ "$NODE_MAJOR" -ge 20 ] || { echo "Node.js 20+ is required; found $(node --version)." >&2; exit 1; }
getent group printerly >/dev/null 2>&1 || groupadd --system printerly
id printerly >/dev/null 2>&1 || useradd --system --gid printerly --home-dir /var/lib/printerly --shell /usr/sbin/nologin printerly
usermod -a -G lp printerly
getent group scanner >/dev/null 2>&1 || groupadd --system scanner
usermod -a -G scanner printerly
install -d -o root -g printerly -m 0750 /etc/printerly
install -d -o printerly -g printerly -m 0750 /var/lib/printerly /var/lib/printerly/jobs /var/lib/printerly/scans
install -d -o root -g root -m 0755 /opt/printerly/src
for f in agent.mjs lib.mjs pair.mjs release-station.mjs; do install -o root -g root -m 0644 "$SCRIPT_DIR/src/$f" "/opt/printerly/src/$f"; done
install -o root -g root -m 0644 "$SCRIPT_DIR/systemd/printerly-node.service" /etc/systemd/system/printerly-node.service
install -o root -g root -m 0644 "$SCRIPT_DIR/systemd/printerly-release-station.service" /etc/systemd/system/printerly-release-station.service
if [ ! -f /etc/printerly/config.json ]; then install -o root -g printerly -m 0640 "$SCRIPT_DIR/config.example.json" /etc/printerly/config.json; else chown root:printerly /etc/printerly/config.json; chmod 0640 /etc/printerly/config.json; fi
cat >/usr/local/bin/printerly-pair <<'WRAPPER'
#!/bin/sh
set -eu
if [ "$(id -u)" -ne 0 ]; then exec sudo "$0" "$@"; fi
exec runuser -u printerly -- env PRINTERLY_CONFIG=/etc/printerly/config.json PRINTERLY_STATE_DIR=/var/lib/printerly /usr/bin/node /opt/printerly/src/pair.mjs "$@"
WRAPPER
chmod 0755 /usr/local/bin/printerly-pair
systemctl daemon-reload
systemctl enable cups
echo "Printerly v1.9 installed. Edit /etc/printerly/config.json, pair with 'sudo printerly-pair 123456', then start with:"
echo "  sudo systemctl enable --now printerly-node printerly-release-station"
echo "Secure Release defaults to http://127.0.0.1:8791 on this Node. Set releaseStationHost to 0.0.0.0 only on a trusted LAN if a separate kiosk must connect."
echo "Detected printers:"; lpstat -p 2>/dev/null || true
echo "Detected scanners:"; scanimage -L 2>/dev/null || true
