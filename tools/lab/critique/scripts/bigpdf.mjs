// Generates a fictional N-page "code" PDF (Helvetica, WinAnsi), ~45 lines/page, an article heading every ~12 lines.
import { writeFileSync } from 'node:fs';
const [out, N = '800'] = process.argv.slice(2);
const words = 'o a de que em para estudante contrato obrigação prazo tribunal prova direito dever norma lei negócio jurídico vontade declaração nulidade anulabilidade capacidade exercício gozo menor tutela herança doação venda compra arrendamento renda trabalho salário férias despedimento causa indemnização responsabilidade civil dano culpa ilicitude'.split(' ');
let seed = 11; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
const line = () => Array.from({ length: 11 + Math.floor(rnd() * 3) }, () => words[Math.floor(rnd() * words.length)]).join(' ');
const pdfStr = (s) => '(' + s.replace(/[\\()]/g, (c) => '\\' + c).replace(/[\u0080-ÿ]/g, (c) => '\\' + c.charCodeAt(0).toString(8).padStart(3, '0')) + ')';
let art = 1; const pages = [];
for (let p = 0; p < +N; p++) {
  let y = 800, s = `BT /F1 8 Tf 72 820 Td ${pdfStr('Diário da República, 1.ª série — N.º 123 (fictício)')} Tj ET\n`;
  for (let l = 0; l < 45; l++) {
    if (l % 12 === 0) { y -= 6; s += `BT /F1 11 Tf 72 ${y} Td ${pdfStr(`Artigo ${art++}.º Disposição ${art}`)} Tj ET\n`; y -= 15; }
    s += `BT /F1 10 Tf 72 ${y} Td ${pdfStr(line() + '.')} Tj ET\n`; y -= 13; if (y < 60) break;
  }
  pages.push(s);
}
const n = pages.length, font = 3 + n;
const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i} 0 R`).join(' ')}] /Count ${n} >>`,
  ...pages.map((_, i) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${font + 1 + i} 0 R >>`),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ...pages.map((c) => { const b = Buffer.from(c, 'latin1'); return Buffer.concat([Buffer.from(`<< /Length ${b.length} >>\nstream\n`), b, Buffer.from('\nendstream')]); })];
const parts = [Buffer.from('%PDF-1.4\n', 'latin1')]; const offs = []; let len = parts[0].length;
objs.forEach((o, i) => { offs.push(len); const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(o) ? o : Buffer.from(o, 'latin1'), Buffer.from('\nendobj\n')]); parts.push(b); len += b.length; });
parts.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`));
writeFileSync(out, Buffer.concat(parts)); console.log('wrote', out, n, 'pages', art - 1, 'articles');
