#!/bin/bash
# join.sh JOINER INVITE_B64URL : what the Tramado app does when a student pastes an invite code.
. /tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/syncthing/lib.sh
I=$1; INV=$2; J=$(echo "$INV" | tr -- '-_' '+/' | base64 -d 2>/dev/null); ME=$(myid $I)
P=$(echo "$INV" | wc -c); case $(( (P-1) % 4 )) in 2) J=$(echo "${INV}==" | tr -- '-_' '+/' | base64 -d);; 3) J=$(echo "${INV}=" | tr -- '-_' '+/' | base64 -d);; esac
api $I POST /rest/config/devices -H 'Content-Type: application/json' -d "$(echo "$J" | jq -c '{deviceID:.d, name:.n, addresses:(.a+["dynamic"]), introducer:false}')" -o /dev/null
api $I POST /rest/config/folders -H 'Content-Type: application/json' -d "$(echo "$J" | jq -c --arg me $ME --arg p "$L/data/$I/$(echo "$J" | jq -r .f)" '{id:.f, label:.l, path:$p, type:"sendreceive", fsWatcherEnabled:true, fsWatcherDelayS:1, pullerDelayS:0, rescanIntervalS:3600, devices:[{deviceID:$me},{deviceID:.d}]}')" -o /dev/null
IGN='{"ignore":["// Tramado managed ignores (v1)","(?d).DS_Store","(?d)Thumbs.db","(?d)desktop.ini","(?d)._*","/.tramado/cache","/.tramado/local","*.tmp","*.part","*.crdownload","~$*",".~lock.*#","*.swp"]}'
api $I POST "/rest/db/ignores?folder=$(echo "$J" | jq -r .f)" -H 'Content-Type: application/json' -d "$IGN" -o /dev/null
echo "$J" | jq -r .f
