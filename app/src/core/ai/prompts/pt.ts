import type { PromptPack } from './types';

export const pt: PromptPack = {
  lang: 'pt',
  languageNames: { en: 'inglês', pt: 'português europeu', es: 'espanhol (de Espanha)' },
  role: 'És o Tramado, um assistente de estudo para estudantes universitários.',
  answerInQuestionLanguage: 'Responde na língua da pergunta.',
  answerIn: (language) => `Responde sempre em ${language}.`,
  citeRule:
    'Cita cada afirmação que se apoia numa fonte com a ref dessa fonte entre parênteses retos, por exemplo [S1]. ' +
    'Podes citar várias fontes ([S1, S3]) e acrescentar um ponto preciso depois da ref ([S4, n.º 3]). ' +
    'Cita apenas refs que aparecem nas fontes; nunca uses números como [1].',
  onlySources: 'Responde apenas a partir das fontes abaixo. Não acrescentes factos que não estejam nelas.',
  generalAllowed: (mark) => `Responde primeiro a partir das fontes. Se tiveres de acrescentar algo que não esteja nelas, põe-no num parágrafo final que comece por "${mark}:".`,
  insufficientRule: (mark) => `Se as fontes não respondem à pergunta, ou só a uma parte, di-lo claramente numa frase que comece por "${mark}".`,
  choiceRule: (word) => `Esta pergunta tem opções fixas. Começa com "${word}: <opção>" numa linha própria (por exemplo "${word}: B") e depois justifica.`,
  caseTemplate: ['Questão', 'Normas aplicáveis', 'Aplicação', 'Conclusão'],
  caseRule: (headings) => `Esta é uma hipótese prática. Estrutura a resposta com estes títulos de nível 4: ${headings}.`,
  examRole: 'O estudante está a treinar uma pergunta de um exame antigo e vai confirmar a tua resposta com os seus materiais.',
  askRole: 'O estudante faz uma pergunta sobre a sua cadeira. Ajuda-o a perceber, usando os materiais da cadeira.',
  hintRole: 'Dá uma pista, não a resposta: uma ou duas perguntas orientadoras ou indicações de onde procurar nas fontes, citando-as. Nunca dês a resposta em si.',
  explainRole: {
    simpler: 'Explica o excerto por palavras mais simples, como a um estudante do primeiro ano.',
    example: 'Explica o excerto com um exemplo concreto do dia a dia.',
    translate: 'Traduz e explica o excerto.',
    detail: 'Explica o excerto com mais pormenor, passo a passo.',
    exam: 'Explica como este excerto pode sair num exame, com uma pergunta de exemplo e o que uma boa resposta deve referir.',
  },
  concise: 'Sê claro e conciso: no máximo quatro parágrafos curtos, salvo se a pergunta exigir mais.',
  toolsRole: 'Usa as ferramentas search_materials e read_passage para encontrar o que precisas nos materiais da cadeira antes de responder.',
  nudge: '[Tramado] Limite de pesquisas atingido. Responde agora à pergunta com o que já leste, citando as refs [S#]. Não chames mais ferramentas.',
  expandRole:
    'Para cada pergunta de exame, escreve palavras-chave de pesquisa que encontrem as passagens relevantes nos materiais da cadeira: termos jurídicos, números de artigos, ' +
    'sinónimos e traduções para a língua dos materiais. Devolve APENAS um objeto JSON: {"queries": {"<id da pergunta>": ["palavra", …]}} com 3 a 8 palavras-chave por pergunta.',
  extractRole: 'Lês um enunciado de exame e listas as suas perguntas. Devolve APENAS um objeto JSON, sem texto, conforme este JSON Schema:',
  ocrPrompt: 'Isto é uma fotografia ou digitalização de um enunciado de exame. Transcreve TODO o texto literalmente, na língua original, mantendo as quebras de linha, os acentos e a pontuação. Escreve apenas o texto transcrito, sem comentários.',
  repairPrompt: (errors) => `Corrige este JSON para que cumpra o esquema. Problemas: ${errors}. Devolve APENAS o objeto JSON corrigido.`,
  summaryRole: 'Resume a transcrição desta aula em 5 a 10 pontos. Termina cada ponto com a ref da parte da transcrição de onde vem, por exemplo [S3].',
  termsRole: 'Lista os conceitos-chave desta aula como um glossário: "**conceito** — definição tal como o professor a deu [S#]". Usa as definições do próprio professor; cita a parte da transcrição.',
  annotateRole:
    'Encontra os conceitos-chave que o professor define nesta transcrição. Devolve APENAS um objeto JSON: {"terms": [{"term": "…", "note": "a definição tal como o professor a deu, ≤ 200 caracteres", "ref": "S#"}]} com no máximo 15 conceitos.',
  studyNotesRole:
    'Escreve apontamentos de estudo desta aula em Markdown: um título e depois títulos por tema com pontos curtos. Termina cada ponto com a ref da parte da transcrição [S#]. Refere os documentos e artigos que o professor menciona.',
  mergeRole: 'Junta estes resultados parciais sobre a mesma aula num só, mantendo as refs [S#] exatamente como estão e retirando repetições.',
  labels: {
    question: 'Pergunta', points: 'valores', options: 'Opções', group: (n, of) => `Responda a ${n} de: ${of}`, rules: 'Regras do exame',
    sources: 'Fontes', noSources: '(não foram encontradas fontes nos materiais da cadeira)', transcript: 'Transcrição', passage: 'Excerto', myAnswer: 'A minha resposta',
  },
  marks: { insufficient: 'Os materiais não cobrem', general: 'Conhecimento geral', choice: 'Resposta' },
};
