const fold = (s) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
// Portuguese article references
const PT_ARTICLE = /\bart(?:igo)?s?\.?\s*(\d{1,4})(?:\.?\s*[º°o])?(?:-([A-Z]))?(?:\s*,?\s*n\.?\s*[º°o]\.?\s*(\d{1,3}))?(?:\s*,?\s*al(?:[íi]nea)?\.?\s*([a-z])\))?(?:\s+(?:do|da)\s+(CC|CP|CPC|CPP|CRP|CT|CSC|CPA|CPTA|CIRE|RGPD|C[óo]digo\s+(?:Civil|Penal|do\s+Trabalho|de\s+Processo\s+(?:Civil|Penal)|das\s+Sociedades\s+Comerciais)|Constitui[çc][ãa]o))?/gu;
const ES_ARTICLE = /\bart(?:[íi]culo)?s?\.?\s*(\d{1,4})(?:\.(\d{1,3}))?(?:\s*(bis|ter|quater))?(?:\s+(?:del?|de\s+la)\s+(CC|CE|CP|LEC|LECrim|ET|LOPDGDD|C[óo]digo\s+(?:Civil|Penal)|Constituci[óo]n(?:\s+Espa[ñn]ola)?))?/gu;
const EN_ARTICLE = /\b(?:s(?:ection)?\.?|art(?:icle)?\.?)\s*(\d{1,4}[A-Z]?)(?:\((\d{1,3})\))?(?:\s+(?:of\s+the\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\s+Act(?:\s+\d{4})?|ECHR|TFEU|TEU|GDPR))?/g;
const samples = [
 'Nos termos do art. 122.º do CC, é menor quem não completou 18 anos; ver também o artigo 125.º, n.º 1, alínea a) e os arts. 240.º a 243.º do Código Civil.',
 'O art. 13.º da CRP e o artigo 483.º-A do CC.',
 'Según el artículo 1902 del Código Civil y el art. 24.2 CE, y el art. 10 bis de la LEC.',
 'Under section 3(1) of the Human Rights Act 1998 and Article 8 ECHR.',
];
for (const s of samples) for (const re of [PT_ARTICLE, ES_ARTICLE, EN_ARTICLE]) for (const m of s.matchAll(re)) console.log(re===PT_ARTICLE?'PT':re===ES_ARTICLE?'ES':'EN', JSON.stringify(m[0]), m.slice(1).filter(Boolean));
// Exam radar (run on folded text)
const RADAR = {
 pt: /\b(?:isto|isso|esta materia|este tema|esta parte|esta pergunta)\s+(?:\w+\s+){0,2}(?:sai|vai sair|costuma sair|pode sair|entra|vai entrar|e para)\s+(?:\w+\s+){0,2}(?:exame|teste|frequencia)|\b(?:importante|fundamental)\s+para\s+o\s+(?:exame|teste)|\bpergunta\s+de\s+exame|\btomem\s+nota\b/u,
 es: /\b(?:esto|esta parte|este tema|esta pregunta)\s+(?:\w+\s+){0,2}(?:entra|va a entrar|cae|suele caer|puede caer|sale|va a salir)\s+(?:\w+\s+){0,2}(?:examen|parcial|final)|\bpregunta\s+de\s+examen|\bapuntad(?:lo)?\s+esto|\bimportante\s+para\s+el\s+examen/u,
 en: /\b(?:this|that|it)\s+(?:will|is going to|might|could|may|is likely to)\s+(?:be|come up|appear|show up)\s+(?:on|in)\s+the\s+(?:exam|test|final|midterm)|\bexam\s+question\b|\bwrite\s+this\s+down\b|\bmake\s+sure\s+you\s+know\b/u,
};
for (const [l,t] of [['pt','Atenção: isto costuma sair no exame, tomem nota.'],['pt','Esta matéria vai sair de certeza no teste.'],['es','Esto entra seguro en el examen.'],['en','This will come up on the exam, so write this down.'],['pt','O exame foi ontem.']]) console.log(l, RADAR[l].test(fold(t)), t);
