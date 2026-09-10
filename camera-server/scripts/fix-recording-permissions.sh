#!/usr/bin/env bash
set -euo pipefail

storage_root="${CAMERA_STORAGE_ROOT:-/var/lib/ledgerly-camera/recordings}"
service_user="${CAMERA_SERVICE_USER:-ledgerly-camera}"
service_group="${CAMERA_SERVICE_GROUP:-ledgerly-camera}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this repair with sudo." >&2
  exit 1
fi

getent passwd "${service_user}" >/dev/null
getent group "${service_group}" >/dev/null
command -v setfacl >/dev/null

install -d -o "${service_user}" -g "${service_group}" -m 0770 "${storage_root}"

# MediaMTX runs in a root-owned container and can create per-camera folders.
# Give the control daemon access to existing folders and make that access
# inheritable for every camera folder MediaMTX creates later.
setfacl -R -m "u:${service_user}:rwx,m::rwx" "${storage_root}"
setfacl -m \
  "d:u::rwx,d:u:${service_user}:rwx,d:g::r-x,d:m::rwx,d:o::r-x" \
  "${storage_root}"

while IFS= read -r -d '' directory; do
  setfacl -m "d:u::rwx,d:u:${service_user}:rwx,d:g::r-x,d:m::rwx,d:o::r-x" "${directory}"
done < <(find "${storage_root}" -type d -print0)

probe="${storage_root}/.ledgerly-write-test"
sudo -u "${service_user}" sh -c 'umask 077; : > "$1"; rm -f "$1"' sh "${probe}"

echo "Ledgerly recording permissions repaired: ${storage_root}"
