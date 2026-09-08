# Printerly Node

Printerly Node turns a low-spec Linux computer beside a USB/LAN printer into an always-online Ledgerly print appliance. It uses outbound HTTPS only, so the school does not expose CUPS, the printer, or router ports to the internet.

## Appliance stack

- Debian/Ubuntu minimal Linux
- CUPS and the correct printer driver
- Node.js 20+
- `printerly-node` agent
- systemd auto-start/restart
- private local state under `/var/lib/printerly`
- read-only appliance configuration under `/etc/printerly`

## Install

From a checked-out Ledgerly repository:

```bash
sudo ./printerly-node/install.sh
sudo nano /etc/printerly/config.json
```

Set `ledgerlyBaseUrl` to the public Ledgerly installation, for example:

```json
{
  "ledgerlyBaseUrl": "https://ledgerly.example.com",
  "pollIntervalMs": 3000,
  "heartbeatIntervalMs": 15000,
  "cupsStatusIntervalMs": 3000,
  "printCompletionTimeoutMs": 1800000,
  "workDir": "/var/lib/printerly/jobs"
}
```

The installer deliberately keeps `/etc/printerly/config.json` read-only to the service and gives the `printerly` service account write access only to `/var/lib/printerly`.

## Pairing

1. In Ledgerly open **Printerly → Pair node** and generate the six-digit code.
2. On the appliance run:

```bash
sudo printerly-pair 684921
sudo systemctl enable --now printerly-node
```

3. Verify:

```bash
sudo systemctl status printerly-node
journalctl -u printerly-node -f
lpstat -p
```

The pairing code is exchanged once for a long random machine token. The token is stored in `/var/lib/printerly/state.json` with owner-only permissions; the six-digit code is never stored in the long-lived appliance configuration.

## Secure document flow

Users upload printable documents to Ledgerly. The backend stores them in the existing private `WORK_FILES_BUCKET`; the browser never gives the Node a public document URL.

A Node can download a document only when all of these match:

- authenticated machine token
- organization
- node ID
- print job ID
- current job claim token

The Node verifies the document SHA-256 before handing it to CUPS.

## Print lifecycle

```text
queued / held
    ↓
claimed
    ↓
downloading
    ↓
spooling
    ↓
printing
    ↓
completed / failed
```

`lp` returning successfully means CUPS accepted a job; it does **not** mean the printer finished. Printerly therefore records the CUPS request ID and polls CUPS until completion before reporting the Ledgerly job as completed.

## Duplicate protection

Printerly favors **never printing twice automatically** over blindly retrying an uncertain job.

- Cloud jobs are atomically claimed with a random claim token.
- Only `claimed` and `downloading` jobs can be recovered automatically after an expired lease.
- Once spooling may have started, the job is never returned to the cloud queue automatically.
- The appliance persists its active job before submitting to CUPS.
- If the computer restarts after CUPS may have received the job but before Printerly recorded the CUPS request ID, the cloud job is marked failed with an explicit manual-verification message rather than being printed again.
- If the CUPS request ID was persisted, Printerly resumes watching that exact CUPS job after restart.

This is intentional for high-volume jobs such as examinations, report cards, receipts and payroll where an automatic duplicate can waste hundreds of sheets.

## Supported upload formats

The first hardened node accepts PDF, PNG, JPEG and plain text. PDF is recommended because it gives the most predictable page layout across printer models. Convert Word/Excel documents to PDF before submitting them.

## Useful operations

```bash
# Restart the appliance agent
sudo systemctl restart printerly-node

# Watch logs
journalctl -u printerly-node -f

# See configured printers
lpstat -p

# See CUPS jobs
lpstat -o
```
