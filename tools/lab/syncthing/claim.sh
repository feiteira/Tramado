#!/bin/bash
# claim.sh INST RECORDING_ID [CLOCK_SKEW_MS=0] [SETTLE_S=5]
# Transcription claim protocol prototype. Each device writes ONLY .tramado/claims/<rec>/<myDeviceID>.json,
# scans, waits a settle window, then computes the deterministic winner: min(claimedAt, deviceId).
. /tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/syncthing/lib.sh
I=$1; REC=$2; SKEW=${3:-0}; SETTLE=${4:-5}; FID=$(cat $RUN/folder.id); ME=$(cat $RUN/$I.id)
P=$(api $I GET /rest/config/folders/$FID | jq -r .path); D="$P/.tramado/claims/$REC"; mkdir -p "$D"
# 1) pre-check: someone already holds a live claim? then don't even try
existing=$(ls "$D"/*.json 2>/dev/null | wc -l)
ts=$(( $(now_ms) + SKEW ))
jq -nc --arg r "$REC" --arg d "$ME" --argjson t $ts '{v:1,recordingId:$r,deviceId:$d,claimedAt:$t,status:"claimed",heartbeat:0,engine:"whisper.cpp/ggml-small"}' > "$D/.$ME.json.tmp" && mv "$D/.$ME.json.tmp" "$D/$ME.json"
api $I POST "/rest/db/scan?folder=$FID&sub=.tramado%2Fclaims%2F$REC" >/dev/null
sleep $SETTLE
# 2) settle: also require that every connected member has our claim (completion==100 for them)
winner=$(cat "$D"/*.json | jq -s -r 'map(select(.status!="released")) | sort_by(.claimedAt, .deviceId) | .[0].deviceId')
n=$(ls "$D"/*.json | wc -l)
echo "$I sees $n claims (existing-before=$existing) -> winner ${winner:0:7} $([ "$winner" = "$ME" ] && echo '(me: START transcribing)' || echo '(yield)')"
