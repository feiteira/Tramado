#!/bin/bash
# autoaccept.sh INST [PROVISIONAL_TIMEOUT_S=20]
# Tramado membership policy (prototype of what the Rust app will do):
#  1. Unknown device knocks (PendingDevicesChanged) -> provisionally add it with NO folders shared.
#  2. Once connected it sends ClusterConfig; if it offers a folder whose ID is one of OUR tramado-* folders
#     (PendingFoldersChanged), the folder ID proves it holds an invite -> share that folder with it (member).
#  3. Provisional devices that offered nothing valid within the timeout are removed and put in remoteIgnoredDevices.
. /tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/syncthing/lib.sh
I=$1; TMO=${2:-20}; SD=$RUN/$I.aa; mkdir -p $SD/prov; LOG=$RUN/$I.autoaccept.log
log() { echo "$(date +%T.%3N) [$I] $*" >> $LOG; }
J='Content-Type: application/json'
handle_pending_devices() {
  api $I GET /rest/cluster/pending/devices | jq -r 'to_entries[] | "\(.key) \(.value.address) \(.value.name)"' | while read -r dev addr name; do
    [ -z "$dev" ] && continue
    api $I POST /rest/config/devices -H "$J" -d "$(jq -nc --arg d "$dev" --arg n "$name" --arg a "tcp://$addr" '{deviceID:$d,name:$n,addresses:[$a,"dynamic"],introducer:false,autoAcceptFolders:false}')" >/dev/null
    date +%s > $SD/prov/$dev; log "provisionally added $dev ($name) addr=$addr"
  done
}
handle_pending_folders() {
  local mine; mine=$(api $I GET /rest/config/folders | jq -c '[.[]|select(.id|startswith("tramado-"))|.id]')
  api $I GET /rest/cluster/pending/folders | jq -r --argjson mine "$mine" 'to_entries[] | .key as $f | .value.offeredBy | keys[] | "\($f) \(.)"' | while read -r fid dev; do
    [ -z "$fid" ] && continue
    if echo "$mine" | jq -e --arg f "$fid" 'index($f)!=null' >/dev/null; then
      cur=$(api $I GET /rest/config/folders/$fid | jq -c --arg d "$dev" '[.devices[] | {deviceID}] + [{deviceID:$d}] | unique_by(.deviceID)')
      api $I PATCH /rest/config/folders/$fid -H "$J" -d "{\"devices\":$cur}" >/dev/null
      rm -f $SD/prov/$dev; log "ACCEPTED $dev as member of $fid (proved folder id)"
    else
      log "ignoring offer of unknown folder $fid from $dev"   # never auto-create folders we don't know
    fi
  done
}
sweep() {
  for f in $SD/prov/*; do [ -e "$f" ] || continue; dev=$(basename $f); age=$(( $(date +%s) - $(cat $f) ))
    if [ $age -ge $TMO ]; then
      # Re-check at decision time: it may have become a member by another path (roster, introducer, manual).
      if api $I GET /rest/config/folders | jq -e --arg d "$dev" '[.[].devices[].deviceID]|index($d)!=null' >/dev/null; then
        rm -f $f; log "provisional $dev is a member by now -> keep"; continue; fi
      # No /rest/config/remoteIgnoredDevices endpoint and PATCH /rest/config is 405 -> GET full config, edit, PUT (atomic).
      cfg=$(api $I GET /rest/config | jq -c --arg d "$dev" '.devices |= map(select(.deviceID!=$d))
            | .folders |= map(.devices |= map(select(.deviceID!=$d)))
            | .remoteIgnoredDevices = ((.remoteIgnoredDevices // []) + [{deviceID:$d,name:"",address:"",time:(now|todate)}] | unique_by(.deviceID))')
      api $I PUT /rest/config -H "$J" -d "$cfg" >/dev/null
      rm -f $f; log "REJECTED $dev: no valid folder offer within ${TMO}s -> removed + ignored"
    fi; done
}
handle_pending_devices; handle_pending_folders
since=0  # NB: event ids are per event-mask subscription; never reuse ids across masks
while true; do
  r=$(api $I GET "/rest/events?events=PendingDevicesChanged,PendingFoldersChanged&since=$since&timeout=3") || { sleep 1; continue; }
  n=$(echo "$r" | jq '.[-1].id // empty'); [ -n "$n" ] && since=$n
  if echo "$r" | jq -e 'map(select(.type=="PendingDevicesChanged" and (.data.added|length>0)))|length>0' >/dev/null; then handle_pending_devices; fi
  if echo "$r" | jq -e 'map(select(.type=="PendingFoldersChanged" and (.data.added|length>0)))|length>0' >/dev/null; then handle_pending_folders; fi
  sweep
done
