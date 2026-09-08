# Printerly Node

Printerly Node turns a low-spec Linux computer beside a USB/LAN printer into an always-online Ledgerly print appliance. It uses outbound HTTPS only, so the school does not expose CUPS, the printer, or router ports to the internet.

## Appliance stack

- Debian/Ubuntu minimal Linux
- CUPS and the correct printer driver
- Node.js 20+
- `printerly-node` agent
- systemd auto-start/restart
- local job working directory

## Pairing

1. In Ledgerly open **Printerly → Pair node** and generate the six-digit code.
2. Copy `config.example.json` to `/etc/printerly/config.json` and enter Ledgerly's public base URL and the pairing code.
3. Start the service. The code is exchanged once for a long machine token and is not reused.
4. The node discovers CUPS printers with `lpstat` and reports them to Ledgerly.

## Install outline

```bash
sudo apt update
sudo apt install -y cups nodejs
sudo useradd --system --home /var/lib/printerly --shell /usr/sbin/nologin printerly || true
sudo usermod -a -G lp printerly
sudo mkdir -p /opt/printerly /etc/printerly /var/lib/printerly/jobs
sudo cp -r printerly-node/src /opt/printerly/
sudo cp printerly-node/config.example.json /etc/printerly/config.json
sudo cp printerly-node/systemd/printerly-node.service /etc/systemd/system/
sudo chown -R printerly:lp /etc/printerly /var/lib/printerly
sudo systemctl daemon-reload
sudo systemctl enable --now printerly-node
```

The agent polls the secure cloud queue, downloads the assigned document, submits it through `lp`, reports lifecycle states, removes its temporary file, and then waits for the next job.

## Idempotency

A job is atomically claimed in D1 using a unique claim token before download. Node status updates must include that token. Reconnects cannot simply re-run a completed job; the cloud queue only offers jobs still in `queued` state.
