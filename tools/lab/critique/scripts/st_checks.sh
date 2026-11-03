#!/usr/bin/env bash
# Critique checks: (1) --log-file with STMONITORED=yes, (2) pending-device name as an invite token
# carrier, (3) /rest/db/file modifiedBy for authorship checks, (4) foreign write to a "single-writer" file.
set -u
C=/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/critique/st
ST=/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/syncthing/bin-extract/syncthing-linux-amd64-v2.1.7/syncthing
rm -rf "$C"/X "$C"/Y "$C"/dX "$C"/dY "$C"/*.log "$C"/*.out
declare -A GP=([X]=18491 [Y]=18492) SP=([X]=22491 [Y]=22492) KEY=([X]=keyxkeyxkeyxkeyxkeyxkeyxkeyx01 [Y]=keyykeyykeyykeyykeyykeyykeyy02)
api() { local i=$1 m=$2 p=$3; shift 3; curl -sS -X "$m" -H "X-API-Key: ${KEY[$i]}" "http://127.0.0.1:${GP[$i]}$p" "$@"; }
start() {
  local i=$1
  "$ST" generate --home="$C/$i" --no-port-probing >"$C/$i.gen.out" 2>&1
  STMONITORED=yes STNOUPGRADE=1 STVERSIONEXTRA=Tramado STGUIAPIKEY="${KEY[$i]}" \
    "$ST" serve --home="$C/$i" --no-browser --no-restart --no-upgrade \
    --gui-address="http://127.0.0.1:${GP[$i]}" --log-file="$C/$i.logfile.log" >"$C/$i.stdout.out" 2>&1 &
  echo $! > "$C/$i.pid"
  for n in $(seq 1 100); do api $i GET /rest/noauth/health >/dev/null 2>&1 && break; sleep 0.1; done
  api $i PATCH /rest/config/options -H 'Content-Type: application/json' -d "{\"listenAddresses\":[\"tcp://127.0.0.1:${SP[$i]}\"],\"globalAnnounceEnabled\":false,\"localAnnounceEnabled\":false,\"relaysEnabled\":false,\"natEnabled\":false,\"urAccepted\":-1,\"urSeen\":3,\"crashReportingEnabled\":false}"
}
start X; start Y
sleep 1
echo "== (1) processes (expect one each) =="; pgrep -a syncthing | sed 's/--gui-address.*//' | cut -c1-80
echo "== (1) log file exists? =="; ls -la "$C"/X.logfile.log 2>&1 | head -1; echo "stdout bytes: $(wc -c < "$C/X.stdout.out")"; head -3 "$C/X.stdout.out"
XID=$(api X GET /rest/system/status | jq -r .myID); YID=$(api Y GET /rest/system/status | jq -r .myID)
echo "X=$XID"; echo "Y=$YID"
F=tramado-critiqueaaaaaaaaaaaaaaaaaa
mkdir -p "$C/dX" "$C/dY"
api X POST /rest/config/folders -H 'Content-Type: application/json' -d "{\"id\":\"$F\",\"label\":\"Crit\",\"path\":\"$C/dX\",\"type\":\"sendreceive\",\"fsWatcherEnabled\":true,\"fsWatcherDelayS\":1,\"pullerDelayS\":0,\"versioning\":{\"type\":\"trashcan\",\"params\":{\"cleanoutDays\":\"30\"}},\"devices\":[{\"deviceID\":\"$XID\"}]}"
echo "== (2) Y sets its own device name to carry an invite token, then dials X =="
api Y PATCH /rest/config/devices/$YID -H 'Content-Type: application/json' -d '{"name":"Bruno · tk:7Q2M-K9XD"}'
api Y POST /rest/config/devices -H 'Content-Type: application/json' -d "{\"deviceID\":\"$XID\",\"name\":\"X\",\"addresses\":[\"tcp://127.0.0.1:${SP[X]}\"]}"
api Y POST /rest/config/folders -H 'Content-Type: application/json' -d "{\"id\":\"$F\",\"label\":\"Crit\",\"path\":\"$C/dY\",\"type\":\"sendreceive\",\"pullerDelayS\":0,\"fsWatcherDelayS\":1,\"devices\":[{\"deviceID\":\"$YID\"},{\"deviceID\":\"$XID\"}]}"
for n in $(seq 1 40); do P=$(api X GET /rest/cluster/pending/devices); [ "$P" != "{}" ] && break; sleep 0.25; done
echo "pending on X: $P"
echo "== accept Y on X (folder-ID proof path collapsed: share directly) =="
api X POST /rest/config/devices -H 'Content-Type: application/json' -d "{\"deviceID\":\"$YID\",\"addresses\":[\"tcp://127.0.0.1:${SP[Y]}\"]}"
api X PATCH /rest/config/folders/$F -H 'Content-Type: application/json' -d "{\"devices\":[{\"deviceID\":\"$XID\"},{\"deviceID\":\"$YID\"}]}"
for n in $(seq 1 60); do S=$(api Y GET "/rest/db/completion?folder=$F&device=$XID" | jq -r .remoteState); [ "$S" = valid ] && break; sleep 0.25; done
echo "Y sees X remoteState=$S"
echo "== (2b) Y renames itself back; does X's stored name change? (overwriteRemoteDeviceNamesOnConnect default) =="
api X GET /rest/config/devices/$YID | jq -c '{name}'
echo "== (3) X writes its own single-writer file, then Y overwrites it (foreign write) =="
mkdir -p "$C/dX/.tramado/chat"; printf '{"id":"m1","text":"hello from X"}\n' > "$C/dX/.tramado/chat/$XID.jsonl"
api X POST "/rest/db/scan?folder=$F&sub=.tramado%2Fchat" ; sleep 1.5
api Y GET "/rest/db/file?folder=$F&file=.tramado/chat/$XID.jsonl" | jq -c '{global: .global | {modifiedBy, version, size}, local: .local | {modifiedBy}}'
printf '{"id":"m1","text":"FORGED by Y"}\n' > "$C/dY/.tramado/chat/$XID.jsonl"
api Y POST "/rest/db/scan?folder=$F&sub=.tramado%2Fchat"; sleep 1.5
echo "X's copy now: $(cat "$C/dX/.tramado/chat/$XID.jsonl")"
api X GET "/rest/db/file?folder=$F&file=.tramado/chat/$XID.jsonl" | jq -c '{global: .global | {modifiedBy, version}}'
echo "X short id: ${XID:0:7}  Y short id: ${YID:0:7}"
echo "trashcan on X: $(find "$C/dX/.stversions" -type f 2>/dev/null | sed "s#$C/##")"
echo "== stop =="
api X POST /rest/system/shutdown; echo; api Y POST /rest/system/shutdown; echo
sleep 2; pgrep -a syncthing || echo "no syncthing left"
echo "== (1) after stop: log file? =="; ls -la "$C"/X.logfile.log 2>&1 | head -1; echo "X stdout lines: $(wc -l < "$C/X.stdout.out")"
