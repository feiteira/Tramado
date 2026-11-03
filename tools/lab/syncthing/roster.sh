#!/bin/bash
# roster.sh INST : app-level "introducer" via a members roster inside the synced class folder.
# Each member writes ONLY its own file .tramado/members/<myDeviceID>.json (single writer), and
# makes sure every device listed in the roster is configured + shared on that folder.
. /tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/syncthing/lib.sh
I=$1; LOG=$RUN/$I.roster.log; J='Content-Type: application/json'
log() { echo "$(date +%T.%3N) [$I] $*" >> $LOG; }
ME=$(myid $I)
while true; do
  myname=$(api $I GET /rest/config/devices/$ME | jq -r .name)
  myaddrs=$(api $I GET /rest/config/options | jq -c '.listenAddresses')   # prod: also "dynamic" + discovered external addrs
  api $I GET /rest/config/folders | jq -r '.[]|select(.id|startswith("tramado-"))|"\(.id) \(.path)"' | while read -r fid fpath; do
    md="$fpath/.tramado/members"; mkdir -p "$md"; mf="$md/$ME.json"
    want=$(jq -nc --arg d $ME --arg n "$myname" --argjson a "$myaddrs" '{deviceId:$d,name:$n,addresses:$a,v:1}')
    if [ "$(jq -c 'del(.joinedAt)' "$mf" 2>/dev/null)" != "$want" ]; then
      echo "$want" | jq -c --arg t "$(date -u +%FT%TZ)" '. + {joinedAt:$t}' > "$mf.tmp" && mv "$mf.tmp" "$mf"
      api $I POST "/rest/db/scan?folder=$fid&sub=.tramado/members" >/dev/null; log "wrote own member file in $fid"
    fi
    cfgdevs=$(api $I GET /rest/config/devices | jq -c 'map(.deviceID)'); fdevs=$(api $I GET /rest/config/folders/$fid | jq -c '[.devices[].deviceID]')
    ignored=$(api $I GET /rest/config | jq -c '[.remoteIgnoredDevices[].deviceID]')
    for f in "$md"/*.json; do
      [ -e "$f" ] || continue; d=$(jq -r .deviceId "$f" 2>/dev/null) || continue; [ "$d" = "$ME" ] && continue
      echo "$ignored" | jq -e --arg d "$d" 'index($d)!=null' >/dev/null && continue
      if ! echo "$cfgdevs" | jq -e --arg d "$d" 'index($d)!=null' >/dev/null; then
        api $I POST /rest/config/devices -H "$J" -d "$(jq -c '{deviceID:.deviceId,name:.name,addresses:(.addresses+["dynamic"]|unique)}' "$f")" >/dev/null; log "roster: added device $d"
      fi
      if ! echo "$fdevs" | jq -e --arg d "$d" 'index($d)!=null' >/dev/null; then
        cur=$(api $I GET /rest/config/folders/$fid | jq -c --arg d "$d" '[.devices[]|{deviceID}] + [{deviceID:$d}] | unique_by(.deviceID)')
        api $I PATCH /rest/config/folders/$fid -H "$J" -d "{\"devices\":$cur}" >/dev/null; log "roster: shared $fid with $d"
        fdevs=$(echo "$fdevs" | jq -c --arg d "$d" '. + [$d]')
      fi
    done
  done
  sleep 2
done
