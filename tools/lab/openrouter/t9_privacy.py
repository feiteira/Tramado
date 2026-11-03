import sys, json, time; sys.path.insert(0, sys.argv[1]); import orlib
Q = [{"role": "user", "content": "Responde só 'ok'."}]
cases = {
 "t9_super_deny": {"model": "nvidia/nemotron-3.5-super-vl:free", "provider": {"data_collection": "deny"}},
 "t9_super_zdr": {"model": "nvidia/nemotron-3.5-super-vl:free", "provider": {"zdr": True}},
 "t9_gemma31_deny": {"model": "google/gemma-4-31b-it:free", "provider": {"data_collection": "deny"}},
 "t9_gemma31_zdr": {"model": "google/gemma-4-31b-it:free", "provider": {"zdr": True}},
 "t9_fallback_deny": {"model": "google/gemma-4-31b-it:free", "models": ["google/gemma-4-31b-it:free", "nvidia/nemotron-3.5-super-vl:free", "nvidia/nemotron-3-ultra-550b-a55b:free"], "provider": {"data_collection": "deny"}},
}
for name in sys.argv[2:]:
    r = orlib.chat(name, {**cases[name], "messages": Q, "max_tokens": 50, "reasoning": {"enabled": False}})
    print(name, r["status"], r["latency_s"], json.dumps(r["json"], ensure_ascii=False)[:900], {k: v for k, v in r["headers"].items() if k.lower() == "x-openrouter-error-origin"})
    time.sleep(2)
