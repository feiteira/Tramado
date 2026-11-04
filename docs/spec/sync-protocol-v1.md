# Tramado Sync Protocol, version 1

| | |
|---|---|
| Status | Draft 1.1 (2026-11-03, review round 1: Rust/TypeScript split stated, identity without ports, signatures, admission and leaving hardened, claims made durable, mass-delete guard on both sides). Normative for Tramado 0.1. Sections marked **(v1.1)** are specified now and built after 0.1 (architecture §1.1). |
| Companion | [`class-folder-v1.md`](class-folder-v1.md) (the on-disk format; cited below as "folder spec §n"). |
| Syncthing | v2.1.7 ("Hafnium Hornet"), bundled. Every REST behaviour marked ✔ was exercised against this binary on 2026-11-03; ◇ means taken from Syncthing's documentation and not exercised. |
| Licence | MPL-2.0. |

This document says how Tramado uses Syncthing to share class folders with no server of its own: the
managed Syncthing process, the REST calls, invites, joining, how every member admits newcomers, the
roster, the "only one person transcribes" claim protocol, chat delivery, leaving, removing someone,
pairing a second computer, and what happens offline. The key words MUST, SHOULD and MAY are used as in
RFC 2119.

---

## 0. Principles

1. **One class = one Syncthing folder.** Its folder ID is the class ID `tramado-<26 base32>`, derived from the
   creator's device ID and a 128-bit random nonce (folder spec §2.1), so it cannot be guessed. **The folder ID is the capability**: whoever knows it can join. It is only ever sent inside
   invites and to devices the folder is shared with.
2. **Tramado runs its own, private Syncthing** (`tramado-syncthing`). It never uses, configures or reads
   the user's own Syncthing.
3. **Every member is equal.** Every member's app runs admission (§9), roster reconciliation (§10) and the
   claim rules (§14), so the class works with any subset of members online. Nothing depends on the class
   creator being online.
4. **No Syncthing introducers, ever.** Membership is an app-level roster (`.tramado/members/`), because
   an introducer leaving makes Syncthing remove still-valid members (verified cascade).
5. **Single-writer files, authorship checks and signatures** (folder spec §6). Syncthing does not prevent a
   member from overwriting or deleting another member's file, so Tramado checks `modifiedBy` against the bytes it
   read, and verifies the device signatures of the records that decide membership and authority.
6. **The webview never sees the Syncthing API key, the GUI port or a raw REST response.** Everything that talks to
   Syncthing runs in Rust (std threads, `ureq` 3.5): the managed process, REST, events, admission, the Syncthing
   side of roster reconciliation and bans, discovery, self-heal, the mass-delete guard and device signatures. The
   class-folder semantics (trust judgement, person bindings, organisers, effective bans, claims, chat, presence,
   invite codes) run in the app's TypeScript, which pushes its results to Rust as a per-class **policy**; Rust
   executes admission and reconciliation from the last policy even while the webview reloads, and re-checks every
   action that widens access on its own (§9.5). Behaviour on disk and on the wire is the same either way
   (architecture D-1).

---

## 1. Components

| Module | Job | Runs in |
|---|---|---|
| `sync::supervisor` | Spawns, watches, restarts and stops `tramado-syncthing` (§2). | Rust |
| `sync::client` | Typed REST client (§3, §4), path normalisation (§3.6). | Rust |
| `sync::config_writer` | The **only** code that mutates Syncthing's config. One thread, one queue, read-modify-write per change (§3.3). | Rust |
| `sync::events` | Two long-poll threads (§5). | Rust |
| `sync::admission` | §9, deciding from the policy plus Rust's own checks (§9.5). | Rust |
| `sync::roster` | §10 (Syncthing config side), §11. | Rust, roster from the policy |
| `sync::trust` | Authorship verdicts and the trust cache (§12.1–12.2). | TypeScript |
| `sync::selfheal`, `sync::sign` | Self-heal mirror (§12.3); device signatures (§12.4). | Rust |
| `sync::presence`, `sync::claims`, `sync::chat` | §13, §14, §15. | TypeScript (the heartbeat of a running transcription job: Rust) |

---

## 2. The managed Syncthing instance

### 2.1 Binary

- Sidecar name **`tramado-syncthing`** (a deb package installs sidecars to `/usr/bin/<name>`; plain
  `syncthing` would collide with the distribution's package). Files in the source tree:
  `desktop/src-tauri/binaries/tramado-syncthing-<target-triple>[.exe]`, fetched by
  `tools/fetch-syncthing.mjs` from the v2.1.7 GitHub release, verified by pinned SHA-256 (and the
  release's GPG-signed `sha256sum.txt.asc`).
- Resolution at run time: environment variable `TRAMADO_SYNCTHING_BIN` (development and tests) if set;
  otherwise the sidecar next to the app executable. If neither exists: error `SYNC_UNAVAILABLE`; local
  classes keep working.
- Syncthing's `LICENSE.txt` (MPL-2.0) and `AUTHORS` ship as app resources.

### 2.2 Home directory

`<app_local_data_dir>/syncthing/` (folder spec §12), mode `0700`. It is never inside a class folder.

| File | Written by | Contents |
|---|---|---|
| `config.xml` | Tramado (pre-seed, §2.3), then Syncthing | Syncthing configuration, mode `0600`. **The API key lives here** and nowhere else on disk. |
| `cert.pem`, `key.pem` | `generate` | The device identity. Losing them means a new device ID. |
| `index-v2/` | Syncthing | Database. |
| `syncthing.lock` | Syncthing | Home lock. |
| `syncthing.log`, `.log.1`, `.log.2` | the child's stdout/stderr (§2.4) | Logs. |
| `tramado-instance.json` | Tramado | `{"format":"tramado.syncthing-instance","version":1,"deviceId":DeviceId,"syncPort":number\|null,"installId":Hex32,"machine":string\|null,"createdAt":Instant}` (`machine`: §2.5 step 0) |
| `runtime.json` | Tramado | `{"pid":number,"guiPort":number,"startedAt":Instant,"exe":string}`, written after every spawn, deleted after a clean stop. Used only for orphan clean-up. |

### 2.3 First initialisation: the identity (once per installation)

Run when `config.xml` does not exist, at the first `identity()` call (architecture §5.3). It creates the device
identity and nothing else: **no port is probed and nothing listens**, so a user who never shares sees no firewall
prompt, and local classes, which need the device ID for their derived IDs and signatures (folder spec §2.1, §6.6),
work even when no port is free. If the sidecar binary is missing, `identity()` fails with `SYNC_UNAVAILABLE` and no
class can be created (the app is incomplete; onboarding says so, UX §3.1).

1. **API key**: 32 characters from `[A-Za-z0-9]`, from the OS CSPRNG.
2. **GUI password**: 32 random bytes, base64; store only its bcrypt hash (`$2a$`, cost 10). The plain
   password is discarded: Tramado never logs into the web GUI, the password only locks it.
   (Verified: a plain-text password in `config.xml` is **not** hashed by Syncthing, so it must be
   pre-hashed. `PATCH /rest/config/gui` with a plain password does hash it.)
3. Write `config.xml` (mode `0600`, home `0700`), exactly as below with `{P}` = `0` and `{G}` = `0` (both are
   replaced before the first spawn, §2.4):

```xml
<configuration version="52">
    <gui enabled="true" tls="false">
        <address>127.0.0.1:{G}</address>
        <apikey>{API_KEY}</apikey>
        <user>tramado</user>
        <password>{BCRYPT_HASH}</password>
    </gui>
    <options>
        <listenAddress>tcp://0.0.0.0:{P}</listenAddress>
        <listenAddress>quic://0.0.0.0:{P}</listenAddress>
        <listenAddress>dynamic+https://relays.syncthing.net/endpoint</listenAddress>
        <globalAnnounceEnabled>true</globalAnnounceEnabled>
        <localAnnounceEnabled>true</localAnnounceEnabled>
        <relaysEnabled>true</relaysEnabled>
        <natEnabled>true</natEnabled>
        <urAccepted>-1</urAccepted>
        <urSeen>3</urSeen>
        <startBrowser>false</startBrowser>
        <autoUpgradeIntervalH>0</autoUpgradeIntervalH>
        <crashReportingEnabled>false</crashReportingEnabled>
        <overwriteRemoteDeviceNamesOnConnect>true</overwriteRemoteDeviceNamesOnConnect>
    </options>
</configuration>
```

4. Run `tramado-syncthing generate --home=<home>` (≈ 40 ms; verified to keep every pre-seeded value and to
   add `cert.pem`, `key.pem`, the own device and `<defaults>`; it leaves a harmless empty
   `.syncthing.tmp.<n>` file). Then `tramado-syncthing device-id --home=<home>` gives the device ID.
5. Write `tramado-instance.json` with `syncPort: null`, a random `installId` (16 bytes, hex) and `machine` (§2.5).

**Lost identity.** If `classes.json` lists a class with `shared: true` but `tramado-instance.json` is missing (the
Syncthing home was lost while the app settings survived), the new identity is a new device: §2.7 re-creates each
shared folder with every device that has a trusted member file in the local copy of the class (their addresses
plus `dynamic`) instead of `[me]` only, the app writes a new member file for the new device, and the UI says
"This computer has a new sharing identity. Your classmates' computers will reconnect to it." (the person key is
kept, so the new device is still bound to the same person, folder spec §8.3.1).

### 2.4 Starting

**Before every spawn** (Syncthing is not running and `config.xml` is ours):

1. **Copied identity check** (§2.5 step 0). On a mismatch, do not spawn.
2. **Sync port P** (only if `tramado-instance.json.syncPort` is `null`, or the last start reported a listener error
   for it): for `P` in `22100..22199` in order, bind TCP `0.0.0.0:P` and UDP `0.0.0.0:P`; if both succeed, close
   them and use `P`. Never `22000` (sharing it with a user's own Syncthing through `SO_REUSEPORT` silently breaks
   both). If none is free: `SYNC_PORT`. Write `P` into the `<listenAddress>` elements and `tramado-instance.json`.
3. **GUI port G**: bind `127.0.0.1:0`, read the port, close the socket; write it into `<gui><address>`.
4. **Pause every class folder**: set `paused="true"` on every `<folder>` whose `id` starts with `tramado-`. So no
   deletion or change made while the app was closed (a file manager emptying a folder, a deleted `.stignore`) is
   scanned and sent before the event loops listen and the ignores are re-applied; §2.7 unpauses them.

With `TRAMADO_DATA_DIR` set (development, e2e), step 2 writes `tcp://127.0.0.1:{P}` as the only listen address and
`false` for global/local announce, relays and NAT.

```
argv: tramado-syncthing serve --home=<home> --no-browser --no-restart --no-upgrade
                              --gui-address=http://127.0.0.1:<G>
env:  STMONITORED=yes          # one process, no monitor child (we are the monitor)
      STNOUPGRADE=1
      STVERSIONEXTRA=Tramado   # version string shows "[Tramado, stnoupgrade]"
      STGUIAPIKEY=<API_KEY>    # never on argv: /proc/<pid>/cmdline is world-readable, environ is not
stdin:  null
stdout, stderr: the same file handle, <home>/syncthing.log opened for append
```

- The key is read from `config.xml` (`<gui><apikey>`).
- `--log-file` is **not** used: Syncthing ignores it when `STMONITORED=yes` (verified) and logs to stdout.
  Never use a pipe for stdout/stderr (an undrained pipe blocks the child).
- Log rotation, before each spawn: if `syncthing.log` is larger than 5 MiB, rename `.log.1` → `.log.2`
  and `.log` → `.log.1`.
- Linux: the child is spawned **and waited on** by one dedicated, long-lived thread named
  `tramado-syncthing`, with `pre_exec` doing `prctl(PR_SET_PDEATHSIG, SIGTERM)` and then raising SIGTERM
  if `getppid()` is no longer Tramado (verified: SIGKILL of the parent kills Syncthing).
- Windows: `CREATE_NO_WINDOW`, and the child is assigned to a Job Object with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` whose handle is never closed (it closes when Tramado dies).
- macOS: no parent-death signal exists; orphan clean-up at the next start (§2.6) covers it.
- Write `runtime.json` right after the spawn.

### 2.5 Readiness and identity

0. **Copied identity** (checked before every spawn): `tramado-instance.json.machine` MUST equal this computer's
   machine ID (Linux `/etc/machine-id`; macOS `IOPlatformUUID` from `ioreg -rd1 -c IOPlatformExpertDevice`; Windows
   `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`; when none can be read, the check is skipped). A mismatch
   means the Syncthing home was copied from another computer (migration assistant, backup restore, a copied home
   directory), and two computers would run one device ID. Tramado does not start Syncthing and reports
   `SYNC_IDENTITY_COPIED`; the UI asks "This looks like a copy of another computer's Tramado. [Set up as a new
   computer] [This is the same computer]". "New computer" moves `syncthing/` to `syncthing.copied-<date>/`, creates
   a new identity (§2.3, lost-identity path) and keeps the person key; "Same computer" rewrites `machine`.
1. Poll `GET /rest/noauth/health` every 100 ms until it returns `{"status":"OK"}` (normally < 1 s), for at
   most 15 s; then treat the start as failed (§2.6).
2. `GET /rest/system/status`: `myID` MUST equal `tramado-instance.json.deviceId`; otherwise stop
   (`SYNC_UNAVAILABLE`, "the sharing identity changed") and show diagnostics.
3. `GET /rest/config/gui`: if `password` does not start with `$2`, `PATCH /rest/config/gui
   {"user":"tramado","password":"<32 random chars>"}` (✔ stores a bcrypt hash).
4. Prime the event loops (§5), re-apply managed settings (§2.7, which unpauses the folders the user did not
   pause), then run the start-up passes: admission (§9.2 `on_start`), roster reconciliation (§10), self-heal
   (§12.3). The app runs trust verification (§12.1) and claim resume (§14.5) when it receives `status: running`.

### 2.6 Supervisor

| Exit | Meaning | Action |
|---|---|---|
| `0` after Tramado asked it to stop | Stopped | Done. |
| `0` unrequested | Someone else stopped it | Restart after 1 s. |
| `3` | Restart requested (`/rest/system/restart` or a config change that needs it) | Restart at once. |
| `1`, log tail contains `Failed to acquire lock` | Another process holds the home | Orphan clean-up (below), then retry once. |
| `1`, log tail contains `Failed to start API` or `address already in use` | GUI port taken | New GUI port, retry; at most 3 times in a row. |
| anything else, or killed by a signal | Crash | Restart with backoff 1, 2, 4, 8, 16, 32, 60 s. After 5 failures within 5 minutes: state `error`, code `SYNC_UNAVAILABLE`, "Sharing stopped. [Try again] [Copy diagnostics]". |

"Log tail" = the last 50 lines of `syncthing.log` written since the spawn.

**Orphan clean-up** (before every spawn, and after a lock failure): if `runtime.json` exists,
`POST http://127.0.0.1:<guiPort>/rest/system/shutdown` with the key (2 s timeout, errors ignored); wait up
to 3 s for `pid` to exit; if it is still alive **and** its executable path equals our sidecar path, kill
it. Delete `runtime.json`.

### 2.7 Managed settings, re-applied at every start (idempotent)

```
PATCH /rest/config/options
{"listenAddresses":["tcp://0.0.0.0:P","quic://0.0.0.0:P","dynamic+https://relays.syncthing.net/endpoint"],
 "globalAnnounceEnabled":!localOnly,"localAnnounceEnabled":true,"relaysEnabled":!localOnly,"natEnabled":!localOnly,
 "urAccepted":-1,"urSeen":3,"startBrowser":false,"autoUpgradeIntervalH":0,"crashReportingEnabled":false,
 "overwriteRemoteDeviceNamesOnConnect":true,"maxSendKbps":<pref, 0 = unlimited>,"maxRecvKbps":<pref, 0>}

PATCH /rest/config/devices/<myID>   {"name": "Tramado", or "<person name> (<computer name>)" (≤ 64 chars) while a class is joining (§9.4)}

for every shared class (not in classes.json leftClasses):
  if the folder is missing from the config: re-create it as in §6.1 (paused, ignores, resume); after a lost identity
     (§2.3) with every device that has a trusted member file in the local copy
  PATCH /rest/config/folders/<id>  {§6.2 settings}                 # the folder is still paused (§2.4 step 4)
  POST  /rest/db/ignores?folder=<id>  {"ignore": folder spec §11 lines}
  if not paused by the user and not paused by the mass-delete guard (§22.2):
     PATCH /rest/config/folders/<id> {"paused":false}
```

All of these apply live (✔ `GET /rest/config/restart-required` → `{"requiresRestart":false}`).
`localOnly` is the "Local network only" setting (§21). If Syncthing reports a listener error for port
`P` (`connectionServiceStatus["tcp://0.0.0.0:P"].error` not null), probe a new port as in §2.4, PATCH
`listenAddresses`, and update `tramado-instance.json`.

### 2.8 Stopping

`POST /rest/system/shutdown` (✔ `{"ok": "shutting down"}`), wait 3 s, then SIGTERM (Unix), then kill at
5 s. One instance stops in about 50–750 ms, but **two connected instances stopping at the same moment
take about 10 s** (verified), hence the deadline. Closing the window never waits for Syncthing: the exit
hook runs in the background with this deadline. Delete `runtime.json` after a clean stop.

### 2.9 When Syncthing runs

- Not at all until the user first shares or joins a class (a local-only user never starts it).
- Afterwards: at every launch while at least one shared class exists.
- With the window closed: kept running in the tray (Windows, Linux) or Dock (macOS) while a shared class
  exists (default on), and optionally started at login, hidden (default off). Details in §20.

---

## 3. REST client rules

### 3.1 Transport

- Base URL `http://127.0.0.1:<G>`; header `X-API-Key: <API_KEY>`; JSON bodies with
  `Content-Type: application/json`. HTTP Basic auth is not used (✔ REST returns 403 even with the
  correct GUI password).
- A `403` means the key is wrong: stop and restart the instance (§2.6). Connection refused: the
  supervisor state decides.
- Device IDs from outside (invites, member files, pairing) are normalised with `GET /rest/svc/deviceid`
  before use (✔ accepts any case, dashes optional; returns the canonical form or `{"error": …}`).

### 3.2 Timeouts (ureq)

| Call | `timeout_recv_response` | `timeout_per_read` |
|---|---|---|
| Ordinary REST | 10 s | 10 s |
| `POST /rest/db/scan` (returns when the scan is done) | 120 s | 120 s |
| Event long-polls (`timeout=60`) | 75 s | 75 s |
| `discovery-lookup.syncthing.net` | 10 s | 10 s |

### 3.3 One config writer

Syncthing replaces whole arrays: `PATCH /rest/config/folders/<id>` replaces `devices` (✔), `POST` on an
existing folder **replaces the folder** and resets its device list (✔), and `POST` on an existing device
**replaces the device** and resets its name, addresses and limits (✔). So:

- All config mutations go through `sync::config_writer`, one at a time.
- Each mutation reads the current object (`GET`) immediately before writing it, and writes the complete
  array (`devices` as `[{"deviceID": …}, …]`).
- `POST` is used only to create things that do not exist yet; everything else is `PATCH`.
- Ignoring a device needs the whole config: `GET /rest/config`, edit `devices`, every folder's
  `devices` and `remoteIgnoredDevices` together, `PUT /rest/config` (there is no
  `/rest/config/remoteIgnoredDevices` endpoint (404) and `PATCH /rest/config` returns 405 ✔).

### 3.4 Scan after every write

After every file Tramado writes in a shared class it calls
`POST /rest/db/scan?folder=<id>&sub=<url-encoded class path of the file or its directory>`. With
`pullerDelayS: 0` this brings a small change to a peer in ~0.25–0.4 s on a LAN, versus 1–2.3 s when
left to the file watcher (✔). Scans of the same sub-path are coalesced (at most one in flight; one
follow-up queued).

### 3.5 Quirks to remember

- Event IDs are per subscription mask; a new mask does not see past events; unknown event names are
  silently accepted and never fire (✔).
- `/rest/cluster/pending/folders` shows a device's folder offers only **after** that device has been
  added to the config (Syncthing closes unknown devices before their ClusterConfig) (✔).
- A pending device's `address` is the observed source address and may not be dialable; always add
  `"dynamic"` as well (✔).
- `/rest/system/connections` briefly shows `connected: true` for a peer that is about to reject us; use
  `remoteState: "valid"` from `/rest/db/completion` as "in sync with X" (✔).
- `/rest/config/defaults/ignores` (✔ `{"lines":[…]}`) is **not** applied to folders created over REST
  (✔ verified: the new folder's ignores stayed empty). Ignores are always set per folder.
- Folders created without explicit values get `pullerDelayS: 1` and `fsWatcherDelayS: 10` (✔), so the
  settings of §6.2 are always sent.

### 3.6 Paths to and from Syncthing (◇ Windows)

On Windows, Syncthing converts names to native separators and reports native paths: disk events
(`filepath.FromSlash(name)`), `/rest/db/file?file=`, `/rest/folder/versions` keys, `/rest/folder/errors` paths and
`/rest/db/need` names. `sync::client` therefore converts **every** path it receives from Syncthing to a class path
(`\` → `/`; no Unicode normalisation: Syncthing already keeps names in NFC, G1 erratum) and every path it sends (`file=`, `sub=`, versions-restore keys) to the native form
(`/` → `\` on Windows). Nothing outside `sync::client` sees a native path. Contract tests on `windows-latest`
cover a disk-event path, `/rest/db/file` queried with both separators, `/rest/folder/versions` keys and
`POST /rest/db/scan?sub=` with a nested path.

---

## 4. REST endpoints used

✔ = exercised against v2.1.7; ◇ = documented, not exercised. All paths are relative to the base URL.

| Method | Path | Body | Response fields used | Used for |
|---|---|---|---|---|
| GET ✔ | `/rest/noauth/health` | — | `status` (`"OK"`) | Readiness (§2.5). No key needed. |
| GET ✔ | `/rest/system/ping` | — | `ping` | Liveness in diagnostics. |
| GET ✔ | `/rest/system/status` | — | `myID`, `connectionServiceStatus{<listenURI>:{error, lanAddresses[], wanAddresses[]}}`, `guiAddressUsed`, `uptime`, `lastDialStatus{<addr>:{when,error}}`, `discoveryStatus` | Identity, own addresses (§11.2), diagnostics. |
| GET ✔ | `/rest/system/version` | — | `version`, `tags[]` | Diagnostics. |
| GET ✔ | `/rest/system/connections` | — | `connections{<deviceID>:{connected, paused, address, type ("tcp-client", "tcp-server", "relay-client", …), isLocal, crypto, clientVersion, inBytesTotal, outBytesTotal, startedAt}}`, `total` | Online state, "connected via relay (slow)", discovery injection (§11.1). |
| POST ✔ | `/rest/system/shutdown` | — | `ok` | Stop (§2.8), orphan clean-up. |
| GET ◇ | `/rest/system/error` | — | `errors[{when, message, level}]` | Diagnostics panel. |
| GET ✔ | `/rest/config/restart-required` | — | `requiresRestart` | After config changes. None of the changes in this document needed a restart (✔). |
| POST ✔ | `/rest/system/restart` | — | `ok` (`"restarting"`); the process then exits with code 3 | Only if `requiresRestart` is ever `true`; the supervisor respawns (§2.6). |
| GET ✔ / PUT ✔ | `/rest/config` | full config | `devices[]`, `folders[]`, `options`, `gui`, `remoteIgnoredDevices[{deviceID, name, address, time}]`, `defaults`, `version` | Ignoring devices (`ignore_device`, §9.2), atomic multi-edits. |
| GET ✔ / PATCH ✔ | `/rest/config/options` | partial options | all option fields | §2.7, §21. |
| GET ✔ / PATCH ✔ | `/rest/config/gui` | `{"user","password"}` | `user`, `password` (hash), `apiKey`, `address` | GUI lock (§2.5). |
| GET ✔ / POST ✔ | `/rest/config/devices` | `{"deviceID","name","addresses":[…,"dynamic"],"compression":"metadata","introducer":false,"autoAcceptFolders":false}` | items: `deviceID, name, addresses, introducer, paused, autoAcceptFolders, maxSendKbps, maxRecvKbps, ignoredFolders, untrusted, group` | Adding devices (POST only if absent: it replaces ✔). |
| GET ✔ / PATCH ✔ / DELETE ✔ | `/rest/config/devices/<deviceID>` | partial device, e.g. `{"addresses":[…]}`, `{"name":…}` | as above | Addresses (§11.1), own name (§2.7), removal (also drops it from folders ✔). |
| GET ✔ / POST ✔ | `/rest/config/folders` | §6.2 body | items: `id, label, path, type, paused, devices[{deviceID, introducedBy, encryptionPassword}], pullerDelayS, fsWatcherDelayS, versioning, markerName, …` | Creating folders (POST only if absent: it replaces ✔). |
| GET ✔ / PATCH ✔ / DELETE ✔ | `/rest/config/folders/<id>` | partial folder; `devices` is replaced whole | as above | Sharing, pausing, settings; DELETE leaves files on disk ✔. |
| GET ✔ | `/rest/cluster/pending/devices` | — | `{<deviceID>:{time, name, address}}` | Admission (§9). |
| DELETE ✔ | `/rest/cluster/pending/devices?device=<id>` | — | — | Dismiss (it returns on the next knock unless ignored). |
| GET ✔ | `/rest/cluster/pending/folders` | — | `{<folderID>:{offeredBy:{<deviceID>:{time, label, receiveEncrypted, remoteEncrypted}}}}` | Admission, pairing, rotation (§9, §18, §19). |
| DELETE ◇ | `/rest/cluster/pending/folders?folder=<id>&device=<id>` | — | — | Clearing refused offers. |
| GET ✔ | `/rest/svc/deviceid?id=<any form>` | — | `id` or `error` | Normalise and validate device IDs. |
| GET ✔ / POST ✔ | `/rest/db/ignores?folder=<id>` | `{"ignore":[…lines]}` | `ignore[]`, `expanded[]`, `error` | Managed ignores (folder spec §11). |
| POST ✔ | `/rest/db/scan?folder=<id>&sub=<path>` | — | 200 when done; **500** when the folder marker is missing | §3.4, §22.3. |
| GET ✔ | `/rest/db/status?folder=<id>` | — | `state` (`idle`, `scanning`, `syncing`, `sync-preparing`, `sync-waiting`, `scan-waiting`, `error`, `""` when paused), `error`, `pullErrors`, `globalFiles`, `globalBytes`, `needFiles`, `needBytes`, `needTotalItems`, `inSyncFiles`, `sequence`, `watchError` | Sync pill, folder health (§22). |
| GET ✔ | `/rest/db/completion?folder=<id>&device=<id>` | — | `completion`, `needItems`, `needBytes`, `needDeletes`, `remoteState` (`valid`, `notSharing`, `paused`, `unknown`), `sequence` | "Admitted?" (§8), claim settle (§14.5), per-member progress. |
| GET ✔ | `/rest/db/file?folder=<id>&file=<path>` | — | `local.{modifiedBy, blocksHash, modified, version[], sequence, size, deleted}`, `global.{modifiedBy, blocksHash, version[], deleted}`, `availability[{id, fromTemporary}]` (`null` when no other device has it; never lists the local device) | Authorship (§12), delivery ticks (§15), leaving (§17), "who has the recording". |
| POST ✔ | `/rest/system/reset?folder=<id>` | — | `ok` (`"resetting folder …"`); Syncthing then exits with code 3 | Restoring a mass deletion on the deleting device (§22.2). |
| GET ✔ | `/rest/db/need?folder=<id>` | — | `progress[]`, `queued[]`, `rest[]` | "Downloading 3 files" detail. |
| GET ✔ | `/rest/db/browse?folder=<id>&prefix=<path>` | — | `[{name, modTime, size, type, children?}]` | Diagnostics only. |
| GET ✔ | `/rest/folder/errors?folder=<id>` | — | `errors` (`null` or `[{path, error}]` ◇), `folder`, `page`, `perpage` | File-name errors (§22.4). |
| GET ✔ / POST ✔ | `/rest/folder/versions?folder=<id>` | POST: `{"<path>":"<versionTime>"}` | GET: `{"<path>":[{versionTime, modTime, size}]}`; POST: `{}` on success | "Recently deleted", Undo (§22.1). |
| GET ✔ | `/rest/events?events=<mask>&since=<id>&timeout=<s>[&limit=<n>]` | — | `[{id, globalID, time, type, data}]` | Loop A (§5). |
| GET ✔ | `/rest/events/disk?since=<id>&timeout=<s>` | — | `[{id, globalID, time, type, data:{action, folder, label, modifiedBy, path, type}}]` | Loop B (§5). |
| GET ✔ | `/rest/stats/device` | — | `{<deviceID>:{lastSeen, lastConnectionDurationS}}` | "Last seen", claim staleness hint (§14.6), fold trigger (§14.8). |

Outside the local instance (made by the Tramado process, not Syncthing):

| Method | URL | Response | Used for |
|---|---|---|---|
| GET ✔ | `https://discovery-lookup.syncthing.net/v2/?device=<canonical deviceID>` | `200 {"seen": Instant, "addresses": [string]}`; `404` with header `retry-after: <seconds>` for unknown devices | Address injection (§11.1). |

---

## 5. Events

Two long-poll threads, each with its own `since` (event IDs are per mask; never share them).

| Loop | Request | Events |
|---|---|---|
| A | `GET /rest/events?events=<maskA>&since=<idA>&timeout=60` | `maskA` = `PendingDevicesChanged,PendingFoldersChanged,DeviceConnected,DeviceDisconnected,DevicePaused,DeviceResumed,ClusterConfigReceived,FolderCompletion,FolderSummary,FolderErrors,StateChanged,FolderPaused,FolderResumed,LocalIndexUpdated,RemoteIndexUpdated,ListenAddressesChanged,ConfigSaved,StartupComplete` (all ✔ observed except `FolderErrors` ◇) |
| B | `GET /rest/events/disk?since=<idB>&timeout=60` | `LocalChangeDetected`, `RemoteChangeDetected` (✔; these are **not** in the default stream) |

**Start-up order** (a mask's subscription begins with its first request; earlier events are lost):

1. Prime: `GET /rest/events?events=<maskA>&since=0&timeout=0` and `GET /rest/events/disk?since=0&timeout=0`;
   remember the greatest `id` returned by each (or 0). Every class folder is still paused at this point
   (§2.4 step 4), so nothing was scanned or sent before the loops listen.
2. Read current state over REST (pending devices and folders, config, connections, folder status).
3. Enter the long-poll loops from the primed ids.

**Gap detection:** if a response's first event has `id > since + 1`, events were dropped from the buffer:
re-read state (step 2) and re-run admission, trust verification and roster reconciliation.

**Dispatch:**

| Event | Action |
|---|---|
| `PendingDevicesChanged` with `added` | Admission: provisional add (§9). |
| `PendingFoldersChanged` with `added` | Admission: folder-ID proof (§9); pairing (§19); rotation (§18.2). |
| `DeviceConnected` / `DeviceDisconnected` | Online dots; discovery timers (§11.1). |
| `ClusterConfigReceived` | Early eviction of a provisional device that offers none of our classes (§9.2). |
| `FolderCompletion` | Per-member progress; claim settle (§14.5); delivery ticks (§15). |
| `FolderSummary`, `StateChanged` | Sync pill. If `summary.pullErrors > 0`: `GET /rest/folder/errors` (§22.4). If `state == "error"`: folder health (§22.3). |
| `FolderErrors` | §22.4. |
| `FolderPaused` / `FolderResumed` | Sync pill. |
| `LocalIndexUpdated` | Note the folder `sequence` after our writes (§15). |
| `ListenAddressesChanged` | Refresh own addresses (§11.2), rewrite own member files (debounced 5 min). |
| `ConfigSaved` | Refresh the cached config view. |
| `RemoteChangeDetected` (`type == "file"` only; path normalised, §3.6) | Receiving mass-change guard (§22.2); self-heal of my files (§12.3); then the app re-judges the path (§12.1) and routes it: `.tramado/members/`, `bans/`, `meta/` → roster and policy (§10); `chat/` → chat (§15); `claims/` → claims (§14); `presence/` → presence (§13); `edits/`, `exam-edits/`, `answers/`, `annotations/`, `mod/`, `consent/`, `markers/` → reload that item; `lecture.json`, `exam.json`, `transcript.json`, `audio.webm` → library refresh and transcription eligibility (§14.2); anything else → document index refresh. |
| `LocalChangeDetected` (`type == "file"` only) | Mass-delete guard (§22.2); self-heal of own files changed locally by someone else (§12.3). |

The UI also refreshes from a `notify` file watcher on every class root (shared or not), so local-only
classes and edits made in a file manager show up without Syncthing.

---

## 6. Creating or sharing a class

A class always exists locally first (with `.tramado/class.json` and the creator's `meta` file; folder
spec §8.1–8.2). "Share with classmates" (on by default when creating) makes it a Syncthing folder.

### 6.1 Steps

1. Start Syncthing if it is not running (§2).
2. `POST /rest/config/folders` with the body of §6.2 and `"paused": true` and `"devices": [{"deviceID": "<myID>"}]`.
   (Syncthing creates the directory if needed and the `.stfolder` marker ✔, but for a folder created paused only
   once it is resumed in step 4: until the ignores POST and the resume there is no directory or marker; G1 erratum.)
3. `POST /rest/db/ignores?folder=<id>` with folder spec §11 (✔ works on a paused folder).
4. `PATCH /rest/config/folders/<id>` `{"paused": false}`. (Paused first so that nothing is announced
   before the ignores are in place.)
5. Set `shared: true` in `classes.json` and return.
6. The app (TypeScript, after `sync_share_class` returns) writes its signed `.tramado/members/<myID>.json`
   (folder spec §8.3), scans `.tramado`, and offers "Invite classmates".

Creating took 37 ms in the lab.

### 6.2 Folder settings (sent on creation, and re-sent with PATCH at every start)

```json
{
  "id": "tramado-geznkyujw4ofedwinfcmzl2rim",
  "label": "Teoria Geral do Direito Civil",
  "path": "/home/ana/Tramado/Teoria Geral do Direito Civil",
  "type": "sendreceive",
  "paused": true,
  "fsWatcherEnabled": true,
  "fsWatcherDelayS": 1,
  "pullerDelayS": 0,
  "rescanIntervalS": 3600,
  "maxConflicts": 10,
  "versioning": { "type": "trashcan", "params": { "cleanoutDays": "30" }, "cleanupIntervalS": 3600 },
  "devices": [ { "deviceID": "AB4Z76W-GA7E7XY-6YXM3ZP-CLW473T-RYRB5Q6-KTOC53U-HT4S232-ZWB42Q2" } ]
}
```

`id`, `path` and `devices` are omitted from the start-up PATCH; `label` follows the class name (LWW
meta, folder spec §8.2) and is PATCHed when it changes. Trashcan versioning on **every** member means any
member can undo a deletion for the class (✔ a restore on one device re-synced the file to everyone).
Trashcan keeps one old copy per path.

---

## 7. Invites

### 7.1 What an invite carries

```ts
interface InviteV1 {
  v: 1;
  f: ClassId;                          // the folder ID (the capability)
  l: string;                           // class name, ≤ 120 chars
  s?: string;                          // short name, ≤ 12
  c: ColourHex;                        // class colour
  i: IconName;                         // lucide icon
  lt?: string;                         // lecturer, ≤ 80
  tm?: string;                         // term, ≤ 40
  lg?: Lang;                           // language of lectures
  m: MemberId;                         // inviter
  n: string;                           // inviter display name, ≤ 64
  d: Array<{                           // 1–3 member devices to dial
    id: string;                        // dashless device ID, 56 chars [A-Z2-7]
    a: string[];                       // 0–5 addresses: tcp://, quic://, relay:// (with ?id=)
  }>;
  t: number;                           // created, Unix seconds
  x?: number;                          // advisory expiry, Unix seconds (§7.4)
}
```

**Which devices:** the inviter's own device first; then up to 2 other roster devices, preferring devices
currently connected to the inviter, then organisers' devices, then the most recently seen
(`/rest/stats/device`). These give the joiner several members to reach if one is offline.

**Which addresses** (per device, at most 5, in this order): up to 2 LAN `tcp://` addresses (RFC 1918 or
IPv6 ULA), 1 `relay://` URI, 1 public `tcp://` address, 1 LAN `quic://` address. The inviter's own
addresses come from §11.2; other devices' from their member files. Concrete addresses matter: a joiner
that only has `dynamic` may look the inviter up before the inviter's first announcement, get a `404`, and
then wait **more than 35 minutes** because Syncthing honours the discovery server's `Retry-After`
(verified). With injected addresses the connection came up in 0.55 s.

### 7.2 Encoding

```
payload = UTF-8 bytes of the compact JSON of InviteV1 (keys in the order above, no spaces)
code    = "tri1_" + base64url(payload) without "=" padding
link    = "tramado://join/" + code
web     = "https://feiteira.github.io/Tramado/join/#" + code      # optional static page; fragment never reaches a server
file    = "<short name or name>.tramado-invite": UTF-8 text, line 1 = link, line 2 = a sentence for people
```

- `tri` = Tramado invite, `1` = payload version. A future `tri2_` code is refused by a v1 app with
  "Update Tramado to use this invite" (`NEWER_FORMAT`).
- **Parsing:** search the pasted text (or file, or link) for the first match of
  `/\btr([ip])(\d+)_([A-Za-z0-9_-]{40,4096})/` (`i` = invite, `p` = pairing, §19). Decode, parse the JSON,
  then validate (§7.3).
- **Size:** a realistic 3-device invite with relay URIs is ~760 bytes of JSON → a ~1,020-character code
  (computed with the example below). A minimal invite (one device, no addresses) is ~300 characters.
  Writers SHOULD keep codes ≤ 2,000 characters by dropping, in order: `quic://` addresses, public `tcp://`
  addresses, the third and then the second device, `lt`, `tm`. Readers MUST refuse codes over 4,096
  characters.
- **QR code:** always encodes a **reduced invite** (first device only, ≤ 2 addresses, no `s`, `lt`, `tm`, `lg`;
  about 450 characters), as `web` when the build has a join page (§25 Q4) and as `link` otherwise; byte mode,
  error correction M (version 15–17). It is rendered at ≥ 4 px per module with a 4-module quiet zone (about
  340 px). The copyable code and the file stay complete; a full 3-device code is about 1,000 characters.
- **No short human code.** A device ID alone is 56 characters and the folder ID 26; anything shorter would
  need a rendezvous server. Tramado says so plainly.
- Deep links: `tauri-plugin-deep-link` registers `tramado://` where the OS allows (Windows, macOS, deb,
  rpm; not a bare AppImage). Pasting the code always works.

Example (whitespace added; the real code has none):

```json
{"v":1,"f":"tramado-geznkyujw4ofedwinfcmzl2rim","l":"Teoria Geral do Direito Civil","s":"TGDC","c":"#3e63dd","i":"scale",
 "lt":"Prof. Menezes","tm":"2026/27 · S1","lg":"pt-PT","m":"k3q7mzx2v4hbtnw5r6yjc2aefg","n":"Ana Ribeiro",
 "d":[{"id":"AB4Z76WGA7E7XY6YXM3ZPCLW473TRYRB5Q6KTOC53UHT4S232ZWB42Q2",
       "a":["tcp://192.168.1.20:22117","relay://95.216.157.10:22067/?id=NZRTFEN-2BDQUHB-QMGXH7S-5R3WWMU-NQT3OMK-5OYCJDY-IWQHG6C-2JXUSQX","tcp://85.243.10.7:22117"]},
      {"id":"TKBNV236HQ5HVUDM667CHDELE5MVVW4HTSN27PQJFWFVGLDA34XDXLAT",
       "a":["tcp://192.168.1.31:22100","relay://51.15.9.21:22067/?id=X3JRS4J-RKOMMTP-AZVFRGC-YLSD4MM-TRRUSLA-GSZ3TVO-5C2EYXV-6RIHGAQ"]},
      {"id":"LGTQI2NC7CZ54ULP7HIBQVR4TCWOYY67AJFSXWTCG5QLJA5Q4X4KTTQO","a":["tcp://10.20.0.11:22105"]}],
 "t":1793721438}
```
→ `tri1_eyJ2IjoxLCJmIjoidHJhbWFkby1nZXpua3l1anc0b2ZlZHdpbmZjbXpsMnJpbSIsImwiOiJUZW9yaWEgR2VyYWwgZG8g…` (1,021 characters).

### 7.3 Validation (joiner side)

| Check | On failure |
|---|---|
| Prefix `tri1_`, base64url decodes, JSON parses, `v == 1` | `SYNC_INVITE_INVALID` ("This invite is damaged. Copy it again.") / `NEWER_FORMAT` for `v > 1` |
| `f` matches `^tramado-[a-z2-7]{26}$` | `SYNC_INVITE_INVALID` |
| 1 ≤ `d.length` ≤ 3; each `id` normalises through `GET /rest/svc/deviceid` | Drop invalid devices; none left → `SYNC_INVITE_INVALID` |
| No `d[].id` equals my own device ID | It is my own invite: "This is your own invite." |
| Addresses parse as `tcp://host:port`, `quic://host:port` or `relay://host:port/?id=…` | Drop the address. |
| Strings within their lengths; `c` is `#rrggbb`; `i` is a known lucide name | Truncate / use defaults (`#8d8d86`, `book-open`). |
| I already have folder `f` | Open that class instead. |
| `x` is in the past | Warn "This invite is old and may not work. Ask for a new one." and let the user continue. |

### 7.4 What an invite cannot do

- **Expiry is advisory.** Without a server nothing can check it; the folder ID stays valid until the class
  is rotated (§18.2). Revocable invites are planned for v1.1 through a token carried in the joiner's
  device name (verified feasible: a pending device's `name` reaches members unchanged).
- Anyone holding the invite can join (unless the class asks before letting people in, §9.3). Invites
  should be shared where the class talks, not publicly.

---

## 8. Joining (joiner side)

The app passes Rust the **invite code text** (not a device list): Rust decodes and validates it (§7.3) and adds
only the devices it names (§9.5).

```
join(code, dirName, parent, includeAudio):                      # Rust (sync_join_class)
  invite = decode(code); validate (§7.3)                        # SYNC_INVITE_INVALID / NEWER_FORMAT
  start Syncthing if needed (§2)
  set own device name "<person> (<computer>)" (§9.4) while any class is joining
  added = []
  for each device d in invite.d (normalised):
    if d not in config:
      POST /rest/config/devices {"deviceID": d, "name": (d == first ? invite.n : ""),
           "addresses": [...invite addresses of d, "dynamic"], "compression": "metadata",
           "introducer": false, "autoAcceptFolders": false, "paused": true}       # no knock yet
      added += [d]
    else: PATCH /rest/config/devices/<d> {"addresses": union(current, invite addresses, ["dynamic"])}
  path = parent/dirName                                          # dirName = unique(sanitize(invite.l)), made by the app
  POST /rest/config/folders  {§6.2 body, "id": invite.f, "label": invite.l, "path": path, "paused": true,
                              "devices": [{"deviceID": me}, {"deviceID": d1}, …]}
  POST /rest/db/ignores?folder=<f>  {folder spec §11, plus "(?d)/**/audio.webm" if not includeAudio}
  PATCH /rest/config/folders/<f> {"paused": false}
  for d in added: PATCH /rest/config/devices/<d> {"paused": false}              # the offer exists before the knock
  on any failure: DELETE the folder if this join created it; DELETE every device in `added`; return the error
  add {classId: f, path, shared: true, joining: true, skipAudio: !includeAudio} to classes.json
then (TypeScript, after sync_join_class returns): write .tramado/members/<me>.json (signed) and scan .tramado/members
```

Unpausing the devices only after the folder exists means the first knock already carries the folder offer, so no
member ever sees this device without proof (§9.2) because of a slow or failed join.

The joiner's REST calls take ~110–180 ms (✔). Then:

| Observation | Meaning | UI |
|---|---|---|
| `GET /rest/db/completion?folder=f&device=<d>` → `remoteState: "valid"` for any `d`, or a `FolderCompletion` event with `remoteState: "valid"` | Admitted by `d` | "You're in! Getting TGDC… 23 of 61 files" |
| `.tramado/class.json` arrives with `classId == f`, a valid signature and a matching derivation (folder spec §2.1) | Class identity confirmed | The class opens normally; `joining` becomes `false`; the device name goes back to "Tramado" when no other class is joining. |
| `class.json.classId != f`, or its signature or derivation fails | Not a Tramado class, a copied folder, or a forgery | Stop, `SYNC_INVITE_INVALID`. |
| Not admitted after 30 s, none of `d` connected | Nobody online | "No one from the class is online right now. You'll join as soon as someone opens Tramado." |
| Not admitted after 30 s, some `d` connected | Waiting for a click (§9.3) | "Waiting for Ana or another member to let you in…" |
| Not admitted 90 s after the first connection to a member, not in ask mode | That member refused or ignored this computer | "Ana's computer didn't let you in yet. Try again in 10 minutes." [Try again] (re-runs the knock by pausing and unpausing the invite devices) |

Joining keeps trying for as long as the class is in "joining" state; Syncthing keeps dialling. "Cancel"
does `DELETE /rest/config/folders/<f>`, deletes devices that share no other folder, and removes the
directory if it is still empty apart from `.stfolder`, `.stignore` and our own member file.

Fresh joiner, measured: admitted 2.2 s after the start, 53 MB synced at 3.6 s, connected to every member
(full mesh through the roster) at 5.2 s.

---

## 9. Admission (runs on every member)

### 9.1 Idea

An unknown device that knocks is added **provisionally, with no folders**. Only then does Syncthing show
which folders it offers. If it offers the ID of one of our shared classes, it has the invite (folder-ID
proof) and the class is shared with it. Otherwise it is removed and ignored. An outsider who knows a
member's device ID and address but not the folder ID learns nothing but that device's name (✔ verified,
including a device that offered a guessed `tramado-…` ID).

### 9.2 Algorithm

Membership decisions are always re-derived from the **current Syncthing config**; `provisional` is only a
timer list. (A parallel membership list caused a lab bug: a device admitted through the roster was later
removed by the sweep.)

```
provisional: Map<DeviceId, {addedAt: Monotonic, source: string}>
MAX_PROVISIONAL       = 32
PROVISIONAL_TIMEOUT   = 60 s;   EARLY_EVICT = 2 s after ClusterConfigReceived
MAX_FAILED_PER_SOURCE = 3 per 10 min      # failed = ignored for giving no proof; successes do not count
source(address)       = IPv4 /24 or IPv6 /64 of the observed address; relay addresses are exempt (they are shared)
IGNORE_STEPS          = 10 min, 1 h, 24 h, 7 days   # by appdata.ignored[dev].strikes within the last 7 days
QUEUE_TIMEOUT         = 24 h;  MAX_MANAGED_IGNORES = 500

on_start():                    # after priming the events (§5)
  handle_pending_devices(); handle_pending_folders()

on PendingDevicesChanged(added non-empty): handle_pending_devices()
on PendingFoldersChanged(added non-empty): handle_pending_folders()
on ClusterConfigReceived(dev) where dev in provisional:
  after EARLY_EVICT: if GET /rest/cluster/pending/folders has no offer of one of my shared classes from dev:
    ignore_device(dev, "noProof")                 # a slot is held ~3 s instead of 60 s
every 5 s: sweep()

handle_pending_devices():
  pend = GET /rest/cluster/pending/devices
  cfg  = GET /rest/config
  for (dev, {name, address}) in pend:
    if dev in cfg.devices or dev in cfg.remoteIgnoredDevices: continue
    if provisional.size >= MAX_PROVISIONAL: continue                                    # retried by sweep()
    if count(appdata.failed from source(address) in the last 10 min) >= MAX_FAILED_PER_SOURCE: continue
    config_writer: POST /rest/config/devices
        {"deviceID": dev, "name": name, "addresses": ["tcp://" + address, "dynamic"],
         "compression": "metadata", "introducer": false, "autoAcceptFolders": false}       # NO folders
    provisional[dev] = {addedAt: now, source: source(address)}
    # bans are NOT checked here: a device banned in one class may be welcome in another (§18.1)

handle_pending_folders():
  pend = GET /rest/cluster/pending/folders
  for (folderId, {offeredBy}) in pend:
    if folderId in classes.json leftClasses or in any class's aliases:              # §17, §18.2
      for dev in offeredBy: add {id: folderId, label, time} to dev's ignoredFolders; continue   # silently
    if folderId is a rotation target (§18.2) or a pairing offer (§19): handle there; continue
    cls = my shared class with classId == folderId
    if cls is none: emit folderOffer (the app decides); continue                  # never create folders we do not know
    for dev in offeredBy:
      if dev in devices_of(folder cls): continue
      if banned(cls, dev): refuse(cls, dev); continue                              # §18.1
      if not policy_received(cls): defer(cls, dev); continue                       # start-up rule below
      if cls.askBeforeAdmit and not known_member(cls, dev) and not pairing_peer(dev):
        queue_for_approval(cls, dev, pend_name(dev)); continue                    # §9.3
      share(cls, dev)

share(cls, dev):                                   # widening: the offer of cls by dev is in pending folders (§9.5)
  config_writer:
    f = GET /rest/config/folders/<cls>
    if dev not in f.devices: PATCH /rest/config/folders/<cls> {"devices": f.devices ++ [{"deviceID": dev}]}
  provisional.remove(dev); appdata.proofAt[cls][dev] = now
  emit admitted (the app notifies "Bruno Costa joined ⚖️ TGDC · [Remove]")

refuse(cls, dev):                                  # this class only
  config_writer: PATCH /rest/config/devices/<dev> {"ignoredFolders": [...current, {"id": cls, "label": <label>, "time": now_rfc3339()}]}   ◇
  if every tramado folder dev offers is banned for dev: ignore_device(dev, "banned")

sweep():
  handle_pending_devices()                         # devices skipped for MAX_PROVISIONAL or a burst get their turn
  cfg = GET /rest/config
  for (dev, p) in provisional:
    if dev is in any folder's devices in cfg: provisional.remove(dev); continue          # admitted by any path
    if dev is queued for approval:
      if now - p.addedAt < QUEUE_TIMEOUT: continue
      config_writer: DELETE /rest/config/devices/<dev>                                  # not ignored: may knock again
      unqueue(dev); provisional.remove(dev); continue
    if now - p.addedAt >= PROVISIONAL_TIMEOUT: ignore_device(dev, "noProof")
  apply the queued ignores in one PUT /rest/config; expire_ignores(cfg)

ignore_device(dev, reason):                        # queued; applied by sweep() in one PUT
  provisional.remove(dev)
  strikes = 1 + count(appdata.ignored[dev] strikes within the last 7 days)
  until   = reason == "banned" ? never : now + IGNORE_STEPS[min(strikes, 4) - 1]
  edit cfg: devices without dev; every folder's devices without dev;
            remoteIgnoredDevices += {"deviceID": dev, "name": reason == "banned" ? "tramado-ban" : "tramado",
                                     "address": "", "time": now_rfc3339()}
            if more than MAX_MANAGED_IGNORES entries named "tramado": drop the oldest one that is not a ban
  appdata.ignored[dev] = {at: now, until, strikes, reason}; if reason == "noProof": appdata.failed += {source, at: now}

expire_ignores(cfg):          # an honest mistake (old invite, rotated class) must not lock someone out for long
  for e in cfg.remoteIgnoredDevices named "tramado" or "tramado-ban":
    if appdata.ignored[e.deviceID].until <= now: remove e (one PUT); keep the strike history
  (entries with other names were added by the user in their own tools; Tramado never touches them)

known_member(cls, dev) = dev is in policy[cls].knownDevices (devices with a trusted, bound member file in cls)
pairing_peer(dev)      = v1.1 (§19): dev's pending name carries a valid pairing token
```

- Once a device is in `remoteIgnoredDevices` it produces no more pending entries (✔). Deleting a device
  without ignoring it makes it knock again a second later (✔ "re-knock loop").
- Admission does not depend on which member the joiner listed: every member it dials (invite devices,
  then every roster device once it has synced the members) admits it by the same proof.
- A burst of joiners behind one campus NAT (a lecturer posts the invite and 30 students join at once) is admitted:
  successes never count against the source, and `sweep()` retries skipped devices every 5 s.
- The fast path measured in the lab: knock visible 0.6 s after the joiner's config calls, folder offer
  visible ~1.1 s after the provisional add, share applied ~0.15 s later.
- **Start-up rule.** Until the app has pushed this session's policy for a class (`sync_policy_set`), or 120 s after
  Syncthing started, Rust only narrows access for that class: bans and removals from the persisted policy run,
  shares and roster additions are deferred, and `joinRequest` / `admitted` events wait. A ban received while the
  app was closed is therefore applied before anyone is let in by an old policy.

### 9.3 "Ask before letting people in" (per class, default off)

When the effective `askBeforeAdmit` (folder spec §8.2) is `true`:

- A device that proves the folder ID but is not a known member is **queued** on every online member's app
  instead of being shared. Notification: "**Bruno Costa** ("Bruno's laptop") wants to join ⚖️ TGDC ·
  [Let in] [Not now] [Decline]". The device stays provisional (no folders) for up to 24 h.
- **Let in** (any member): `share(cls, dev)`. Every other member's app then admits it through the roster
  once its member file has synced, or by the same proof.
- **Not now**: nothing changes; the entry stays queued and visible.
- **Decline** by an organiser: a ban entry for that device (§18.1), so every member refuses it.
  **Decline** by a non-organiser: `ignore_device(dev, "noProof")` on that member only (10 minutes for a first
  decline, longer after repeats, §9.2).
- Devices that are already known members (a member's new computer bound to the same person, a re-joining
  member) are let in without asking.
- Both screens show the joiner's **check words** (§25 Q1), so people can compare them by voice.

### 9.4 Device names

A device's Syncthing name is sent in the Hello to any device that dials it, and local discovery broadcasts device
IDs and addresses on the LAN, so names would let anyone on a campus network list nearby Tramado users. The own
device name is therefore **"Tramado"**, except while at least one class is in `joining` state: then it is
`"<person> (<computer>)"` (≤ 64 chars), so that members in ask mode see who knocks (§2.7). The UI always takes
names from member files, which update live. `overwriteRemoteDeviceNamesOnConnect: true` makes stored names follow
the peer's announced name on reconnect (✔).

### 9.5 Rust re-checks every widening action

The webview renders classmates' content, so a script injected there must not be able to share a class with a
device the user never admitted. Rust performs an action that **widens** access only after its own check, whatever
the policy says:

| Action | Rust's own check |
|---|---|
| Share class C with device D (admission, Let in, `sync_admit`) | `GET /rest/cluster/pending/folders` lists C offered by D. |
| Add a roster device D of `ClassPolicy` to class C (§10) | `GET /rest/db/file?folder=C&file=.tramado/members/<D>.json` → `!local.deleted && local.modifiedBy == shortId(D)` (the signature and person proof were already checked by the app; this check stops a script that only controls the webview). |
| Add devices while joining | They are exactly the devices of the invite code Rust decoded itself (§8). |
| Treat D as one of my own devices (pairing, v1.1) | Rust ran the pairing itself and holds its secret (§19). |

Narrowing actions (bans, removals, pausing) need no check. Each refusal returns `PERMISSION_DENIED` and is
logged; Rust unit tests cover each row.

---

## 10. Roster reconciliation (runs on every member)

Every member's app makes its Syncthing config match the class roster: every device with a member file
is configured and shares the folder; devices that left are removed. This replaces Syncthing
introducers.

```
reconcile(cls):        # on start, on every policy push for cls, after gap detection, and every 60 s
  me      = myID
  roster  = { D -> m : m in policy[cls].roster, and the §9.5 check of members/D.json passes }   # trusted + bound (app)
  banned  = policy[cls].bannedDevices                                      # §18.1, expanded by the app
  config_writer:
    f    = GET /rest/config/folders/<cls>
    devs = GET /rest/config/devices  (as a map)
    ign  = GET /rest/config .remoteIgnoredDevices

    for (D, m) in roster where D != me and D not in banned:
      addrs = dedupe(m.addresses ++ discovered[D] ++ ["dynamic"])         # §11.1
      if D not in devs:
        POST /rest/config/devices {"deviceID": D, "name": m.name + " (" + m.deviceName + ")", "addresses": addrs,
             "compression": "metadata", "introducer": false, "autoAcceptFolders": false}
      else if set(devs[D].addresses) != set(addrs):
        PATCH /rest/config/devices/<D> {"addresses": addrs}
      if D in ign and appdata.ignored[D].reason != "banned":
        remove D from remoteIgnoredDevices (GET / edit / PUT /rest/config)  # a member we once refused is legitimate
      appdata.seenMember[cls].add(D)

    keep = [me]
    for d in f.devices where d != me:
      if d in banned:                         continue                     # dropped (§18.1)
      if d in roster:                         keep.add(d)
      else if left(cls, d):                   continue                     # dropped
      else if stuck_joiner(cls, d):           continue                     # dropped
      else:                                   keep.add(d)                  # newcomer whose member file has not arrived,
                                                                           # or a member whose file is untrusted for now
    want = keep ∪ { D in roster | D != me and D not in banned }
    if set(want) != set(f.devices): PATCH /rest/config/folders/<cls> {"devices": [{"deviceID": x} for x in want]}

    for d in devs where d != me and d is in no folder's devices
                    and d not in provisional and d not bound to my own memberId:
      DELETE /rest/config/devices/<d>
  apply_bans()                                                             # §18.1, declarative over every class

left(cls, d) =  members/<d>.json is absent locally
            and d in appdata.seenMember[cls]
            and GET /rest/db/file?folder=<cls>&file=.tramado/members/<d>.json
                → global.deleted == true and global.modifiedBy == shortId(d)
                                                    # a deletion by anyone else is ignored; d will restore its file (§12.3)

stuck_joiner(cls, d) =  d not in appdata.seenMember[cls]                  # never had a trusted member file here
                    and (appdata.proofAt[cls][d] is absent or older than 7 days)   # §9.2 share() records the proof
                    and d is not connected now
```

A device that proved the folder ID stays in the folder until it is banned or `left()`. A long-standing member
whose member file is briefly untrusted (a race, a foreign write, a deletion by someone else) is never dropped and
re-admitted in a loop. Unit test on the fake client: a member file untrusted for 3 reconcile cycles → no PATCH of
the folder's devices.

The device's own member file is the app's (TypeScript) job: it rewrites it when a field changes (folder spec §8.3).

Lab result with this scheme and `introducer: false` everywhere: a device that joined through one member
learned the others from the roster and reached full mesh in 0.5–6.6 s; no cascade removals.

---

## 11. Connectivity

### 11.1 Discovery address injection

Syncthing negative-caches "device unknown" answers from global discovery for 35–40 minutes. Tramado
therefore looks peers up itself and gives Syncthing concrete addresses.

```
every 10 s, for each device D that shares at least one tramado folder, D != me:
  if connections[D].connected: lastConnected[D] = now; continue
  if now - max(lastConnected[D], syncthingStartedAt) < 30 s: continue
  if localOnly or sharingPaused: continue
  if now < nextLookup[D]: continue
  r = GET https://discovery-lookup.syncthing.net/v2/?device=<D>
  if r.status == 200:
    config_writer: PATCH /rest/config/devices/<D>
        {"addresses": dedupe(r.addresses ++ memberFileAddresses(D) ++ ["dynamic"])}
    discovered[D] = r.addresses; nextLookup[D] = now + 5 min
  elif r.status == 404: nextLookup[D] = now + clamp(retry-after, 5 min, 60 min)
  else: nextLookup[D] = now + 5 min
```

Verified: two relay-only devices that had looked each other up too early never connected in 3.5 minutes;
after injecting the looked-up relay address they connected 551 ms later.

### 11.2 Own addresses (member files and invites)

```
own_addresses():
  s = GET /rest/system/status
  for (uri, st) in s.connectionServiceStatus where st.error == null:
    for a in st.lanAddresses ++ st.wanAddresses:
      drop if host is 0.0.0.0, ::, in 127.0.0.0/8, ::1, 169.254.0.0/16 or fe80::/10, or port is 0
      keep tcp://, quic://, relay://
  order: LAN tcp, relay, public tcp, LAN quic, public quic; dedupe
  return the first 8
```

(With `TRAMADO_DATA_DIR` set, loopback addresses are kept, for tests.) The relay URI appears once the
relay is joined, about 10 s after start (`relay://95.216.157.10:22067/?id=…`). Members write their
addresses into their member file (folder spec §8.3) at most every 5 minutes, so connected peers keep
fresh addresses for everyone else.

### 11.3 What leaves the computer

The managed instance announces this device's ID and addresses to Syncthing's public discovery servers,
joins a public relay, uses UPnP/NAT-PMP, and broadcasts on the LAN (port 21027). The Tramado process
itself calls `discovery-lookup.syncthing.net` (§11.1). The "What leaves this computer" page lists these.
"Local network only" turns all Internet-facing parts off (§21).

---

## 12. Authorship verification (folder spec §6)

### 12.1 The verdict is bound to the bytes

`blocksHash(bytes)` = base64 (padded) of `SHA-256(h_1 || h_2 || … || h_n)`, where `h_i` is the SHA-256 of the
i-th block of the file and the block size is 128 KiB (Syncthing's size for files smaller than 250 MiB; every machine
file is, `transcript.json` ≤ 32 MiB). Verified on v2.1.7: for a 27-byte file it equals
`base64(SHA-256(SHA-256(bytes)))`; the contract tests also check a 1 MiB file (8 blocks). An empty machine file is
treated as absent.

```
verdict(cls, path, bytes):                               # TypeScript, through sync_file_info (architecture §6.7)
  r = GET /rest/db/file?folder=<cls>&file=<native path of path>     # §3.6
  if r.local.deleted:
     return (r.local.modifiedBy == shortId(writer(path))) ? "deleted" : "keep-last-trusted"   # folder spec §6.2 rule 4
  if r.local.blocksHash != blocksHash(bytes):
     retry every 200 ms for up to 3 s (re-read the file and r); then return "pending"          # the db or the event lags
  ok = r.local.modifiedBy == shortId(writer(path))
       or sha256(bytes) == trustCache[path].sha256
       or (path is *.jsonl and the first trustCache[path].length bytes hash to trustCache[path].prefixSha256)
  signed paths (folder spec §6.1): additionally verify sig, person proof and the no-rollback rule (§6.6, §8.3.1, §6.2 rule 7)
  manifests: additionally verify the derived ID (folder spec §2.1)
  if ok (full file): trustCache[path] = {sha256, length, prefixSha256: sha256, blocksHash}
  elif prefix ok:    trust only the first `length` bytes; drop the rest
  else:              untrusted; diagnostics SYNC_FOREIGN_WRITE
```

- `local.modifiedBy` is used, not `global.modifiedBy`, because the reader judges the bytes it has.
- A reader that does not want to hash a large file twice MAY instead compare `(size, mtime in ns)` from `fstat`
  before and after its read with `local.size` / `local.modified`: Syncthing never rescans a same-size, same-mtime
  overwrite (✔), so this is sound against unmodified clients.
- **At start** the app runs `verdict` for every machine file whose size or mtime differs from the trust cache.
- **Pending** verdicts are retried on the next event for that path and at the 10-minute safety pass; until then the
  last trusted content stays in use.

### 12.2 On events

`RemoteChangeDetected.data` carries `path`, `action`, `modifiedBy` and `type` (✔ shapes, v2.1.7):

- `action` is `modified` or `deleted` only (a brand-new file reports `modified`; `added` never occurred in about
  410 lab events);
- `type` is `file` or `dir`; a directory event arrives for every parent (`.tramado`, `.tramado/chat`, …). Only
  `type == "file"` events are routed;
- paths are native on Windows (§3.6).

The event's `modifiedBy` is a **trigger**: it tells the app which path to re-judge, never the verdict (§12.1).

### 12.3 Self-heal

Each device keeps a mirror of every machine file of 1 MiB or less that it writes, under
`app_local_data_dir/private/<classId>/mirror/<class path>`, **except** `transcript.json`, `transcript.md` and
`transcript.vtt` (their ownership can change hands, §14.5; the app decides about them). For its own `audio.webm`
it keeps `{size, sha256}` only. When a `RemoteChangeDetected` or `LocalChangeDetected` shows that one of **my**
files was modified or deleted by anyone else (by another device, or by a program on this computer while Tramado
was not writing):

- if the file's SHA-256 equals the mirror's, nothing happens (an identical version after a restore or a rotation
  creates no new version);
- otherwise Tramado rewrites the file from the mirror (atomic write) and scans it;
- `audio.webm` is restored with `POST /rest/folder/versions` from the local trashcan, which keeps the replaced
  version (✔: the trashcan keeps replaced files as well as deleted ones);
- claim and presence files older than their retention (folder spec §8.10, §9.2) are never restored;
- when the device rejoins a class it had left, the class's mirror is purged first.

The original also survives in the other members' trashcan (`.stversions`, ✔).

**Local consistency.** `ClassFs` holds a per-path lock across every read-modify-write (redaction of a chat month)
and across "append to the file + append to the mirror", so an append racing a redaction is never lost. At start,
for each own JSONL file whose `local.modifiedBy` is me, Tramado copies the canonical file over the mirror (a crash
between the two appends leaves the mirror short, and a short mirror would later "heal" a legitimate line away).

### 12.4 Signing

Rust holds the device key (`<home>/key.pem`, PKCS#8 Ed25519) and never exposes it. `sync_sign(classId, path,
canonical)` returns the folder spec §6.6 `Sig` for the canonical JSON bytes the app computed (RFC 8785): Rust
prepends `"tramado-sig-v1" 0x00 classId 0x00 path 0x00` itself, so the key can never sign anything that is not a
Tramado record of a class path. Signing works without the daemon running (the key exists from §2.3), so local
classes are signed too. Verification runs in the app (WebCrypto Ed25519), on every platform including the demo
and the Vitest mesh.

---

## 13. Presence and heartbeats

- A device writes `presence/<me>.json` (folder spec §8.4) when its activity changes, and every 60 s
  while it records, transcribes or has a class note open. An idle device writes nothing.
- **Online** (the green dot) comes from Syncthing: a person is online when any of their bound devices is
  connected to me (`/rest/system/connections`), or when its presence `seq` changed in the last 3 minutes
  (it may be connected only to other members).
- **Staleness is judged on the reader's own monotonic clock**, never by comparing remote timestamps:
  the reader remembers when it last saw each presence file's `seq` change. Activity unchanged for 3
  minutes is shown as "may be asleep or offline" and ignored for decisions. For a presence file first seen at
  start-up, the clock starts at "now" if the writer is connected, otherwise at
  `max(lastSeen from GET /rest/stats/device, now − 3 min)`. An activity whose `updatedAt` is more than 24 h older
  than the reader's clock is ignored (folder spec §8.4).
- "Bruno is already recording this lecture" uses `activity.recording` of other devices in the class
  (not stale).

---

## 14. Transcription claims ("only one person transcribes")

Each lecture is transcribed once, by one device, for the whole class. Devices race by writing claim files
(folder spec §8.10) and all apply the same deterministic rule to the same set of files, so they agree on
one winner without a server.

### 14.1 Parameters

| Name | Value | Meaning |
|---|---|---|
| `SETTLE_MS` | 12 000 | Wait after writing a claim before deciding. |
| `COMPLETION_WAIT_MAX_MS` | 60 000 | Max extra wait for connected members to receive my claim. |
| `HEARTBEAT_MS` | 60 000 | Rewrite interval of a `working` claim. |
| `SLOW_MS` | 120 000 | UI: "last update N min ago (it may be asleep)". |
| `STALE_MS` | 600 000 | A `claimed`/`working` claim unchanged this long (reader's clock) is dead. |
| `DONE_TRUST_MS` | 3 600 000 | A `done` claim whose `transcript.json` is still missing or wrong after this is ignored, unless the cluster index already has the claimant's transcript (§14.4). |
| `DONE_RETENTION` | 7 days | A superseded `done` claim is deleted after this; the current owner keeps its latest one (folder spec §8.10). |
| `UNCLAIMED_NUDGE` | 24 h | A lecture still unclaimed this long after its audio is complete notifies the recorder (§14.3). |
| `FAIL_COOLDOWN` | 24 h | A device that failed a lecture does not auto-claim it again for this long. |

### 14.2 Eligibility to claim (all must hold on the claiming device)

- `lecture.json` is trusted, `audio` is not `null`, (`audio.shared` or I am the recorder), and `duplicateOf` is
  absent.
- The local `audio.webm` has exactly `audio.size` bytes and SHA-256 `audio.sha256` (files arrive in any
  order).
- There is no trusted `transcript.json` with `audioSha256 == audio.sha256` and `round` = the current
  round (§14.7). For an **automatic** claim (§14.3), there is no `transcript.json` at all, trusted or not, with
  `audioSha256 == audio.sha256`: an untrusted transcript shows a warning, and only a manual Re-transcribe (a new
  round) may claim it.
- An engine is ready: a local model is installed and the CPU is supported, or cloud transcription is
  enabled with the user's consent for this lecture.
- I have not failed this lecture within `FAIL_COOLDOWN` (manual retries are always allowed).

### 14.3 Who claims, and when (volunteering by capability)

Claims are made by explicit choice or automatically after a **capability delay**, which lets the best-placed
device go first without a negotiation:

| Who | Delay after the audio is complete locally |
|---|---|
| Recorder who chose "Transcribe on this computer" or "With OpenRouter" when saving | 0 (immediately) |
| Anyone clicking "Transcribe on this computer" or "Take over" | 0 |
| Volunteer (effective `caps.volunteer` = `plugged` and power is AC, or `always`) with a local model, `speedRT ≥ 1.5` | 60 s |
| Same, `speedRT < 1.5` | 180 s |
| Volunteer on battery (`always` only) | + 600 s |
| Volunteer with only cloud transcription enabled | + 120 s (and only if the user allowed automatic cloud use) |
| Recorder who chose "Let a classmate's computer do it" or "Not now"; `volunteer: "off"` | never automatically |

Each automatic delay gets a random 0–15 s jitter. When the delay ends, the device runs the pre-check of
§14.5 again; if someone else already holds a live claim, it does nothing.

- **Default volunteering.** The preference is `plugged` by default, but it takes effect only once a local model is
  installed (or the user allowed automatic cloud use, §25 Q5); until then the member file reports
  `caps.volunteer: "off"`. The first time a model becomes ready on a device with a shared class, the app says once:
  "This computer will help transcribe your classes' lectures when it's plugged in." [OK] [Turn off].
- **Duplicates.** A volunteer never claims automatically a lecture whose `[startedAt, startedAt + durationMs]`
  overlaps by more than 50 % with another lecture of the same class that has a live or `done` claim (a backup
  recording, UX "Record anyway, as a backup"). The UI shows "Probably the same lecture as {title}" with
  [Mark as duplicate] (recorder) and [Transcribe anyway].
- **Re-evaluation when a claim goes stale.** Staleness produces no file event, so the claim engine keeps, per
  lecture, `reevaluateAt = last change seen of the winner's claim + STALE_MS + 1 s` (and `+ SLOW_MS` for the UI).
  When it fires, every eligible volunteer restarts its capability delay plus jitter from that moment and then runs
  `try_claim` with the stale claims in `supersedes`. Property test (`claims.property.test.ts`): the winner crashes,
  and within `STALE_MS` + the largest delay + `SETTLE_MS` + `COMPLETION_WAIT_MAX_MS`, exactly one other device is
  `working`.
- **Nobody transcribed it.** A lecture still unclaimed `UNCLAIMED_NUDGE` after its audio completed notifies the
  recorder's app: "Nobody has transcribed “{lecture}” yet." [Transcribe here].

### 14.4 Ranking

```
rank(status): done = 0, working = 1, claimed = 2

R_max = max(greatest `round` among trusted claims of this lecture and kind, round of the trusted transcript.json)   # default 1

live(c) = trusted(c) and c.round == R_max
          and c.status in {claimed, working, done}
          and not (c.status in {claimed, working} and locally_stale(c))
          and not (c.status == done and transcript missing or mismatched for longer than DONE_TRUST_MS
                   and not in_cluster(c))
in_cluster(c) = GET /rest/db/file?folder=<cls>&file=<lectureDir>/transcript.json → global exists,
                global.deleted == false and global.modifiedBy == shortId(c.deviceId)
                # finished elsewhere, still arriving: keep the claim live and show "Finished on Ana's computer —
                # waiting for it to arrive" with who has it (availability)

superseded(c) = exists s with live(s), s != c, {deviceId: c.deviceId, heartbeat: h} in s.supersedes, and c.heartbeat <= h

eligible(c) = live(c) and not superseded(c)

winner = the eligible claim with the smallest (rank(status), claimedAt, deviceId)    # string order for deviceId
```

`locally_stale(c)`: the reader keeps, per claim path, the monotonic time at which it last saw the file's
content change. The claim is stale when that time is `STALE_MS` or more in the past. For a claim first
seen at start-up, the clock starts at "now" if the claimant is connected, otherwise at the claimant's
`lastSeen` from `GET /rest/stats/device` (but never more than `STALE_MS` in the past), so that a claim from
a device not seen for days is not honoured for another 10 minutes at every start.

### 14.5 Claim round

```
try_claim(lecture, kind = "transcribe"):
  if not eligible_to_claim(lecture): return                        # §14.2
  W = winner()
  if W exists and W.deviceId != me: return                          # someone holds it (UI shows their progress)
  stale = [c for c in trusted claims if c.deviceId != me and c.status in {claimed, working} and locally_stale(c)]
  write claims/<lectureId>/<me>.json:
    {kind, lectureId, round: R_max, deviceId: me, memberId, status: "claimed",
     heartbeat: firstHeartbeat(observations, me),                  # 1 + the largest heartbeat of a supersedes entry
                                                                    # naming me, else 0 (G1 erratum: with 0, two
                                                                    # devices could both be "working")
     claimedAt: max(now_ms(), greatest claimedAt seen for this lecture + 1),
     supersedes: [{deviceId: c.deviceId, heartbeat: c.heartbeat} for c in stale],
     audioSha256, engine, updatedAt}
  scan claims/<lectureId>
  sleep SETTLE_MS
  wait until GET /rest/db/file?folder=<cls>&file=<my claim path> → availability lists every connected device that
       shares the folder (fromTemporary == false)                 # they hold my claim; others' downloads don't matter
       (poll every 1 s; give up after COMPLETION_WAIT_MAX_MS)
  W = winner()
  if W.deviceId == me:
    rewrite my claim: status "working", heartbeat + 1; scan
    start the transcription job (local or cloud)
  else:
    delete my claim; scan

while working:                                                      # in Rust, survives a webview reload
  every HEARTBEAT_MS: rewrite my claim (status "working", heartbeat + 1, progress, etaMs); scan
  on any change under claims/<lectureId>/:
    if winner().deviceId != me: abort the job (keep the partial result for resume), delete my claim, scan
  on success:
    if winner().deviceId != me: delete my claim; scan; keep the result file; stop        # never write transcript.*
    write transcript.json, then transcript.md and transcript.vtt; scan the lecture directory
    rewrite my claim: status "done", finishedAt, transcriptRevision; scan
    update presence (transcribing cleared)
  on failure: rewrite my claim: status "failed", error = <code>; scan
  on resume after sleep/suspend (my last heartbeat write is STALE_MS or more ago):
    if any other live claim exists for this lecture: abort the job, delete my claim, scan
    else: write a heartbeat at once and continue

after done, on every change under claims/<lectureId>/ or of transcript.json (owner duties):
  if my done claim is not the winner: delete my claim, delete my result file, never write transcript.* for this round
  if I am the winner and transcript.json.writer != me for my round (a partition where both finished):
    rewrite transcript.* from my result file (kept 7 days in data/transcribe/<lectureId>.result.json);
    delete every transcript.sync-conflict-* of the lecture directory; scan
  if I was the owner and transcript.json.writer is now another device with a valid change (folder spec §6.2
    rule 3): clear my owner state and never write transcript.* again

on app start: for each of my own claims with status claimed/working:
  the last heartbeat time is persisted (`lastHeartbeatWallMs` in data/transcribe/<lectureId>.json), and monotonic
  clocks restart with the app, so every restart counts as "possibly stale": wait for sync_wait_caught_up (60 s at
  most), then apply the resume rule above (the job resumes from data/transcribe/<lectureId>.partial.json)
```

The `claimedAt = max(now, max seen + 1)` rule limits the advantage a device gains from a slow clock.

### 14.6 Staleness and take-over

| What a member sees | Condition (reader's clock) | UI |
|---|---|---|
| Healthy | winner's claim changed < 2 min ago | "Ana's laptop is transcribing — 40% · about 25 min left" |
| Slow | 2–10 min | "… last update 6 min ago (it may be asleep or offline)" |
| Stale | ≥ 10 min (no eligible claim left) | "Ana's laptop stopped at 40%, 14 min ago. [Take over on this computer]" |

"Take over" is `try_claim` with the stale claims listed in `supersedes`. If the stale device comes back
**before** it sees the take-over, it writes a newer heartbeat; its claim is then no longer superseded and
outranks the newcomer (earlier `claimedAt`, `working`), so the newcomer yields. If it comes back **after**
seeing the take-over, the resume rule makes it yield. Either way exactly one device continues.

### 14.7 Re-transcribing ("replaces it for everyone")

After a confirmation, the device writes a claim with `round = R_max + 1`. Claims and edits of older rounds
are ignored from then on. The winner of the new round writes a new `transcript.json` with that `round`
and `revision: 1`. Corrections made to the previous round are lost, and the dialog says so.

### 14.8 Transcript owner hand-over and fold claims

The transcript owner (`transcript.json.writer.deviceId`) folds corrections (folder spec §8.9). A new owner
is needed when the owner is gone:

(v1.1: Tramado 0.1 shows transcripts read-only and writes no edit lines, so it never needs a new owner.)

- **Trigger** (checked every hour by every member that has unfolded edits for the lecture): the owner has
  no member file any more, **or** `GET /rest/stats/device` shows the owner last seen more than 7 days ago.
- **Procedure:** the same claim round as §14.5 with `kind: "fold"` in `claims/<lectureId>.fold/`,
  eligibility = "I have the transcript and the edit logs". The winner rewrites `transcript.json` with
  `writer` = itself and `revision + 1` (readers accept the writer change because a fold claim by that
  device exists, folder spec §6.2 rule 3), regenerates `.md`/`.vtt`, sets its fold claim to `done`.
- A returning former owner MUST check the fold claims and the current `writer` before writing; if the
  writer changed, it is no longer the owner. Rust's self-heal never touches `transcript.*` (§12.3), so it cannot
  restore an old version before the app has checked.
- **Voluntary hand-over:** "Stop and let someone else do it" while transcribing sets the claim to
  `released`; volunteers restart their capability delays.

### 14.9 Properties (and what was tested)

- Three devices claiming in the same millisecond agreed on one winner (tie broken by device ID) ✔.
- A partition plus a 60 s clock skew: with the plain "earliest `claimedAt`" rule everyone switched to the
  skewed device; with `working` ranked above `claimed`, all devices kept the device already working ✔.
- Clock skew is a fairness and wasted-work problem, not a correctness problem: everyone applies the same
  rule to the same files. Duplicate work is possible only while two devices are partitioned; when they
  reconnect, the loser aborts.
- Required tests: a property test over an in-memory mesh (`createMemoryMesh()`) with random partitions,
  ±10 min skew, crashes and heals, asserting at most one `working` per connected component and eventually
  exactly one transcript; a mesh test where a partition lets both sides finish: after the heal there is one
  `transcript.json`, no conflict copy, and no rewrite during 10 more flush rounds; a mesh test where the `done`
  claim arrives without the transcript's blocks: nobody re-transcribes while the global index has it.

---

## 15. Chat delivery

**Send:**

1. Build the line (folder spec §8.16), `hlc = tick()`.
2. Append it to `.tramado/chat/<me>/<YYYY-MM>.jsonl` (one `write()` with `O_APPEND`, then `fsync`); append
   the same bytes to the mirror (§12.3).
3. `POST /rest/db/scan?folder=<cls>&sub=.tramado%2Fchat%2F<me>`.
4. Show "🕓 Saved — will send when a classmate is online".
5. Mark "✓ Sent" when `GET /rest/db/file?folder=<cls>&file=<that path>` → `availability` lists at least
   one device with `fromTemporary == false` (`availability` never lists me; that device holds the current
   version, which contains the line). Poll this
   only while unsent lines exist, on `FolderCompletion` and `RemoteIndexUpdated` events for the folder,
   at most once every 2 s. "Delivered to 7 of 12" (v1.1) uses the same field.

**Receive:** on a trusted `RemoteChangeDetected` for `.tramado/chat/<D>/<month>.jsonl`, read from the
saved byte offset of that file to the end; if the file shrank or its first saved bytes changed (redaction,
§8.16), re-read it whole. Any month file that changes is read, whatever its month. Parse complete lines, dedupe
by `(deviceId of the file, id)` (folder spec §8.16: the same `id` in another device's file is another message),
attribute each line to the person bound to the file's device (folder spec §6.2 rule 6), observe their HLCs, and
send them to the UI. Notifications follow the user's setting (mentions and important by default).

**Latency** (write → line in the receiver's file):

| Path | Measured |
|---|---|
| LAN or loopback, scan + `pullerDelayS: 0` | 0.24–0.36 s (3 senders in parallel: avg 0.21–0.31 s, max 0.79 s, 0 conflicts) |
| Public relay | 0.45–0.64 s |
| File watcher only (no explicit scan) | 1.0–2.3 s |
| Receiver offline | when it next connects to any member that has the line |

Syncthing writes received files to `.syncthing.<name>.tmp` and renames them, so readers never see a
partial file (✔ 32,509 reads during 300 appends, 0 partial).

---

## 16. Class notes: conflicts

Class notes are the only multi-writer machine-readable content (folder spec §8.21).

1. The editor autosaves 2 s after the last keystroke (atomic write) and scans at once.
2. While a note is open, presence carries `editing: {path}`; other members see "Bruno is editing this
   note" and get a gentle warning when they open it.
3. When `<base>.sync-conflict-<date>-<time>-<ShortId>.md` appears next to a note, the note shows "Two
   versions of this note" with a side-by-side line diff and [Keep this one] [Keep the other] [Keep both]
   [Merge by hand].
   - Keep one / merge: write the result to `<base>.md` (atomic), delete every conflict copy of it, scan the
     directory.
   - Keep both: rename the conflict copy to `<base> (2).md` (sanitised, unique).
4. Who wrote the losing text is unknown (the `ShortId` in the conflict name is not its author); the UI
   does not guess.
5. Conflict copies of machine files are not shown to people; their writer deletes them and rewrites the
   canonical file (folder spec §8.21).

---

## 17. Leaving a class

Leaving is a persisted background state, because the deletion of my member file must reach at least one other
member before my folder goes away, and often nobody is online when I leave.

```
leave(cls, afterwards: "keepLocal" | "trash", deleteMyNotes):          # the app, then Rust (sync_leave_class)
  for each of my claims in cls with status claimed/working: abort the job; set status "released"; scan
  rewrite .tramado/meta/<me>.json with a fresh hlc (the departure stamp, folder spec §8.2); scan
  delete .tramado/presence/<me>.json and .tramado/members/<me>.json; scan .tramado
  classes.json: leaving = {since: now, afterwards}; the class leaves the UI at once (it is listed only under
                Settings › Storage as "Leaving — waiting for a classmate to receive it")
  if deleteMyNotes: purge app_local_data_dir/private/<classId>/ now

finish_leaving(cls):    # Rust: at start, on FolderCompletion / RemoteIndexUpdated for cls, and every 60 s
  r = GET /rest/db/file?folder=<cls>&file=.tramado/members/<me>.json
  if not (r.availability has an entry with fromTemporary == false and r.global.deleted)
     and now - leaving.since < 30 days: return                         # nobody holds my deletion yet; no timeout
  config_writer: DELETE /rest/config/folders/<cls>                    # files stay on disk ✔
  classes.json: leftClasses += [cls]                                   # offers of cls are dropped silently from now on (§9.2)
  for every configured device d: PATCH ignoredFolders += {"id": cls, "label": <label>, "time": now_rfc3339()}
  for each device that now shares no folder and is not bound to my own memberId: DELETE /rest/config/devices/<d>
  afterwards == "trash":     move the class directory to the OS trash; remove cls from classes.json
  afterwards == "keepLocal": fork (below); the class stays as a local, unshared class
```

- Until `finish_leaving` runs, the folder keeps syncing (so the deletion can spread), but nothing new is shown.
  Moving the directory to the trash any earlier would only stop the folder (§22.3); it would not spread the
  deletion.
- **Fork.** A copy kept after leaving must not keep the class ID: a later "Share with classmates" or an `adopt`
  would otherwise create a folder with the old ID, and its stale files would resurrect deleted files for everyone
  (a modified file beats a deletion) or make conflict copies. So the app rewrites `class.json` as a fork (folder
  spec §8.1: new `idNonce`, the derived new `classId`, `forkedFrom` = old ID, signed) and Rust renames the registry
  entry and `private/<old>` to the new ID. The same fork happens when the user adopts a class folder whose
  `classId` is not registered but whose `.tramado/members/` holds other devices' files (a copied or restored
  folder). Rejoining the original class is only possible through an invite, into a new, empty directory.
  Mesh test: leave with keepLocal → share → no file of the original class changes on the other members.
- My chat logs, edits, answers and meta values stay in the class as history. Other members remove my devices when
  they see my member file deleted by me (`left()` in §10), and fold claims take over any transcript I owned
  (§14.8). Leaving propagated in about 1.5 s in the lab when a member was online.

---

## 18. Removing someone

Syncthing cannot take a folder away from a device that knows its ID: a removed device can knock again
and prove the ID. Tramado therefore offers a soft removal that every honest app enforces, and a hard
removal that changes the ID (v1.1).

### 18.1 Soft removal (ban)

An organiser chooses "Remove Bruno from the class". Its app, in one action:

1. adds `{target: {memberId}, state: "banned", hlc, reason}` to its signed `bans/<me>.json` (folder spec §8.19);
2. sets `askBeforeAdmit = true` in its own meta file (folder spec §8.2), so that a new computer or a reinstall of
   the banned person (a new device and a new person key, which would otherwise prove the folder ID and be let in
   automatically) has to be let in by a member;
3. scans `.tramado`.

Every member's app computes the effective bans (folder spec §8.19: organiser at the entry's HLC; a banned
`memberId` covers **every** device whose member file claims it, bound or not) and pushes them as
`ClassPolicy.bannedDevices`. Rust applies ban effects **declaratively** on every policy push and every reconcile:

```
apply_bans():           # over all classes at once; Rust
  wanted_folder_ignores = { (d, cls) : d in policy[cls].bannedDevices }
  for (d, cls) in wanted_folder_ignores:
    remove d from the folder's devices of cls (GET, then PATCH the full list)
    ensure d's ignoredFolders has {"id": cls, "label": <label>}              ◇ (§25 Q7)
  for every device d with an ignoredFolders entry for a tramado class not in wanted_folder_ignores:
    remove that entry                                                         # unbanned, or the ban no longer counts
  wanted_device_ignores = { d : every tramado folder d is configured for, or offers, bans d }
  ensure each is in remoteIgnoredDevices with name "tramado-ban"; remove "tramado-ban" entries not wanted
```

- Admission never ignores a device because of a ban in another class (§9.2): a classmate banned from one class
  may still be welcome in a study group with the same people.
- Unban = an entry with `state: "unbanned"` and a greater HLC; the next `apply_bans()` removes the effects (the
  person can rejoin with the invite).
- Members whose app is closed keep syncing with the banned device until they open Tramado; a soft ban is only as
  strong as the honest apps.
- The UI says: "{name} keeps what was already on their computer. From now on, new computers must be let in by a
  member. To be sure they can't come back, use [Start a fresh class without {name}]" (v1.1).

### 18.2 Hard removal: rotating the class to a new ID ("Start a fresh class without Bruno") (v1.1)

Done by an organiser's app R.

```
rotate(old, excludedMembers):
  new = classId(R, fresh idNonce)                                 # folder spec §2.1
  1. ban the excluded members (§18.1) so that members who have not moved yet stop syncing with them
  2. append to R's mod log in `old` (signed): {"type":"rotate","newClassIdSha256": sha256(new),"newLabel": label,
     "excluded": [{memberId, deviceIds: [every device claiming that memberId]}]}; scan
     (the new ID itself is never written into the old folder: the excluded devices can read it)
  3. wait until at least one other remaining member has the mod line (availability) or 30 s
  4. config_writer: DELETE /rest/config/folders/<old>                         # files stay on disk
  5. rewrite .tramado/class.json: {classId: new, idNonce, rotatedFrom: old, createdAt: now, createdBy: R, initialName, sig}
  6. POST /rest/config/folders {§6.2 body, id: new, path: same path, paused: true,
                                devices: [R] + every remaining roster device}
     POST /rest/db/ignores; PATCH paused false
  7. classes.json: classId = new, aliases += [old]; rename app_local_data_dir/private/<old> to private/<new>
```

Every other member's app, on a pending offer of an unknown `tramado-*` folder `new` from a device `R`:

```
accept automatically if:  R is bound to an organiser of a class `old` that I hold,
                          `old` has a trusted rotate mod line from R with newClassIdSha256 == sha256(new),
                          and I am not excluded (my memberId is not in the line's `excluded`, and I am not banned in `old`)
then:   DELETE /rest/config/folders/<old>                                    # files stay
        delete the local .tramado/class.json (R's new one arrives; avoids a conflict copy)
        POST /rest/config/folders {§6.2 body, id: new, path: <same path as old>, paused: true, devices: [me, R]}
        POST /rest/db/ignores; PATCH paused false
        classes.json and private data as in step 7
        reconcile (§10) then adds the other members from the roster, honouring bans and `excluded`
        notify "⚖️ TGDC moved to a fresh class without Bruno (by Ana)."
otherwise: ask the user: "Ana offers you a class called 'TGDC'. [Accept] [Ignore]"; Accept creates the folder with
           devices [me, offeredBy] only (happens when the mod line never reached this member)
```

Offers of a folder ID that is in some class's `aliases` (late members still offering the old ID) are dropped
silently and answered with an `ignoredFolders` entry on that device (§9.2). Because the files at the path are
identical apart from `class.json`, the new folder should sync only that file. Files that changed on a member between
R's step 4 and that member's move exist in two versions and become ordinary Syncthing conflicts: conflict copies of
machine files are cleaned up by their writers (folder spec §8.21); notes and documents get the normal conflict
dialog (§16). The excluded devices keep the old folder and what they had; nothing new reaches them once every member
has moved. The three-instance rotation test (§24) also delivers the mod line before the bans file, and covers the
manual Accept.

---

## 19. Pairing a second computer of the same person (v1.1)

Pairing gives a new computer the person's key and classes. Because member files are bound by the person key
(folder spec §8.3.1), a device that holds the key proves itself to everyone; no classmate has to vouch for it.

**Device 1** (existing), Settings → Your computers → "Add a computer": shows a QR and a code, open for 10
minutes, with the warning "Anyone who gets this code can act as you. Only scan it with your own computer."

```ts
interface PairV1 {
  v: 1;
  m: MemberId;                     // the person
  n: string;                       // display name
  d: { id: string; a: string[] };  // device 1: dashless ID, ≤ 5 addresses
  pk: string;                      // the person private key: base64url (no padding) of the 32-byte Ed25519 seed (43 chars)
  k: string;                       // one-time pairing secret: 16 random bytes, base32 lowercase, 26 chars
  f: Array<{ f: ClassId; l: string; c: ColourHex; i: IconName }>;   // ≤ 20 shared classes
  t: number;                       // created (Unix s)
  x: number;                       // t + 600
}
// code = "trp1_" + base64url(compact JSON); link = "tramado://pair/" + code
```

Rust on device 1 creates the code (`pk` is read from Rust's key store; `k` stays in Rust's memory and is never
written to disk or shown to the webview except inside the code). **Requires at least one shared class.**

**Device 2** (new) pastes or scans it (Rust decodes it, §9.5):

1. Validates (`x` not passed, device IDs via `/rest/svc/deviceid`), and stores `pk` as its person key (asking first
   if it already has a different identity: "This replaces your Tramado profile on this computer").
2. Sets its own device name to `"<name> · tp:" + first 8 base32 characters of HMAC-SHA256(key = k, msg = UTF-8(<device 2 canonical ID>))`
   (a pending device's name reaches members unchanged, critique V2), adds device 1 (addresses + `"dynamic"`), and
   for every class in `f` creates the folder like a joiner (§8) with devices `[me, device1]`.
3. In every class, writes its signed member file with a valid person proof for `m` (folder spec §8.3.1).

**Device 1:** for a pending device whose name carries a `tp:` token that verifies against the open `k`, admission
skips "ask before letting people in" (`pairing_peer`, §9.2); any other device follows the normal rules even while
pairing is open. Once device 2's member file arrives with a valid person proof, device 1 closes the pairing, shares
its remaining classes (those beyond the 20 in `f`) with device 2 (PATCH folder devices; a §9.5 widening action
allowed because Rust ran this pairing), and device 2 sets its device name back to "Tramado". Classmates admit
device 2 by the same folder-ID proof and show it under the same person because its person proof verifies.

Private data (notes, marks, practice) is **not** copied between the person's computers in v1.

**Removing one of your computers:** device 1 adds device 2 to `person.revoked` (signed with the person key) in its
member file of every class, removes device 2 from every folder and its own config, and forgets it. Every reader
then stops treating device 2 as that person (folder spec §8.3.1), and reconciliation drops it unless it re-proves
membership as someone else. A stolen computer is handled the same way.

**A user's own Syncthing:** "Add my Syncthing as one of my computers" shows device 1's ID and the class
folder IDs for the user to add by hand in their Syncthing; it is admitted like any device that proves the
folder IDs, has no person proof, and is listed as "Your Syncthing (not Tramado)". Tramado never touches
that Syncthing.

---

## 20. App closed, offline, tray

| Situation | What happens |
|---|---|
| Window closed, ≥ 1 shared class, "Keep sharing when the window is closed" on (default) | Tramado stays in the tray (Windows, Linux) or Dock (macOS). Syncthing, admission, roster, claim heartbeats, transcription and model downloads continue; notifications (mentions, joins, finished transcripts) are raised by the app (which keeps running while the window is hidden) and shown by the OS through Rust (`notify_show`). First time: "Keep sharing when you close the window? Your classmates get recordings and transcripts from you faster." |
| "Start at login" (offered at first share, default off) | Starts hidden in the tray. |
| Quit from the tray | Everything stops (§2.8). |
| Tramado not running | Nothing syncs from or to this computer. Joiners who can reach only this member wait. My claims stop heartbeating and become stale after 10 minutes, so others can take over. Lines I wrote while offline are already in my files; Syncthing's start-up scan sends them. |
| No member online | Messages show "🕓 Saved — will send when a classmate is online"; the joiner sees "No one from the class is online right now". Small classes often have nobody online, which is why the tray mode defaults to on. |
| Laptop asleep | Same as not running; on wake, §14.5's resume rule. |

Cost while hidden: Syncthing idles at ~0.5 % CPU and 47–73 MB RSS per instance (lab, 1 folder, 4–5
devices). The settings page says so.

---

## 21. Bandwidth and metered networks

Syncthing has no metered-network detection. v1 offers:

| Control | Implementation |
|---|---|
| "Pause sharing" (global, in the sync pill) | `PATCH /rest/config/folders/<id> {"paused": true}` for every class; remembered across restarts; resume sets `false`. Admission and connections continue; no data moves. |
| Upload / download limits | `PATCH /rest/config/options {"maxSendKbps": n, "maxRecvKbps": n}` (0 = unlimited; applies live ✔). |
| "Skip audio files" per class | Per-device ignore line `(?d)/**/audio.webm` (folder spec §11.2). Transcripts still arrive. Such a device never claims transcriptions of that class (it lacks the audio). |
| "Local network only" | `PATCH /rest/config/options {"globalAnnounceEnabled": false, "relaysEnabled": false, "natEnabled": false}`, and §11.1 lookups stop. Warned: "It won't work on eduroam and other networks that isolate devices." |

OS metered detection (NetworkManager `Metered`, Windows `NetworkCostType`, macOS `NWPath.isExpensive`)
is planned for v1.1. Relayed connections run at about 6 Mbit/s (a 90-minute lecture's audio, ~16 MB,
takes ~25 s); the members panel shows "Connected via relay (slow)" when `type` is `relay-client` or
`relay-server`.

---

## 22. Deletions, errors and folder health

### 22.1 Undo and "Recently deleted"

Deletions inside Tramado say "Delete for everyone in TGDC?" and then offer Undo, which restores through
`POST /rest/folder/versions?folder=<id>` with `{"<path>": "<versionTime>"}` (✔ the file came back and
re-synced to everyone).

- A restored file is a new version whose `modifiedBy` is the restorer. When the restorer is not the writer of a
  restored machine file (`lecture.json`, `exam.json`, a transcript), readers still trust it because its bytes equal
  the trust-cache entry, which is kept for 31 days after a deletion (folder spec §6.2 rule 1). A reader without the
  entry (a new joiner) shows the item with "Restored by Bruno (unverified)" instead of hiding it.
- **"Recently deleted (class)"** lists `GET /rest/folder/versions?folder=<id>` entries whose path is absent
  now (`GET /rest/db/file` → `global.deleted == true`), excluding `.tramado/**`, `transcript.md`, `transcript.vtt` and
  `*.sync-conflict-*`, grouped by lecture or exam directory. (The trashcan also keeps **replaced** files, so the raw
  list would show every replaced chat month, claim and presence file.)

### 22.2 Mass-change guard

Verified on v2.1.7: the trashcan archives only files replaced or deleted by **incoming** changes. After a member
deleted 60 files, its own `.stversions` held none of them while every peer's held all 60. Pausing about 5 ms after the
first `LocalChangeDetected{deleted}` kept all files on the peer (loopback); unpausing later sent every deletion.

**On the deleting device.** Tramado records every path it deletes itself (for 30 s). If `LocalChangeDetected`
reports more than 20 deletions in 10 s that Tramado did not make (someone emptied the folder in a file manager, or a
backup tool rolled it back), it pauses the folder at once
(`PATCH {"paused": true}`), remembers `guardPaused` in `appdata.json` (§2.7 keeps it paused across restarts) and
emits `massDelete`. Deletions made while the app was closed are caught the same way, because every folder starts
paused (§2.4 step 4) and is unpaused only after the event loops listen. The dialog says: "Did you mean to delete 143
files from TGDC for everyone? Sharing for this class is paused. If a classmate already received the deletion, their
Tramado can restore it." [Restore the files] [Yes, delete for everyone].
Only deletions are counted: Syncthing reports new and modified files alike, so a mass modification cannot be told
from a mass addition (G1 erratum).

- **Restore the files** (✔ 30 of 30 back on the deleting device; the peer never applied the deletions):
  1. keep the folder paused;
  2. `POST /rest/system/reset?folder=<id>` (Syncthing forgets its index of the folder and exits with code 3);
  3. the supervisor respawns it (§2.6); the folder stays paused (§2.4 step 4);
  4. `PATCH /rest/config/folders/<id> {"paused": false}`: Syncthing rescans, finds the files missing as "never
     had", and pulls them back from the peers.
- **Yes, delete for everyone**: unpause; the deletions spread.

**On receiving devices.** More than 20 `RemoteChangeDetected` deletions (or modifications of existing files) with the
same `modifiedBy` within 10 s, not explained by a lecture or exam directory deletion that the app showed, emits
`massDeleteRemote {classId, by, count, sample}`. The app shows "Bruno's computer deleted 143 files from TGDC.
[Restore for everyone] [Keep deleted]"; Restore uses `POST /rest/folder/versions` from the local trashcan, which
holds every file replaced or deleted by that incoming change.

The `.stignore` is part of the guard: a deleted or emptied `.stignore` is re-POSTed at every start before the folder
is unpaused (§2.7).

### 22.3 Folder marker missing

If `.stfolder` disappears (unmounted drive, moved folder), `POST /rest/db/scan` returns 500 and
`/rest/db/status` shows `state: "error"`, `error: "folder marker missing …"`; **nothing is deleted on
peers** (✔). Tramado shows "TGDC's folder can't be found. Put it back at {path}, or remove the class from this
computer." [Remove from this computer]. Error code `SYNC_FOLDER_MARKER_MISSING`. (v1.1: [Locate it…] does
`PATCH /rest/config/folders/<id> {"path": "<new path>"}` after checking that `<new path>/.tramado/class.json` has the
same `classId`.)

### 22.4 Files that cannot be synced

Names valid on one OS can fail on another (`aula: resumo?.md` on Windows; `Aula.pdf` vs `aula.pdf` on
case-insensitive systems). On `FolderErrors` or `pullErrors > 0`, Tramado reads
`GET /rest/folder/errors?folder=<id>` and shows "1 file can't be saved on this computer: rename it"
with a rename action that applies folder spec §5.4. Tramado also warns when the classes root is inside a
cloud-sync folder (path contains `OneDrive`, `Dropbox`, `iCloud Drive`, `Mobile Documents` or `Google
Drive`), which would double-sync and conflict.

### 22.5 Large classes

Every member connects to every other member (O(n²) connections). Above 30 members: "Large classes sync
slowly. Consider study groups." (dismissible, remembered in meta `largeClassAck`). Above 50: the same
advice on every invite. Presence writes only while active (§13) to keep index churn low.

---

## 23. Error codes (shared taxonomy)

| Code | When |
|---|---|
| `SYNC_UNAVAILABLE` | No sidecar binary; repeated start failures; device ID changed. |
| `SYNC_LOCKED` | Another process holds the Syncthing home and orphan clean-up could not stop it. |
| `SYNC_PORT` | No free port in 22100–22199. |
| `SYNC_FOLDER_MARKER_MISSING` | §22.3. |
| `SYNC_INVITE_INVALID` | §7.3, or a `class.json` mismatch, bad signature or bad derivation after joining. |
| `SYNC_FOREIGN_WRITE` | Authorship mismatch (diagnostics only, never a modal). |
| `SYNC_IDENTITY_COPIED` | The Syncthing home was copied from another computer (§2.5 step 0). |
| `NEWER_FORMAT` | Invite `tri2_`/`trp2_`, or newer records (folder spec §7.3). |
| `CONFLICT` | A class note has conflict copies (§16). |

The UI translates codes; messages go to logs. Device IDs in copied diagnostics are truncated to their
`ShortId`.

---

## 24. Test obligations

- **Contract tests** against the pinned Syncthing binary in Linux CI, re-run on every Syncthing bump:
  config pre-seed + `generate` (no port probed); folder create (paused → ignores → resume); POST-replaces semantics;
  pending device → provisional add → pending folder → share; outsider rejected and ignored; event names
  accepted (recorded list); `modifiedBy` after a foreign write and after a foreign deletion; `blocksHash` of a
  27-byte and a 1 MiB file equals §12.1; disk-event shapes (§12.2; `availability` with `fromTemporary`);
  `ignoredFolders` PATCH shape (§25 Q7); `POST /rest/system/reset` + respawn + unpause restores a local mass
  deletion (§22.2); a folder paused in `config.xml` before the spawn sends nothing; device signature with
  `key.pem` verifies against `cert.pem` (§12.4). On `windows-latest`: the path cases of §3.6.
- **Two-instance e2e** (each with its own `TRAMADO_DATA_DIR`, loopback listen address, discovery, relays
  and NAT off; instances stopped one after the other): invite → join → a document, a recording and chat
  cross → exactly one transcript.
- **Three-instance e2e for the unverified flows:** soft ban with `ignoredFolders` (§18.1), a foreign write and a
  foreign deletion followed by self-heal (§12.3), leaving while the others are offline (§17); in v1.1 also class
  rotation (§18.2: the excluded device receives nothing new; identical files cause no conflict copies; the mod line
  delivered before the bans file; manual Accept) and pairing (§19).
- **Vitest** with `createMemoryMesh()`: claims (§14.9 property and partition tests, §14.3 stale-winner test), chat,
  roster, admission, partitions; forged `memberId` in a device's own chat file is shown under that device's person,
  and a duplicate `id` in another device's file is a second message (folder spec §6.2 rule 6); a member deletes an
  organiser's member and bans files → organisers, effective bans and folder devices are unchanged on every reader
  (folder spec §6.2 rule 4); a stuck-joiner case where a member file stays untrusted for 3 cycles; the event for
  version N delivered after the bytes of version N+1 (§12.1); one device at +10 years sets a meta field and a later
  ordinary write still wins (folder spec §3.4).
- **Unit tests:** HLC, invite encode/decode/limits and QR reduction, address selection, `sanitize`, trust cache
  prefix logic, organiser replay (vacancy, departed organisers), edit replay, signature and person-proof
  verification, derived IDs (`test-vectors/ids.json`), `blocksHash`; Rust: admission constants and strikes, the
  §9.5 refusals, the start-up rule, `apply_bans` idempotence.
- **Process tests** per OS: kill the parent, assert the child is gone within 5 s (Linux, Windows) or
  cleaned up at the next start (macOS).

---

## 25. Open questions (each with the default v1 uses)

| # | Question | Default in v1 |
|---|---|---|
| 1 | Check words (two friendly words derived from the joiner's device ID, shown on both screens). | **Words in v1**: `checkWords(deviceId) = ADJ[h[0]] + "-" + NOUN[h[1]]`, `h = SHA-256(UTF-8("tramado-check-v1|" + canonical dashed deviceId))`, with the 256 adjectives and 256 animal names of `docs/spec/check-words-v1.txt` (ASCII, 3–7 letters, never translated; written once by M0 and frozen; vectors in `test-vectors/check-words.json`). |
| 2 | Revocable / expiring invites. | Advisory expiry only; v1.1 adds the device-name token and `.tramado/invites/`. |
| 3 | GUI over a Unix socket instead of TCP loopback. | TCP loopback (`ureq` has no Unix-socket support; socket paths are limited to 107/103 bytes). |
| 4 | Static join page. | `https://feiteira.github.io/Tramado/join/` (`site/join/index.html`, deployed by `.github/workflows/pages.yml`), reading the fragment; no third-party scripts. Builds use it as `web` only once it is live; until then `JOIN_PAGE = ''` and links and the QR use `tramado://join/<code>`. |
| 5 | Automatic cloud transcription by volunteers (costs the volunteer money). | Off unless the volunteer explicitly allowed "use OpenRouter automatically". |
| 6 | Private sync of personal data between a person's computers. | Not in v1 (an unshared per-person folder in v1.1). |
| 7 | Using `ignoredFolders` on a device for per-class bans (§18.1). | Used as written, marked ◇; the contract test must confirm the PATCH shape before release, otherwise fall back to ignoring the device entirely. |
