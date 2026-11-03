#!/bin/bash
# chat_test.sh SENDER N : append N chat lines to SENDER's own .tramado/chat/<id>.jsonl, scan, and measure when each
# line becomes visible in every other member's copy. Prints per-receiver latency stats.
. /tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/syncthing/lib.sh
S=$1; N=${2:-10}; FID=$(cat $RUN/folder.id); SID=$(cat $RUN/$S.id); REL=".tramado/chat/$SID.jsonl"
RECV=$(for i in ${MEMBERS:-A B C}; do [ $i != $S ] && echo $i; done)
SP=$(api $S GET /rest/config/folders/$FID | jq -r .path); mkdir -p $SP/.tramado/chat
for m in $(seq 1 $N); do
  T0=$(now_ms); msg="m$T0"
  printf '%s\n' "$(jq -nc --arg id "$msg" --arg f "$SID" --argjson ts $T0 --arg tx "hello #$m from $S" '{id:$id,ts:$ts,from:$f,text:$tx}')" >> $SP/$REL
  api $S POST "/rest/db/scan?folder=$FID&sub=$(echo $REL | sed 's/\//%2F/g')" >/dev/null
  for r in $RECV; do RP=$(api $r GET /rest/config/folders/$FID | jq -r .path)
    while ! grep -q "$msg" $RP/$REL 2>/dev/null; do sleep 0.005; done; echo "$r $(( $(now_ms)-T0 ))"; done
  sleep 0.3
done | awk '{s[$1]+=$2; n[$1]++; if(!($1 in mn)||$2<mn[$1])mn[$1]=$2; if($2>mx[$1])mx[$1]=$2} END{for(r in s) printf "receiver %s: n=%d avg=%dms min=%dms max=%dms (sequential wait, later receivers include earlier waits)\n", r, n[r], s[r]/n[r], mn[r], mx[r]}'
