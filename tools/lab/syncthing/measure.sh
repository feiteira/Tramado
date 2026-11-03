#!/bin/bash
# measure.sh SRC DST RELPATH MODE(watch|scan) [size_bytes]
# Writes RELPATH in SRC's folder copy, waits until it appears (complete) in DST's copy. Prints latency ms.
. /tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/syncthing/lib.sh
S=$1; D=$2; REL=$3; MODE=$4; SIZE=${5:-0}; FID=$(cat $RUN/folder.id)
SP=$(api $S GET /rest/config/folders/$FID | jq -r .path); DP=$(api $D GET /rest/config/folders/$FID | jq -r .path)
mkdir -p "$(dirname "$SP/$REL")"
if [ "$SIZE" -gt 0 ]; then head -c $SIZE /dev/urandom > $RUN/payload.bin; SUM=$(sha256sum < $RUN/payload.bin | cut -c1-64); fi
T0=$(now_ms)
if [ "$SIZE" -gt 0 ]; then cp $RUN/payload.bin "$SP/$REL"; else echo "{\"t\":$T0,\"from\":\"$S\"}" > "$SP/$REL"; fi
[ "$MODE" = scan ] && api $S POST "/rest/db/scan?folder=$FID&sub=$(dirname "$REL" | jq -sRr @uri | sed 's/%0A$//')" >/dev/null
T1=$(now_ms)
while [ ! -f "$DP/$REL" ]; do sleep 0.01; [ $(( $(now_ms)-T0 )) -gt 120000 ] && { echo TIMEOUT; exit 1; }; done
T2=$(now_ms)
if [ "$SIZE" -gt 0 ]; then DS=$(sha256sum < "$DP/$REL" | cut -c1-64); [ "$DS" = "$SUM" ] && ok=hash-ok || ok=HASH-MISMATCH; else ok=$(cat "$DP/$REL"); fi
echo "$S->$D $MODE $REL size=$SIZE: write->visible $(( T2-T0 )) ms (scan call $(( T1-T0 )) ms) $ok"
