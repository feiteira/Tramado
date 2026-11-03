import sys, json; sys.path.insert(0, sys.argv[1]); import orlib
r = orlib.call("meta_models_stt", "GET", "/models?output_modalities=transcription", save=False)
(orlib.HERE/"dl"/"models_stt.json").write_text(json.dumps(r["json"]))
print("stt", r["status"])
for m in (r["json"] or {}).get("data", []):
    print(" ", m["id"], json.dumps(m["pricing"]), m["architecture"]["input_modalities"], m["architecture"]["output_modalities"], m.get("endpoints"))
for mid in ["google/gemma-4-31b-it:free", "nvidia/nemotron-3.5-super-vl:free"]:
    r = orlib.call("meta_endpoints_" + mid.split("/")[1].replace(":", "_"), "GET", f"/models/{mid}/endpoints")
    print(mid, r["status"])
    for e in (r["json"] or {}).get("data", {}).get("endpoints", []):
        print("  ", json.dumps({k: e.get(k) for k in ("name","provider_name","tag","context_length","max_completion_tokens","quantization","status","uptime_last_30m","supports_implicit_caching","supported_parameters","pricing")})[:900])
