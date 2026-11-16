#!/usr/bin/env bash
set -euo pipefail

CERT_SOURCE="/home/debashish/Zscalar_root_CA.cer"
CERT_DEST="/usr/local/share/ca-certificates/Zscalar_root_CA.crt"

if [[ ! -f "$CERT_SOURCE" ]]; then
  echo "Certificate not found: $CERT_SOURCE" >&2
  exit 1
fi

if command -v sudo >/dev/null 2>&1; then
  sudo install -m 0644 "$CERT_SOURCE" "$CERT_DEST"
  sudo update-ca-certificates
else
  install -m 0644 "$CERT_SOURCE" "$CERT_DEST"
  update-ca-certificates
fi

printf 'Zscaler root certificate trusted.\n'
