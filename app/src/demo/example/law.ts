// Class `law`: "Direito Constitucional I" (pt-PT, shared; UX §7.3). Fictional: the lecturer, the law, the exams and
// the people are invented. Texts of documents live in content/; this file says who did what, when, and what the AI
// answered with which citations (each quote is resolved by `example.test.ts`).
import { L6_E00_WHISPER, L6_KEY, L7_KEY } from './content/transcripts';
import { MOCK_PAPER } from './content/law-docs';
import type { DemoClass } from './types';

const GEMMA = 'google/gemma-4-31b-it:free';
const DOTS = 'dots-studio/dots-3-note-preview:free';

export const LAW: DemoClass = {
  key: 'law',
  name: 'Direito Constitucional I',
  shortName: 'DC I',
  colour: '#12a594',
  icon: 'scale',
  lecturer: 'Prof.ª Marta Reis',
  term: '2026/27 · 1.º semestre',
  language: 'pt-PT',
  shared: true,
  archived: false,
  createdAt: '2026-09-21T09:12',
  members: [
    { key: 'bruno', device: 0, joinedAt: '2026-09-22T18:03' },
    { key: 'carla', device: 0, joinedAt: '2026-09-22T21:47' },
    { key: 'carla', device: 1, joinedAt: '2026-09-30T20:15' },
  ],
  organisers: ['ana'],
  consents: [
    { by: 'ana', at: '2026-10-20T09:56' },
    { by: 'carla', at: '2026-10-27T09:58' },
  ],
  documents: [
    { key: 'lf', path: 'Legislação/Lei Fundamental de Exemplo (texto fictício).pdf', asset: 'lf.pdf', mime: 'application/pdf', addedBy: 'ana', addedAt: '2026-10-03T18:20', pages: 24 },
    { key: 'slides6', path: 'Slides/Aula 6 — Restrições (slides).pptx', asset: 'slides6.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', addedBy: 'bruno', addedAt: '2026-10-20T13:05', pages: null },
    { key: 'resumo', path: 'Leituras/Resumo — Direitos, liberdades e garantias.docx', asset: 'resumo.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', addedBy: 'carla', addedAt: '2026-10-25T16:40', pages: null },
    { key: 'acordao', path: 'Leituras/Acórdão fictício n.º 12-2026.pdf', asset: 'acordao.pdf', mime: 'application/pdf', addedBy: 'carla', addedAt: '2026-10-22T11:15', pages: 2 },
    { key: 'calendario', path: 'Do chat/Calendário de avaliações.pdf', asset: 'calendario.pdf', mime: 'application/pdf', addedBy: 'carla', addedAt: '2026-11-02T10:06', pages: 1 },
    { key: 'esquemas', path: 'Os meus esquemas.pdf', asset: 'esquemas.pdf', mime: 'application/pdf', addedBy: 'ana', addedAt: '2026-10-29T22:10', pages: 3, localOnly: true },
  ],
  lectures: [
    {
      key: 'l6', title: 'Aula 6 — Restrições aos direitos fundamentais', startedAt: '2026-10-20T10:00', durationMs: 5_520_000, mode: 'room', language: 'pt-PT',
      recordedBy: 'ana', speakers: [{ id: 'lecture', label: 'Professora' }], channels: [{ index: 0, speaker: 'lecture' }],
      transcript: {
        by: 'bruno', device: 0, model: 'turbo', at: '2026-10-20T13:41', revision: 1, keySegments: L6_KEY,
        original: { s_l6e00: L6_E00_WHISPER }, filler: { lang: 'pt', speaker: 'lecture', seed: 6 },
      },
      claim: { by: 'bruno', device: 0, status: 'done', heartbeat: 31 },
      // The pending correction of UX §7.3 ("Corrected by Carla" on s_l6e00), not yet folded by the owner.
      edits: [{ by: 'carla', device: 0, at: '2026-11-02T21:10', segment: 's_l6e00', text: 'É o que diz o artigo 18.º, n.º 3.' }],
      markers: [
        { at: '0:12:05', kind: 'important' },
        { at: '0:33:40', kind: 'note', note: 'comparar com art. 19.º' },
        { at: '0:41:12', kind: 'exam' },
        { at: '0:52:30', kind: 'confused', note: 'rever exemplo' },
        { at: '1:20:10', kind: 'todo' },
      ],
      highlights: [{ segment: 's_l6d00', quote: 'nunca pode atingir o conteúdo essencial do direito', colour: 'exam', at: '2026-10-21T21:30' }],
      summary: {
        at: '2026-10-21T21:25', model: GEMMA,
        answer: [
          '- Tema: as restrições aos direitos, liberdades e garantias [S1].',
          '- 1.º requisito: a restrição tem de estar expressamente prevista na Lei Fundamental [S2].',
          '- 2.º requisito: generalidade, nunca uma lei para um caso concreto [S3].',
          '- Limite absoluto: o conteúdo essencial do direito (art. 18.º, n.º 3) [S4].',
          '- Exemplo: uma lei que proibisse todas as manifestações num distrito [S5].',
          '- Para a próxima aula: ler o art. 19.º, sobre o estado de exceção [S6].',
        ].join('\n'),
        citations: [
          { ref: 'S1', source: { kind: 'lecture', lecture: 'l6', segment: 's_l6a00' }, quote: 'restrições aos direitos, liberdades e garantias' },
          { ref: 'S2', source: { kind: 'lecture', lecture: 'l6', segment: 's_l6b00' }, quote: 'expressamente prevista na Lei Fundamental' },
          { ref: 'S3', source: { kind: 'lecture', lecture: 'l6', segment: 's_l6c00' }, quote: 'não pode dirigir-se a uma pessoa ou a um caso concreto' },
          { ref: 'S4', source: { kind: 'lecture', lecture: 'l6', segment: 's_l6d00' }, quote: 'nunca pode atingir o conteúdo essencial do direito' },
          { ref: 'S5', source: { kind: 'lecture', lecture: 'l6', segment: 's_l6f00' }, quote: 'uma lei que proibisse todas as manifestações' },
          { ref: 'S6', source: { kind: 'lecture', lecture: 'l6', segment: 's_l6h00' }, quote: 'leiam o artigo 19.º sobre o estado de exceção' },
        ],
      },
      cite: { segment: 's_l6d00', quote: 'nunca pode atingir o conteúdo essencial do direito' },
    },
    {
      key: 'l7', title: 'Aula 7 — Princípio da proporcionalidade', startedAt: '2026-10-27T10:00', durationMs: 5_040_000, mode: 'room', language: 'pt-PT',
      recordedBy: 'carla', speakers: [{ id: 'lecture', label: 'Professora' }], channels: [{ index: 0, speaker: 'lecture' }],
      transcript: { by: 'ana', device: 0, model: 'turbo', at: '2026-10-27T12:02', revision: 1, keySegments: L7_KEY, filler: { lang: 'pt', speaker: 'lecture', seed: 7 } },
      claim: { by: 'ana', device: 0, status: 'done', heartbeat: 29 },
      markers: [
        { at: '0:08:30', kind: 'important' },
        { at: '0:12:03', kind: 'exam' },
        { at: '0:30:10', kind: 'important' },
      ],
    },
    {
      key: 'l8', title: 'Aula 8 — Estado de exceção', startedAt: '2026-11-03T10:00', durationMs: 4_680_000, mode: 'room', language: 'pt-PT',
      recordedBy: 'carla', speakers: [{ id: 'lecture', label: 'Professora' }], channels: [{ index: 0, speaker: 'lecture' }],
      transcript: null,
      claim: { by: 'bruno', device: 0, status: 'working', progress: 0.4, etaMs: 25 * 60_000, heartbeat: 37 },
      markers: [],
    },
  ],
  exams: [
    {
      key: 'freq', title: 'Frequência', type: 'midterm', status: 'upcoming', date: '2026-11-12T10:00', durationMin: 120, room: 'Anfiteatro 1.02',
      coversText: 'Aulas 1–8; Lei Fundamental, arts. 1.º–24.º', weight: 40, weightText: '40 %', importedBy: 'ana', createdAt: '2026-10-29T19:20', questions: [],
    },
    { key: 'final', title: 'Exame — época normal', type: 'final', status: 'upcoming', date: '2027-01-14T09:30', importedBy: 'ana', createdAt: '2026-11-02T10:20', questions: [] },
    {
      key: 'mock', title: 'Frequência 2025/26 (simulada)', type: 'midterm', status: 'paper', date: '2026-01-12T10:00', durationMin: 120,
      rules: MOCK_PAPER.rules, scale: { max: 20, unit: 'valores' }, extraPoints: [{ label: MOCK_PAPER.extra, points: 2 }],
      file: { name: 'enunciado.pdf', asset: 'mock.pdf', mime: 'application/pdf', pages: 2 },
      importedBy: 'ana', createdAt: '2026-10-30T20:41',
      extraction: { method: 'pdf-text', model: GEMMA, at: '2026-10-30T20:42', reviewedAt: '2026-10-30T20:47' },
      questions: [
        {
          key: 'I', id: 'q_mkI000', number: 'I', parent: null, group: 'Grupo I', kind: 'case', text: MOCK_PAPER.groupI, points: 6, page: 1,
          answer: {
            by: 'ana', at: '2026-10-30T20:52', model: GEMMA, requestedModel: GEMMA, scope: 'materials',
            text: [
              '**Questão.** Saber se a Lei n.º 7/2026, que proíbe durante um ano todas as reuniões e manifestações em Vila Nova, respeita a Lei Fundamental de Exemplo.',
              '',
              '**Normas aplicáveis.** A liberdade de reunião exerce-se sem necessidade de autorização [S1]. A lei só a pode restringir na medida necessária para proteger outros direitos [S2], com caráter geral e abstrato, sem efeito retroativo e sem nunca atingir o conteúdo essencial do direito [S3, n.º 3].',
              '',
              '**Aplicação.** Uma proibição total, durante um ano e numa cidade inteira, vai muito além do necessário para garantir a tranquilidade dos moradores e deixa o direito de reunião sem qualquer espaço útil. Ao abranger manifestações já anunciadas, tem ainda efeito retroativo. Aliás, a professora usou um exemplo semelhante na aula [S4].',
              '',
              '**Conclusão.** A lei é desconforme com a Lei Fundamental de Exemplo, por violar os arts. 18.º e 30.º.',
            ].join('\n'),
            citations: [
              { ref: 'S1', source: { kind: 'document', doc: 'lf', locator: { type: 'article', article: '30.º', page: 15 } }, quote: 'sem necessidade de autorização' },
              { ref: 'S2', source: { kind: 'document', doc: 'lf', locator: { type: 'article', article: '18.º', page: 9 } }, quote: 'apenas na medida necessária para proteger outros direitos' },
              { ref: 'S3', source: { kind: 'document', doc: 'lf', locator: { type: 'article', article: '18.º', page: 9 } }, quote: 'nunca podem atingir o conteúdo essencial do direito restringido', pin: 'n.º 3' },
              { ref: 'S4', source: { kind: 'lecture', lecture: 'l6', segment: 's_l6f00' }, quote: 'uma lei que proibisse todas as manifestações' },
            ],
          },
          mine: {
            draft: 'Falta generalidade e necessidade; efeito retroativo.\nViola o art. 30.º (reunião sem autorização) e o art. 18.º, n.º 3.',
            mark: 'right', revealed: true, inPractice: true, practice: { last: '2026-11-02T22:15', result: 'gotIt', count: 2 },
          },
        },
        { key: 'II', id: 'q_mkII00', number: 'II', parent: null, group: 'Grupo II', kind: 'container', text: `${MOCK_PAPER.groupII}.`, points: 6, choose: 2, page: 1 },
        {
          key: 'IIa', id: 'q_mkIIa0', number: 'II.a', parent: 'II', group: 'Grupo II', kind: 'short', text: MOCK_PAPER.IIa, points: 3, page: 1,
          mine: { draft: 'DLG: não dependem de prestações do Estado; aplicam-se diretamente.\nDESC: dependem de meios e de leis que os concretizem.', inPractice: true },
        },
        {
          key: 'IIb', id: 'q_mkIIb0', number: 'II.b', parent: 'II', group: 'Grupo II', kind: 'short', text: MOCK_PAPER.IIb, points: 3, page: 1,
          answer: {
            by: 'ana', at: '2026-10-30T20:53', model: DOTS, requestedModel: GEMMA, scope: 'materials',
            text: 'Só nos casos expressamente previstos na Lei Fundamental [S1], devendo as restrições limitar-se ao necessário e revestir caráter geral e abstrato, sem nunca atingir o conteúdo essencial [S1, n.º 3] [S2].',
            citations: [
              { ref: 'S1', source: { kind: 'document', doc: 'lf', locator: { type: 'article', article: '18.º', page: 9 } }, quote: 'nos casos expressamente previstos nesta Lei Fundamental' },
              { ref: 'S2', source: { kind: 'lecture', lecture: 'l6', segment: 's_l6d00' }, quote: 'nunca pode atingir o conteúdo essencial do direito' },
            ],
          },
          mine: {
            correct: 'Previsão expressa; necessidade (proporcionalidade); generalidade e abstração; não retroatividade; respeito pelo conteúdo essencial (art. 18.º, n.ºs 2 e 3).',
            mark: 'partly', inPractice: true, practice: { last: '2026-11-02T22:18', result: 'again', count: 1 },
          },
        },
        {
          key: 'IIc', id: 'q_mkIIc0', number: 'II.c', parent: 'II', group: 'Grupo II', kind: 'short', text: MOCK_PAPER.IIc, points: 3, page: 2,
          answer: {
            by: 'bruno', at: '2026-11-01T17:32', model: GEMMA, requestedModel: GEMMA, scope: 'materials+general',
            text: 'É o núcleo do direito que nenhuma restrição pode atingir: o «limite dos limites» [S1] [S2]. Na doutrina alemã fala-se, a este propósito, de «Wesensgehalt». Por isso a jurisprudência exige que reste sempre um espaço útil de exercício do direito [S9].',
            unverified: ['Na doutrina alemã fala-se, a este propósito, de «Wesensgehalt».'],
            citations: [
              { ref: 'S1', source: { kind: 'lecture', lecture: 'l7', segment: 's_l7b00' }, quote: 'o conteúdo essencial é o limite dos limites' },
              { ref: 'S2', source: { kind: 'document', doc: 'lf', locator: { type: 'article', article: '18.º', page: 9 } }, quote: 'nunca podem atingir o conteúdo essencial' },
              // S9 is cited in the text but was never sent: a hallucinated citation (folder spec §8.15).
            ],
          },
          mine: { inPractice: true, practice: { last: '2026-11-02T22:20', result: 'gotIt', count: 1 } },
        },
        {
          key: 'III', id: 'q_mkIII0', number: 'III', parent: null, group: 'Grupo III', kind: 'comment', text: MOCK_PAPER.groupIII, points: 6, page: 2,
          answer: {
            by: 'ana', at: '2026-10-30T20:54', model: GEMMA, requestedModel: GEMMA, scope: 'materials',
            text: 'A frase é correta: mesmo em estado de exceção, a declaração nunca pode afetar o direito à vida [S1], que a Lei Fundamental declara inviolável [S2].',
            citations: [
              { ref: 'S1', source: { kind: 'document', doc: 'lf', locator: { type: 'article', article: '19.º', page: 10 } }, quote: 'nunca pode afetar o direito à vida' },
              { ref: 'S2', source: { kind: 'document', doc: 'lf', locator: { type: 'article', article: '24.º', page: 12 } }, quote: 'A vida humana é inviolável' },
            ],
          },
          mine: { inPractice: true },
        },
      ],
    },
  ],
  chat: [
    { n: 1, at: '2026-10-29T18:40', by: 'carla', kind: 'message', text: 'Alguém sabe se a frequência continua no dia 10?' },
    { n: 2, at: '2026-10-29T19:05', by: 'bruno', kind: 'message', text: 'Mudou! Frequência a 12 nov., anfiteatro 1.02. Vou afixar.', pinnedBy: 'bruno' },
    { n: 3, at: '2026-11-02T10:02', by: 'bruno', kind: 'message', text: 'Alguém tem os slides da aula 6?' },
    { n: 4, at: '2026-11-02T10:05', by: 'carla', kind: 'message', text: 'Estão nos documentos 👍', replyTo: 3 },
    { n: 5, at: '2026-11-02T10:06', by: 'carla', kind: 'message', text: 'E deixo aqui o calendário de avaliações.', attachment: 'calendario' },
    { n: 6, at: '2026-11-02T10:09', by: 'bruno', kind: 'message', text: '{@ai} o que disse a professora sobre o conteúdo essencial?', mentions: ['ai'] },
    {
      n: 7, at: '2026-11-02T10:09', by: 'bruno', kind: 'ai', replyTo: 6,
      ai: {
        by: 'bruno', at: '2026-11-02T10:09', model: GEMMA, requestedModel: GEMMA, scope: 'materials',
        text: 'A professora explicou que a lei restritiva nunca pode atingir o conteúdo essencial [S1], o que corresponde ao art. 18.º, n.º 3 da Lei Fundamental [S2].',
        citations: [
          { ref: 'S1', source: { kind: 'lecture', lecture: 'l6', segment: 's_l6d00' }, quote: 'nunca pode atingir o conteúdo essencial do direito' },
          { ref: 'S2', source: { kind: 'document', doc: 'lf', locator: { type: 'article', article: '18.º', page: 9 } }, quote: 'nunca podem atingir o conteúdo essencial do direito restringido' },
        ],
      },
    },
    { n: 8, at: '2026-11-02T10:30', by: 'bruno', kind: 'thanks', thanks: { lecture: 'l7', to: 'ana' } },
    { n: 9, at: '2026-11-03T11:30', by: 'ana', kind: 'message', text: 'Obrigada, Bruno!' },
    { n: 10, at: '2026-11-03T11:40', by: 'carla', kind: 'message', text: 'A aula de hoje já está a ser transcrita pelo Bruno 🙌' },
    { n: 11, at: '2026-11-03T12:15', by: 'bruno', kind: 'message', text: '{@ana} tens os apontamentos da aula 7? Faltei à segunda parte.', mentions: ['ana'] },
    { n: 12, at: '2026-11-03T12:20', by: 'carla', kind: 'message', text: 'Eu também agradecia!' },
  ],
  readUpTo: 9,
  notes: [
    {
      key: 'mine6', title: 'Notas — Aula 6', private: true, name: 'Notas — Aula 6.md', by: 'ana', at: '2026-10-20T21:05',
      body: [
        '# Notas — Aula 6',
        '',
        'Restrições aos direitos, liberdades e garantias (Prof.ª Marta Reis).',
        '',
        '- Previsão expressa na Lei Fundamental [12:05]({lecture:l6}?t=725000)',
        '- Generalidade: nunca uma lei para um só caso [33:40]({lecture:l6}?t=2020000)',
        '- **Limite dos limites**: o núcleo do direito não se toca [41:12]({lecture:l6}?t=2472000)',
        '',
        'Ler com atenção: [Lei Fundamental, p. 9]({doc:lf}?page=9)',
        '',
        'Dúvida para a próxima aula: em que é que a suspensão do art. 19.º difere de uma restrição?',
        '',
      ].join('\n'),
    },
    {
      key: 'class8', title: 'Resumo partilhado — Semana 8', private: false, name: 'Resumo partilhado — Semana 8.md', by: 'bruno', at: '2026-11-03T12:40',
      editingBy: 'bruno',
      body: [
        '# Resumo partilhado — Semana 8',
        '',
        'Resumo coletivo da turma. Escrevam por baixo do vosso nome e não apaguem o trabalho dos outros.',
        '',
        '## Estado de exceção (aula 8)',
        '',
        '- O estado de exceção suspende o exercício de alguns direitos, mas não os elimina.',
        '- Só pode ser declarado nos termos da Lei Fundamental, com fundamento e prazo.',
        '- Há direitos que nunca ficam suspensos: a vida, a integridade pessoal, a identidade pessoal, a não retroatividade da lei penal e a liberdade de consciência.',
        '',
        '## Ligação com as aulas 6 e 7',
        '',
        '- Restrição e suspensão são coisas diferentes: a restrição é permanente e geral; a suspensão é temporária e excecional.',
        '- Mesmo durante a suspensão continua a valer a proporcionalidade: só o necessário, pelo tempo necessário.',
        '',
        '## Dúvidas para levar à aula',
        '',
        '1. Quem fiscaliza a declaração enquanto ela dura?',
        '2. Uma lei pode prolongar automaticamente o prazo?',
        '',
        '*Bruno: completo amanhã com os exemplos do acórdão fictício.*',
        '',
      ].join('\n'),
      conflict: {
        by: 'carla', at: '2026-11-03T12:38',
        body: [
          '# Resumo partilhado — Semana 8',
          '',
          'Resumo coletivo da turma. Escrevam por baixo do vosso nome e não apaguem o trabalho dos outros.',
          '',
          '## Estado de exceção (aula 8)',
          '',
          '- Suspende o exercício de alguns direitos durante um tempo limitado.',
          '- Nunca afeta a vida, a integridade pessoal, a identidade pessoal, a lei penal não retroativa e a consciência.',
          '',
          '*Carla: acrescentei a lista dos direitos que nunca se suspendem.*',
          '',
        ].join('\n'),
      },
    },
  ],
  ask: [
    {
      key: 't1', at: '2026-11-01T21:14', question: 'O que diz o art. 18.º sobre as leis restritivas?', model: GEMMA,
      answer: 'As leis restritivas só são admitidas nos casos previstos na Lei Fundamental e têm de ser gerais e abstratas, sem efeito retroativo, nunca podendo atingir o conteúdo essencial do direito restringido [S1, n.º 3]. Na aula 6, a professora sublinhou que este ponto costuma ser perguntado [S2].',
      citations: [
        { ref: 'S1', source: { kind: 'document', doc: 'lf', locator: { type: 'article', article: '18.º', page: 9 } }, quote: 'As leis restritivas devem ser gerais e abstratas', pin: 'n.º 3' },
        { ref: 'S2', source: { kind: 'lecture', lecture: 'l6', segment: 's_l6d00' }, quote: 'a lei restritiva nunca pode atingir o conteúdo essencial do direito' },
      ],
      sent: [
        { ref: 'S1', source: { kind: 'document', doc: 'lf', locator: { type: 'article', article: '18.º', page: 9 } }, quote: '3. As leis restritivas devem ser gerais e abstratas' },
        { ref: 'S2', source: { kind: 'lecture', lecture: 'l6', segment: 's_l6d00' }, quote: 'Isto costuma sair no exame' },
        { ref: 'S3', source: { kind: 'document', doc: 'lf', locator: { type: 'article', article: '18.º', page: 9 } }, quote: '2. A lei só pode restringir direitos' },
        { ref: 'S4', source: { kind: 'lecture', lecture: 'l6', segment: 's_l6e00' }, quote: 'É o que diz o artigo 18.º' },
        { ref: 'S5', source: { kind: 'lecture', lecture: 'l6', segment: 's_l6b00' }, quote: 'O primeiro requisito' },
        { ref: 'S6', source: { kind: 'lecture', lecture: 'l6', segment: 's_l6c00' }, quote: 'O segundo requisito' },
        { ref: 'S7', source: { kind: 'document', doc: 'lf', locator: { type: 'article', article: '18.º', page: 9 } }, quote: '1. As normas sobre direitos' },
        { ref: 'S8', source: { kind: 'lecture', lecture: 'l6', segment: 's_l6g00' }, quote: 'Tomem nota' },
        { ref: 'S9', source: { kind: 'document', doc: 'lf', locator: { type: 'article', article: '19.º', page: 10 } }, quote: '1. O exercício de direitos só pode ser suspenso' },
      ],
    },
  ],
};
