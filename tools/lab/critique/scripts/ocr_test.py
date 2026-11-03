"""OCR-by-vision-model test for exam photos. stdlib only, never prints the key.
Usage: python3 -I ocr_test.py <ocr_dir> <case>   (case: super | deny | gemma | super_small | deny_small | super_json)
Writes <ocr_dir>/out/<case>.json (request without image bytes + response) and prints a short summary.
"""
import base64, difflib, json, os, pathlib, re, sys, time, urllib.error, urllib.request, unicodedata

D = pathlib.Path(sys.argv[1]); CASE = sys.argv[2]
OUT = D / "out"; OUT.mkdir(exist_ok=True)
KEY = pathlib.Path(os.path.expanduser("~/.openrouter.key")).read_text().strip()
TRUTH = (D / "exam.txt").read_text()

PROMPT_TXT = ("This is a photo of an exam paper. Transcribe ALL of its text verbatim, in the original language, "
              "keeping line breaks, accents and punctuation exactly. Output only the transcribed text, no commentary.")
PROMPT_JSON = ("This is a photo of an exam paper. Return ONLY a JSON object {\"title\": string|null, \"rules\": [string], "
               "\"questions\": [{\"number\": string, \"parent\": string|null, \"text\": string, \"points\": number|null, "
               "\"kind\": \"open\"|\"case\"|\"comment\"|\"short\"|\"choose_n\"|\"container\"}]}. Use numbers as printed "
               "(\"I\", \"II\", \"II.a\"). Copy question text verbatim. No markdown fences.")

def img(name):
    return "data:image/jpeg;base64," + base64.b64encode((D / name).read_bytes()).decode()

CASES = {
    "super":       dict(model="nvidia/nemotron-3.5-super-vl:free", image="exam_photo.jpg", prompt=PROMPT_TXT, reasoning={"enabled": False}),
    "super_small": dict(model="nvidia/nemotron-3.5-super-vl:free", image="exam_photo_small.jpg", prompt=PROMPT_TXT, reasoning={"enabled": False}),
    "super_json":  dict(model="nvidia/nemotron-3.5-super-vl:free", image="exam_photo.jpg", prompt=PROMPT_JSON, reasoning={"effort": "low", "exclude": True}),
    "deny":        dict(models=["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free", "dots-studio/dots-3-note-preview:free"],
                        image="exam_photo.jpg", prompt=PROMPT_TXT, provider={"data_collection": "deny"}),
    "deny_small":  dict(models=["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free", "dots-studio/dots-3-note-preview:free"],
                        image="exam_photo_small.jpg", prompt=PROMPT_TXT, provider={"data_collection": "deny"}),
    "deny_text":   dict(models=["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free", "dots-studio/dots-3-note-preview:free"],
                        image=None, prompt="Em uma frase: o que é a reserva mental no direito civil português?", provider={"data_collection": "deny"}),
}
c = CASES[CASE]
content = [{"type": "text", "text": c["prompt"]}]
if c.get("image"):
    content.append({"type": "image_url", "image_url": {"url": img(c["image"])}})
body = {"messages": [{"role": "user", "content": content}], "max_tokens": 4000, "temperature": 0}
if "model" in c: body["model"] = c["model"]
if "models" in c: body["models"] = c["models"]
if "reasoning" in c: body["reasoning"] = c["reasoning"]
if "provider" in c: body["provider"] = c["provider"]

req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=json.dumps(body).encode(), method="POST",
    headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json",
             "HTTP-Referer": "https://github.com/tramado-app/tramado", "X-OpenRouter-Title": "Tramado (lab)"})
t0 = time.time()
try:
    with urllib.request.urlopen(req, timeout=180) as r:
        status, data = r.status, json.loads(r.read())
except urllib.error.HTTPError as e:
    status, data = e.code, json.loads(e.read() or b"{}")
dt = time.time() - t0
safe = json.loads(json.dumps(body))
for m in safe["messages"]:
    for p in m["content"]:
        if p.get("type") == "image_url": p["image_url"]["url"] = f"data:image/jpeg;base64,<{c['image']}>"
for k in ("user_id",):
    data.pop(k, None)
(OUT / f"{CASE}.json").write_text(json.dumps({"request": safe, "status": status, "latency_s": round(dt, 2), "response": data}, ensure_ascii=False, indent=1))

def norm(s):
    s = unicodedata.normalize("NFC", s).replace("º", "º").replace("“", "\"").replace("”", "\"")
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", s)).strip()

print(f"case={CASE} status={status} latency={dt:.1f}s")
if status != 200:
    print("error:", json.dumps(data.get("error", data), ensure_ascii=False)[:400]); sys.exit(0)
ch = data["choices"][0]; txt = (ch["message"].get("content") or "")
u = data.get("usage", {})
print(f"model={data.get('model')} provider={data.get('provider')} finish={ch.get('finish_reason')} "
      f"prompt_tokens={u.get('prompt_tokens')} completion={u.get('completion_tokens')} "
      f"reasoning={u.get('completion_tokens_details', {}).get('reasoning_tokens')}")
if CASE.endswith("json") or CASE == "deny_text":
    print(txt[:2500]); sys.exit(0)
a, b = norm(TRUTH), norm(txt.strip().strip("`"))
sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
print(f"char similarity={sm.ratio():.4f}  truth_chars={len(a)} out_chars={len(b)}")
wa, wb = a.split(), b.split()
wm = difflib.SequenceMatcher(None, wa, wb, autojunk=False)
errs = [(op, ' '.join(wa[i1:i2]), ' '.join(wb[j1:j2])) for op, i1, i2, j1, j2 in wm.get_opcodes() if op != 'equal']
wer = sum(max(i2 - i1, j2 - j1) for op, i1, i2, j1, j2 in wm.get_opcodes() if op != 'equal') / max(1, len(wa))
print(f"word error rate≈{wer:.3f}  diffs={errs[:12]}")
