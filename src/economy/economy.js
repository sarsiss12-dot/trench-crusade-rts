// Generic resource helpers. Resource *sources* are faction-specific (factions/*.js):
// New Antioch = logistics (material/supply/manpower/food), Black Grail = plague (biomass).

export function canAfford(resources, cost) {
  if (!cost) return true;
  for (const k in cost) if ((resources[k] || 0) + 1e-9 < cost[k]) return false;
  return true;
}

export function pay(resources, cost) {
  if (!cost) return;
  for (const k in cost) resources[k] = (resources[k] || 0) - cost[k];
}

export function refund(resources, cost, fraction = 1) {
  if (!cost) return;
  for (const k in cost) resources[k] = (resources[k] || 0) + Math.floor(cost[k] * fraction);
}

/** Linear structure cost for a length (rounded up per resource). */
export function linearCost(costPerM, length) {
  const c = {};
  for (const k in costPerM) c[k] = Math.ceil(costPerM[k] * length);
  return c;
}

/** Diminishing returns for n workers: n^0.75 using exact sqrt (deterministic). */
export function workEfficiency(n) {
  if (n <= 0) return 0;
  const r = Math.sqrt(n);
  return r * Math.sqrt(r);
}
