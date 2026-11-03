# Syncthing v2.1.7 lab: Tramado class-sharing protocol, proven over REST

Lab date: 2026-11-03. Binary: `syncthing v2.1.7 "Hafnium Hornet" (go1.27.3 linux-amd64)`.
Everything below was **executed and measured**, with up to 8 Syncthing instances on one host (A, B, C, D, E, F, G, H, plus U as "the user's own Syncthing", and M1–M4 as probes). Timings are from localhost unless a section says otherwise. Relay timings used the real public Syncthing relay pool.

Lab scripts (reusable): `/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/syncthing/` (see §15).

---

## 0. Verdict / TL;DR

**The protocol works.** A Syncthing folder per class, with a single invite code, works with **no server of ours**. The REST API covers everything an app needs.

| What | Result (measured) |
|---|---|
| Join via invite (fresh device, policy daemon on members) | inviter accepts in **2.2 s**, joiner fully synced (32 files / 53 MB) in **3.6 s**, full mesh with all members in **5.2 s** |
| Chat line A→B (append to own JSONL + `POST /rest/db/scan`, `pullerDelayS=0`) | **~0.28–0.36 s** LAN/loopback, **~0.45 s via public relay** |
| Same, relying only on the fs-watcher (no explicit scan) | 1.0–2.3 s |
| 50 MB file, loopback | 0.65 s (meaningless for the real world). **Public relay ≈ 6 Mbit/s** (5 MB in 6.9 s) |
| Partial reads by a reader during 300 rapid appends (32,509 reads) | **0** (Syncthing writes `.syncthing.<name>.tmp`, then renames) |
| Same file edited concurrently on 2 devices | conflict copy `shared.sync-conflict-20261103-155644-TKBNV23.md` on **all** devices. This is why we use a single writer per file |
| Outsider who knows a member's device ID but not the folder ID | gets **nothing**. Removed and ignored after the timeout |
| Transcription claim with 3 simultaneous claimants | all devices converge on the same winner |

Main recommendations (details in the sections below):

1. **Managed, private Syncthing child process.** Use its own home dir in the app data dir and **pre-seed `config.xml` before the first start**. Use its own listen port (**never 22000**), the GUI/REST API on `127.0.0.1:<free port>` (or a Unix socket), our own API key, and `STMONITORED=yes` so there is one process.
2. **Class = folder `tramado-<26 base32 chars>` (128-bit).** The folder ID *is* the capability.
3. **Invite = {member device ID(s), folder ID, label, current addresses}.** Joiner: add the device(s) and the folder shared with them.
4. **Membership policy on every member:**
   - An unknown device knocks. Add it provisionally with **no folders**.
   - If it offers a folder ID that we have, share that folder with it.
   - Otherwise remove it and ignore it after 20–60 s.
5. **Use a roster, not Syncthing introducers.** Each device writes only `.tramado/members/<myDeviceID>.json`, and every member adds every roster device to its config. Do **not** rely on Syncthing introducers: when an introducer leaves, Syncthing cascades device removals (verified).
6. **Single-writer files everywhere.** Use `.tramado/chat/<deviceId>.jsonl`, `.tramado/claims/<rec>/<deviceId>.json` and `.tramado/members/<deviceId>.json`. After each write, call `POST /rest/db/scan?folder=&sub=`. Set `pullerDelayS: 0` on class folders.
7. **Claim rule** (deterministic): rank `done > working > claimed`, then earliest `claimedAt`, then lowest `deviceId`. Add a heartbeat. Judge staleness by *local observation time*, not by remote clocks.
8. **Production connectivity:** keep global discovery, relays, NAT-PMP/UPnP and local discovery on. **Put concrete addresses into invites** (LAN plus relay URIs), or do an app-side discovery lookup. The discovery server answers unknown devices with **`404 Retry-After: ~2000–2500 s`**, and Syncthing honours it. Without concrete addresses, a joiner who looks up too early can wait **more than 35 minutes**. This was observed: no connection after 3.5 min. With injected addresses, the connection came up in 0.55 s.

---

## 1. Download and verification

```bash
D=/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/syncthing/dl   # own empty dir
curl -sSL -o $D/syncthing-linux-amd64-v2.1.7.tar.gz https://github.com/syncthing/syncthing/releases/download/v2.1.7/syncthing-linux-amd64-v2.1.7.tar.gz
curl -sSL -o $D/sha256sum.txt.asc https://github.com/syncthing/syncthing/releases/download/v2.1.7/sha256sum.txt.asc
grep syncthing-linux-amd64 $D/sha256sum.txt.asc; sha256sum $D/syncthing-linux-amd64-v2.1.7.tar.gz
# both: 2edc416e7ed136b7c858ed5f3f02a3b8316589605e54c380228ceea7acbf0142  -> MATCH
```

GPG check of the checksum file: we imported `https://syncthing.net/release-key.txt` into an isolated `GNUPGHOME`. The result was:
- `Good signature from "Syncthing Release Management <release@syncthing.net>"`, key **FBA2 E162 F2F4 4657 B38F 0309 E566 5F9B D597 0C47**.
- The file carries a **second signature** from key `37C84554E7E0A261E4F76E1ED26E6ED000654A3E`. On keys.openpgp.org that key has no user ID, so it could not be checked. This is harmless: one good signature from the published release key is enough.

Other release facts:
- The tarball is 14.0 MB. It contains a 34 MB static binary `syncthing`, `.metadata/release.sig` (used by Syncthing's own upgrader), `etc/` (systemd/launchd samples), and `LICENSE.txt`.
- **The licence is MPL-2.0, the same as Tramado.** Bundling it is fine. Ship its LICENSE and AUTHORS files.
- Platform assets in v2.1.7: `linux-amd64/arm64 .tar.gz`, `macos-amd64/arm64/universal .zip`, `windows-amd64/arm64 .zip`.

---

## 2. v2 CLI facts (`syncthing --help`, `serve --help`, `generate --help`)

Commands: `serve` (default), `cli`, `browser`, `decrypt`, `device-id`, `generate`, `paths`, `upgrade`, `version`, `debug`, `install-completions`.

Global flags: `-H/--home` (`$STHOMEDIR`), `-C/--config` (`$STCONFDIR`), `-D/--data` (`$STDATADIR`).

`serve` flags that matter for a managed child (each one has an env-var twin):

| flag | env | note |
|---|---|---|
| `--gui-address=URL` | `STGUIADDRESS` | `http://127.0.0.1:PORT` or `unix:///abs/path.sock`. Overrides config and is **not persisted** |
| `--gui-apikey=KEY` | `STGUIAPIKEY` | Override, **not persisted**. The `config.xml` `<apikey>` **also keeps working** (verified: both return 200) |
| `--no-browser` | `STNOBROWSER` | |
| `--no-restart` | `STNORESTART` | Without it, a crash or REST restart is handled by the monitor |
| `--no-upgrade` | `STNOUPGRADE` | Also set `STNOUPGRADE=1`: the log then says "No automatic upgrades; STNOUPGRADE environment variable defined" and the version gets tag `[stnoupgrade]` |
| `--no-port-probing` | `STNOPORTPROBING` | First start only |
| `--log-file=PATH`, `--log-level=INFO`, `--log-max-size`, `--log-max-old-files`, `--log-format-timestamp=""` | `STLOGFILE`, … | ⚠ `--log-file` is **ignored when `STMONITORED=yes`** (the monitor writes the log file). Capture stdout/stderr in that mode |
| `--paused` / `--unpaused` | | Start with everything paused (does not stop listeners) |
| `--allow-newer-config`, `--db-maintenance-interval=8h`, `--db-delete-retention-interval=10920h` | | |
| (env) `STVERSIONEXTRA=Tramado` | | Shows the wrapper name in the version string. Recommended |

v1 flags that are **gone in v2**: `-no-default-folder`, `-logflags`, `-home` (single dash), `-gui-address` (single dash). Also, **v2 never creates a "Default Folder" (`~/Sync`)**. Verified: a fresh `serve` has `folders: []` and creates no `~/Sync`.

`generate`:
- Takes about 37 ms. It creates `cert.pem`, `key.pem` (ECDSA) and `config.xml`.
- It leaves a stray empty `.syncthing.tmp.<n>` file in the home dir. This is harmless.
- `--no-port-probing` gives GUI `127.0.0.1:8384` and listen `default`.
- **Without** that flag, when 8384 is taken, it picked a **random** GUI port (`127.0.0.1:40523`) and `tcp://0.0.0.0:41047` plus `dynamic+https://relays…`, with **no QUIC**.
- **If `config.xml` already exists, `generate` keeps our settings.** It only adds the keys, our own device entry and the defaults section. This is how we pre-seed (§3).

`device-id --home=H` prints the ID offline. `paths --home=H` lists the config, keys, DB (`index-v2/`, SQLite) and log locations. The DB lock file is `syncthing.lock`.

### Process model, verified

- `serve --no-restart` **still forks a monitor**. The parent (monitor) runs the child with env `STMONITORED=yes`, plus `STGUIADDRESS`, `STGUIAPIKEY` and `STNOUPGRADE` copied in. The API key is readable in `/proc/<pid>/environ`, but only by the same user.
- **SIGTERM to the parent:** the parent and child both exit, with exit code 0.
- **SIGKILL to the parent:** the **child is orphaned and keeps serving** (the API still answered 200).
- **Setting `STMONITORED=yes` ourselves gives a single process** (no children). This is the right mode when the Tauri app is the supervisor.
- `POST /rest/system/shutdown` returns `{"ok": "shutting down"}`, then the **process exits with 0 after about 1.0 s**.
- `POST /rest/system/restart` with `--no-restart` returns `{"ok": "restarting"}`, then the **process exits with code 3**. The supervisor must respawn on exit 3.
- A second instance on the same home dir prints `ERR Failed to acquire lock: is another Syncthing instance already running?` and exits with code 1.
- A fatal GUI bind error (port in use) exits with code 1, logging `Failed to start API … bind: address already in use`.

---

## 3. Recommended managed-instance recipe (production)

### 3.1 Paths

- Home: `<app_data_dir>/syncthing/` (holds config, keys and DB). **Not** in a synced folder.
- API key: random 32+ characters. Store it in the app's private settings (same place as the OpenRouter key handling, not in class folders), and also inside the pre-seeded `config.xml`.

### 3.2 Pre-seed `config.xml`, then run `generate` (verified)

This avoids binding 22000, the GUI on 8384, and any UR prompt, even for the first second.

```xml
<configuration version="52">
    <gui enabled="true" tls="false">
        <address>127.0.0.1:18393</address>              <!-- overridden at every start anyway -->
        <apikey>RANDOM-32+-CHARS</apikey>
    </gui>
    <options>
        <listenAddress>tcp://0.0.0.0:22100</listenAddress>   <!-- Tramado's own port, NOT 22000 -->
        <listenAddress>quic://0.0.0.0:22100</listenAddress>
        <listenAddress>dynamic+https://relays.syncthing.net/endpoint</listenAddress>
        <urAccepted>-1</urAccepted>                          <!-- usage reporting declined: no prompt -->
        <urSeen>3</urSeen>
        <startBrowser>false</startBrowser>
        <autoUpgradeIntervalH>0</autoUpgradeIntervalH>       <!-- the app ships/updates the binary -->
        <crashReportingEnabled>false</crashReportingEnabled> <!-- privacy default; could be opt-in -->
        <overwriteRemoteDeviceNamesOnConnect>true</overwriteRemoteDeviceNamesOnConnect>
    </options>
</configuration>
```

```bash
syncthing generate --home="$H"          # keeps our options, adds keys + own device + <defaults>
STMONITORED=yes STNOUPGRADE=1 STVERSIONEXTRA=Tramado \
  syncthing serve --home="$H" --no-browser --no-restart --no-upgrade \
  --gui-address="http://127.0.0.1:$FREE_PORT" --gui-apikey="$KEY"
```

Verified result:
- `connectionServiceStatus` reports `tcp://0.0.0.0:22100`, `quic://0.0.0.0:22100` and the relay, all with `error:null`.
- Options read back `urAccepted:-1`, `urUniqueID:null` and `startBrowser:false`.
- `generate` kept `globalAnnounceEnabled`, `localAnnounceEnabled` and `relaysEnabled` at their default of true.

Port choice: on first run, probe `22100..22199` for a TCP+UDP pair that is free, then persist it. A stable port helps UPnP and NAT-PMP, and keeps peers' cached addresses valid. After that, the app sets it once and only changes it if binding fails.

Alternatives:
- Start with defaults, then `PATCH /rest/config/options`. This works live: listeners rebind, and `restart-required` is false. But for about a second the instance binds `[::]:22000`, starts global announcements, and shows `urAccepted:0`.
- `syncthing cli config …` needs a running instance (it talks REST), so it is no help before the first start.

### 3.3 GUI/REST transport

- **TCP loopback.** `--gui-address=http://127.0.0.1:<free port>`. Pick a free port at each start, or persist one and fall back. A GUI port conflict is **fatal** (exit 1), so the supervisor must retry with another port.
- **Unix socket (Linux/macOS), verified.** `--gui-address=unix:///abs/path/gui.sock`:
  - The socket is created as `srwxrwxr-x`. Set `<unixSocketPermissions>0600</unixSocketPermissions>`.
  - It is removed on shutdown.
  - `curl --unix-socket … http://localhost/rest/system/ping` returns `{"ping":"pong"}`. No key or a wrong key returns **403**.
  - ⚠ The path must be **absolute and short**: at most 107 bytes on Linux and 103 on macOS. A 126-byte path failed with `bind: invalid argument`. The relative `unix://st.sock` silently became an **abstract socket `@81f19`**, so it is unusable.
  - Rust `reqwest` cannot speak over a Unix socket, so this would need hyper with `hyperlocal`. **Recommendation:** use TCP loopback on all OSes for simplicity, and keep the Unix socket as a possible hardening later.
- `GET /rest/noauth/health` returns `{"status":"OK"}` with no key. Use it as the readiness probe: in the lab it answered within about 0.3–1 s of spawn.

### 3.4 Supervisor rules for the Tauri (Rust) app

- Spawn with `STMONITORED=yes`. Linux: set `prctl(PR_SET_PDEATHSIG, SIGTERM)` in `pre_exec`. Windows: Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. macOS: no pdeathsig, so use the startup cleanup below.
- **Startup cleanup for orphans.** Before spawning, `POST /rest/system/shutdown` to the persisted GUI address with our key (ignore errors). Then spawn. If spawn fails with "Failed to acquire lock", read the PID file, kill that process, and retry.
- Exit code 0 means stopped. Code 3 means restart requested: respawn. Code 1 means error: inspect stderr (port or lock) and retry with backoff.
- Graceful quit: `POST /rest/system/shutdown`, wait up to 5 s, then kill.
- `GET /rest/config/restart-required` returns `{"requiresRestart":false}`. All the changes we made (options, devices, folders, ignores) applied live.
- Footprint: **RSS 47–73 MB** per instance with 1 folder, 4–5 devices and 53 MB of data. The DB was 5.2 MB. CPU was idle at about 0.5 %.

### 3.5 Options: lab vs production

| option | lab | **production (Tramado)** | why |
|---|---|---|---|
| `listenAddresses` | `tcp://127.0.0.1:2200x` | `tcp://0.0.0.0:P`, `quic://0.0.0.0:P`, `dynamic+https://relays.syncthing.net/endpoint` (P ≠ 22000) | §4 |
| `globalAnnounceEnabled` | false | **true** | classmates on different networks |
| `relaysEnabled` | false | **true** | campus Wi-Fi with client isolation, CGNAT. Measured about 6 Mbit/s and about 0.45 s chat latency |
| `natEnabled` | false | **true** (UPnP/NAT-PMP) | direct WAN connections |
| `localAnnounceEnabled` | false | **true** | Students in the same lecture hall connect directly. Fast, and needs no Internet. See the 21027 caveat in §4 |
| `urAccepted` / `urSeen` | -1 / 3 | **-1 / 3** | no prompt, no reporting |
| `crashReportingEnabled` | false | false (or opt-in) | privacy |
| `autoUpgradeIntervalH` | 0 | **0**, plus `STNOUPGRADE=1` | the app controls the version |
| `overwriteRemoteDeviceNamesOnConnect` | – | **true** | Verified: a rename propagated on reconnect in about 1 s. Without it, the old name stays |
| `startBrowser` | false | false | |
| per folder `pullerDelayS` | 0 | **0** | 1 s by default. Setting it to 0 cut latency from 1.3 s to 0.28 s |
| per folder `fsWatcherDelayS` | 1 | 1–2 | the app scans explicitly anyway |
| per folder `rescanIntervalS` | 3600 | 3600 | |
| per folder `versioning` | – | `trashcan`, `cleanoutDays: 30` (or `staggered`) | Protects against a classmate deleting files (§10.4) |

---

## 4. Coexisting with the user's own Syncthing (verified)

"U" ran a stock config: GUI 127.0.0.1:8384, TCP and QUIC on `*:22000`, local discovery on 21027. A second, naive instance then started with defaults:

| resource | outcome for the 2nd instance |
|---|---|
| GUI `127.0.0.1:8384` | **FATAL**: `ERR Failed to start API … bind: address already in use`, exit 1 |
| TCP `:22000` | **Both bind successfully** (SO_REUSEPORT). Proven with 12 TLS handshakes to 127.0.0.1:22000: **4 reached U's certificate and 8 reached the other one**. The kernel load-balances inbound peers between the two daemons, so peers get `unexpected device id, expected X got Y` (we saw exactly this in `lastDialStatus`). This is a **silent, intermittent breakage of both apps** |
| QUIC `udp :22000` | `WRN Failed to listen (QUIC) … address already in use`. It keeps retrying and is non-fatal |
| UDP 21027 IPv4 broadcast | Only the first process gets the socket. The second one's IPv4 LAN discovery receive silently does not work. IPv6 multicast `[::]:21027` is shared fine |

**Conclusion:** a managed instance must use its **own GUI address** (random loopback port or Unix socket) and its **own sync port** (not 22000). Pre-seed it so that 22000 is never bound even briefly. Before choosing P, check that both TCP P and UDP P are free.

Local discovery still announces our real port P, so LAN peers find us. Receiving IPv4 broadcasts may fail while the user's own Syncthing runs; global discovery and IPv6 cover that case.

---

## 5. REST API reference (everything used, v2.1.7)

All requests use header `X-API-Key: <key>`. JSON bodies need `Content-Type: application/json`.

| Purpose | Call | Notes / response |
|---|---|---|
| readiness | `GET /rest/noauth/health` | `{"status":"OK"}`, no key needed |
| ping | `GET /rest/system/ping` | `{"ping":"pong"}` |
| my device ID | `GET /rest/system/status` → `.myID` | also: `guiAddressUsed`, `guiAddressOverridden`, `connectionServiceStatus{<listenURI>:{error,lanAddresses,wanAddresses}}` (use for invite addresses: includes relay URI `relay://95.216.157.10:22067/?id=…`), `discoveryStatus`, `lastDialStatus{<addr>:{when,error}}`, `uptime` |
| version | `GET /rest/system/version` | `{"version":"v2.1.7","tags":["stnoupgrade"],…}` |
| validate/normalise device ID | `GET /rest/svc/deviceid?id=<any case, dashes optional>` | `{"id":"TKBNV23-…"}` or `{"error":"\"NOTVALID-123\": device ID invalid: incorrect length"}` |
| options | `GET` / `PATCH /rest/config/options` | PATCH merges and applies live |
| restart needed? | `GET /rest/config/restart-required` | `{"requiresRestart":false}` |
| set my name | `PATCH /rest/config/devices/<myID>` `{"name":"Ana (laptop)"}` | 200 |
| list devices | `GET /rest/config/devices` | items: `deviceID,name,addresses,compression,certName,introducer,skipIntroductionRemovals,introducedBy,paused,allowedNetworks,autoAcceptFolders,maxSendKbps,maxRecvKbps,ignoredFolders,maxRequestKiB,untrusted,remoteGUIPort,numConnections,group` (`group` is new in v2) |
| add device | `POST /rest/config/devices` `{"deviceID":…, "name":…, "addresses":["tcp://1.2.3.4:22100","dynamic"], "introducer":false, "autoAcceptFolders":false}` | 200 |
| remove device | `DELETE /rest/config/devices/<id>` | also drops it from folders |
| add folder | `POST /rest/config/folders` (body below) | ⚠ **If the ID exists, POST REPLACES the whole folder.** Verified: the devices list was reset to just ourselves. Only POST new folders |
| modify folder | `PATCH /rest/config/folders/<id>` | ⚠ `devices` is replaced as a whole array, so always send the full list |
| remove folder | `DELETE /rest/config/folders/<id>` | **files stay on disk** (verified) |
| whole config | `GET` / `PUT /rest/config` | ⚠ **`PATCH /rest/config` returns 405** and **`/rest/config/remoteIgnoredDevices` returns 404**. To ignore a device: GET the full config, edit `remoteIgnoredDevices` (and devices and folders) in one go, then PUT. This is atomic |
| pending devices | `GET /rest/cluster/pending/devices` | `{"<id>":{"time":"…Z","name":"Student B","address":"127.0.0.1:22002"}}`. `address` is the observed remote address and may not be dialable |
| dismiss pending device | `DELETE /rest/cluster/pending/devices?device=<id>` | 200 (it reappears on the next knock unless ignored) |
| pending folders | `GET /rest/cluster/pending/folders` | `{"<folderID>":{"offeredBy":{"<dev>":{"time","label","receiveEncrypted":false,"remoteEncrypted":false}}}}` |
| connections | `GET /rest/system/connections` | `{total:{…}, connections:{<id>:{connected,paused,address,type:"tcp-client"\|"tcp-server"\|"relay-client"…,isLocal,crypto:"TLS1.3-TLS_AES_128_GCM_SHA256",clientVersion,inBytesTotal,outBytesTotal,startedAt,primary:{…},secondary:[…]}}}`. v2 opens **several connections per device** (primary plus secondaries) |
| pause/resume device | `POST /rest/system/pause?device=<id>` / `POST /rest/system/resume?device=<id>` | events `DevicePaused`/`DeviceResumed` |
| pause/resume folder | `PATCH /rest/config/folders/<id>` `{"paused":true\|false}` | events `FolderPaused`/`FolderResumed`. Peers see `remoteState:"paused"` |
| folder status | `GET /rest/db/status?folder=<id>` | `{state:"idle"\|"scanning"\|"syncing"\|"sync-preparing"\|"sync-waiting"\|"scan-waiting"\|"error", error, globalFiles, globalBytes, localFiles, needFiles, needBytes, needTotalItems, inSyncFiles, inSyncBytes, version, sequence, remoteSequence:{<dev>:n}, ignorePatterns:true, watchError, stateChanged}` |
| per-member progress | `GET /rest/db/completion?folder=<id>&device=<dev>` | `{"completion":100,"globalBytes":…,"globalItems":…,"needBytes":0,"needDeletes":0,"needItems":0,"remoteState":"valid"\|"notSharing"\|"paused"\|"unknown","sequence":n}`. Without `device`: aggregate (`remoteState:"unknown"`) |
| what I still need | `GET /rest/db/need?folder=<id>` | `{"progress":[],"queued":[],"rest":[],"page":1,"perpage":65536}` |
| what a member needs | `GET /rest/db/remoteneed?folder=&device=` | `{"files":[],…}` |
| who has a file | `GET /rest/db/file?folder=&file=recordings/x.bin` | `.availability[].id`, `.global.{size,modifiedBy,version}`. Useful for "who has the recording" |
| browse | `GET /rest/db/browse?folder=&prefix=docs` | `[{"name":"aula1.md","modTime":…,"size":5,"type":"FILE_INFO_TYPE_FILE"}]` |
| scan now | `POST /rest/db/scan?folder=<id>&sub=<url-encoded relpath>` | returns once the scan is done (~16–40 ms for a small sub-path; 76 ms for a new 50 MB file) |
| ignores | `GET` / `POST /rest/db/ignores?folder=<id>` `{"ignore":[…]}` | the GET also returns `expanded` |
| versions | `GET /rest/folder/versions?folder=` and `POST /rest/folder/versions?folder=` `{"docs/aula1.md":"<versionTime>"}` | restore (verified) |
| events | `GET /rest/events?since=N&timeout=S[&events=A,B][&limit=n]`, `GET /rest/events/disk?since=N&timeout=S` | §8.3 |
| stats | `GET /rest/stats/device` (`lastSeen`), `GET /rest/stats/folder` (`lastFile`, `lastScan`) | |
| errors | `GET /rest/system/error` | |
| discovery cache | `GET /rest/system/discovery` | stayed `{}` in the global-discovery test (§11) |
| shutdown / restart | `POST /rest/system/shutdown` / `POST /rest/system/restart` | exit 0 / exit 3 (§2) |

Folder body used when creating a class:

```json
{ "id": "tramado-geznkyujw4ofedwinfcmzl2rim", "label": "Direito Constitucional I",
  "path": "/…/Direito-Constitucional", "type": "sendreceive",
  "fsWatcherEnabled": true, "fsWatcherDelayS": 1, "pullerDelayS": 0, "rescanIntervalS": 3600,
  "versioning": {"type":"trashcan","params":{"cleanoutDays":"30"},"cleanupIntervalS":3600},
  "devices": [{"deviceID": "<myID>"}] }
```

Creating the folder took 37 ms. Syncthing **creates the path and the `.stfolder` marker** itself. The defaults filled in were `markerName:".stfolder"`, `maxConflicts:10`, `order:"random"`, `minDiskFree 1%`, `blockPullOrder:"standard"` and `caseSensitiveFS:false`.

---

## 6. Class creation and join protocol (verified step by step)

### 6.1 Folder ID = capability

- Format: `tramado-` plus 26 lowercase base32 characters (16 random bytes, 128 bits).
- Bash used in the lab: `head -c 16 /dev/urandom | base32 | tr -d = | tr A-Z a-z | head -c 26`.
- The brief suggested 16 characters (80 bits). Because the ID is the only secret gating access, use 128 bits.
- The ID is never sent to devices the folder is not shared with. Verified: the outsider's `pending/folders` stayed `{}`.

### 6.2 Invite format

Lab version: base64url of JSON, 262 characters.

```json
{"v":1,"d":"WSGDTBE-PYLFPIJ-JSGOJZC-CJC6O2N-ARA52TT-HKVPG6S-UVZH2AZ-RUULKAI","n":"Student A",
 "f":"tramado-geznkyujw4ofedwinfcmzl2rim","l":"Direito Constitucional I","a":["tcp://127.0.0.1:22001"]}
```

Recommended production form: `tramado://join?v=1&f=<folderId>&d=<dev1>,<dev2>,<dev3>&a=<addr list>&l=<label>`, also shown as a QR code.
- Include **up to 3 currently-online members' device IDs**, so the join works if one of them is offline.
- Include their **current concrete addresses** from `GET /rest/system/status` → `connectionServiceStatus[*].lanAddresses/wanAddresses`, *including the `relay://…?id=…` URI*.
- Strip dashes from device IDs: 52 base32 chars each.
- The minimal useful invite is folder ID plus one device ID, about 90 characters.

### 6.3 Steps and what was observed

A = class creator, B = joiner.

1. **A** reads `GET /rest/system/status .myID`, then creates the folder (§5).
2. **B** parses the invite:
   - Validate with `GET /rest/svc/deviceid?id=`.
   - `POST /rest/config/devices {deviceID:A, name, addresses:[…invite addrs, "dynamic"], introducer:false}`.
   - `POST /rest/config/folders {id:f, label:l, path:<B's choice>, devices:[B, A], pullerDelayS:0, …}`.
   - `POST /rest/db/ignores` with the managed ignore list (§10.1).
   - In `join.sh` this took 108–179 ms in total.
3. B dials A immediately. **A's `/rest/cluster/pending/devices` shows B after 623 ms**: `{"TKBNV23-…":{"time":"2026-11-03T15:47:28Z","name":"Student B","address":"127.0.0.1:22002"}}`.
   - Events on A: `PendingDevicesChanged {"added":[{"address","deviceID","name"}]}` and the deprecated-but-still-emitted `DeviceRejected {"address","device","name"}`.
   - B retries about every second. Each retry re-emits both events.
   - **`/rest/cluster/pending/folders` on A stays `{}`**: B's offered folder is **not** visible before A accepts the device, because the unknown device's connection is closed before ClusterConfig.
   - B's `/rest/system/connections` briefly shows `connected:true` toward A during each attempt. Do not trust it as a membership signal.
4. **A provisionally adds B with no folders**: `POST /rest/config/devices {deviceID:B, addresses:["tcp://<pending address>","dynamic"]}`.
   - The connection comes up, and B's ClusterConfig arrives about 1 s after `DeviceConnected`.
   - **1074 ms** after the add, `/rest/cluster/pending/folders` shows: `{"tramado-gezn…":{"offeredBy":{"TKBNV23-…":{"time":"…","label":"Direito Constitucional I","receiveEncrypted":false,"remoteEncrypted":false}}}}`.
   - Events: `ClusterConfigReceived {"device"}`, `PendingFoldersChanged {"added":[{"folderID","folderLabel","deviceID","receiveEncrypted","remoteEncrypted"}],"removed":[]}`, and the deprecated `FolderRejected {"device","folder","folderLabel"}`.
   - A pending folder **is listed even though A already has that folder**, as long as it is not shared with that device.
5. **A checks that the offered folder ID is one of its `tramado-*` folders**, then `PATCH /rest/config/folders/<id> {"devices":[{A},{B}]}`.
   - The pending entry clears in **143 ms** (`PendingFoldersChanged {"removed":[{"deviceID","folderID"}]}`).
   - B sees completion 100 / `remoteState:"valid"` for A after **157 ms**.

**Timings for the clean, scripted join of a fresh device F** (`join.sh` plus policy and roster daemons on members; folder holds 32 files / 53 MB):
- A accepts F at **2156 ms**.
- F is fully synced at **3569 ms**.
- F is connected to and sharing with A, B and C at **5206 ms**.

### 6.4 Second joiner via a *member's* invite (C uses B's invite)

With Syncthing's introducer (C sets `introducer:true` on B):
- B auto-accepts C after 2.2 s.
- B introduces A to C: C's config gains A with `introducedBy:"TKBNV23"`, addresses `["dynamic","tcp://127.0.0.1:22001"]`. The addresses are copied from B's config. A also became `introducer:true` on C, because the log says "Device is now also an introducer": the introducer flag propagates.
- C has every file 3.5 s after starting.
- C dials A. A had **not** marked B as introducer, so it saw C as a *pending device*. A's policy then provisionally added C, saw C offer the folder ID, and accepted it at **5.4 s**.
- Who accepts what: the device being knocked on (A) accepts the newcomer (C) because of the folder-ID proof. The newcomer accepts the introduced device automatically through the introducer.

**But a de-introduction cascade was verified.** When B left (deleted the folder), C's log said:
`Unsharing folder as introducer no longer shares the folder with that device … device=WSG…` and `Removing device as introducer no longer shares any folders with that device (device=WSGDTBE introducer=TKBNV23)`.
C dropped A even though A was still a member. Our policy healed it in 2 s (A still had C, dialled it, offered the folder, and C re-accepted). Even so, it caused a full index reset (`Peer has a new index ID`).

**→ Do not use Syncthing introducers. Use an app-level roster instead** (verified with E and F):
- Each member writes **only** `.tramado/members/<myDeviceID>.json`, containing `{"deviceId","name","addresses":[…],"v":1,"joinedAt"}`.
- Each member's app keeps every roster device in its config, with the folder shared to it.
- Result: E joined via C's invite with `introducer:false`. E learned A from the roster and dialled A. A's policy and A's roster both added E. E and A were sharing after 6.6 s. B (rejoining) and F reached full mesh in 0.5–5 s.
- Leave = delete your own member file (it syncs), then remove the folder. The others remove devices whose member file disappeared.

### 6.5 Membership policy: auto-accept by folder-ID proof (verified, including outsider rejection)

The prototype is `autoaccept.sh`. In the Rust app it becomes a task on the event stream.

```
on start: handle current GET /rest/cluster/pending/devices and /pending/folders (state first, then subscribe)
on PendingDevicesChanged(added): for each pending device not in remoteIgnoredDevices and under rate limit:
    POST /rest/config/devices {deviceID, name, addresses:["tcp://<observed addr>","dynamic"]}   # NO folders
    provisional[dev] = now
on PendingFoldersChanged(added): for each (folderID, dev) in GET /rest/cluster/pending/folders:
    if folderID ∈ my tramado-* folders: PATCH folder devices += dev ; provisional.remove(dev)
    else: ignore (never create folders we don't know)
every few s: for dev in provisional older than T (20 s lab; 60 s prod):
    if dev is in ANY folder's devices by now (roster/manual path) -> keep, forget provisional   # (bug found, see below)
    else: GET /rest/config -> drop dev from devices+folders, append to remoteIgnoredDevices -> PUT /rest/config
```

Outsider test with D:
- D knew A's device ID and address, marked A as `introducer:true, autoAcceptFolders:true`, and offered a guessed `tramado-aaaa…` folder plus a `default` folder.
- A provisionally added D, and its log showed `ignoring offer of unknown folder …` for both. After 20 s A logged **REJECTED, removed and ignored**.
- A's log showed `Unexpected folder ID in ClusterConfig` for D's offers.
- **D's `/rest/cluster/pending/folders` = `{}` and D's devices = only A.** D learned nothing except A's device name.
- Once D was in `remoteIgnoredDevices`, it produced **no more pending entries** (checked for 30 s or more).

Bugs found while testing, all fixed in the scripts:
- **Re-knock loop.** Deleting a device without ignoring it makes it come back as pending one second later. Always put it in `remoteIgnoredDevices` (through a full-config PUT, since there is no sub-endpoint and PATCH returns 405).
- **Race.** A device provisionally added that then became a member through the *roster* still had a provisional record. The sweep removed a legitimate member twice (E on A, B on E). Decide at sweep time from the actual config ("is it in any folder's devices?"), not from local bookkeeping. In Rust, keep membership state derived from config, not a parallel list.
- **Event IDs are per subscription mask.** Do not reuse a `since` value from one mask (or from the unfiltered stream) on another mask.

Hardening for production:
- Cap concurrent provisional devices (for example 5) and give up per IP.
- Run the policy on every member, so any online member can admit a newcomer.
- Removing someone for real (a kick) is not possible while they know the folder ID: they can re-knock and prove it. The real tool is to rotate the class. Create a new folder ID, move the files, and re-invite everyone except the kicked device. A softer option is a ban list in `.tramado/bans/<issuerDeviceId>.json` honoured by every app policy.

---

## 7. Single-writer files and conflicts

### 7.1 Chat: `.tramado/chat/<deviceId>.jsonl`

One line per message: `{"id":"m<ts>","ts":<ms>,"from":"<deviceId>","text":"…"}`. After appending, call `POST /rest/db/scan?folder=<id>&sub=.tramado%2Fchat`.

Latencies (write → line visible in the receiver's file):

| config | A→B |
|---|---|
| fs-watcher only, `fsWatcherDelayS=1`, `pullerDelayS=1` (default) | 2279–2343 ms |
| explicit scan, `pullerDelayS=1` | 1293–1305 ms |
| **explicit scan, `pullerDelayS=0`** | **280–291 ms** (B→A 241 ms) |
| fs-watcher only, `pullerDelayS=0` | 965–1330 ms |
| 10 messages to 3 receivers (sequential check) | avg 314 / 339 / 360 ms |
| **3 senders in parallel**, 10 messages each | avg 211–307 ms, max 790 ms, **0 conflicts**, every file complete everywhere |
| **public relay** (G→H) | 447–636 ms |

Where the floor of about 250 ms comes from, using event timestamps: A's scan finished 15 ms after the write (`LocalIndexUpdated`). B's `RemoteIndexUpdated` arrived about 250 ms later (index batching on the sender). The pull took about 18 ms.

**Atomicity was verified.** A Python reader in a tight loop (32,509 reads over 25 s) watched B's copy while A appended 300 lines of about 2 KB, with a scan every 5 lines:
- `partial_or_invalid_reads: 0`.
- `distinct_inodes_seen: 5`: the file is replaced by rename, and updates are coalesced.
- The only other name seen was `.syncthing.WSGDTBE-…jsonl.tmp`.

So Syncthing writes to `.syncthing.<name>.tmp` in the same directory and then renames. Readers must ignore `.syncthing.*.tmp`.

On the *sender*, our app should write each line with a single `write()` on an `O_APPEND` fd, or use temp+rename. Readers should still drop a trailing line that has no `\n`.

Rotate per month (`.tramado/chat/<deviceId>/2026-11.jsonl`), because the whole file is re-hashed on every append. That is cheap below a few MB.

### 7.2 Same file edited by two devices: conflict files

A and B both wrote `notes/shared.md` at the same moment, then both scanned. After about 2 s, **all 4 devices** had:
- `shared.md` containing "edit from B" (the winner).
- `shared.sync-conflict-20261103-155644-TKBNV23.md` containing "edit from A".

Notes:
- Naming: `<base>.sync-conflict-<YYYYMMDD>-<HHMMSS>-<7-char device ID>.<ext>`.
- ⚠ The device ID in the name was B's, although the file holds A's losing content. Do not use it as "author".
- `maxConflicts` defaults to 10.
- This is what justifies single-writer files for every app-generated file. Shared human-edited notes need a UI that detects `*.sync-conflict-*` and offers a merge.

No conflict files were ever produced under `.tramado/chat`, `claims` or `members` in any test.

---

## 8. Events API (v2.1.7, observed)

### 8.1 Event names seen

`Starting`, `StartupComplete`, `ConfigSaved`, `ListenAddressesChanged`, `DeviceDiscovered`, `DeviceConnected`, `DeviceDisconnected`, `DevicePaused`, `DeviceResumed`, `DeviceRejected` (deprecated, still emitted), `PendingDevicesChanged`, `FolderRejected` (deprecated, still emitted), `PendingFoldersChanged`, `ClusterConfigReceived`, `StateChanged`, `FolderScanProgress`, `LocalIndexUpdated`, `RemoteIndexUpdated`, `ItemStarted`, `ItemFinished`, `FolderSummary`, `FolderCompletion`, `FolderPaused`, `FolderResumed`, `Failure`, `LocalChangeDetected`, `RemoteChangeDetected`.

**There is no `DevicePendingDetected`.** Unknown names in `events=` are **silently ignored** (HTTP 200, `[]`), so a typo means you never get events.

### 8.2 Payloads (verbatim)

```json
{"id":23,"globalID":23,"time":"2026-11-03T15:47:28.284638161Z","type":"PendingDevicesChanged","data":{"added":[{"address":"127.0.0.1:22002","deviceID":"TKBNV23-…","name":"Student B"}]}}
{"id":24,"type":"DeviceRejected","data":{"address":"127.0.0.1:22002","device":"TKBNV23-…","name":"Student B"}}
{"id":31,"type":"DeviceConnected","data":{"addr":"127.0.0.1:22002","clientName":"syncthing","clientVersion":"v2.1.7","deviceName":"Student B","id":"TKBNV23-…","type":"tcp-client"}}
{"id":34,"type":"ClusterConfigReceived","data":{"device":"TKBNV23-…"}}
{"id":33,"type":"PendingFoldersChanged","data":{"added":[{"folderID":"tramado-gezn…","folderLabel":"Direito Constitucional I","deviceID":"TKBNV23-…","receiveEncrypted":false,"remoteEncrypted":false}],"removed":[]}}
{"id":40,"type":"PendingFoldersChanged","data":{"removed":[{"deviceID":"TKBNV23-…","folderID":"tramado-gezn…"}]}}
{"id":32,"type":"FolderRejected","data":{"device":"TKBNV23-…","folder":"tramado-gezn…","folderLabel":"Direito Constitucional I"}}
{"type":"DeviceDisconnected","data":{"error":"device is paused","id":"L3YY4OM-…"}}
{"type":"DeviceDiscovered","data":{"addrs":["tcp://192.168.122.131:22000","quic://192.168.122.131:22000",…],"device":"TKBNV23-…"}}
{"type":"LocalIndexUpdated","data":{"filenames":["notes/scan0-1.txt"],"folder":"tramado-…","items":1,"sequence":23,"version":23}}
{"type":"RemoteIndexUpdated","data":{"device":"WSGDTBE-…","folder":"tramado-…","items":1,"sequence":23,"version":23}}
{"type":"ItemStarted","data":{"action":"update","folder":"tramado-…","item":"notes/scan0-1.txt","type":"file"}}
{"type":"ItemFinished","data":{"action":"update","error":null,"folder":"tramado-…","item":"notes/scan0-1.txt","type":"file"}}
{"type":"StateChanged","data":{"duration":2.69,"folder":"tramado-…","from":"idle","to":"sync-waiting"}}   // idle→sync-waiting→idle→sync-preparing→syncing→sync-preparing→idle ; scanner: idle→scan-waiting→scanning→idle
{"type":"FolderScanProgress","data":{"current":31,"folder":"tramado-…","rate":0,"total":32}}
{"type":"FolderSummary","data":{"folder":"tramado-…","summary":{ …same fields as /rest/db/status… }}}
{"type":"FolderCompletion","data":{"completion":90.9,"device":"TKBNV23-…","folder":"tramado-…","globalBytes":341,"globalItems":12,"needBytes":31,"needDeletes":0,"needItems":1,"remoteState":"valid","sequence":21}}
{"type":"FolderPaused","data":{"id":"tramado-…","label":"Direito Constitucional I"}}   // FolderResumed: same shape
{"type":"DevicePaused","data":{"device":"WSGDTBE-…"}}                                    // DeviceResumed: same shape
{"type":"Starting","data":{"home":"/…/run/A","myID":"WSGDTBE-…"}}   {"type":"StartupComplete","data":{"myID":"WSGDTBE-…"}}
{"type":"ConfigSaved","data":{<entire config: defaults,devices,folders,gui,ldap,options,remoteIgnoredDevices,version>}}
{"type":"Failure","data":"index sender does not exist for connection on which indexes were received"}   // benign; seen 3x around rapid config changes/reconnects
// /rest/events/disk stream:
{"id":12,"globalID":196,"type":"RemoteChangeDetected","data":{"action":"modified","folder":"tramado-…","folderID":"tramado-…","label":"Direito Constitucional I","modifiedBy":"WSGDTBE","path":"notes/scan0-1.txt","type":"file"}}
{"id":12,"globalID":185,"type":"LocalChangeDetected","data":{ same shape }}
```

### 8.3 Semantics that matter for the app

- **Default stream:** `/rest/events` without `events=` **excludes** `LocalChangeDetected` and `RemoteChangeDetected`. Get those from `/rest/events/disk` or by naming them explicitly.
- **IDs are per subscription.**
  - Each distinct `events=` mask is a separate buffered subscription with its own `id` sequence. `globalID` is global.
  - `since` refers to `id`.
  - A mask's subscription is created by the first request, and **events before that are not delivered**. `since=0` on a new mask returned `[]` for earlier `PendingDevicesChanged`.
  - Pattern to use: read current state over REST, then subscribe. To prime a subscription, make one request with `timeout=0` at startup.
- **Long-poll:** `timeout` is in seconds (default 60). The call returns as soon as at least one event is available. Example: `events=RemoteChangeDetected,ItemFinished` returned `ItemFinished` for `.tramado/chat/…jsonl` 278 ms after A's write.
- **Recommended app subscriptions** (two loops):
  1. `events=PendingDevicesChanged,PendingFoldersChanged,DeviceConnected,DeviceDisconnected,FolderCompletion,FolderSummary,StateChanged,FolderPaused,FolderResumed,ClusterConfigReceived`. Use it for membership and the sync-status UI.
  2. `/rest/events/disk`, or `events=ItemFinished,RemoteChangeDetected`. On paths under `.tramado/chat/`, `claims/` and `members/`, re-read the file (incremental read from the last offset) and refresh the UI. On paths under `recordings/` and `docs/`, re-index the library and embeddings.

---

## 9. Transcription claim protocol (verified)

The prototype is `claim.sh`. Claim file: `.tramado/claims/<recordingId>/<deviceId>.json`, written only by its owner via temp+rename:

```json
{"v":1,"recordingId":"rec-2026-11-03-aula1","deviceId":"<me>","claimedAt":1793721438157,
 "status":"claimed|working|done|released","heartbeat":0,"engine":"whisper.cpp/ggml-small"}
```

### Algorithm

1. **Pre-check.** If a live claim exists (`done`, or `working`/`claimed` whose content changed recently), do not claim.
2. Write your own claim with `claimedAt = max(local_now_ms, max(claimedAt seen in folder) + 1)`. This bounds the advantage of a slow clock. Then call `POST /rest/db/scan?sub=.tramado/claims/<rec>`.
3. **Settle window.** Wait W (5 s in the lab, 10–15 s in production). Also wait until `FolderCompletion` is 100 for every *connected* member, so they hold your claim.
4. **Winner** = the first claim after sorting by `(rank(status), claimedAt, deviceId)`, where `rank: done=0, working=1, claimed=2`, ignoring `released` claims.
   - If you are the winner, set `status:"working"` and rewrite your file with `heartbeat+1` every 60–120 s.
   - Otherwise delete your claim or set it to `released`.
5. When finished, the winner writes the transcript to `transcripts/<rec>.json` (single writer) and sets its claim to `status:"done"`.
6. **Staleness** is judged by *local observation*: if a claim's content (heartbeat) has not changed for 10 minutes of **my** clock, treat it as dead and start a new round. This is immune to remote clock skew.

### Results

- **Run 1.** B, C and E claimed at the same instant (claimedAt 1793721438157 / …158 / …158). After 5 s **all three printed winner TKBNV23 (B)**. C and E were tied on the millisecond, and the device-ID tie-break was deterministic.
- **Run 2 (partition plus clock skew).**
  - E's folder was paused (`PATCH {"paused":true}`; A saw `remoteState:"paused"`).
  - C claimed alone and won.
  - Two seconds later, offline E wrote a claim with its clock **60 s behind**.
  - E resumed (`{"paused":false}`), and its claim reached C **338 ms** later.
  - With the naive rule `min(claimedAt)`, **every device switched to E**. That still converges, but C's in-progress work would be preempted.
  - With rule v2 (C had marked itself `working`), **A, C and E all chose C (working)**.
- **Clock skew is therefore a fairness and wasted-work problem, not a correctness problem**, as long as everyone applies the same deterministic rule to the same set of files. The `working` precedence plus local-observation staleness handles real partitions.
- **Duplicate work is still possible**, but only when two devices both reach `working` while partitioned. When they reconnect, the loser aborts.

---

## 10. Folder operations

### 10.1 Ignores (`.stignore`)

- Set them over REST on **every device**, because `.stignore` itself is **not synced** (verified: B kept its own copy).
- Also set them in `/rest/config/defaults/ignores` so new folders inherit them.
- Patterns without a leading `/` are expanded to match at any depth. For example `.tramado/cache` became `**/.tramado/cache/**`. Anchor the app paths.

Recommended list (as sent in `join.sh`):

```json
{"ignore":["// Tramado managed ignores (v1)","(?d).DS_Store","(?d)Thumbs.db","(?d)desktop.ini","(?d)._*",
 "/.tramado/cache","/.tramado/local","*.tmp","*.part","*.crdownload","~$*",".~lock.*#","*.swp"]}
```

`(?d)` means the file may be deleted if it blocks a directory deletion. Verified: `.DS_Store`, `~$Aula.docx`, `draft.tmp` and `.tramado/cache/emb.bin` stayed only on A, while `docs/aula1.md` synced.

Keep per-device data (embeddings DB, whisper model, UI state) **outside** the class folder, or under `/.tramado/local`.

### 10.2 `.stfolder` marker

- Created automatically when the folder is added.
- If it goes missing (unmounted drive, user deleted the folder): `POST /rest/db/scan` returns **HTTP 500**, and `db/status` becomes `{"state":"error","error":"folder marker missing (this indicates potential data loss, search docs/forum to get information about how to proceed)"}`. **Nothing is deleted on peers.**
- Restoring the marker and rescanning returns the folder to `idle`.
- The app should surface this state and offer "relocate folder".

### 10.3 Large files

- 50 MB over loopback: 647 ms (scan 76 ms). The hash matched on A, B, C and E, and swarming came from multiple peers.
- Public relay: about 6 Mbit/s, so a 200 MB WAV would take about 4–5 min.
- **Record or compress to Opus**: 32 kbps mono is about 14 MB per hour.
- Progress: poll `GET /rest/db/completion?folder&device` per member, or use `FolderCompletion` events (`needBytes`). Use `/rest/db/need` for the per-file queue, and `/rest/db/file` → `availability` for who has a file.

### 10.4 Versioning (recommended: trashcan)

- Setting: `PATCH /rest/config/folders/<id> {"versioning":{"type":"trashcan","params":{"cleanoutDays":"30"},"cleanupIntervalS":3600}}`.
- A deleted `docs/aula1.md`. B (with trashcan) kept `.stversions/docs/aula1.md`, while C (without it) lost it.
- `GET /rest/folder/versions?folder=` returned `{"docs/aula1.md":[{"versionTime":"2026-11-03T16:03:20Z","modTime":…,"size":5}]}`.
- `POST /rest/folder/versions?folder=` with `{"docs/aula1.md":"2026-11-03T16:03:20Z"}` returned `{}`. The file came back on B **and re-synced to A and C**.
- **Set trashcan versioning on every member**, so any member can "undelete" for the class. `.stversions` is never synced.

### 10.5 Pause / resume, leave, device removal

- **Folder pause.** `PATCH {"paused":true}` took 1 ms. `db/status` state becomes `""` while paused. Peers report `remoteState:"paused"`. Resume replayed offline changes in 338 ms.
- **Device pause.** `POST /rest/system/pause?device=` and `resume`.
- **Unsharing a folder from a member.** With `PATCH devices` without E:
  - E then reports `remoteState:"notSharing"` for A, and E's connection stays up.
  - A's `pending/folders` did **not** show E's continued offer until E's next ClusterConfig (on reconnect or E's config change).
  - On reconnect, the auto-accept policy would let E back in, because E still holds the ID. See the kick discussion in §6.5.
- **Leave.**
  1. Delete your own `members/<id>.json`. This propagated in 1.5 s.
  2. `DELETE /rest/config/folders/<id>`. The files stay on disk (51 MB remained).
  3. Delete devices that no longer share any folder.
  - The others remove the leaver from the folder and the device when its member file disappears.

### 10.6 Device names

- Set your own with `PATCH /rest/config/devices/<myID> {"name":…}`.
- The name is announced in Hello, so pending entries show it ("Student B").
- Peers update their stored name only with `overwriteRemoteDeviceNamesOnConnect:true`, and only on reconnect (verified: about 1 s after a pause/resume).
- For the UI, prefer the display name in the **roster file**, which updates live and can carry the student's name and avatar.

---

## 11. Production connectivity test (public discovery and relays)

Setup: instances G and H with `listenAddresses:["dynamic+https://relays.syncthing.net/endpoint"]` only (to force a relay), global discovery on, local discovery off.

- Joining a relay took about 10 s after start (`Joined relay (uri=relay://95.216.157.10:22067)`). The announced address was `relay://95.216.157.10:22067/?id=NZRTFEN-…`.
- IPv6 announce failed on this VM (`network is unreachable`). That is harmless.
- **Each device added the other with `addresses:["dynamic"]` within a second of starting. After 3.5 min they still had not connected.**
  - `lastDialStatus:{}` and `/rest/system/discovery:{}`: H never even dialled.
  - Root cause, checked by hand: `curl https://discovery-lookup.syncthing.net/v2/?device=<unannounced valid ID>` returns **`HTTP/2 404` with `retry-after: 2016`**. Another try returned `retry-after: 2523` (HTTP 400 for a malformed ID).
  - Each instance looked the other up before the other's first announcement, got a 404, and Syncthing **negative-caches it for about 35–40 minutes**.
- **Fix, verified.** App-side lookup and address injection:

  ```bash
  ADDRS=$(curl -s "https://discovery-lookup.syncthing.net/v2/?device=$GID" | jq -c '.addresses + ["dynamic"]')
  # -> ["relay://95.216.157.10:22067/?id=NZRTFEN-…","dynamic"]
  curl -X PATCH -H "X-API-Key: $K" -d "{\"addresses\":$ADDRS}" http://127.0.0.1:$P/rest/config/devices/$GID
  ```

  The devices were **connected 551 ms later** (`type:"relay-client"`, `isLocal:false`, TLS 1.3).
- Over that relay, chat latency was **447–636 ms** and **5 MB took 6.9 s (about 6 Mbit/s)**.
- **Recommendations:**
  1. Invites carry concrete addresses, including relay URIs and LAN addresses, from `connectionServiceStatus`.
  2. Whenever a configured member has been disconnected for more than 30 s, the app performs its own lookup (`GET https://discovery-lookup.syncthing.net/v2/?device=<id>`, response `{"seen":"…","addresses":[…]}`) and PATCHes the addresses as `[…found, "dynamic"]`.
  3. Members also publish their current addresses in their roster file (`members/<id>.json`), so peers that are already connected keep fresh addresses for the others.

---

## 12. Gotchas checklist

1. **Port 22000 sharing through SO_REUSEPORT** with the user's own Syncthing breaks both apps silently. Use your own port.
2. **A GUI port in use is fatal** (exit 1). Choose a free port, or a short absolute Unix socket path (≤107/103 bytes; a relative path becomes an abstract socket).
3. **`serve` forks a monitor even with `--no-restart`.** Killing the parent with SIGKILL orphans the child. Use `STMONITORED=yes`, and note that `--log-file` is then ignored.
4. **Exit code 3 = restart requested.** The supervisor must respawn.
5. **`POST /rest/config/folders` on an existing ID replaces the folder** (devices reset). Use PATCH, and always send full `devices` arrays.
6. **No `/rest/config/remoteIgnoredDevices` (404) and no `PATCH /rest/config` (405).** Use a full-config GET, edit and PUT.
7. **Pending folders appear only after a device is accepted** (the ClusterConfig requirement), and refresh only on a new ClusterConfig.
8. **Pending device `address` is the observed source address.** Always add `"dynamic"` as well.
9. **Event IDs are per mask, and new masks miss past events.** Unknown event names are silently ignored. `Local/RemoteChangeDetected` are not in the default stream.
10. **Introducer de-introduction cascades** remove still-valid members when an introducer leaves. Use the app roster, with `introducer:false`.
11. **Discovery negative cache of about 35–40 minutes.** Put addresses in invites and do app-side lookups.
12. **`pullerDelayS` defaults to 1 s.** Set it to 0 on class folders. Always call `POST /rest/db/scan&sub=` after app writes.
13. **`.stignore` is per device** and not synced. Unanchored patterns match at any depth.
14. **The conflict-file device-ID suffix does not identify the author** of the losing content.
15. **`connected:true` appears briefly** for a peer that is about to reject us. Use `DeviceConnected`/`ClusterConfigReceived` plus `remoteState:"valid"` from `/rest/db/completion` as the "in sync with X" signal.
16. **v2 opens several TCP connections per device** (`primary` + `secondary[]`). Byte counters are aggregated at the top level of `/rest/system/connections`.
17. **`generate` leaves `.syncthing.tmp.<n>` in the home dir.** On first `serve` it writes `config.xml.v0` ("Archiving a copy of old config file format"). Both are harmless.
18. **Benign `Failure` events** ("index sender does not exist for connection…") appear around rapid reconnects. Log them, but do not alert the user.
19. **The managed instance announces itself to public discovery** (device ID, IPs). That is expected for P2P. Mention it in PRIVACY.md (Trama has one).

---

## 13. Sketch for the Rust side (Tauri 2)

- Ship `syncthing` as a Tauri sidecar: `bundle.externalBin: ["binaries/syncthing"]`, with the per-target names `syncthing-x86_64-unknown-linux-gnu`, `-aarch64-apple-darwin`, `-x86_64-pc-windows-msvc.exe` and so on. The macOS universal zip exists.
- Alternatively, download on first "create/join class", like the whisper model. Verify SHA-256 against a hash pinned in the app; do not trust the downloaded `sha256sum.txt.asc` alone.
- At about 14 MB compressed, bundling is reasonable. MPL-2.0 is compatible with the app's licence.

```rust
// spawn (tokio::process::Command); env is the important part
let mut cmd = Command::new(sidecar_path);
cmd.args(["serve", "--home", home, "--no-browser", "--no-restart", "--no-upgrade",
          "--gui-address", &format!("http://127.0.0.1:{gui_port}"), "--gui-apikey", &api_key])
   .env("STMONITORED", "yes").env("STNOUPGRADE", "1").env("STVERSIONEXTRA", "Tramado")
   .stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
#[cfg(target_os = "linux")]
unsafe { cmd.pre_exec(|| { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM); Ok(()) }); }
// readiness: poll GET /rest/noauth/health until {"status":"OK"}
// client: reqwest with default header X-API-Key; long-poll events with .timeout(Duration::from_secs(70)) and ?timeout=60
```

Modules: `syncthing::{supervisor, client (typed REST), events (2 long-poll loops → tokio broadcast), membership (policy + roster), chat (jsonl tail reader with offsets), claims}`. Expose them to the UI via Tauri commands and events.

---

## 14. Timings summary (localhost unless noted)

| step | ms |
|---|---|
| `generate` | 37 |
| REST ready after spawn | < 1000 |
| create folder | 37 |
| joiner's config calls (device + folder + ignores) | 108–179 |
| joiner appears in inviter's pending devices | 623 |
| provisional add → pending folder offer visible | 1074 |
| share → joiner in sync (empty folder) | 157 |
| fresh joiner F: accepted / synced 53 MB / full mesh | 2156 / 3569 / 5206 |
| C via B (introducer): B accepted / C has all files / A accepted C | 2200 / ~3500 / 5450 |
| E via C (roster, no introducer): A shares / E↔A in sync | 5366 / 6613 |
| chat line, scan + pullerDelayS=0 | 241–291 (relay 447–636) |
| file via fs-watcher only (defaults) | 1900–2350 |
| 50 MB file (loopback) | 647 |
| 5 MB via public relay | 6881 (≈ 6 Mbit/s) |
| connect via relay after injecting the looked-up address | 551 |
| connect via relay with `dynamic` only (negative-cached) | > 210,000 (never, until injected) |
| graceful shutdown | ≈ 1000 |

---

## 15. Lab scripts (all in `/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/syncthing/`)

| file | what |
|---|---|
| `lib.sh` | Source it. Provides `api INST METHOD PATH [curl args]`, `start_inst INST` (generate + serve with GUI/API-key overrides), `lab_options INST`, `stop_inst`, `myid`, `now_ms`, and a port map (A–H, U) |
| `evlog.sh INST [/rest/events/disk]` | Long-poll logger. Appends events plus receive time to `run/<INST>.events_*.jsonl` |
| `autoaccept.sh INST [timeout_s]` | Membership policy prototype (provisional add → folder-ID proof → accept, or remove and ignore) with the fixes from §6.5 |
| `roster.sh INST` | App-level introducer. Writes `.tramado/members/<id>.json` and adds and shares every roster device |
| `join.sh JOINER INVITE_B64URL` | What "paste invite" does: device + folder + managed ignores |
| `measure.sh SRC DST REL watch\|scan [bytes]` | Write → visible latency, with hash check for binaries |
| `chat_test.sh SENDER N` (env `MEMBERS="A B C"`) | Chat latency statistics per receiver |
| `claim.sh INST REC [skew_ms] [settle_s]` | Claim protocol, round 1 |
| `reader_check.py DIR FILE SECONDS` | Run with `python3 -I`. Partial-read and atomic-rename checker |
| `run/` | Homes, logs (`<INST>.log`), event JSONL logs, autoaccept and roster logs from this session |
| `data/` | Folder contents for each instance (including the conflict files and `.stversions`) |
| `bin-extract/syncthing-linux-amd64-v2.1.7/syncthing` | Verified binary. `dl/` has the tarball and `sha256sum.txt.asc`. `release-key.txt` is the Syncthing release key |

All lab Syncthing instances, logger, policy and roster loops, and the gpg-agent and dirmngr were stopped at the end. `ss` showed no Syncthing sockets left.
