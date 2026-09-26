// Toggleable debug / performance overlay: FPS, frame + tick cost, draw calls, triangles, shadow
// pass, particles, decals, corpses (gameplay vs visual), squads, soldiers, path cache, clutter.
import { el } from './dom.js';
import { t } from './i18n.js';

export function createDebugOverlay(game) {
  const panel = el('pre.debug');
  (game.hud ? game.hud.root : game.env.root).appendChild(panel);
  let visible = false;
  let acc = 1;
  const hist = new Float32Array(90);
  let hi = 0;

  function setVisible(v) {
    visible = !!v;
    panel.style.display = visible ? 'block' : 'none';
  }

  function update(dt) {
    hist[hi] = dt * 1000;
    hi = (hi + 1) % hist.length;
    if (!visible) return;
    acc += dt;
    if (acc < 0.25) return;
    acc = 0;
    const r = game.renderer, s = game.session, sim = game.sim;
    let worst = 0, sum = 0;
    for (const v of hist) { sum += v; if (v > worst) worst = v; }
    let soldiers = 0, squads = 0;
    const bySide = {};
    for (const sq of sim.state.squads) {
      squads++;
      let n = 0;
      for (const m of sq.members) if (m.state === 'alive') n++;
      soldiers += n;
      bySide[sq.faction] = (bySide[sq.faction] || 0) + n;
    }
    const nav = sim.rt.nav;
    const lines = [
      `${t('debug.title')} — ${game.settings.quality}`,
      `FPS ${game.fps.toFixed(0)}  frame ${(sum / hist.length).toFixed(1)}ms (max ${worst.toFixed(0)})  cpu ${game.frameMs.toFixed(1)}ms`,
      `tick ${s.tickMs.toFixed(2)}ms (max ${s.tickMsMax.toFixed(1)})  ticks/frame ${s.ticksLastFrame}  speed ${s.speed}x`,
      `draw ${r.frameStats.drawCalls} (shadow ${r.frameStats.shadowCalls})  tris ${(r.frameStats.triangles / 1000).toFixed(0)}k`,
      `squads ${squads}  soldiers ${soldiers}  ${Object.entries(bySide).map(([k, v]) => k.slice(0, 2) + ':' + v).join(' ')}`,
      `drawn ${r.units.stats.drawn}  corpses sim ${sim.state.corpses.length} / vis ${r.units.stats.corpses}`,
      `particles ${r.fx.stats.particles}  decals ${r.fx.stats.decals}  clutter ${r.statics.clutter ? r.statics.clutter.stats.drawn : 0}`,
      `paths ${nav && nav.stats ? nav.stats.searches : 0} (cache ${nav && nav.cache ? nav.cache.size : 0})  tick#${sim.state.tick}`,
      `res ${r.width}x${r.height} (${Math.round(r.renderScale * 100)}%)  cam ${game.camera.tx.toFixed(0)},${game.camera.tz.toFixed(0)} d${game.camera.dist.toFixed(0)}  shadow ${r.shadow.size ? r.shadow.size + ' R' + r.shadow.radius : 'off'}`,
    ];
    panel.textContent = lines.join('\n');
  }

  return { setVisible, update, destroy() { panel.remove(); } };
}
