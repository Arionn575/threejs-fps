// The look plan, in one place. Every colour the game uses lives here, so no
// other colour appears in the code. The same names are the CSS custom
// properties in index.html. Emberline is a desert-industrial yard at dusk:
// warm sandstone, rusted steel, one amber accent, and two team colours.
export const PALETTE = {
  canvas: '#2e2a26',
  surface: '#8a7a63',
  hairline: '#6b5b45',
  ink: '#efe8d8',
  muted: '#9a8f7d',
  accent: '#f0a830',
  rust: '#a85a32',
  sand: '#c9a86a',
  ground: '#5d5044',
  defender: '#4a7ab8',
  attacker: '#e8a33a',
};

export function shade(name) {
  return PALETTE[name];
}
