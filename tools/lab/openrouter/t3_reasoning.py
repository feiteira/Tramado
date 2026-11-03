import sys, json, time; sys.path.insert(0, sys.argv[1]); import orlib
M = "nvidia/nemotron-3.5-super-vl:free"
Q = [{"role": "user", "content": "Um aluno teve 12, 15 e 17 valores em três testes com pesos 20%, 30% e 50%. Qual a média final? Responde numa frase."}]
cases = [
  ("t3_default_mt150", {"max_tokens": 150}),
  ("t3_enabled_false_mt150", {"max_tokens": 150, "reasoning": {"enabled": False}}),
  ("t3_effort_none_mt150", {"max_tokens": 150, "reasoning": {"effort": "none"}}),
  ("t3_effort_low_mt600", {"max_tokens": 600, "reasoning": {"effort": "low"}}),
  ("t3_exclude_mt1500", {"max_tokens": 1500, "reasoning": {"exclude": True}}),
]
only = sys.argv[2:] 
for name, extra in cases:
    if only and name not in only: continue
    r = orlib.chat(name, {"model": M, "messages": Q, "temperature": 0.2, **extra})
    b = orlib.brief(r)
    print(name, json.dumps({k: b.get(k) for k in ("status","latency_s","model","finish_reason","content","reasoning_len","error")}, ensure_ascii=False),
          "usage:", json.dumps({"completion": (b.get("usage") or {}).get("completion_tokens"), "reasoning": ((b.get("usage") or {}).get("completion_tokens_details") or {}).get("reasoning_tokens")}))
    time.sleep(3)
