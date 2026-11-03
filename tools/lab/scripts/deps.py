import json, sys, urllib.request
def get(u):
    r = urllib.request.Request(u, headers={"User-Agent": "tramado-research (feiteira)"})
    return json.load(urllib.request.urlopen(r))
for spec in sys.argv[1:]:
    name, ver = spec.split("@")
    d = get("https://crates.io/api/v1/crates/%s/%s" % (name, ver))
    v = d["version"]
    print("== %s %s  license=%s  rust_version=%s  size=%s  published=%s" % (name, ver, v.get("license"), v.get("rust_version"), v.get("crate_size"), v["created_at"][:10]))
    feats = v.get("features") or {}
    print("   features:", json.dumps(feats)[:900])
    dd = get("https://crates.io/api/v1/crates/%s/%s/dependencies" % (name, ver))
    for x in dd["dependencies"]:
        print("   dep %-8s %-28s %-12s opt=%s %s" % (x["kind"], x["crate_id"], x["req"], x["optional"], x.get("target") or ""))
