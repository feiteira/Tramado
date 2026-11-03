import sys, json; sys.path.insert(0, sys.argv[1]); import orlib
FALLBACK = ["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free", "nvidia/nemotron-3.5-super-vl:free"]
name = sys.argv[2]
body = {"model": FALLBACK[0], "models": FALLBACK, "stream": True,
        "messages": [{"role": "user", "content": "Lista 3 direitos fundamentais da Constituição portuguesa, uma linha cada."}],
        "max_tokens": 1500, "temperature": 0.3}
if len(sys.argv) > 3:
    body.update(json.loads(sys.argv[3]))
r = orlib.stream(name, body)
print("status", r["status"], "total", r["latency_s"], "lines", len(r["lines"]))
content, reasoning, kinds, usage, first_content_t, first_any_t = "", "", {}, None, None, None
for t, line in r["lines"]:
    if line == "": kinds["blank"] = kinds.get("blank", 0) + 1; continue
    if line.startswith(":"):
        kinds[line] = kinds.get(line, 0) + 1; continue
    if line.startswith("data: "):
        p = line[6:]
        if p == "[DONE]": kinds["[DONE]"] = 1; continue
        js = json.loads(p)
        first_any_t = first_any_t or t
        if js.get("usage"): usage = js["usage"]; kinds["usage_chunk"] = t
        if js.get("error"): kinds["error"] = js["error"]
        for c in js.get("choices", []):
            d = c.get("delta", {})
            if d.get("content"):
                content += d["content"]; first_content_t = first_content_t or t
            if d.get("reasoning"): reasoning += d["reasoning"]
            if c.get("finish_reason"): kinds.setdefault("finish", []).append([t, c["finish_reason"], c.get("native_finish_reason")])
    else:
        kinds.setdefault("other", []).append(line[:200])
print(json.dumps({"kinds": kinds, "first_chunk_s": first_any_t, "first_content_s": first_content_t,
                  "content": content, "reasoning_chars": len(reasoning), "usage": usage}, indent=1, ensure_ascii=False))
# print first 3 and last 4 raw data lines
datal = [l for l in r["lines"] if l[1].startswith(("data", ":"))]
for l in datal[:4] + [["..."]] + datal[-4:]: print(json.dumps(l, ensure_ascii=False)[:700])
