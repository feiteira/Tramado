import json, sys
for p in sys.argv[1:]:
    try:
        d = json.load(open(p))
    except Exception as e:
        print(p, "ERR", e); continue
    if "crate" not in d:
        print(p, "missing"); continue
    c = d["crate"]; v = d["versions"][0]
    mx = c.get("max_stable_version") or c.get("max_version")
    print("%-22s max=%-12s upd=%s created=%s dl=%10d recent=%9d lic=%s repo=%s" % (c["name"], mx, c["updated_at"][:10], c["created_at"][:10], c["downloads"], c["recent_downloads"] or 0, v.get("license"), c.get("repository")))
