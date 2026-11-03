# Tramado Syncthing lab helpers. Source me: . lib.sh
L=/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/syncthing
ST=$L/bin-extract/syncthing-linux-amd64-v2.1.7/syncthing
RUN=$L/run
# instance -> GUI port / sync port
gport() { case $1 in A) echo 18381;; B) echo 18382;; C) echo 18383;; D) echo 18384;; E) echo 18385;; F) echo 18386;; G) echo 18387;; H) echo 18388;; U) echo 8384;; esac; }
sport() { case $1 in A) echo 22001;; B) echo 22002;; C) echo 22003;; D) echo 22004;; E) echo 22005;; F) echo 22006;; G) echo 22007;; H) echo 22008;; U) echo 22000;; esac; }
key()   { cat $RUN/$1.apikey; }
# api INST METHOD PATH [curl args...]
api() { local i=$1 m=$2 p=$3; shift 3; curl -sS -X "$m" -H "X-API-Key: $(key $i)" "http://127.0.0.1:$(gport $i)$p" "$@"; }
myid() { api $1 GET /rest/system/status | jq -r .myID; }
now_ms() { date +%s%3N; }
start_inst() { # start_inst INST  (generate if needed, then serve as child in background)
  local i=$1 h=$RUN/$1
  [ -f $RUN/$i.apikey ] || head -c 24 /dev/urandom | base64 | tr -d '/+=' > $RUN/$i.apikey
  [ -f $h/config.xml ] || "$ST" generate --home="$h" --no-port-probing >$RUN/$i.gen.log 2>&1
  STNOUPGRADE=1 nohup "$ST" serve --home="$h" --no-browser --no-restart --no-upgrade \
     --gui-address="http://127.0.0.1:$(gport $i)" --gui-apikey="$(key $i)" \
     --log-file="$RUN/$i.log" --log-level=INFO >$RUN/$i.stdout 2>&1 &
  echo $! > $RUN/$i.pid
  # wait for REST
  for n in $(seq 1 100); do api $i GET /rest/noauth/health >/dev/null 2>&1 && break; sleep 0.1; done
  api $i GET /rest/noauth/health; echo " $i up pid=$(cat $RUN/$i.pid)"
}
stop_inst() { api $1 POST /rest/system/shutdown; echo; }
# lab options: loopback only, no discovery/relays/NAT/UR/crash/upgrade
lab_options() {
  local i=$1
  api $i PATCH /rest/config/options -H 'Content-Type: application/json' -d "{
    \"listenAddresses\": [\"tcp://127.0.0.1:$(sport $i)\"],
    \"globalAnnounceEnabled\": false, \"localAnnounceEnabled\": false,
    \"relaysEnabled\": false, \"natEnabled\": false,
    \"urAccepted\": -1, \"urSeen\": 3, \"crashReportingEnabled\": false,
    \"autoUpgradeIntervalH\": 0, \"startBrowser\": false
  }"
}
