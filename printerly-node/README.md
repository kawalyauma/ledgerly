# Printerly Node v1.9

Printerly Node turns a small Linux computer beside a printer/scanner into a secure Ledgerly print-and-scan appliance. It initiates outbound HTTPS only; CUPS, SANE and the school's printer network are never exposed publicly.

## Capabilities

- Remote CUPS printing with checksum verification and duplicate-output protection.
- CUPS health, usage telemetry, Printer Pools and smart routing.
- SANE Scannerly discovery and flatbed/ADF capture.
- Crash-safe print and scan recovery.
- **Secure Release Station** for confidential output using single-use PIN or QR credentials.

## Install

```bash
sudo ./printerly-node/install.sh
sudo nano /etc/printerly/config.json
```

Set `ledgerlyBaseUrl`, then generate a pairing code from **Ledgerly → Printerly → Pair node** and run:

```bash
sudo printerly-pair 123456
sudo systemctl enable --now printerly-node printerly-release-station
```

Verify:

```bash
lpstat -p
scanimage -L
systemctl status printerly-node printerly-release-station
journalctl -u printerly-node -f
journalctl -u printerly-release-station -f
```

## Secure Release Station

The release portal defaults to `http://127.0.0.1:8791`, which means it is accessible only on the Printerly computer itself. This is the recommended setup when the old PC has a small monitor/touchscreen or keyboard beside the printer.

For a separate kiosk/tablet on a trusted school LAN, set:

```json
{
  "releaseStationHost": "0.0.0.0",
  "releaseStationPort": 8791
}
```

Then open `http://<printerly-node-lan-ip>:8791`. Do not port-forward this service to the internet. Use a private/VLAN network or a local TLS reverse proxy if the LAN is not trusted.

The browser never receives the Printerly machine token. The portal sends the entered PIN/QR value to its local service, and the service redeems it through the paired Node's outbound authenticated Ledgerly connection. Ledgerly stores only SHA-256 credential digests, limits failed attempts, and releases a job only to a printer physically attached to the redeeming Node.

## Safety model

Printerly prioritizes avoiding duplicate output. A print job that might already have reached CUPS is not automatically reprinted after a crash. Scannerly follows the same rule for physical scans.

The machine token and active-job recovery state are stored under `/var/lib/printerly` with restricted permissions. Configuration under `/etc/printerly` is read-only to both services.
