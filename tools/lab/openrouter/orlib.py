"""Tiny stdlib-only OpenRouter lab client. Never prints the key.

Every request is counted in out/count.log and saved (request + response, key redacted) to
out/<name>.json so the report can quote exact JSON.
"""
import json, os, sys, time, urllib.request, urllib.error, pathlib

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
BASE = "https://openrouter.ai/api/v1"
KEY = pathlib.Path(os.path.expanduser("~/.openrouter.key")).read_text().strip()
ATTR = {"HTTP-Referer": "https://github.com/tramado-app/tramado", "X-Title": "Tramado (lab)"}


def _count(name):
    with open(OUT / "count.log", "a") as f:
        f.write(f"{time.strftime('%H:%M:%S')} {name}\n")
    n = sum(1 for _ in open(OUT / "count.log"))
    print(f"[request #{n}] {name}", file=sys.stderr)
    if n > 58:
        raise SystemExit("request budget exhausted")


def _headers(key, extra):
    h = {"Authorization": f"Bearer {key}", "Content-Type": "application/json", **ATTR}
    if extra:
        h.update(extra)
    return h


def _redact(h):
    return {k: ("Bearer sk-or-***" if k == "Authorization" else v) for k, v in h.items()}


def call(name, method, path, body=None, key=None, extra_headers=None, timeout=180, save=True):
    """Non-streaming request. Returns dict(status, headers, json|text, latency_s)."""
    _count(name)
    key = KEY if key is None else key
    h = _headers(key, extra_headers)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            status, rh, raw = r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        status, rh, raw = e.code, dict(e.headers), e.read()
    dt = time.time() - t0
    text = raw.decode("utf-8", "replace")
    try:
        js = json.loads(text) if text.strip() else None
    except json.JSONDecodeError:
        js = None
    res = {"status": status, "latency_s": round(dt, 2), "headers": rh, "json": js,
           "text": None if js is not None else text[:4000]}
    if save:
        (OUT / f"{name}.json").write_text(json.dumps(
            {"request": {"method": method, "path": path, "headers": _redact(h), "body": body},
             "response": res}, indent=1, ensure_ascii=False))
    return res


def stream(name, body, key=None, timeout=300):
    """SSE request; records every raw line with its arrival time (s since send)."""
    _count(name)
    key = KEY if key is None else key
    h = _headers(key, None)
    req = urllib.request.Request(BASE + "/chat/completions", data=json.dumps(body).encode(),
                                 method="POST", headers=h)
    t0 = time.time()
    lines = []
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            status, rh = r.status, dict(r.headers)
            for raw in r:
                lines.append([round(time.time() - t0, 3), raw.decode("utf-8", "replace").rstrip("\r\n")])
    except urllib.error.HTTPError as e:
        status, rh = e.code, dict(e.headers)
        lines.append([round(time.time() - t0, 3), e.read().decode("utf-8", "replace")])
    res = {"status": status, "headers": rh, "lines": lines, "latency_s": round(time.time() - t0, 2)}
    (OUT / f"{name}.json").write_text(json.dumps(
        {"request": {"path": "/chat/completions", "headers": _redact(h), "body": body},
         "response": res}, indent=1, ensure_ascii=False))
    return res


def chat(name, body, **kw):
    return call(name, "POST", "/chat/completions", body, **kw)


def brief(res):
    """One-screen summary of a chat completion result."""
    js = res.get("json") or {}
    out = {"status": res["status"], "latency_s": res["latency_s"]}
    if "error" in js:
        out["error"] = js["error"]
    if "choices" in js:
        c = js["choices"][0]
        m = c.get("message", {})
        out.update({"model": js.get("model"), "provider": js.get("provider"),
                    "finish_reason": c.get("finish_reason"),
                    "native_finish_reason": c.get("native_finish_reason"),
                    "content": (m.get("content") or "")[:1500],
                    "reasoning_len": len(m.get("reasoning") or ""),
                    "tool_calls": m.get("tool_calls"), "usage": js.get("usage")})
    rl = {k: v for k, v in res["headers"].items() if k.lower().startswith(("x-ratelimit", "retry-after"))}
    if rl:
        out["ratelimit_headers"] = rl
    return out
