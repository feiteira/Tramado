#!/usr/bin/env python3
# Adversarial protocol checks against Syncthing v2.1.7 (two loopback instances X, Y).
import json, os, subprocess, sys, time, threading, urllib.request, shutil
BASE = "/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/adversarial/st"
ST = "/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/syncthing/bin-extract/syncthing-linux-amd64-v2.1.7/syncthing"
GP = {"X": 18591, "Y": 18592}; SP = {"X": 22591, "Y": 22592}
KEY = {"X": "advkeyx0000000000000000000000001", "Y": "advkeyy0000000000000000000000002"}
procs = {}
def api(i, m, p, body=None, timeout=70):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"http://127.0.0.1:{GP[i]}{p}", data=data, method=m,
                               headers={"X-API-Key": KEY[i], "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        t = resp.read().decode()
        try: return json.loads(t) if t else None
        except Exception: return t
def start(i):
    h = f"{BASE}/{i}"
    subprocess.run([ST, "generate", f"--home={h}", "--no-port-probing"], capture_output=True)
    env = dict(os.environ, STMONITORED="yes", STNOUPGRADE="1", STGUIAPIKEY=KEY[i])
    out = open(f"{BASE}/{i}.stdout", "w")
    procs[i] = subprocess.Popen([ST, "serve", f"--home={h}", "--no-browser", "--no-restart", "--no-upgrade",
                                 f"--gui-address=http://127.0.0.1:{GP[i]}"], env=env, stdout=out, stderr=out)
    for _ in range(150):
        try: api(i, "GET", "/rest/noauth/health"); break
        except Exception: time.sleep(0.1)
    api(i, "PATCH", "/rest/config/options", {"listenAddresses": [f"tcp://127.0.0.1:{SP[i]}"], "globalAnnounceEnabled": False,
        "localAnnounceEnabled": False, "relaysEnabled": False, "natEnabled": False, "urAccepted": -1, "urSeen": 3, "crashReportingEnabled": False})
    return api(i, "GET", "/rest/system/status")["myID"]
shutil.rmtree(BASE, ignore_errors=True); os.makedirs(BASE)
X = start("X"); Y = start("Y")
print("X", X, "Y", Y)
F = "tramado-advaaaaaaaaaaaaaaaaaaaaaaa"
for i, me, other in (("X", X, Y), ("Y", Y, X)):
    d = f"{BASE}/d{i}"; os.makedirs(d, exist_ok=True)
    api(i, "POST", "/rest/config/devices", {"deviceID": other, "addresses": [f"tcp://127.0.0.1:{SP['Y' if i=='X' else 'X']}"]})
    api(i, "POST", "/rest/config/folders", {"id": F, "label": "Adv", "path": d, "type": "sendreceive", "fsWatcherEnabled": True,
        "fsWatcherDelayS": 1, "pullerDelayS": 0, "versioning": {"type": "trashcan", "params": {"cleanoutDays": "30"}},
        "devices": [{"deviceID": me}, {"deviceID": other}]})
for _ in range(120):
    if api("Y", "GET", f"/rest/db/completion?folder={F}&device={X}").get("remoteState") == "valid": break
    time.sleep(0.25)
print("connected")
# prime disk events on both
since = {}
for i in "XY":
    ev = api(i, "GET", "/rest/events/disk?since=0&timeout=0")
    since[i] = max([e["id"] for e in ev], default=0)
evlog = {"X": [], "Y": []}
stop = threading.Event()
def poll(i):
    s = since[i]
    while not stop.is_set():
        try: ev = api(i, "GET", f"/rest/events/disk?since={s}&timeout=2", timeout=10)
        except Exception: continue
        now = time.time()
        for e in ev or []:
            s = max(s, e["id"]); evlog[i].append((now, e))
for i in "XY": threading.Thread(target=poll, args=(i,), daemon=True).start()
# ---------- T1: new file -> full /rest/db/file JSON on Y; action for a brand-new file
xp = f".tramado/chat/{X}"; os.makedirs(f"{BASE}/dX/{xp}", exist_ok=True)
rel = f"{xp}/2026-11.jsonl"
with open(f"{BASE}/dX/{rel}", "w") as fh: fh.write('{"id":"m1","text":"hello"}\n')
api("X", "POST", f"/rest/db/scan?folder={F}&sub=" + urllib.parse.quote(xp, safe="") if False else f"/rest/db/scan?folder={F}&sub=.tramado%2Fchat")
time.sleep(2.0)
print("T1 /rest/db/file on Y:", json.dumps(api("Y", "GET", f"/rest/db/file?folder={F}&file=" + urllib.request.quote(rel)))[:1500])
print("T1 Y disk events:", [(e["type"], e["data"]["action"], e["data"]["path"], e["data"]["modifiedBy"]) for _, e in evlog["Y"]])
# ---------- T2: timing on Y: bytes on disk vs RemoteChangeDetected vs db/file local.modifiedBy
ypath = f"{BASE}/dY/{rel}"
obs = {"disk": None, "dbfile": None}
def watch_disk():
    while obs["disk"] is None and not stop.is_set():
        try:
            with open(ypath) as fh:
                if "second" in fh.read(): obs["disk"] = time.time()
        except Exception: pass
        time.sleep(0.002)
def watch_db():
    while obs["dbfile"] is None and not stop.is_set():
        try:
            j = api("Y", "GET", f"/rest/db/file?folder={F}&file=" + urllib.request.quote(rel), timeout=5)
            if j["local"]["size"] > 30: obs["dbfile"] = time.time()
        except Exception: pass
        time.sleep(0.005)
n0 = len(evlog["Y"])
t1 = threading.Thread(target=watch_disk); t2 = threading.Thread(target=watch_db); t1.start(); t2.start()
with open(f"{BASE}/dX/{rel}", "a") as fh: fh.write('{"id":"m2","text":"second line"}\n')
tw = time.time(); api("X", "POST", f"/rest/db/scan?folder={F}&sub=.tramado%2Fchat")
t1.join(10); t2.join(10); time.sleep(1.0)
evt = [t for t, e in evlog["Y"][n0:] if e["type"] == "RemoteChangeDetected" and e["data"]["path"].endswith("2026-11.jsonl")]
print("T2 ms after write: disk=%.1f dbfile=%.1f event=%s" % ((obs["disk"]-tw)*1000, (obs["dbfile"]-tw)*1000, [round((t-tw)*1000,1) for t in evt]))
# ---------- T3: foreign write by Y with same size, then deletion by Y; what X sees
with open(f"{BASE}/dX/{rel}") as fh: orig = fh.read()
forged = orig.replace("hello", "HELL0")
assert len(forged) == len(orig)
st = os.stat(f"{BASE}/dY/{rel}")
with open(f"{BASE}/dY/{rel}", "w") as fh: fh.write(forged)
os.utime(f"{BASE}/dY/{rel}", ns=(st.st_atime_ns, st.st_mtime_ns))   # same size + same mtime
api("Y", "POST", f"/rest/db/scan?folder={F}&sub=.tramado%2Fchat"); time.sleep(2.5)
with open(f"{BASE}/dX/{rel}") as fh: print("T3 same-size+same-mtime forge reached X:", "HELL0" in fh.read())
print("T3 Y local after forge:", json.dumps(api("Y", "GET", f"/rest/db/file?folder={F}&file=" + urllib.request.quote(rel))["local"])[:400])
# T3b forge with different size
with open(f"{BASE}/dY/{rel}", "a") as fh: fh.write('{"id":"m3","text":"FORGED"}\n')
api("Y", "POST", f"/rest/db/scan?folder={F}&sub=.tramado%2Fchat"); time.sleep(2.5)
j = api("X", "GET", f"/rest/db/file?folder={F}&file=" + urllib.request.quote(rel))
print("T3b X local.modifiedBy=%s global.modifiedBy=%s version=%s" % (j["local"]["modifiedBy"], j["global"]["modifiedBy"], j["local"]["version"]))
print("T3b availability on X:", json.dumps(j.get("availability")))
# T3c deletion by Y of X's file
n0 = len(evlog["X"])
os.remove(f"{BASE}/dY/{rel}")
api("Y", "POST", f"/rest/db/scan?folder={F}&sub=.tramado%2Fchat"); time.sleep(2.5)
j = api("X", "GET", f"/rest/db/file?folder={F}&file=" + urllib.request.quote(rel))
print("T3c X after foreign delete: exists=%s local.deleted=%s local.modifiedBy=%s" % (os.path.exists(f"{BASE}/dX/{rel}"), j["local"]["deleted"], j["local"]["modifiedBy"]))
print("T3c X events:", [(e["type"], e["data"]["action"], e["data"]["modifiedBy"]) for _, e in evlog["X"][n0:]])
# ---------- T4: mass delete on X: does pausing on the first LocalChangeDetected stop propagation?
mdir = f"{BASE}/dX/docs"; os.makedirs(mdir, exist_ok=True)
for k in range(60):
    with open(f"{mdir}/f{k:02d}.txt", "w") as fh: fh.write("x" * 100 + str(k))
api("X", "POST", f"/rest/db/scan?folder={F}&sub=docs"); time.sleep(3)
print("T4 Y has files before:", len(os.listdir(f"{BASE}/dY/docs")))
n0 = len(evlog["X"])
paused_at = {"t": None}
def guard():
    while paused_at["t"] is None:
        for t, e in evlog["X"][n0:]:
            if e["type"] == "LocalChangeDetected" and e["data"]["action"] == "deleted":
                api("X", "PATCH", f"/rest/config/folders/{F}", {"paused": True}); paused_at["t"] = time.time(); return
        time.sleep(0.005)
g = threading.Thread(target=guard); g.start()
td = time.time()
for k in range(60): os.remove(f"{mdir}/f{k:02d}.txt")
g.join(20); time.sleep(4)
left_y = len([n for n in os.listdir(f"{BASE}/dY/docs")]) if os.path.isdir(f"{BASE}/dY/docs") else 0
print("T4 paused %.0f ms after the rm; Y still has %d of 60 files (watcher path, fsWatcherDelayS 1)" % ((paused_at["t"]-td)*1000, left_y))
api("X", "PATCH", f"/rest/config/folders/{F}", {"paused": False})
stop.set()
for i in "XY":
    try: api(i, "POST", "/rest/system/shutdown")
    except Exception: pass
    time.sleep(0.5)
for i in "XY":
    try: procs[i].wait(15)
    except Exception: procs[i].kill()
print("done")
