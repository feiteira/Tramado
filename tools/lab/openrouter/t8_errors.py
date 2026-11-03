import sys, json, time; sys.path.insert(0, sys.argv[1]); import orlib
from corpus import PASSAGES
big = " ".join(p["text"] for p in PASSAGES)
cases = {
 "t8_401_bad_key": dict(body={"model": "nvidia/nemotron-3.5-super-vl:free", "messages": [{"role": "user", "content": "ping"}], "max_tokens": 5}, key="sk-or-v1-" + "0"*64),
 "t8_404_no_model": dict(body={"model": "google/does-not-exist:free", "messages": [{"role": "user", "content": "ping"}], "max_tokens": 5}),
 "t8_400_bad_body": dict(body={"model": "nvidia/nemotron-3.5-super-vl:free", "messages": "ping"}),
 "t8_400_context": dict(body={"model": "liquid/lfm-2.5-2.6b:free", "messages": [{"role": "user", "content": (big + "\n") * 160 + "\nResume."}], "max_tokens": 50}),
}
for name in sys.argv[2:]:
    c = cases[name]
    r = orlib.chat(name, c["body"], key=c.get("key"))
    if name == "t8_400_context":
        p = orlib.OUT / f"{name}.json"; s = json.loads(p.read_text())
        s["request"]["body"]["messages"][0]["content"] = f"<{len(c['body']['messages'][0]['content'])} chars of passages>"
        p.write_text(json.dumps(s, indent=1, ensure_ascii=False))
    hdr = {k: v for k, v in r["headers"].items() if k.lower() in ("x-openrouter-error-origin", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "content-type", "x-generation-id")}
    print(name, r["status"], r["latency_s"], json.dumps(r["json"], ensure_ascii=False)[:900] if r["json"] else r["text"][:400], "\n   headers:", hdr)
    time.sleep(2)
