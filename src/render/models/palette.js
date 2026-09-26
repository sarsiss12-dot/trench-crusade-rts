// Desaturated grimdark palette (sRGB). Faction identity comes from silhouette, equipment and
// subtle accents — never full-body team paint.

export const C = {
  // New Antioch
  coat: [0.34, 0.32, 0.26], coatDark: [0.25, 0.23, 0.19], trousers: [0.3, 0.28, 0.23],
  puttee: [0.32, 0.29, 0.22], boot: [0.11, 0.085, 0.065], leather: [0.27, 0.18, 0.11],
  leatherDark: [0.15, 0.105, 0.075], steel: [0.3, 0.31, 0.32], steelDark: [0.16, 0.165, 0.17],
  brass: [0.55, 0.43, 0.22], wood: [0.36, 0.23, 0.13], woodDark: [0.22, 0.15, 0.09],
  canvas: [0.44, 0.4, 0.31], canvasDark: [0.31, 0.28, 0.21], rubber: [0.17, 0.16, 0.14],
  lens: [0.16, 0.2, 0.17], tabard: [0.52, 0.49, 0.41], crossRed: [0.4, 0.1, 0.075],
  skin: [0.62, 0.48, 0.4], glove: [0.2, 0.15, 0.11], blanket: [0.36, 0.3, 0.24],
  armor: [0.26, 0.26, 0.25], armorEdge: [0.4, 0.38, 0.33], engine: [0.2, 0.19, 0.17],
  rope: [0.45, 0.39, 0.28], cable: [0.12, 0.1, 0.08], plank: [0.38, 0.3, 0.2],
  // Black Grail
  skinPale: [0.41, 0.43, 0.35], skinBruise: [0.3, 0.24, 0.27], skinDead: [0.36, 0.38, 0.32],
  flesh: [0.46, 0.17, 0.15], fleshDark: [0.25, 0.08, 0.08], pus: [0.63, 0.59, 0.31],
  rags: [0.21, 0.19, 0.15], ragsDark: [0.13, 0.12, 0.1], rust: [0.34, 0.2, 0.12],
  chitin: [0.14, 0.12, 0.09], chitinHi: [0.28, 0.24, 0.15], bronze: [0.38, 0.3, 0.16],
  bone: [0.66, 0.62, 0.5], boneDark: [0.46, 0.42, 0.32], grailAccent: [0.5, 0.53, 0.25],
  lensGreen: [0.24, 0.32, 0.13], ichor: [0.06, 0.05, 0.03],
  // world
  stone: [0.42, 0.4, 0.37], stoneDark: [0.3, 0.285, 0.26], brick: [0.37, 0.29, 0.24],
  slate: [0.2, 0.21, 0.23], plaster: [0.5, 0.47, 0.41], soil: [0.3, 0.25, 0.19],
  sandbag: [0.4, 0.36, 0.27], sandbagDark: [0.3, 0.27, 0.2], char: [0.08, 0.07, 0.06],
  treeBark: [0.22, 0.19, 0.16], treeBarkDark: [0.13, 0.11, 0.09], dryGrass: [0.5, 0.46, 0.28],
  wire: [0.2, 0.18, 0.16],
};

export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scale(a, k) {
  return [a[0] * k, a[1] * k, a[2] * k];
}
