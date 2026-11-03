// A fictional law ("Regulamento Académico") as a 4-page text PDF, hand-written like Trama's fixtures
// (Helvetica, WinAnsi). Articles span pages so page citations can be checked.
import { writeFileSync } from 'node:fs';

const out = process.argv[2];
const pdfFromObjects = (objects) => {
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [];
  let len = parts[0].length;
  objects.forEach((body, i) => {
    offsets.push(len);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(b);
    len += b.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
};
const stream = (content) => {
  const b = Buffer.from(content, 'latin1');
  return Buffer.concat([Buffer.from(`<< /Length ${b.length} >>\nstream\n`, 'latin1'), b, Buffer.from('\nendstream', 'latin1')]);
};
const latin1 = (s) => Buffer.from(s, 'utf8').toString('latin1') && Buffer.from(s, 'latin1').toString('latin1');
const pdfStr = (s) => '(' + s.replace(/[\\()]/g, (c) => '\\' + c).replace(/[\u0080-ÿ]/g, (c) => '\\' + c.charCodeAt(0).toString(8).padStart(3, '0')) + ')';
const textAt = (x, y, size, s) => `BT /F1 ${size} Tf ${x} ${y} Td ${pdfStr(s)} Tj ET\n`;

// Each page: list of [size, text, gapBefore]
const pages = [
  [
    [16, 'Regulamento Académico (fictício)', 0],
    [12, 'Artigo 1.º Objeto', 30],
    [11, 'O presente regulamento estabelece as regras de avaliação dos estudantes', 20],
    [11, 'inscritos nas unidades curriculares da faculdade.', 14],
    [12, 'Artigo 2.º Época de recurso', 30],
    [11, 'O estudante reprovado na época normal pode inscrever-se na época de', 20],
    [11, 'recurso, mediante requerimento apresentado nos serviços académicos.', 14],
  ],
  [
    [11, 'A inscrição na época de recurso está sujeita ao pagamento de uma taxa', 0],
    [11, 'fixada anualmente pelo conselho de gestão.', 14],
    [12, 'Artigo 3.º Melhoria de nota', 30],
    [11, 'O estudante aprovado pode requerer melhoria de nota uma única vez,', 20],
    [11, 'prevalecendo sempre a classificação mais elevada obtida.', 14],
  ],
  [
    [12, 'Artigo 4.º Fraude académica', 0],
    [11, 'A fraude em prova de avaliação determina a anulação da prova e a', 20],
    [11, 'instauração de procedimento disciplinar ao estudante.', 14],
  ],
  [
    [12, 'Artigo 5.º Estatuto de trabalhador-estudante', 0],
    [11, 'O trabalhador-estudante tem direito a época especial de exames e não', 20],
    [11, 'está sujeito a regime de faltas nas aulas teóricas.', 14],
  ],
];

const contents = pages.map((lines) => {
  let y = 780;
  return lines.map(([size, s, gap]) => {
    y -= gap || 0;
    return textAt(72, y, size, s);
  }).join('');
});
const n = pages.length;
const kids = pages.map((_, i) => `${3 + i} 0 R`).join(' ');
const fontObj = 3 + n;
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`,
  ...pages.map((_, i) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${fontObj + 1 + i} 0 R >>`),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ...contents.map(stream),
];
writeFileSync(out, pdfFromObjects(objects));
console.log('wrote', out);
