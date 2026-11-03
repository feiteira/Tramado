import sys, json; sys.path.insert(0, sys.argv[1]); import orlib
from corpus import PASSAGES
which = sys.argv[2]
if which == "debug":
    sys.argv = [sys.argv[0], sys.argv[1]]
    import importlib.util
    spec = importlib.util.spec_from_file_location("t5", orlib.HERE / "t5_structured.py"); t5 = importlib.util.module_from_spec(spec)
    # reuse EXAM/SCHEMA without running cases
    src = (orlib.HERE / "t5_structured.py").read_text(); exec(src[:src.index("cases = {")], t5.__dict__)
    body = {"model": "nvidia/nemotron-3-ultra-550b-a55b:free", "stream": True, "debug": {"echo_upstream_body": True},
            "messages": [{"role": "system", "content": t5.SYS}, {"role": "user", "content": t5.EXAM}],
            "response_format": t5.rf(), "max_tokens": 3000, "temperature": 0, "reasoning": {"effort": "low"}}
    r = orlib.stream("t2_stream_debug_ultra_schema", body)
    print("status", r["status"], r["latency_s"])
    for t, line in r["lines"][:6]:
        if line.startswith("data: {") and '"debug"' in line:
            js = json.loads(line[6:]); up = js.get("debug", {}).get("echo_upstream_body", js.get("debug"))
            print("DEBUG CHUNK keys:", list(js.keys()), "choices:", js.get("choices"))
            print(json.dumps(up, ensure_ascii=False)[:1800])
        else:
            print(t, line[:200])
else:
    big = " ".join(p["text"] for p in PASSAGES)
    content = (big + "\n") * 200 + "\nQuantos artigos diferentes aparecem acima? Responde só com o número."
    body = {"model": "nvidia/nemotron-3.5-super-vl:free", "stream": True, "max_tokens": 60, "reasoning": {"enabled": False},
            "messages": [{"role": "user", "content": content}]}
    r = orlib.stream("t2_stream_bigprompt", body)
    p = orlib.OUT / "t2_stream_bigprompt.json"; s = json.loads(p.read_text())
    s["request"]["body"]["messages"][0]["content"] = f"<{len(content)} chars>"; p.write_text(json.dumps(s, indent=1, ensure_ascii=False))
    print("status", r["status"], "total", r["latency_s"], "chars", len(content))
    for t, line in r["lines"]:
        if line.startswith(":") or '"usage"' in line or '"error"' in line or "[DONE]" in line or '"content":"' in line and '"content":""' not in line:
            print(t, line[:400])
