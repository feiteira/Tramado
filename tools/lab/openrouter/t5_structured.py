import sys, json, time, re; sys.path.insert(0, sys.argv[1]); import orlib
EXAM = """Faculdade de Direito — Direito Constitucional I — Frequência (20/11/2026). Duração: 90 minutos.
GRUPO I (8 valores)
1. Distinga direitos, liberdades e garantias de direitos económicos, sociais e culturais. (3 valores)
2. Responda às seguintes alíneas: (5 valores)
   a) O que se entende por "conteúdo essencial" de um direito? (2 valores)
   b) Indique os três subprincípios da proporcionalidade. (3 valores)
GRUPO II (12 valores)
3. Um município aprova um regulamento que proíbe a distribuição de panfletos de um partido da oposição, mantendo permitidos os dos restantes partidos. Analise a constitucionalidade da medida. (8 valores)
4. Verdadeiro ou falso: "Os direitos, liberdades e garantias vinculam apenas entidades públicas." Justifique. (2 valores)
5. Escolha a opção correta. A lei restritiva de direitos deve ter caráter: (A) individual e concreto; (B) geral e abstrato; (C) retroativo. (2 valores)"""
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["title", "questions"], "properties": {
  "title": {"type": ["string", "null"], "description": "Exam title/course, if stated"},
  "questions": {"type": "array", "description": "Every question AND sub-question, flattened, in document order", "items": {
    "type": "object", "additionalProperties": False,
    "required": ["number", "parent", "group", "text", "points", "kind", "options"],
    "properties": {
      "number": {"type": "string", "description": "Label as printed: '1', '2', '2a', '2b'"},
      "parent": {"type": ["string", "null"], "description": "number of the parent question for sub-questions, else null"},
      "group": {"type": ["string", "null"], "description": "Section/group heading, e.g. 'GRUPO I'"},
      "text": {"type": "string", "description": "Question text verbatim, without the points"},
      "points": {"type": ["number", "null"], "description": "Points (valores) for this item, null if not stated"},
      "kind": {"type": "string", "enum": ["open", "multiple_choice", "true_false", "short", "container"]},
      "options": {"type": "array", "items": {"type": "string"}, "description": "Choices for multiple_choice, else []"}}}}}}
SYS = "You extract exam questions into JSON. Copy text verbatim. Do not answer the questions."
def rf(strict=True):
    return {"type": "json_schema", "json_schema": {"name": "exam_questions", "strict": strict, "schema": SCHEMA}}
PROMPT_ONLY = ("Return ONLY a JSON object (no markdown, no prose) matching this JSON Schema:\n" + json.dumps(SCHEMA, ensure_ascii=False) +
               "\n\nExam:\n" + EXAM)

def tolerant_parse(s):
    if not s: return None
    s = s.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", s, re.S)
    if m: s = m.group(1)
    i, j = s.find("{"), s.rfind("}")
    if i < 0 or j < 0: return None
    try: return json.loads(s[i:j+1])
    except json.JSONDecodeError: return None

cases = {
 "t5_super_strict": {"model": "nvidia/nemotron-3.5-super-vl:free", "messages": [{"role":"system","content":SYS},{"role":"user","content":EXAM}], "response_format": rf()},
 "t5_ultra_unsupported": {"model": "nvidia/nemotron-3-ultra-550b-a55b:free", "messages": [{"role":"system","content":SYS},{"role":"user","content":EXAM}], "response_format": rf()},
 "t5_ultra_require_params": {"model": "nvidia/nemotron-3-ultra-550b-a55b:free", "messages": [{"role":"system","content":SYS},{"role":"user","content":EXAM}], "response_format": rf(), "provider": {"require_parameters": True}},
 "t5_ultra_prompt_only": {"model": "nvidia/nemotron-3-ultra-550b-a55b:free", "messages": [{"role":"system","content":SYS},{"role":"user","content":PROMPT_ONLY}]},
 "t5_xing_strict": {"model": "xingchen-agi/xing4.0-29b-a4b:free", "messages": [{"role":"system","content":SYS},{"role":"user","content":EXAM}], "response_format": rf()},
 "t5_gemma26_strict": {"model": "google/gemma-4-26b-a4b-it:free", "messages": [{"role":"system","content":SYS},{"role":"user","content":EXAM}], "response_format": rf()},
}
for name in sys.argv[2:]:
    if name.startswith("re:"):
        name = name[3:]; import types
        saved = json.loads((orlib.OUT / f"{name}.json").read_text())["response"]; r = saved; b = orlib.brief(saved)
    else:
      body = {**cases[name], "max_tokens": 6000, "temperature": 0, "reasoning": {"effort": "low"}}
      r = orlib.chat(name, body)
      b = orlib.brief(r)
    c = (((r["json"] or {}).get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    strict_ok = None
    try: parsed = json.loads(c); strict_ok = True
    except Exception: parsed = tolerant_parse(c); strict_ok = False
    summary = None
    if parsed:
        summary = [(q.get("number"), q.get("parent"), q.get("points"), q.get("kind"), len(q.get("options") or [])) for q in parsed.get("questions", [])]
    print(name, json.dumps({k: b.get(k) for k in ("status","latency_s","model","finish_reason")}), "raw_json_ok:", strict_ok, "tolerant:", parsed is not None)
    if b.get("error"): print("  error:", json.dumps(b["error"], ensure_ascii=False)[:700])
    print("  content head:", c[:160].replace("\n"," "))
    print("  questions:", summary)
    if parsed: print("  title:", parsed.get("title"), "| q2a text:", next((q["text"] for q in parsed.get("questions", []) if q.get("number") in ("2a","2.a","2 a)","a)")), None))
    time.sleep(3)
