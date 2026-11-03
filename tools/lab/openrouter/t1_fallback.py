import sys, json; sys.path.insert(0, sys.argv[1]); import orlib
FALLBACK = ["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free", "nvidia/nemotron-3.5-super-vl:free"]
body = {
  "model": FALLBACK[0], "models": FALLBACK,
  "messages": [
    {"role": "system", "content": "You are Tramado, a study assistant. Answer in European Portuguese, briefly."},
    {"role": "user", "content": "Em uma frase: o que é o princípio da separação de poderes?"}],
  "max_tokens": 1024, "temperature": 0.3}
r = orlib.chat(sys.argv[2], body)
print(json.dumps(orlib.brief(r), indent=1, ensure_ascii=False))
