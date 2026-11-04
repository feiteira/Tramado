// "Lei Fundamental de Exemplo": the made-up constitution of the made-up "República de Exemplo" (UX §7.3, `lf`).
// Its wording is invented for the demo and copies no real constitution. The single source of the 24-page PDF
// (tools/fixtures/build-demo-assets.mjs) and of every citation of it (`example.test.ts` resolves each quote).
// Self-contained on purpose: Node runs this file directly (type stripping) when it builds the assets.

export interface LawArticle { n: number; title: string; paragraphs: string[] }
/** One printed page: section headings (Título / Capítulo) before its articles, or plain text blocks. */
export interface LawPage { blocks: Array<{ heading: string } | { article: LawArticle } | { text: string; style?: 'title' | 'subtitle' | 'body' | 'small' }> }

export const LF_TITLE = 'Lei Fundamental de Exemplo (texto fictício)';
/** The running header of every page (UX §7.3: it exercises header stripping). */
export const LF_HEADER = 'Lei Fundamental de Exemplo — texto fictício para demonstração';

const a = (n: number, title: string, ...paragraphs: string[]): { article: LawArticle } => ({ article: { n, title, paragraphs } });
const h = (heading: string) => ({ heading });

export const LF_PAGES: LawPage[] = [
  // 1
  { blocks: [
    { text: 'REPÚBLICA DE EXEMPLO', style: 'subtitle' },
    { text: 'Lei Fundamental de Exemplo', style: 'title' },
    { text: 'Texto fictício, escrito para a demonstração do Tramado. Não reproduz nem resume nenhuma constituição real; os artigos, os números e as instituições são inventados.', style: 'body' },
    { text: 'Versão de estudo · 2026', style: 'small' },
  ] },
  // 2
  { blocks: [
    h('Preâmbulo'),
    { text: 'Reunidos em assembleia constituinte depois de um longo período de reconstrução, os representantes do povo da República de Exemplo aprovam esta Lei Fundamental para servir de quadro comum à vida política, económica e social do país.', style: 'body' },
    { text: 'A presente Lei Fundamental assenta em três ideias simples: o poder pertence às pessoas, o Estado existe para as servir e nenhuma maioria, por maior que seja, dispensa o respeito pelas regras que aqui se fixam.', style: 'body' },
    { text: 'Os seus autores quiseram um texto curto, legível por qualquer estudante, e deixaram ao legislador ordinário o desenvolvimento das matérias que dele precisem.', style: 'body' },
  ] },
  // 3
  { blocks: [
    h('Título I — Princípios fundamentais'),
    a(1, 'República de Exemplo', '1. A República de Exemplo é um Estado de direito democrático, fundado na dignidade de cada pessoa e na participação de todos na vida pública.', '2. O poder político é exercido nas formas previstas nesta Lei Fundamental.'),
    a(2, 'Soberania popular', '1. A soberania reside no povo, que a exerce pelo voto, pelo referendo e pelos demais meios aqui regulados.', '2. Nenhum grupo ou pessoa pode arrogar-se o exercício da soberania em nome do povo.'),
    a(3, 'Território', 'O território da República de Exemplo compreende o continente, as ilhas do arquipélago do Norte e as águas sob a sua jurisdição, tal como a lei os delimita.'),
    a(4, 'Cidadania', '1. São cidadãos da República de Exemplo os que a lei como tal considere, por nascimento ou por naturalização.', '2. A cidadania não pode ser retirada por motivos políticos.'),
  ] },
  // 4
  { blocks: [
    a(5, 'Língua oficial', 'A língua oficial é o português de Exemplo, sem prejuízo da proteção das línguas minoritárias faladas no território.'),
    a(6, 'Símbolos nacionais', '1. Os símbolos nacionais são a bandeira azul e cinzenta, o hino aprovado por lei e o selo da República.', '2. A lei regula o uso dos símbolos nacionais em atos oficiais.'),
    a(7, 'Organização do Estado', '1. O Estado é unitário e organiza-se de forma descentralizada, com municípios dotados de órgãos eleitos.', '2. As ilhas do arquipélago do Norte têm um estatuto próprio, aprovado por lei reforçada.'),
    a(8, 'Relações externas', 'A República de Exemplo rege-se nas relações com outros povos pela resolução pacífica dos conflitos, pela cooperação e pelo respeito mútuo.'),
  ] },
  // 5
  { blocks: [
    a(9, 'Normas internacionais', 'As convenções internacionais regularmente aprovadas vigoram na ordem interna depois de publicadas no jornal oficial, enquanto vincularem internacionalmente o Estado.'),
    a(10, 'Tarefas do Estado', 'São tarefas do Estado garantir a independência nacional, promover o bem-estar das pessoas, defender o ambiente e assegurar o ensino público gratuito até ao fim da escolaridade obrigatória.'),
    a(11, 'Sufrágio', '1. O sufrágio é universal, igual, direto, secreto e periódico.', '2. Votam todos os cidadãos maiores de dezoito anos, salvo as incapacidades previstas na lei.'),
    h('Título II — Direitos e deveres fundamentais'),
    h('Capítulo I — Disposições gerais'),
    a(12, 'Titulares', 'Gozam dos direitos e estão sujeitos aos deveres consignados neste título todas as pessoas que se encontrem no território, nos termos dos artigos seguintes.'),
    a(13, 'Igualdade', '1. Todas as pessoas têm a mesma dignidade e são iguais perante a lei.', '2. Ninguém pode ser favorecido ou prejudicado pela sua origem, língua, crença, opinião, situação económica ou condição de saúde.'),
  ] },
  // 6
  { blocks: [
    a(14, 'Residentes no estrangeiro', 'Os cidadãos que residam fora do país mantêm os direitos que não sejam incompatíveis com a ausência do território e recebem do Estado a proteção consular adequada.'),
    a(15, 'Estrangeiros e apátridas', '1. Os estrangeiros e os apátridas que residam na República de Exemplo gozam, em regra, dos mesmos direitos que os cidadãos.', '2. Ficam reservados aos cidadãos os direitos políticos e o exercício de funções públicas de autoridade, salvo o que a lei disponha para eleições municipais.'),
  ] },
  // 7
  { blocks: [
    h('Capítulo II — Direitos, liberdades e garantias'),
    a(16, 'Âmbito', '1. Os direitos enunciados nesta Lei Fundamental não excluem outros que resultem das leis ou das convenções internacionais.', '2. A interpretação das normas sobre direitos faz-se sempre no sentido mais favorável à pessoa.', '3. Os direitos de natureza análoga aos deste capítulo seguem o regime nele previsto.'),
  ] },
  // 8
  { blocks: [
    a(17, 'Regime', '1. O regime deste capítulo aplica-se aos direitos aqui enunciados e aos que, noutros lugares desta Lei Fundamental, tenham a mesma natureza.', '2. Cabe aos tribunais assegurar a defesa efetiva desses direitos, em processo rápido quando a urgência o exigir.', '3. Os órgãos do Estado devem remover os obstáculos de facto que impeçam o seu exercício.'),
  ] },
  // 9
  { blocks: [
    a(18, 'Força jurídica dos direitos',
      '1. As normas sobre direitos, liberdades e garantias aplicam-se diretamente e obrigam entidades públicas e privadas.',
      '2. A lei só pode restringir direitos, liberdades e garantias nos casos expressamente previstos nesta Lei Fundamental, e apenas na medida necessária para proteger outros direitos ou interesses nela protegidos.',
      '3. As leis restritivas devem ser gerais e abstratas, não podem ter efeito retroativo e nunca podem atingir o conteúdo essencial do direito restringido.'),
  ] },
  // 10
  { blocks: [
    a(19, 'Estado de exceção',
      '1. O exercício de direitos só pode ser suspenso em estado de exceção declarado nos termos desta Lei Fundamental.',
      '2. A declaração do estado de exceção nunca pode afetar o direito à vida, a integridade pessoal, a identidade pessoal, a não retroatividade da lei penal e a liberdade de consciência.'),
  ] },
  // 11
  { blocks: [
    a(20, 'Acesso aos tribunais', 'A todas as pessoas é assegurado o acesso aos tribunais para defesa dos seus interesses legítimos, não podendo a justiça ser recusada por insuficiência de meios económicos.'),
    a(21, 'Direito de oposição', 'Todas as pessoas podem recusar o cumprimento de ordens que ofendam os seus direitos, liberdades e garantias, quando não seja possível recorrer em tempo útil à autoridade pública.'),
    a(22, 'Responsabilidade do Estado', 'O Estado e as demais entidades públicas respondem pelos danos causados pelos seus titulares, funcionários ou agentes no exercício das suas funções.'),
    a(23, 'Provedor das pessoas', 'Qualquer pessoa pode apresentar queixas por ações ou omissões dos poderes públicos ao Provedor das pessoas, órgão independente eleito pelo parlamento.'),
  ] },
  // 12
  { blocks: [
    a(24, 'Direito à vida',
      '1. A vida humana é inviolável e nenhuma lei pode autorizar a sua privação.',
      '2. A República de Exemplo não admite a pena de morte.'),
    a(25, 'Integridade pessoal', '1. A integridade moral e física de cada pessoa é intocável.', '2. São proibidos os tratos cruéis, degradantes ou desumanos, qualquer que seja o motivo invocado.'),
  ] },
  // 13
  { blocks: [
    a(26, 'Identidade e reserva', '1. A todos são reconhecidos os direitos à identidade pessoal, ao bom nome, à imagem, à palavra e à reserva da vida privada e familiar.', '2. A lei estabelece garantias contra a utilização abusiva de informações relativas às pessoas.'),
    a(27, 'Liberdade e segurança', '1. Todas as pessoas têm direito à liberdade e à segurança.', '2. Ninguém pode ser privado da liberdade a não ser em consequência de sentença judicial ou nos casos taxativamente indicados na lei.'),
  ] },
  // 14
  { blocks: [
    a(28, 'Detenção', '1. A pessoa detida é apresentada a um juiz no prazo máximo de quarenta e oito horas.', '2. A detenção é comunicada sem demora a um familiar ou a pessoa da confiança do detido.'),
    a(29, 'Lei penal', '1. Ninguém pode ser punido por um facto que não fosse crime no momento em que foi praticado.', '2. Aplica-se sempre a lei penal mais favorável ao arguido.'),
  ] },
  // 15
  { blocks: [
    a(30, 'Liberdade de reunião',
      '1. Todas as pessoas têm o direito de se reunir pacificamente e sem armas, mesmo em lugares públicos, sem necessidade de autorização.',
      '2. A lei pode exigir aviso prévio às autoridades, nos termos e prazos que fixar.'),
  ] },
  // 16
  { blocks: [
    a(31, 'Liberdade de associação', '1. Todas as pessoas podem constituir associações sem dependência de licença, desde que estas não se destinem a promover a violência.', '2. Ninguém pode ser obrigado a fazer parte de uma associação.', '3. As associações só podem ser dissolvidas por decisão judicial.'),
  ] },
  // 17
  { blocks: [
    a(32, 'Expressão e informação', '1. Todas as pessoas têm o direito de exprimir e divulgar o seu pensamento por qualquer meio, bem como o direito de se informar.', '2. O exercício destes direitos não pode ser impedido por qualquer forma de censura prévia.'),
    a(33, 'Comunicação social', '1. É garantida a liberdade de imprensa e dos demais meios de comunicação social.', '2. A lei assegura a transparência da propriedade das empresas de comunicação social.'),
  ] },
  // 18
  { blocks: [
    a(34, 'Domicílio e correspondência', '1. O domicílio e o sigilo da correspondência e das comunicações privadas são invioláveis.', '2. A entrada no domicílio contra a vontade de quem nele vive só pode ser ordenada por um juiz.', '3. Durante a noite, ninguém pode entrar no domicílio de uma pessoa sem o seu consentimento.'),
  ] },
  // 19
  { blocks: [
    a(35, 'Dados pessoais', '1. Todas as pessoas têm o direito de conhecer os dados que lhes digam respeito e de exigir a sua retificação.', '2. É proibido o tratamento de dados sobre convicções, filiação partidária ou vida privada, salvo consentimento expresso.', '3. A lei define o regime de proteção dos dados que circulem através de redes informáticas.'),
  ] },
  // 20
  { blocks: [
    a(36, 'Família e filiação', '1. Todas as pessoas têm o direito de constituir família e de contrair casamento em condições de plena igualdade.', '2. Os filhos nascidos fora do casamento não podem ser discriminados.', '3. Os pais têm o direito e o dever de educar e manter os filhos.'),
  ] },
  // 21
  { blocks: [
    a(37, 'Consciência e culto', '1. A liberdade de consciência, de religião e de culto não pode ser limitada.', '2. Ninguém pode ser perseguido ou privado de direitos por causa das suas convicções.', '3. As igrejas e comunidades religiosas estão separadas do Estado.'),
  ] },
  // 22
  { blocks: [
    a(38, 'Criação cultural', '1. É livre a criação intelectual, artística e científica.', '2. Esta liberdade compreende o direito à invenção, produção e divulgação da obra e a proteção legal dos direitos de autor.'),
  ] },
  // 23
  { blocks: [
    a(39, 'Aprender e ensinar', '1. É garantida a liberdade de aprender e de ensinar.', '2. O Estado não pode programar a educação e a cultura segundo diretrizes filosóficas, estéticas, políticas ou religiosas.', '3. O ensino público não é confessional.'),
  ] },
  // 24
  { blocks: [
    a(40, 'Deslocação e emigração', '1. Todas as pessoas têm o direito de se deslocar e de fixar residência em qualquer parte do território.', '2. A todos é garantido o direito de emigrar ou de sair do território e o direito de regressar.'),
    { text: '(Fim do texto fictício.)', style: 'small' },
  ] },
];

export const articleHeading = (x: LawArticle): string => `Artigo ${x.n}.º (${x.title})`;

/** The canonical lines of a page: the running header, then each block (one line per paragraph). */
export function lfPageLines(page: LawPage): string[] {
  const out = [LF_HEADER];
  for (const b of page.blocks) {
    if ('heading' in b) out.push(b.heading);
    else if ('article' in b) out.push(articleHeading(b.article), ...b.article.paragraphs);
    else out.push(b.text);
  }
  return out;
}

/** The page (1-based) that prints article `n`. */
export function lfArticlePage(n: number): number {
  const i = LF_PAGES.findIndex((p) => p.blocks.some((b) => 'article' in b && b.article.n === n));
  if (i < 0) throw new Error(`no article ${n}`);
  return i + 1;
}
