// Heavy frontier compounds: octagonal keeps, broad gates, flat roofs, iron bands. No church parts.
import { MeshBuilder, MAT } from './meshbuilder.js';
import { C } from './palette.js';
const STONE = [0.34, 0.32, 0.25], IRON = [0.13, 0.19, 0.20], TEAL = [0.09, 0.30, 0.28];
function tower(mb, x, z, r, h) {
  mb.push(x, 0, z).col(STONE, MAT.STONE).lathe([[r * 1.1, 0], [r, h], [r * 1.08, h], [r * 1.08, h + 0.45]], 8);
  mb.col(IRON, MAT.DARKMETAL).push(0, h * 0.62, 0).cyl(r * 1.03, r * 1.03, 0.26, 8).pop();
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; mb.col(STONE, MAT.STONE).push(Math.sin(a) * r, h + 0.8, Math.cos(a) * r, 0, a, 0).box(r * 0.56, 0.7, 0.4).pop(); }
  mb.pop();
}
function compound(lod, field) {
  const mb = new MeshBuilder({ lod, seed: field ? 560 : 561 });
  const w = field ? 13 : 19, d = field ? 9 : 15, h = field ? 3.1 : 4.3;
  mb.col(STONE, MAT.STONE).push(0, 0.25, 0).box(w, 0.5, d, { bevel: 0.2 }).pop();
  for (const x of [-w / 2 + 0.8, w / 2 - 0.8]) mb.push(x, h / 2, 0).box(1.5, h, d - 1).pop();
  mb.push(0, h / 2, -d / 2 + 0.7).box(w, h, 1.4).pop();
  for (const s of [-1, 1]) mb.push(s * (w / 4 + 1), h / 2, d / 2 - 0.7).box(w / 2 - 2.8, h, 1.4).pop();
  // Wide iron gate and overhead lintel, not a nave / apse / steeple.
  mb.col(IRON, MAT.DARKMETAL).push(0, 1.6, d / 2 - 0.6).box(4.5, 3.2, 0.4).pop();
  mb.col(STONE, MAT.STONE).push(0, h + 0.2, d / 2 - 0.7).box(6.2, 0.9, 2).pop();
  for (const s of [-1, 1]) tower(mb, s * (w / 2 - 1.7), d / 2 - 1.7, field ? 1.35 : 1.8, h + 0.6);
  tower(mb, 0, -1.3, field ? 2.6 : 4.2, field ? 4.1 : 6.2);
  mb.col(TEAL, MAT.CLOTH).push(0, h + 0.2, d / 2 + 0.35).box(1.2, 1.8, 0.06).pop();
  if (!lod) for (let x = -1.6; x < 2; x += 0.8) mb.col(C.brass, MAT.METAL).push(x, 1.6, d / 2 - 0.34).box(0.09, 2.7, 0.04).pop();
  return mb.finish();
}
function node(lod, kind) {
  const mb = new MeshBuilder({ lod, seed: 570 });
  const defense = kind === 'redoubt' || kind === 'battery';
  const w = defense ? 5.6 : kind === 'muster' ? 11 : 8.5, d = defense ? 5.6 : 7;
  mb.col(STONE, MAT.STONE).push(0, 1.4, 0).box(w, 2.8, d, { bevel: 0.18, taper: [0.92, 0.92] }).pop();
  mb.col(IRON, MAT.DARKMETAL).push(0, 2.9, 0).box(w + 0.3, 0.35, d + 0.3).pop();
  mb.col(TEAL, MAT.CLOTH).push(-w * 0.3, 2.2, d / 2 + 0.03).box(0.7, 1.3, 0.06).pop();
  mb.col(C.char, MAT.DARKMETAL).push(0, 1, d / 2 + 0.03).box(2.3, 2, 0.07).pop();
  if (defense) {
    tower(mb, 0, 0, 1.7, 3.3);
    mb.col(IRON, MAT.DARKMETAL).cylBetween([0, 3.5, 1], [0, 3.5, kind === 'battery' ? 4.1 : 3.1], kind === 'battery' ? 0.22 : 0.12, 0.12, 8);
  } else if (kind === 'laboratory') {
    for (const x of [-2.2, 2.2]) mb.col(C.brass, MAT.METAL).push(x, 3, 0).lathe([[0.8, 0], [0.8, 1.8], [0.35, 2.4], [0.25, 3.2]], 10).pop();
    mb.col(TEAL, MAT.GLASS).push(0, 3.65, 0).sphere(1, 0.75, 1, 10, 6).pop();
  } else if (kind === 'sapper' || kind === 'arsenal') {
    mb.col(C.steel, MAT.METAL).push(0, 4, 0).box(5, 0.24, 0.3).pop();
    for (const x of [-2.3, 2.3]) mb.push(x, 3.5, 0).box(0.25, 2.3, 0.3).pop();
    mb.col(C.brass, MAT.METAL).push(0, 3.45, 0).cyl(0.5, 0.5, 0.7, 8).pop();
  } else if (kind === 'supply') {
    for (const x of [-2, 0, 2]) mb.col(C.canvas, MAT.CLOTH).push(x, 3.35, -0.4).box(1.5, 0.6, 2, { bevel: 0.15 }).pop();
  } else tower(mb, -3.6, -1.5, 1.1, 4);
  return mb.finish();
}
export const STRUCTURE_MODELS_SULTANATE = {
  sultanate_citadel: (lod) => compound(lod, false), sultanate_field_hq: (lod) => compound(lod, true),
  sapper_post: (lod) => node(lod, 'sapper'), sultanate_muster: (lod) => node(lod, 'muster'),
  sultanate_supply: (lod) => node(lod, 'supply'), sultanate_arsenal: (lod) => node(lod, 'arsenal'),
  jabirean_laboratory: (lod) => node(lod, 'laboratory'), sultanate_redoubt: (lod) => node(lod, 'redoubt'),
  sultanate_battery: (lod) => node(lod, 'battery'),
};
