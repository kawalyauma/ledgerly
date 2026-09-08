# Printerly Node v1.2

Printerly Node turns a small Linux computer beside a printer/scanner into a secure Ledgerly print-and-scan appliance. It initiates outbound HTTPS only; CUPS, SANE and the school's LAN are never exposed publicly.

## What v1.2 adds

- CUPS printer health and fault telemetry.
- Actual/estimated print usage for Printerly cost accounting.
- SANE scanner discovery and Scannerly jobs.
- Flatbed and ADF scanning to PDF/PNG/JPEG.
- Crash-safe print and scan recovery designed to avoid duplicate output/capture.
- Secure claim-bound document download and scan upload.

## Install

```bash
sudo ./printerly-node/install.sh
sudo nano /etc/printerly/config.json
```

Set `ledgerlyBaseUrl`, then generate a pairing code from **Ledgerly → Printerly → Pair node** and run:

```bash
sudo printerly-pair 123456
sudo systemctl enable --now printerly-node
```

Verify devices:

```bash
lpstat -p
scanimage -L
systemctl status printerly-node
journalctl -u printerly-node -f
```

## Safety model

Printerly prioritizes avoiding duplicate output. A print job that might already have reached CUPS is not automatically reprinted after a crash. Scannerly follows the same rule: a scan interrupted after physical capture begins is marked for manual retry instead of automatically rescanning confidential pages.

The machine token and active-job recovery state are stored under `/var/lib/printerly` with restricted permissions. Configuration under `/etc/printerly` is read-only to the service.
