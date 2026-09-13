#!/bin/sh
# Rebuilds the password-protected test archives from src/ with bsdtar
# (libarchive) — an encoder independent of the app's own reader, which is the
# point: tools/test-parsers.mjs checks that js/app.js opens what a real
# WinZip-AES writer produces. Everything in src/ is invented: fourteen days of
# steps and sixty Pokéstop spins around 0°N 0°E. Run from anywhere:
#   sh pogo-metrics/tools/fixtures/make-fixtures.sh
# The password is synthetic and deliberately public (tools/test-parsers.mjs uses it too).
set -e
PW="pogo-metrics-fixture"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$HERE"
rm -f aes256.zip aes128-stored.zip zipcrypto.zip
# The export's shape: a plain Player_Journey.zip inside a locked download.
bsdtar -a -cf "$TMP/Player_Journey.zip" -C src Player_Journey/Pokestop_spin1.csv
bsdtar -a -cf aes256.zip --options zip:encryption=aes256 --passphrase "$PW" -C "$TMP" Player_Journey.zip -C "$HERE/src" FitnessData.tsv
# AES-128 over a stored (uncompressed) entry, and the older ZipCrypto scheme.
bsdtar -a -cf aes128-stored.zip --options zip:compression=store,zip:encryption=aes128 --passphrase "$PW" -C src FitnessData.tsv
bsdtar -a -cf zipcrypto.zip --options zip:encryption=zipcrypt --passphrase "$PW" -C src FitnessData.tsv
ls -l aes256.zip aes128-stored.zip zipcrypto.zip
