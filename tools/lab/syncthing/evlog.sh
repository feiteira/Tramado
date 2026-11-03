#!/bin/bash
# evlog.sh INST [endpoint=/rest/events] : long-poll the events API forever, append JSONL with receive time (ms)
. /tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/syncthing/lib.sh
I=$1; EP=${2:-/rest/events}; OUT=$RUN/$I.events$(echo $EP | tr / _).jsonl
since=0
while true; do
  r=$(api $I GET "$EP?since=$since&timeout=30" 2>/dev/null) || { sleep 0.5; continue; }
  [ -z "$r" ] && { sleep 0.5; continue; }
  t=$(date +%s%3N)
  echo "$r" | jq -c --arg t "$t" '.[] | . + {rx: ($t|tonumber)}' >> $OUT
  n=$(echo "$r" | jq 'if length>0 then .[-1].id else empty end')
  [ -n "$n" ] && since=$n
done
