// The documents of `bio` ("Biology 101") and `stats` ("Estadística I") (UX §7.3). All fictional. Single source of
// the assets (tools/fixtures/build-demo-assets.mjs) and of the citations of them. Self-contained on purpose: Node
// runs this file directly (type stripping) when it builds the assets.

export interface Slide { title: string; bullets: string[] }
export interface PdfPageText { lines: Array<{ text: string; style?: 'title' | 'heading' | 'body' | 'small' }> }

/** `primer` → Readings/Cell Biology Primer (fictional).pdf: 12 pages; p. 4 and p. 7 carry the cited sentences. */
export const PRIMER: PdfPageText[] = [
  { lines: [
    { text: 'Cell Biology Primer', style: 'title' },
    { text: 'A fictional reading for Biology 101 (Dr. Sam Okafor). Written for the Tramado demo.', style: 'small' },
    { text: 'Contents: 1 Cells · 2 Membranes · 3 Transport · 4 Water · 5 Energy · 6 Review', style: 'body' },
  ] },
  { lines: [
    { text: '1. What a cell is', style: 'heading' },
    { text: 'Every living thing is built from cells, the smallest units that can grow, use energy and copy themselves.', style: 'body' },
    { text: 'Some organisms are a single cell; a person is made of tens of trillions of them, working together.', style: 'body' },
    { text: 'Cells share a common plan: an outer boundary, a watery interior and instructions written in DNA.', style: 'body' },
  ] },
  { lines: [
    { text: '2. The boundary of the cell', style: 'heading' },
    { text: 'The plasma membrane separates the inside of the cell from its surroundings.', style: 'body' },
    { text: 'It is built from two layers of phospholipids, with their water-loving heads facing out and their tails facing in.', style: 'body' },
    { text: 'Proteins sit in or on this double layer and do most of the membrane’s work: carrying, signalling and anchoring.', style: 'body' },
  ] },
  { lines: [
    { text: '3. Crossing the membrane', style: 'heading' },
    { text: 'Small non-polar molecules such as oxygen and carbon dioxide diffuse directly across the lipid bilayer.', style: 'body' },
    { text: 'Ions and large polar molecules, such as glucose, need help from transport proteins.', style: 'body' },
    { text: 'Diffusion always runs down a concentration gradient and costs the cell no energy.', style: 'body' },
  ] },
  { lines: [
    { text: '3.1 Channels and carriers', style: 'heading' },
    { text: 'Channel proteins form narrow pores that let particular ions through very quickly.', style: 'body' },
    { text: 'Carrier proteins bind the molecule they move and change shape to release it on the other side.', style: 'body' },
  ] },
  { lines: [
    { text: '3.2 Active transport', style: 'heading' },
    { text: 'Pumps move substances against their gradient and pay for it with energy from ATP.', style: 'body' },
    { text: 'The sodium–potassium pump keeps the inside of animal cells low in sodium and high in potassium.', style: 'body' },
  ] },
  { lines: [
    { text: '4. Water and osmosis', style: 'heading' },
    { text: 'Osmosis is the diffusion of water across a membrane that lets water through but holds back the solutes.', style: 'body' },
    { text: 'In a hypotonic solution, water moves into the cell by osmosis and the cell swells.', style: 'body' },
    { text: 'In a hypertonic solution the opposite happens: water leaves and the cell shrinks.', style: 'body' },
  ] },
  { lines: [
    { text: '4.1 Plant cells and turgor', style: 'heading' },
    { text: 'A plant cell does not burst in pure water, because its cell wall pushes back as it fills.', style: 'body' },
    { text: 'This pressure, called turgor, keeps leaves and young stems firm.', style: 'body' },
  ] },
  { lines: [
    { text: '5. Energy in the cell', style: 'heading' },
    { text: 'Mitochondria release the energy stored in food and capture it in molecules of ATP.', style: 'body' },
    { text: 'Chloroplasts, found in plant cells, capture light energy and use it to build sugars.', style: 'body' },
  ] },
  { lines: [
    { text: '5.1 Enzymes', style: 'heading' },
    { text: 'Enzymes are proteins that speed up chemical reactions without being used up.', style: 'body' },
    { text: 'Each enzyme has an active site that fits its substrate closely.', style: 'body' },
  ] },
  { lines: [
    { text: '6. Review questions', style: 'heading' },
    { text: 'Why can oxygen enter a cell without a transport protein?', style: 'body' },
    { text: 'What would happen to a plant cell placed in salty water?', style: 'body' },
    { text: 'Which kind of transport needs ATP, and why?', style: 'body' },
  ] },
  { lines: [
    { text: 'Glossary', style: 'heading' },
    { text: 'Bilayer: the double layer of lipids in a membrane. Gradient: a difference in concentration.', style: 'body' },
    { text: 'Hypotonic: having fewer dissolved particles than the cell. Turgor: the pressure of water inside a plant cell.', style: 'body' },
  ] },
];

/** `slides3` → Slides/Lecture 3 — Membranes.pptx (6 slides). */
export const SLIDES3: { title: string; slides: Slide[] } = {
  title: 'Lecture 3 — Membranes',
  slides: [
    { title: 'Lecture 3 — Membranes', bullets: ['Biology 101 · Fall 2026', 'Dr. Sam Okafor'] },
    { title: 'The fluid mosaic model', bullets: ['A lipid bilayer with proteins floating in it', 'Lipids and proteins move sideways'] },
    { title: 'Phospholipids', bullets: ['Hydrophilic heads, hydrophobic tails', 'Self-assemble into bilayers in water'] },
    { title: 'Membrane proteins', bullets: ['Channels, carriers, receptors, anchors', 'Integral and peripheral proteins'] },
    { title: 'Cholesterol', bullets: ['Buffers fluidity in both directions', 'Less fluid when warm, more fluid when cold'] },
    { title: 'What crosses easily?', bullets: ['Small non-polar molecules: O₂, CO₂', 'Ions and glucose need proteins'] },
  ],
};

/** `lab2` → Lab/Lab 2 — Osmosis worksheet.docx. */
export const LAB2: { title: string; sections: Array<{ heading: string; paragraphs: string[] }> } = {
  title: 'Lab 2 — Osmosis worksheet',
  sections: [
    { heading: 'Aim', paragraphs: ['To observe how potato cylinders change mass in salt solutions of different concentrations.'] },
    { heading: 'Method', paragraphs: [
      'Cut six potato cylinders of the same length and weigh each one.',
      'Place each cylinder in a tube with 0 %, 0.5 %, 1 %, 2 %, 5 % or 10 % salt solution for 30 minutes.',
      'Dry the cylinders gently with paper towel and weigh them again.',
    ] },
    { heading: 'Results', paragraphs: ['Record the change in mass of each cylinder as a percentage of its starting mass, then plot it against the salt concentration.'] },
    { heading: 'Questions', paragraphs: [
      'At which concentration did the mass not change? What does that tell you about the inside of the potato cells?',
      'Explain the change in the 0 % tube using the word osmosis.',
    ] },
  ],
};

/** `cell` → Images/Plant cell diagram.png: a simple labelled drawing. */
export const CELL_LABELS = ['Cell wall', 'Cell membrane', 'Nucleus', 'Chloroplast', 'Vacuole', 'Cytoplasm'];

/** `apuntes` → Documentos/Apuntes — Tema 2.pdf (stats, 3 pages; p. 2 carries the key sentence). */
export const APUNTES: PdfPageText[] = [
  { lines: [
    { text: 'Apuntes — Tema 2: Estimación puntual', style: 'title' },
    { text: 'Estadística I · apuntes personales (ficticios)', style: 'small' },
    { text: 'Un estimador es una función de la muestra que usamos para aproximar un parámetro de la población.', style: 'body' },
    { text: 'Ejemplos: la media muestral, la varianza muestral y la proporción muestral.', style: 'body' },
  ] },
  { lines: [
    { text: '2.1 Propiedades de los estimadores', style: 'heading' },
    { text: 'La media muestral es un estimador insesgado de la media poblacional.', style: 'body' },
    { text: 'Un estimador es insesgado cuando su valor esperado coincide con el parámetro que estima.', style: 'body' },
    { text: 'Entre dos estimadores insesgados preferimos el de menor varianza.', style: 'body' },
  ] },
  { lines: [
    { text: '2.2 Ejercicios', style: 'heading' },
    { text: 'Comprobar con una muestra de tamaño 3 que la varianza con denominador n está sesgada.', style: 'body' },
    { text: 'Repasar para el parcial: definiciones de sesgo, varianza y error cuadrático medio.', style: 'body' },
  ] },
];
