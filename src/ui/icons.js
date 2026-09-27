// Inline SVG icon set (24x24, currentColor). Drawn for this project — no external assets.
const S = (body, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${body}</svg>`;
const st = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

export const ICONS = {
  // units
  rifle: S(`<path ${st} d="M3 16 L17 6 M15 5 l3 3 M6 14 l2 3 M17 6 l3 -2"/><circle cx="7.5" cy="16.5" r="1.4" fill="currentColor"/>`),
  engineer: S(`<path ${st} d="M5 19 L13 11 M11 9 a4 4 0 1 1 4 4 M14.5 9.5 l2-2"/><path ${st} d="M4 7 h6 M7 4 v6"/>`),
  heavy: S(`<path ${st} d="M8 3 h8 l1 5 h-10 z M6 9 h12 v6 l-3 5 h-6 l-3 -5 z M10 12 h4"/>`),
  thrall: S(`<path ${st} d="M12 4 a3 3 0 1 1 0 .1 M8 21 l2-7 -3-3 M16 21 l-2-7 3-3 M10 14 h4 M7 11 l-3 2 M17 11 l3 2"/>`),
  guard: S(`<path ${st} d="M12 3 a3 3 0 1 1 0 .1 M7 21 v-9 l5-3 5 3 v9 M9 12 h6 M18 8 l3-2 v6 l-3 1"/>`),
  knight: S(`<path ${st} d="M12 2 l3 4 v4 h-6 v-4 z M6 12 h12 l-2 9 h-8 z M4 8 l3 4 M20 8 l-3 4"/>`),
  gang: S(`<path ${st} d="M7 5 a2.2 2.2 0 1 1 0 .1 M15 7 a2.2 2.2 0 1 1 0 .1 M4 20 l2-6 3 1 3-3 M12 20 l2-5 3 1 3-2 M6 14 l-2-2 M10 11 h6"/>`),
  // structures
  low_sandbags: S(`<path ${st} d="M3 18 h18 M4 18 c0-3 7-3 7 0 M13 18 c0-3 7-3 7 0"/>`),
  breastwork: S(`<path ${st} d="M2 19 h20 M4 19 l3-6 h10 l3 6 M7 13 v-3 M12 13 v-4 M17 13 v-3"/>`),
  timber_wall: S(`<path ${st} d="M3 19 h18 M5 19 v-9 M19 19 v-9 M3 10 h18 M7 15 c0-2 4-2 4 0 M13 15 c0-2 4-2 4 0"/>`),
  fortified_wall: S(`<path ${st} d="M3 20 v-12 h3 v2 h3 v-2 h3 v2 h3 v-2 h3 v2 h3 v10 z M3 14 h18 M10 20 v-3 h4 v3"/>`),
  aid_station: S(`<path ${st} d="M3 19 l9-12 9 12 z"/><path ${st} stroke-width="2.4" d="M12 10 v7 M9 13 h6"/>`),
  workshop: S(`<path ${st} d="M3 20 v-9 l9-5 9 5 v9 M8 20 v-5 h8 v5 M16 8 v-4 h2 v5"/>`),
  ammo_dump: S(`<path ${st} d="M4 20 h16 M6 20 v-9 l1.5-4 1.5 4 v9 M11 20 v-9 l1.5-4 1.5 4 v9 M16 20 v-9 l1.5-4 1.5 4 v9"/>`),
  signal_post: S(`<path ${st} d="M12 21 v-17 M7 6 h10 M8 9 h8 M12 13 l6 3 M18 14 v4"/>`),
  muster_point: S(`<path ${st} d="M6 21 v-17 M6 4 h10 v7 h-10 M3 21 h18 M10 6 v3 M8.5 7.5 h3"/>`),
  corpse_mound: S(`<path ${st} d="M3 19 c2-8 16-8 18 0 z M7 15 a1.5 1.5 0 1 1 0 .1 M12 12 h5 M10 16 h6"/>`),
  plague_pit: S(`<ellipse cx="12" cy="16" rx="8" ry="3" ${st}/><path ${st} d="M5 15 c1-6 4-9 7-9 s6 3 7 9 M12 6 v-2 M10 13 a1 1 0 1 1 0 .1 M14 14 a1 1 0 1 1 0 .1"/>`),
  fly_nest: S(`<path ${st} d="M12 3 c4 5 5 11 3 18 h-6 c-2-7 -1-13 3-18 z M11 10 a1 1 0 1 1 0 .1 M13 14 a1 1 0 1 1 0 .1 M18 6 l2-1 M19 9 l2 1"/>`),
  bone_barricade: S(`<path ${st} d="M3 19 h18 M5 19 l3-9 M10 19 l2-11 M15 19 l2-9 M19 19 l1-6 M6 9 a1.2 1.2 0 1 1 0 .1 M12 7 a1.2 1.2 0 1 1 0 .1"/>`),
  mortar_barrage: S(`<path ${st} d="M6 20 l5-9 M9 11 l4 2 M4 20 h8 M15 5 a1.5 1.5 0 1 1 0 .1 M19 9 a1.5 1.5 0 1 1 0 .1 M16 13 a1.5 1.5 0 1 1 0 .1"/>`),
  infection: S(`<circle cx="12" cy="12" r="4" ${st}/><path ${st} d="M12 3 v5 M12 16 v5 M3 12 h5 M16 12 h5 M6 6 l3 3 M15 15 l3 3 M18 6 l-3 3 M6 18 l3-3"/>`),
  trench: S(`<path ${st} d="M2 9 h5 l2 6 h6 l2 -6 h5 M9 15 v3 M15 15 v3 M4 7 h3 M17 7 h3"/>`),
  sandbags: S(`<path ${st} d="M3 18 h18 M4 18 c0-3 7-3 7 0 M13 18 c0-3 7-3 7 0 M8 14 c0-3 7-3 7 0"/>`),
  wire: S(`<path ${st} d="M3 12 c2-4 4 4 6 0 s4 4 6 0 s4 4 6 0 M5 6 v12 M19 6 v12 M11 10 l2 4 M13 10 l-2 4"/>`),
  fire_post: S(`<path ${st} d="M3 19 h18 v-6 h-18 z M6 13 v-3 h12 v3 M12 10 l7 -5"/>`),
  observation_post: S(`<path ${st} d="M8 21 l2-12 h4 l2 12 M7 9 h10 l-1-4 h-8 z M9 15 h6"/>`),
  supply_cache: S(`<path ${st} d="M4 9 h16 v10 h-16 z M4 9 l3-4 h10 l3 4 M9 13 h6 M12 11 v4"/>`),
  bastion: S(`<path ${st} d="M4 21 v-8 l2-2 v-3 h3 v3 l3-4 3 4 v-3 h3 v3 l2 2 v8 z M12 3 v4 M10 5 h4"/>`),
  altar: S(`<path ${st} d="M6 21 l2-9 h8 l2 9 M9 12 c-4-2-4-7 0-8 M15 12 c4-2 4-7 0-8 M12 12 v-9"/>`),
  depot: S(`<path ${st} d="M3 11 l9-6 9 6 v9 h-18 z M9 20 v-5 h6 v5"/>`),
  // commands
  stop: S(`<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>`),
  attack_move: S(`<path ${st} d="M4 20 L14 10 M10 6 h8 v8 M4 4 l4 4 M16 20 l4-4"/>`),
  attack: S(`<path ${st} d="M5 19 L19 5 M15 5 h4 v4 M5 5 l14 14 M5 15 v4 h4"/>`),
  move: S(`<path ${st} d="M12 3 v18 M3 12 h18 M12 3 l-3 3 M12 3 l3 3 M21 12 l-3-3 M21 12 l-3 3"/>`),
  formation: S(`<circle cx="6" cy="8" r="1.6" fill="currentColor"/><circle cx="12" cy="8" r="1.6" fill="currentColor"/><circle cx="18" cy="8" r="1.6" fill="currentColor"/><circle cx="9" cy="15" r="1.6" fill="currentColor"/><circle cx="15" cy="15" r="1.6" fill="currentColor"/>`),
  reinforce: S(`<path ${st} d="M12 4 v10 M7 9 l5-5 5 5 M5 20 h14"/>`),
  repair: S(`<path ${st} d="M14 6 a4 4 0 0 0 5 5 l-8 8 a2 2 0 0 1 -3 -3 l8 -8 a4 4 0 0 0 -2 -2 z"/>`),
  gather: S(`<path ${st} d="M4 20 l6-8 4 3 6-9 M16 6 h4 v4"/>`),
  build: S(`<path ${st} d="M3 21 h18 M6 21 v-8 h12 v8 M9 13 v-4 h6 v4 M12 9 v-5"/>`),
  deselect: S(`<path ${st} d="M6 6 l12 12 M18 6 l-12 12"/>`),
  box: S(`<rect x="4" y="4" width="16" height="16" rx="1" ${st} stroke-dasharray="3 2.5"/>`),
  multi: S(`<rect x="3" y="7" width="11" height="11" rx="1" ${st}/><path ${st} d="M8 3 h12 v12"/>`),
  all: S(`<circle cx="6" cy="12" r="2.2" fill="currentColor"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><circle cx="18" cy="12" r="2.2" fill="currentColor"/><path ${st} d="M3 18 h18 M3 6 h18"/>`),
  home: S(`<path ${st} d="M4 11 l8-7 8 7 M6 10 v10 h12 v-10 M10 20 v-6 h4 v6"/>`),
  rally: S(`<path ${st} d="M6 21 v-18 M6 4 h11 l-3 4 3 4 h-11"/>`),
  cancel: S(`<path ${st} d="M6 6 l12 12 M18 6 l-12 12"/>`),
  confirm: S(`<path ${st} stroke-width="2.4" d="M4 12 l5 5 11 -11"/>`),
  rotate: S(`<path ${st} d="M19 12 a7 7 0 1 1 -2 -5 M19 3 v5 h-5"/>`),
  // abilities
  artillery_barrage: S(`<path ${st} d="M3 18 l9-5 M12 13 l2 2 M4 21 h8 M16 4 l1 3 M20 6 l-2 2 M19 11 l-3 -1"/><circle cx="17" cy="16" r="3" ${st}/>`),
  fly_swarm: S(`<ellipse cx="12" cy="13" rx="3" ry="4.5" ${st}/><path ${st} d="M9 11 c-5 -4 -7 1 -3 3 M15 11 c5 -4 7 1 3 3 M12 8.5 v-3 M10 5 l2 1 2-1"/>`),
  // resources
  material: S(`<path ${st} d="M3 17 l6-3 6 3 6-3 M3 12 l6-3 6 3 6-3 M3 17 v-5 M21 14 v-5"/>`),
  supply: S(`<path ${st} d="M5 8 h14 v12 h-14 z M9 8 v-3 h6 v3 M5 13 h14"/>`),
  manpower: S(`<circle cx="9" cy="8" r="3" ${st}/><path ${st} d="M3 20 c0-5 12-5 12 0 M16 5 a3 3 0 0 1 0 6 M18 14 c2 1 3 3 3 6"/>`),
  food: S(`<path ${st} d="M12 21 v-10 M12 11 c-4 0 -6 -3 -6 -7 c4 0 6 3 6 7 c0 -4 2 -7 6 -7 c0 4 -2 7 -6 7"/>`),
  biomass: S(`<path ${st} d="M12 3 c5 5 7 9 7 12 a7 7 0 0 1 -14 0 c0 -3 2 -7 7 -12 z M10 15 a2 2 0 0 0 4 0"/>`),
  corpse: S(`<path ${st} d="M3 17 h18 M5 17 l3 -4 h7 l2 4 M8 13 a2 2 0 1 1 0 .1"/>`),
  ammo: S(`<path ${st} d="M7 21 v-11 l2 -5 2 5 v11 z M13 21 v-11 l2 -5 2 5 v11 z"/>`),
  cover: S(`<path ${st} d="M12 3 l8 3 v6 c0 5 -4 8 -8 9 c-4 -1 -8 -4 -8 -9 v-6 z"/>`),
  // system
  pause: S(`<rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/>`),
  play: S(`<path d="M7 4 v16 l13 -8 z" fill="currentColor"/>`),
  menu: S(`<path ${st} d="M4 7 h16 M4 12 h16 M4 17 h16"/>`),
  eye: S(`<path ${st} d="M2 12 c4 -7 16 -7 20 0 c-4 7 -16 7 -20 0 z"/><circle cx="12" cy="12" r="3" fill="currentColor"/>`),
  sound: S(`<path ${st} d="M4 9 h4 l5 -4 v14 l-5 -4 h-4 z M16 9 a4 4 0 0 1 0 6 M18.5 6.5 a8 8 0 0 1 0 11"/>`),
  save: S(`<path ${st} d="M5 4 h11 l3 3 v13 h-14 z M8 4 v5 h7 v-5 M8 20 v-6 h8 v6"/>`),
  bug: S(`<ellipse cx="12" cy="13" rx="4.5" ry="6" ${st}/><path ${st} d="M12 7 v12 M7.5 11 h-4 M20.5 11 h-4 M7.5 16 h-4 M20.5 16 h-4 M9 5 l-2 -2 M15 5 l2 -2"/>`),
  cross: S(`<path ${st} stroke-width="2.4" d="M12 3 v18 M6 8 h12"/>`),
  grail: S(`<path ${st} d="M6 4 h12 c0 6 -3 9 -6 9 s-6 -3 -6 -9 z M12 13 v5 M8 21 h8 M9 18 h6"/>`),
};

export function icon(name, cls = '') {
  const svg = ICONS[name] || ICONS.cross;
  return `<span class="ico ${cls}">${svg}</span>`;
}

/** Icon name for a unit / structure / ability id (data-driven where the data declares icons). */
export function iconForUnit(def) {
  return def.icon || 'rifle';
}

export function iconForStructure(id) {
  const map = { grail_altar: 'altar', supply_depot: 'depot', field: 'food' };
  if (!ICONS[map[id] || id]) return 'build';
  return map[id] || id;
}
