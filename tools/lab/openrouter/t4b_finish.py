import sys, json; sys.path.insert(0, sys.argv[1]); import orlib
sys.argv += []
from t4_tools_defs import TOOLS
tr = json.loads((orlib.OUT / "t4_ultra_transcript.json").read_text())
msgs = tr["messages"]
msgs.append({"role": "user", "content": "[Tramado] Limite de pesquisas atingido. Responde agora à pergunta com o que já leste, citando as refs [S#]. Não chames mais ferramentas."})
body = {"model": "nvidia/nemotron-3-ultra-550b-a55b:free", "messages": msgs, "tools": TOOLS, "tool_choice": "none",
        "max_tokens": 4000, "temperature": 0.2, "reasoning": {"effort": "low"}}
r = orlib.chat("t4_ultra_final_toolchoice_none", body)
b = orlib.brief(r)
print(json.dumps({k: b.get(k) for k in ("status","latency_s","model","finish_reason","tool_calls","error")}, ensure_ascii=False))
print(b.get("content"))
print(json.dumps(b.get("usage", {}), ensure_ascii=False)[:400])
