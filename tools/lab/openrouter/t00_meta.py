import sys, json; sys.path.insert(0, sys.argv[1]); import orlib
r = orlib.call("meta_models", "GET", "/models", save=False)
(orlib.HERE/"dl"/"models.json").write_text(json.dumps(r["json"]))
print("models status", r["status"], "count", len(r["json"]["data"]), "lat", r["latency_s"])
r = orlib.call("meta_key", "GET", "/key")
print("key", r["status"], json.dumps(r["json"])[:1500])
r = orlib.call("meta_embeddings_models", "GET", "/embeddings/models", save=False)
(orlib.HERE/"dl"/"embeddings_models.json").write_text(json.dumps(r["json"]) if r["json"] else (r["text"] or ""))
print("emb models", r["status"], (json.dumps(r["json"])[:300] if r["json"] else r["text"][:300]))
