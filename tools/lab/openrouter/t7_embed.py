import sys, json, math; sys.path.insert(0, sys.argv[1]); import orlib
from corpus import PASSAGES
model = sys.argv[2]; name = sys.argv[3]
Q = "Um regulamento municipal pode restringir a liberdade de propaganda política de um só partido?"
inputs = [Q] + [p["text"] for p in PASSAGES]
r = orlib.call(name, "POST", "/embeddings", {"model": model, "input": inputs, "encoding_format": "float"}, save=False)
js = r["json"] or {}
print("status", r["status"], "lat", r["latency_s"], "keys", list(js.keys()), "model", js.get("model"), "provider", js.get("provider"))
if "error" in js: print(json.dumps(js["error"], ensure_ascii=False)[:800])
if "data" in js:
    vecs = [d["embedding"] for d in js["data"]]
    print("n", len(vecs), "dims", len(vecs[0]), "item keys", list(js["data"][0].keys()), "usage", js.get("usage"))
    def cos(a, b): return sum(x*y for x, y in zip(a, b)) / (math.sqrt(sum(x*x for x in a)) * math.sqrt(sum(y*y for y in b)))
    for p, v in sorted(zip(PASSAGES, vecs[1:]), key=lambda t: -cos(vecs[0], t[1])):
        print(f"  {cos(vecs[0], v):.3f}  {p['loc']}")
    small = dict(js); small["data"] = [{**d, "embedding": d["embedding"][:4] + ["…"]} for d in js["data"]]
    (orlib.OUT / f"{name}.json").write_text(json.dumps({"request": {"model": model, "input": ["<6 strings>"]}, "response": {"status": r["status"], "json": small}}, indent=1))
