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
