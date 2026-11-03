import sys, json, time; sys.path.insert(0, sys.argv[1]); import orlib
time.sleep(2)
r = orlib.call("t1_generation_lookup", "GET", "/generation?id=<redacted>")
print("generation", r["status"], json.dumps(r["json"], ensure_ascii=False)[:3000])
body = {"model": "google/gemma-4-31b-it:free",
        "messages": [{"role": "user", "content": "Diz olá em português europeu."}], "max_tokens": 200}
r = orlib.chat("t8_429_gemma_single", body)
print(json.dumps(orlib.brief(r), indent=1, ensure_ascii=False))
print(json.dumps({k:v for k,v in r["headers"].items() if k.lower() not in ("set-cookie","permissions-policy")}, indent=1))
