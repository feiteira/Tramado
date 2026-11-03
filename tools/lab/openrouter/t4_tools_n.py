import sys, json, time, re, unicodedata; sys.path.insert(0, sys.argv[1]); import orlib
from corpus import PASSAGES
MODEL = sys.argv[2]; TAG = sys.argv[3]
MAX_STEPS = int(sys.argv[4]) if len(sys.argv) > 4 else 6

def norm(s):
    s = unicodedata.normalize("NFKD", s.lower())
    return [w for w in re.findall(r"[a-z0-9]+", "".join(c for c in s if not unicodedata.combining(c))) if len(w) > 2]

refs = {}  # passage id -> S#
def ref(pid):
    if pid not in refs: refs[pid] = f"S{len(refs)+1}"
    return refs[pid]

def search_materials(query, limit=4):
    q = set(norm(query))
    scored = []
    for p in PASSAGES:
        toks = norm(p["text"] + " " + p["loc"])
        score = sum(toks.count(w) for w in q)
        if score: scored.append((score, p))
    scored.sort(key=lambda x: -x[0])
    return {"results": [{"ref": ref(p["id"]), "id": p["id"], "source": p["source"], "location": p["loc"],
                          "snippet": p["text"][:180] + "…"} for _, p in scored[:max(1, min(int(limit), 6))]]}

def read_passage(id):
    for p in PASSAGES:
        if p["id"] == id or ref(p["id"]) == id:
            return {"ref": ref(p["id"]), "id": p["id"], "source": p["source"], "location": p["loc"], "text": p["text"]}
    return {"error": f"no passage with id {id!r}"}

TOOLS = [
 {"type": "function", "function": {"name": "search_materials",
   "description": "Search this class's documents and lecture transcripts. Returns passages with a ref (S1, S2…) to cite, an id, source and location (page/article or timestamp).",
   "parameters": {"type": "object", "properties": {
      "query": {"type": "string", "description": "Keywords or a question, in the language of the materials."},
      "limit": {"type": "integer", "description": "Max results (1-6). Default 4."}},
     "required": ["query"]}}},
 {"type": "function", "function": {"name": "read_passage",
   "description": "Read the full text of one passage returned by search_materials, by its id or ref.",
   "parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}}},
]
SYSTEM = ("És o Tramado, um assistente de estudo. Responde a perguntas de exame usando APENAS os materiais da turma, "
          "que consultas com as ferramentas search_materials e read_passage. Cita cada afirmação com a ref da passagem entre parênteses retos, ex.: [S1]. "
          "Se os materiais não chegarem, diz o que falta. Responde em português europeu, de forma estruturada e concisa (máx. 200 palavras).")
QUESTION = ("Pergunta 2 (4 valores): Um município aprova um regulamento que proíbe a distribuição de panfletos de um partido da oposição, "
            "mantendo permitidos os dos restantes partidos. Analise a constitucionalidade da medida.")
msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": QUESTION}]
log = []
for step in range(MAX_STEPS):
    body = {"model": MODEL, "messages": msgs, "tools": TOOLS, "tool_choice": "auto", "max_tokens": 4000, "temperature": 0.2,
            "reasoning": {"effort": "low"}}
    r = orlib.chat(f"{TAG}_step{step}", body)
    b = orlib.brief(r)
    log.append({k: b.get(k) for k in ("status","latency_s","model","finish_reason","tool_calls","error")})
    print(f"step {step}: status {b['status']} {b['latency_s']}s finish={b.get('finish_reason')} tools={[ (t['function']['name'], t['function']['arguments']) for t in (b.get('tool_calls') or [])]}")
    if r["status"] != 200 or "choices" not in (r["json"] or {}):
        print("ERROR", json.dumps(b.get("error"), ensure_ascii=False)[:600]); break
    msg = r["json"]["choices"][0]["message"]
    # pass the assistant turn back unchanged (incl. reasoning_details), minus nulls
    msgs.append({k: v for k, v in msg.items() if v is not None and k != "refusal"})
    if not msg.get("tool_calls"):
        print("FINAL ANSWER:\n" + (msg.get("content") or "<empty>"))
        print("usage", json.dumps(b.get("usage", {}).get("completion_tokens_details")), "prompt_tokens", b.get("usage", {}).get("prompt_tokens"))
        break
    for tc in msg["tool_calls"]:
        try:
            args = json.loads(tc["function"]["arguments"] or "{}")
            fn = {"search_materials": search_materials, "read_passage": read_passage}[tc["function"]["name"]]
            out = fn(**args)
        except Exception as e:
            out = {"error": f"{type(e).__name__}: {e}"}
        msgs.append({"role": "tool", "tool_call_id": tc["id"], "content": json.dumps(out, ensure_ascii=False)})
    time.sleep(2)
else:
    print("hit MAX_STEPS")
print("refs", refs)
(orlib.OUT / f"{TAG}_transcript.json").write_text(json.dumps({"messages": msgs, "log": log}, indent=1, ensure_ascii=False))
