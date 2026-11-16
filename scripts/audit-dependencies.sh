#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
runtime_image=${1:?Usage: scripts/audit-dependencies.sh RUNTIME_IMAGE TEST_IMAGE}
test_image=${2:?Usage: scripts/audit-dependencies.sh RUNTIME_IMAGE TEST_IMAGE}

audit_dir=$(mktemp -d)
trap 'rm -rf "$audit_dir"' EXIT

npm --prefix frontend audit
npm --prefix frontend audit --omit=dev

# Inspect the built artifacts, not a fresh dependency resolution.
docker run --rm "$runtime_image" python -c 'import importlib.util; assert not any(importlib.util.find_spec(name) for name in ("pytest", "pypdf", "httpx", "jwt", "passlib", "multipart")), "Test or unused packages found in runtime image"'
docker run --rm "$test_image" python -c 'import pytest, pypdf'
docker run --rm "$runtime_image" pip check
docker run --rm "$test_image" pip check
docker run --rm "$runtime_image" pip freeze --all > "$audit_dir/runtime.txt"
docker run --rm "$test_image" pip freeze --all > "$audit_dir/test.txt"

# A separate tool environment prevents the audit installation from upgrading
# application dependencies before they are checked.
docker run --rm -v "$audit_dir:/audit:ro" python:3.12-slim sh -c '
  python -m venv /opt/audit
  /opt/audit/bin/pip install --quiet pip-audit==2.10.1
  /opt/audit/bin/pip-audit -r /audit/runtime.txt --no-deps --disable-pip
  /opt/audit/bin/pip-audit -r /audit/test.txt --no-deps --disable-pip
'
