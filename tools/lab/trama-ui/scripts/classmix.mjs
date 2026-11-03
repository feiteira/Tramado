// Does `color-mix(in oklab, <class colour> P%, var(--ink))` reach 4.5:1 on the raised paper in
// both themes for every class colour? (A pure-CSS text colour for a class: mixing with ink darkens
// in light mode and lightens in dark mode.) Also checks soft tints for ink text.
const CLASS = ['#e5484d', '#f76b15', '#f5a524', '#8db600', '#30a46c', '#12a594', '#0090c8', '#3e63dd', '#6e56cf', '#ab4aba', '#d6409f', '#8d8d86'];
const T = {
  light: { ink: '#181d29', raised: '#ffffff', paper: '#f3f5f8', sunk: '#e8ecf2', ink3: '#545b6c' },
  dark: { ink: '#e8ebf1', raised: '#1c2028', paper: '#14171d', sunk: '#101318', ink3: '#a1a8b5' },
};
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function rgb2oklab([r, g, b]) {
  [r, g, b] = [r, g, b].map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function oklab2rgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [r, g, bb].map((c) => Math.min(1, Math.max(0, fromLin(c))));
}
const mix = (a, b, p) => {
  const A = rgb2oklab(hex2rgb(a)), B = rgb2oklab(hex2rgb(b));
  return oklab2rgb(A.map((x, i) => x * p + B[i] * (1 - p)));
};
const lum = (rgb) => { const [r, g, b] = rgb.map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const cr = (x, y) => { const [h, l] = [lum(x), lum(y)].sort((p, q) => q - p); return (h + 0.05) / (l + 0.05); };
const toHex = (rgb) => '#' + rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');

for (const p of [0.7, 0.65, 0.6, 0.55, 0.5]) {
  let worst = { r: 99 };
  for (const c of CLASS) for (const [name, t] of Object.entries(T)) for (const bg of ['raised', 'paper', 'sunk']) {
    const r = cr(mix(c, t.ink, p), hex2rgb(t[bg]));
    if (r < worst.r) worst = { r, c, name, bg };
  }
  console.log(`text = ${Math.round(p * 100)}% class + ink: worst ${worst.r.toFixed(2)} (${worst.c} on ${worst.name} ${worst.bg})`);
}
// Soft tint: color-mix(in oklab, class S%, paper-raised): ink and ink-3 on it.
for (const s of [0.12, 0.16, 0.2]) {
  let worst = { r: 99 };
  for (const c of CLASS) for (const [name, t] of Object.entries(T)) {
    const bg = mix(c, t.raised, s);
    for (const ink of ['ink', 'ink3']) {
      const r = cr(hex2rgb(t[ink]), bg);
      if (r < worst.r) worst = { r, c, name, ink };
    }
  }
  console.log(`soft = ${Math.round(s * 100)}% class on raised: worst text ${worst.r.toFixed(2)} (${worst.ink} on ${worst.c}, ${worst.name})`);
}
// Bars (non-text, 3:1): the solid itself vs paper-raised, or mixed 80% with ink.
for (const p of [1, 0.85, 0.75]) {
  let worst = { r: 99 };
  for (const c of CLASS) for (const [name, t] of Object.entries(T)) {
    const r = cr(mix(c, t.ink, p), hex2rgb(t.raised));
    if (r < worst.r) worst = { r, c, name };
  }
  console.log(`bar = ${Math.round(p * 100)}% class + ink: worst ${worst.r.toFixed(2)} (${worst.c}, ${worst.name})`);
}
console.log('sample 60% text colours light/dark:', CLASS.map((c) => `${c}→${toHex(mix(c, T.light.ink, 0.6))}/${toHex(mix(c, T.dark.ink, 0.6))}`).join(' '));
