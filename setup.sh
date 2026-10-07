#!/bin/sh
# All runtime assets are pinned, verified, and replaced atomically.
set -eu
cd "$(dirname "$0")"
mkdir -p lib
if command -v sha256sum >/dev/null 2>&1; then
    checksum() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
    checksum() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
    echo 'Error: sha256sum or shasum is required.' >&2
    exit 1
fi
asset_tmp=''
trap 'if [ -n "$asset_tmp" ]; then rm -f "$asset_tmp"; fi' EXIT HUP INT TERM
fetch() {
    asset_name=$1
    asset_url=$2
    asset_hash=$3
    if [ -f "lib/$asset_name" ] && [ "$(checksum "lib/$asset_name")" = "$asset_hash" ]; then
        echo "$asset_name verified."
        return
    fi
    asset_tmp=$(mktemp "lib/.download.XXXXXX")
    if command -v curl >/dev/null 2>&1; then
        curl --fail --location --retry 2 --connect-timeout 15 --max-time 120 --output "$asset_tmp" "$asset_url"
    elif command -v wget >/dev/null 2>&1; then
        wget --timeout=30 --tries=3 -O "$asset_tmp" "$asset_url"
    else
        echo 'Error: curl or wget is required.' >&2
        exit 1
    fi
    if [ "$(checksum "$asset_tmp")" != "$asset_hash" ]; then
        echo "Error: checksum mismatch for $asset_name" >&2
        exit 1
    fi
    chmod 644 "$asset_tmp"
    mv "$asset_tmp" "lib/$asset_name"
    asset_tmp=''
}
fetch jszip.min.js https://unpkg.com/jszip@3.10.1/dist/jszip.min.js acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e
fetch gridjs.umd.js https://unpkg.com/gridjs@6.2.0/dist/gridjs.umd.js f7402f347715568c73f061781edd8e7dceeecdd7e2503c28a1012b7ccbc12509
fetch gridjs-mermaid.min.css https://unpkg.com/gridjs@6.2.0/dist/theme/mermaid.min.css ab9585e3983a57267a8f22f708fe40ad70f8c1bd5688ebfba31d11a0c7cca331
echo 'Setup complete. Runtime works offline.'
