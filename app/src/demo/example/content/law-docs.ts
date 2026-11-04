// The other documents of the class `law` (UX §7.3): the slides of lecture 6, Carla's summary, the scanned
// (image-only) judgment, the assessment calendar, my private diagrams, and the mock exam paper. All fictional.
// Single source of the assets (tools/fixtures/build-demo-assets.mjs) and of the citations of them.
// Self-contained on purpose: Node runs this file directly (type stripping) when it builds the assets.

export interface Slide { title: string; bullets: string[] }
export interface DocxSection { heading: string; paragraphs: string[] }
export interface PdfPageText { lines: Array<{ text: string; style?: 'title' | 'heading' | 'body' | 'small' }> }

/** `slides6` → Slides/Aula 6 — Restrições (slides).pptx: 8 slides (titles exactly as UX §7.3). */
export const SLIDES6: { title: string; slides: Slide[] } = {
  title: 'Aula 6 — Restrições aos direitos fundamentais',
  slides: [
    { title: 'Restrições aos direitos fundamentais', bullets: ['Direito Constitucional I · Aula 6', 'Prof.ª Marta Reis · 20 de outubro de 2026'] },
    { title: 'Previsão expressa', bullets: ['A restrição tem de estar prevista na própria Lei Fundamental', 'Não basta uma lei ordinária que a autorize', 'Ver art. 18.º, n.º 2'] },
    { title: 'Generalidade e abstração', bullets: ['A lei restritiva aplica-se a um número indeterminado de pessoas', 'Proibidas as leis feitas à medida de um caso concreto'] },
    { title: 'Não retroatividade', bullets: ['A restrição só vale para o futuro', 'Factos anteriores à lei não podem ser atingidos'] },
    { title: 'Proporcionalidade (ver aula 7)', bullets: ['Adequação, necessidade e proporcionalidade em sentido estrito', 'Desenvolvido na próxima aula'] },
    { title: 'Conteúdo essencial — o limite dos limites', bullets: ['Há um núcleo do direito que nenhuma restrição pode tocar', 'Mesmo uma restrição proporcional para aqui', 'Art. 18.º, n.º 3'] },
    { title: 'Exemplo: proibição geral de manifestações', bullets: ['Uma lei que proíbe todas as reuniões num distrito durante um ano', 'Falta de generalidade? Necessidade? Núcleo do direito de reunião?'] },
    { title: 'Leituras: arts. 18.º e 19.º', bullets: ['Lei Fundamental de Exemplo, arts. 18.º e 19.º', 'Resumo partilhado da turma, ponto 3'] },
  ],
};

/** `resumo` → Leituras/Resumo — Direitos, liberdades e garantias.docx (Carla, about 600 words). */
export const RESUMO: { title: string; sections: DocxSection[] } = {
  title: 'Resumo — Direitos, liberdades e garantias',
  sections: [
    { heading: '1. Conceito', paragraphs: [
      'Os direitos, liberdades e garantias são o núcleo dos direitos fundamentais na Lei Fundamental de Exemplo. Protegem a pessoa contra o Estado e, em muitos casos, também contra outros particulares. Distinguem-se dos direitos económicos, sociais e culturais porque não dependem, em regra, de prestações do Estado: basta que o Estado e os outros não interfiram.',
      'Exemplos dados nas aulas: o direito à vida, a integridade pessoal, a liberdade de reunião, a liberdade de expressão e a inviolabilidade do domicílio. A professora insistiu que a lista do capítulo II não é fechada, porque o artigo 16.º admite outros direitos com a mesma natureza.',
      'Uma ideia útil para o exame é perguntar sempre quem é o titular do direito, quem fica obrigado e o que exatamente se protege. Esta grelha simples ajuda a arrumar qualquer hipótese prática.',
    ] },
    { heading: '2. Regime', paragraphs: [
      'O regime destes direitos tem três traços principais. Primeiro, as normas aplicam-se diretamente, sem precisar de uma lei que as concretize. Segundo, vinculam tanto as entidades públicas como as privadas. Terceiro, só podem ser limitados dentro de apertadas condições.',
      'A aplicabilidade direta significa que um tribunal pode decidir um caso com base apenas na Lei Fundamental. A vinculação das entidades privadas é mais discutida: nas aulas vimos que depende do tipo de relação e da posição de poder de cada parte.',
      'O regime também se estende aos direitos de natureza análoga, mesmo que estejam fora do capítulo II. É por isso que convém identificar a natureza do direito antes de aplicar as regras sobre restrições.',
      'Por fim, há garantias processuais: o acesso aos tribunais, a responsabilidade do Estado pelos danos causados e a possibilidade de queixa ao Provedor das pessoas. Sem estas garantias, os direitos ficariam apenas no papel.',
      'Convém ainda lembrar a distinção entre o direito e o seu exercício. Uma lei pode regular o modo de exercer um direito, por exemplo exigindo aviso prévio para uma reunião, sem o restringir. A fronteira nem sempre é clara: a professora sugeriu perguntar se a regra apenas organiza o exercício ou se, na prática, impede algumas pessoas de o exercer. Na segunda hipótese estamos perante uma verdadeira restrição, sujeita a todos os requisitos do ponto seguinte.',
    ] },
    { heading: '3. Restrições', paragraphs: [
      'As restrições são o tema mais provável na frequência. Segundo a aula 6, uma lei restritiva tem de cumprir vários requisitos cumulativos. Tem de estar expressamente autorizada pela Lei Fundamental; tem de ser geral e abstrata; não pode ser retroativa; tem de respeitar a proporcionalidade; e nunca pode tocar no núcleo do direito.',
      'A proporcionalidade, desenvolvida na aula 7, decompõe-se em três testes. A adequação pergunta se a medida serve o fim; a necessidade, se havia um meio menos restritivo; a proporcionalidade em sentido estrito, se o sacrifício compensa o benefício.',
      'O núcleo do direito é o limite último. Mesmo uma restrição adequada, necessária e equilibrada é inválida se deixar o direito sem qualquer espaço útil de exercício. Na doutrina chama-se a isto o limite dos limites.',
      'Diferente das restrições é a suspensão de direitos em estado de exceção. Aí o artigo 19.º permite suspender o exercício de alguns direitos, mas nunca de todos: a vida, a integridade pessoal e a liberdade de consciência ficam sempre de fora.',
      'Exemplo de treino: uma lei que proíba durante um ano todas as manifestações numa cidade levanta problemas de generalidade, de necessidade e, muito provavelmente, de violação do núcleo do direito de reunião.',
    ] },
  ],
};

/**
 * `acordao` → Leituras/Acórdão fictício n.º 12-2026.pdf: two scanned pages with **no text layer** (UX §7.3: the
 * document shows "Scan — no text" and the AI reading offer). These lines are what the page images show.
 */
export const ACORDAO: PdfPageText[] = [
  { lines: [
    { text: 'TRIBUNAL CONSTITUCIONAL DE EXEMPLO', style: 'title' },
    { text: 'Acórdão fictício n.º 12/2026 — Processo n.º 48/2026', style: 'heading' },
    { text: 'Relatora: Conselheira Joana Vilar (nome fictício)', style: 'small' },
    { text: 'I. Relatório', style: 'heading' },
    { text: 'O Provedor das pessoas pediu a apreciação da Lei n.º 3/2026, que proíbe a', style: 'body' },
    { text: 'realização de reuniões em todas as praças do centro histórico de Vila Nova', style: 'body' },
    { text: 'durante as festas da cidade, invocando a segurança dos visitantes.', style: 'body' },
    { text: 'II. Fundamentação', style: 'heading' },
    { text: 'A liberdade de reunião só pode ser restringida nos termos do artigo 18.º da', style: 'body' },
    { text: 'Lei Fundamental. A restrição tem de ser necessária e não pode esvaziar o', style: 'body' },
    { text: 'direito: deve restar sempre um espaço útil para o seu exercício.', style: 'body' },
  ] },
  { lines: [
    { text: 'Uma proibição que abrange todas as praças, durante todo o período das festas,', style: 'body' },
    { text: 'sem distinguir reuniões pacíficas de outras, excede o que a segurança exige.', style: 'body' },
    { text: 'Havia meios menos restritivos, como o aviso prévio ou a fixação de percursos.', style: 'body' },
    { text: 'III. Decisão', style: 'heading' },
    { text: 'Pelo exposto, o Tribunal declara a inconstitucionalidade, com força', style: 'body' },
    { text: 'obrigatória geral, da norma do artigo 1.º da Lei n.º 3/2026.', style: 'body' },
    { text: 'Lisboa de Exemplo, 14 de maio de 2026.', style: 'small' },
    { text: 'Documento fictício para a demonstração do Tramado.', style: 'small' },
  ] },
];

/** `calendario` → Da conversa/Calendário de avaliações.pdf (attached in chat by Carla on 2 Nov). */
export const CALENDARIO: PdfPageText = { lines: [
  { text: 'Calendário de avaliações', style: 'title' },
  { text: 'Direito Constitucional I · 2026/27 · 1.º semestre', style: 'heading' },
  { text: 'Frequência — quinta-feira, 12 de novembro de 2026, 10:00 — Anfiteatro 1.02', style: 'body' },
  { text: 'Matéria: aulas 1 a 8; Lei Fundamental de Exemplo, arts. 1.º a 24.º. Peso: 40 %.', style: 'body' },
  { text: 'Exame — época normal — quinta-feira, 14 de janeiro de 2027, 09:30', style: 'body' },
  { text: 'Exame — época de recurso — quinta-feira, 4 de fevereiro de 2027, 09:30', style: 'body' },
  { text: 'Consulta permitida: legislação não anotada.', style: 'small' },
  { text: 'Documento fictício.', style: 'small' },
] };

/** `esquemas` → Os meus esquemas.pdf: 3 pages of my own diagrams, only on this computer. */
export const ESQUEMAS: PdfPageText[] = [
  { lines: [
    { text: 'Os meus esquemas — 1. Restrições', style: 'title' },
    { text: 'Requisitos (todos!):', style: 'heading' },
    { text: '• previsão expressa na Lei Fundamental', style: 'body' },
    { text: '• lei geral e abstrata', style: 'body' },
    { text: '• sem efeito retroativo', style: 'body' },
    { text: '• proporcionalidade (aula 7)', style: 'body' },
    { text: '• respeitar o núcleo do direito (limite dos limites)', style: 'body' },
  ] },
  { lines: [
    { text: 'Os meus esquemas — 2. Estado de exceção', style: 'title' },
    { text: 'Suspende o exercício, não acaba com o direito.', style: 'body' },
    { text: 'Nunca suspensos: vida · integridade · identidade · lei penal não retroativa · consciência.', style: 'body' },
    { text: 'Comparar com as restrições do art. 18.º (perguntar na aula).', style: 'body' },
  ] },
  { lines: [
    { text: 'Os meus esquemas — 3. Proporcionalidade', style: 'title' },
    { text: 'Adequação: serve o fim?', style: 'body' },
    { text: 'Necessidade: havia meio menos restritivo?', style: 'body' },
    { text: 'Sentido estrito: o sacrifício compensa?', style: 'body' },
  ] },
];

/** The mock paper `mock` → Exames/Frequência 2025-26 (simulada)/enunciado.pdf (2 text pages). */
export const MOCK_PAPER = {
  header: 'Faculdade de Direito de Exemplo · Direito Constitucional I',
  title: 'Frequência 2025/26 (simulada)',
  rules: ['Permitida a consulta de legislação não anotada', 'Duração: 2 h'],
  groupI: 'A Assembleia da República de Exemplo aprovou a Lei n.º 7/2026, que proíbe, durante um ano, todas as reuniões e manifestações na cidade de Vila Nova, para «garantir a tranquilidade dos moradores». A lei aplica-se também às manifestações anunciadas antes da sua entrada em vigor. Pronuncie-se sobre a conformidade desta lei com a Lei Fundamental de Exemplo.',
  groupII: 'Responda a duas de três',
  IIa: 'Distinga direitos, liberdades e garantias de direitos económicos, sociais e culturais.',
  IIb: 'Em que condições pode a lei restringir direitos, liberdades e garantias?',
  IIc: 'O que se entende por «conteúdo essencial» de um direito?',
  groupIII: 'Comente: «O estado de exceção não suspende o direito à vida.»',
  extra: 'Redação e organização',
};

/** The two pages of the mock paper, as printed (the question texts are exact copies of MOCK_PAPER). */
export function mockPaperPages(): PdfPageText[] {
  const m = MOCK_PAPER;
  return [
    { lines: [
      { text: m.header, style: 'small' },
      { text: m.title, style: 'title' },
      { text: `${m.rules[0]}. ${m.rules[1]}.`, style: 'small' },
      { text: 'Grupo I (6 valores)', style: 'heading' },
      { text: m.groupI, style: 'body' },
      { text: `Grupo II (6 valores) — ${m.groupII}`, style: 'heading' },
      { text: `a) ${m.IIa} (3 valores)`, style: 'body' },
      { text: `b) ${m.IIb} (3 valores)`, style: 'body' },
    ] },
    { lines: [
      { text: `c) ${m.IIc} (3 valores)`, style: 'body' },
      { text: 'Grupo III (6 valores)', style: 'heading' },
      { text: m.groupIII, style: 'body' },
      { text: `${m.extra}: 2 valores.`, style: 'small' },
      { text: 'Enunciado fictício para a demonstração do Tramado.', style: 'small' },
    ] },
  ];
}
