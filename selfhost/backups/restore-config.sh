#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
[[ $# -eq 1 ]] || die "usage: restore-config.sh CONFIG_BACKUP.tar.gz"
ARCHIVE="$1"; [[ -s "$ARCHIVE" ]] || die "config backup not found or empty"
require_cmd tar; require_cmd sha256sum
[[ -f "$ARCHIVE.sha256" ]] || die "checksum file is required"
( cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256" >/dev/null )
if tar -tzf "$ARCHIVE" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then die "archive contains unsafe traversal path"; fi
DEST="${LEDGERLY_CONFIG_RESTORE_STAGING:-/var/lib/ledgerly/restore-staging/config-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$DEST"; chmod 0700 "$DEST"
tar -xzf "$ARCHIVE" -C "$DEST"
if find "$DEST" -type f \( -name '.env.selfhost' -o -name '*.pem' -o -name '*.key' -o -iname '*credential*' -o -iname '*secret*' \) | grep -q .; then
  rm -rf "$DEST"; die "restored config staging unexpectedly contains secret-like files"
fi
printf '{"status":"staged","path":"%s","note":"diff and promote explicitly; live configuration was not overwritten"}\n' "$DEST"
