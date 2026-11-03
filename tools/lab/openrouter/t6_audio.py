import sys, json, time, base64; sys.path.insert(0, sys.argv[1]); import orlib
A = orlib.HERE / "audio"
def b64(p): return base64.b64encode((A / p).read_bytes()).decode()
TRANSCRIBE = ("Transcribe this audio verbatim in its original language (European Portuguese if Portuguese). "
              "Output only the transcript text, no commentary.")
TIMED = ("Transcribe this audio verbatim. Split it into sentence-level segments and prefix each with its start and end time "
         "as [mm:ss.s-mm:ss.s]. Output only the segments, one per line.")
cases = {
 "t6_omni_pt_wav": ("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "speech_pt.wav", "wav", TRANSCRIBE),
 "t6_omni_en_mp3_timed": ("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "speech_en.mp3", "mp3", TIMED),
 "t6_inkling_small_pt_mp3": ("thinkingmachines/inkling-small:free", "speech_pt.mp3", "mp3", TRANSCRIBE),
 "t6_omni_pt_wav_noreason": ("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "speech_pt.wav", "wav", TRANSCRIBE),
 "t6_omni_en_mp3_timed_noreason": ("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "speech_en.mp3", "mp3", TIMED),
 "t6_omni_long_mp3_noreason": ("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "long.mp3", "mp3", TRANSCRIBE),
 "t6_omni_pt_mp3_timed": ("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "speech_pt.mp3", "mp3", TIMED),
}
for name in sys.argv[2:]:
    model, f, fmt, prompt = cases[name]
    data = b64(f)
    body = {"model": model, "max_tokens": 3000, "temperature": 0, "reasoning": ({"enabled": False} if name.endswith("_noreason") else {"exclude": True}),
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "input_audio", "input_audio": {"data": data, "format": fmt}}]}]}
    r = orlib.chat(name, body)
    # keep saved file small: replace base64 in saved request
    p = orlib.OUT / f"{name}.json"; s = json.loads(p.read_text())
    s["request"]["body"]["messages"][0]["content"][1]["input_audio"]["data"] = f"<base64 of {f}, {len(data)} chars>"
    p.write_text(json.dumps(s, indent=1, ensure_ascii=False))
    b = orlib.brief(r)
    print(name, json.dumps({k: b.get(k) for k in ("status","latency_s","model","provider","finish_reason","error")}, ensure_ascii=False))
    print("   ", (b.get("content") or "").replace("\n", "\n    "))
    u = b.get("usage") or {}
    print("    usage:", json.dumps({"prompt": u.get("prompt_tokens"), "audio_tokens": (u.get("prompt_tokens_details") or {}).get("audio_tokens"), "completion": u.get("completion_tokens"), "reasoning": (u.get("completion_tokens_details") or {}).get("reasoning_tokens")}))
    time.sleep(3)
