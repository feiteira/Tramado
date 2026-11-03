#!/usr/bin/env python3
# Can the deleting device undo an unpropagated mass delete by resetting its folder index? (v2.1.7)
import json, os, subprocess, time, threading, urllib.request, shutil
BASE = "/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/adversarial/st2"
ST = "/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/syncthing/bin-extract/syncthing-linux-amd64-v2.1.7/syncthing"
GP = {"X": 18691, "Y": 18692}; SP = {"X": 22691, "Y": 22692}
KEY = {"X": "advkeyx0000000000000000000000011", "Y": "advkeyy0000000000000000000000012"}
procs = {}
def api(i, m, p, body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"http://127.0.0.1:{GP[i]}{p}", data=data, method=m, headers={"X-API-Key": KEY[i], "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        t = resp.read().decode()
        try: return json.loads(t) if t else None
        except Exception: return t
def spawn(i):
    env = dict(os.environ, STMONITORED="yes", STNOUPGRADE="1", STGUIAPIKEY=KEY[i])
    out = open(f"{BASE}/{i}.stdout", "a")
    procs[i] = subprocess.Popen([ST, "serve", f"--home={BASE}/{i}", "--no-browser", "--no-restart", "--no-upgrade", f"--gui-address=http://127.0.0.1:{GP[i]}"], env=env, stdout=out, stderr=out)
    for _ in range(150):
        try: api(i, "GET", "/rest/noauth/health"); return
        except Exception: time.sleep(0.1)
def start(i):
    subprocess.run([ST, "generate", f"--home={BASE}/{i}", "--no-port-probing"], capture_output=True)
    spawn(i)
    api(i, "PATCH", "/rest/config/options", {"listenAddresses": [f"tcp://127.0.0.1:{SP[i]}"], "globalAnnounceEnabled": False, "localAnnounceEnabled": False, "relaysEnabled": False, "natEnabled": False, "urAccepted": -1, "urSeen": 3, "crashReportingEnabled": False})
    return api(i, "GET", "/rest/system/status")["myID"]
shutil.rmtree(BASE, ignore_errors=True); os.makedirs(BASE)
X = start("X"); Y = start("Y"); F = "tramado-advbbbbbbbbbbbbbbbbbbbbbbb"
for i, me, other, o in (("X", X, Y, "Y"), ("Y", Y, X, "X")):
    os.makedirs(f"{BASE}/d{i}", exist_ok=True)
    api(i, "POST", "/rest/config/devices", {"deviceID": other, "addresses": [f"tcp://127.0.0.1:{SP[o]}"]})
    api(i, "POST", "/rest/config/folders", {"id": F, "label": "R", "path": f"{BASE}/d{i}", "type": "sendreceive", "fsWatcherEnabled": True, "fsWatcherDelayS": 1, "pullerDelayS": 0, "versioning": {"type": "trashcan", "params": {"cleanoutDays": "30"}}, "devices": [{"deviceID": me}, {"deviceID": other}]})
for _ in range(120):
    if api("Y", "GET", f"/rest/db/completion?folder={F}&device={X}").get("remoteState") == "valid": break
    time.sleep(0.25)
os.makedirs(f"{BASE}/dX/docs")
for k in range(30):
    open(f"{BASE}/dX/docs/f{k:02d}.txt", "w").write("y" * 50 + str(k))
api("X", "POST", f"/rest/db/scan?folder={F}&sub=docs"); time.sleep(3)
print("Y has", len(os.listdir(f"{BASE}/dY/docs")))
# X: pause first (simulates the guard having won), then delete + scan while paused is impossible -> delete, scan, pause
ev = api("X", "GET", "/rest/events/disk?since=0&timeout=0"); s = max([e["id"] for e in ev], default=0)
for k in range(30): os.remove(f"{BASE}/dX/docs/f{k:02d}.txt")
while True:
    ev = api("X", "GET", f"/rest/events/disk?since={s}&timeout=5")
    if any(e["type"] == "LocalChangeDetected" and e["data"]["action"] == "deleted" for e in ev): break
    s = max([e["id"] for e in ev], default=s)
api("X", "PATCH", f"/rest/config/folders/{F}", {"paused": True}); time.sleep(3)
print("after guard pause: Y has", len(os.listdir(f"{BASE}/dY/docs")), "X has", len(os.listdir(f"{BASE}/dX/docs")))
# reset X's index for the folder
try:
    print("reset:", api("X", "POST", f"/rest/system/reset?folder={F}"))
except Exception as e:
    print("reset error:", repr(e))
rc = procs["X"].wait(20); print("X exited with", rc)
spawn("X")
print("X folder paused after respawn:", api("X", "GET", f"/rest/config/folders/{F}")["paused"])
api("X", "PATCH", f"/rest/config/folders/{F}", {"paused": False})
for _ in range(60):
    time.sleep(0.5)
    if len(os.listdir(f"{BASE}/dX/docs")) == 30: break
print("after reset+unpause: X has", len(os.listdir(f"{BASE}/dX/docs")), "Y has", len(os.listdir(f"{BASE}/dY/docs")))
time.sleep(2)
print("final: X has", len(os.listdir(f"{BASE}/dX/docs")), "Y has", len(os.listdir(f"{BASE}/dY/docs")))
for i in "XY":
    try: api(i, "POST", "/rest/system/shutdown")
    except Exception: pass
    time.sleep(0.5)
for i in "XY":
    try: procs[i].wait(15)
    except Exception: procs[i].kill()
