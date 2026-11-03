const fold = (s) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
const PT_ARTICLE = /\bart(?:igo)?s?\.?\s*(\d{1,4})(?:\.?\s*[º°o])?(?:-([A-Z]))?(?:\s*(?:a|e|-)\s*(\d{1,4})(?:\.?\s*[º°o])?)?(?:\s*,?\s*n\.?\s*[º°o]\.?\s*(\d{1,3}))?(?:\s*,?\s*al(?:[íi]nea)?\.?\s*([a-z])\))?(?:\s+(?:do|da)\s+(CC|CP|CPC|CPP|CRP|CT|CSC|CPA|CPTA|CIRE|RGPD|C[óo]digo\s+(?:Civil|Penal|do\s+Trabalho|de\s+Processo\s+(?:Civil|Penal)|das\s+Sociedades\s+Comerciais)|Constitui[çc][ãa]o))?/gu;
const ES_ARTICLE = /\bart(?:[íi]culo)?s?\.?\s*(\d{1,4})(?:\.(\d{1,3}))?(?:\s*(bis|ter|quater))?(?:\s+(?:(?:del?|de\s+la)\s+)?(CC|CE|CP|LEC|LECrim|ET|LOPDGDD|C[óo]digo\s+(?:Civil|Penal)|Constituci[óo]n(?:\s+Espa[ñn]ola)?))?/gu;
const EN_ARTICLE = /\b(?:[Ss](?:ection)?\.?|[Aa]rt(?:icle)?\.?)\s*(\d{1,4}[A-Z]?)(?:\((\d{1,3})\))?(?:\s+(?:of\s+the\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\s+Act(?:\s+\d{4})?|ECHR|TFEU|TEU|GDPR))?/g;
const t = {pt:['Nos termos do art. 122.º do CC; o artigo 125.º, n.º 1, alínea a) e os arts. 240.º a 243.º do Código Civil.','O art. 13.º da CRP e o artigo 483.º-A do CC.'],
 es:['Según el artículo 1902 del Código Civil y el art. 24.2 CE, y el art. 10 bis de la LEC.'], en:['Under section 3(1) of the Human Rights Act 1998 and Article 8 ECHR.']};
const R={pt:PT_ARTICLE,es:ES_ARTICLE,en:EN_ARTICLE};
for (const [l,arr] of Object.entries(t)) for (const s of arr) for (const m of s.matchAll(R[l])) console.log(l, JSON.stringify(m[0]), m.slice(1).filter(Boolean));
const RADAR = {
 pt: /\b(?:isto|isso|esta materia|este tema|esta parte|esta pergunta)\s+(?:\S+\s+){0,2}(?:sai|vai sair|costuma sair|pode sair|entra|vai entrar|e para)\s+(?:\S+\s+){0,3}(?:exame|teste|frequencia)\b|\b(?:importante|fundamental)\s+para\s+o\s+(?:exame|teste)\b|\bpergunta\s+de\s+exame\b|\btomem\s+nota\b/u,
 es: /\b(?:esto|esta parte|este tema|esta pregunta)\s+(?:\S+\s+){0,2}(?:entra|va a entrar|cae|suele caer|puede caer|sale|va a salir)\s+(?:\S+\s+){0,3}(?:examen|parcial|final)\b|\bpregunta\s+de\s+examen\b|\bapuntad(?:lo)?\s+esto\b|\bimportante\s+para\s+el\s+examen\b/u,
 en: /\b(?:this|that|it)\s+(?:will|is going to|might|could|may|is likely to)\s+(?:be|come up|appear|show up)\s+(?:on|in)\s+the\s+(?:exam|test|final|midterm)\b|\bexam\s+question\b|\bwrite\s+this\s+down\b|\bmake\s+sure\s+you\s+know\b/u,
};
for (const [l,s] of [['pt','Atenção: isto costuma sair no exame, tomem nota.'],['pt','Esta matéria vai sair de certeza no teste.'],['es','Esto entra seguro en el examen.'],['en','This will come up on the exam, so write this down.'],['pt','O exame foi ontem.'],['es','El examen fue ayer.']]) console.log(l, RADAR[l].test(fold(s)), s);
