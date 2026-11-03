import sys, json; sys.path.insert(0, sys.argv[1]); import orlib
from t4_tools_defs import TOOLS
body = {"model": "nvidia/nemotron-3.5-super-vl:free", "stream": True, "tools": TOOLS, "tool_choice": "auto", "max_tokens": 2000,
        "reasoning": {"exclude": True},
        "messages": [{"role": "system", "content": "Usa sempre search_materials antes de responder."},
                     {"role": "user", "content": "O que diz o artigo 18.º sobre restrições? E o 13.º?"}]}
r = orlib.stream("t4_stream_toolcalls", body)
print("status", r["status"], r["latency_s"])
for t, line in r["lines"]:
    if line.startswith("data: {"):
        js = json.loads(line[6:])
        for c in js.get("choices", []):
            d = c.get("delta", {})
            if d.get("tool_calls") or c.get("finish_reason"): print(t, json.dumps({"tool_calls": d.get("tool_calls"), "finish": c.get("finish_reason"), "reasoning": d.get("reasoning")}, ensure_ascii=False)[:400])
    elif line.startswith(":") or "[DONE]" in line: print(t, line)
