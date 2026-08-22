/*
 * Was man mit einem Lauf allein nicht beantworten kann.
 *
 * Ein einzelner Lauf ist eine Anekdote: ein Startwert, eine Parameterwahl, ein
 * Ergebnis. Die interessanten Fragen sind andere — wo kippt das Regime, haelt
 * der Befund ueber Startwerte hinweg, welche Massnahme wirkt, und laesst sich
 * das Modell ueberhaupt auf beobachtete Daten festlegen. Genau dafuer ist
 * dieses Modul da. Es rechnet nur; es deutet nichts.
 */

import { run } from "./swarm.js";

/* Parameter, die auf jede Fraktion gleich wirken, gegen solche, die global
   gelten. Der Unterschied ist kein Detail: Wer den Konfidenzradius variiert,
   verschiebt eine Eigenschaft von Menschen; wer die Topologie variiert,
   verschiebt die Welt, in der sie sich begegnen. */
export const FACTION_AXES = ["confidence", "stubbornness", "activity", "zealots", "spread"];
export const GLOBAL_AXES = ["repulsion", "repulsionThreshold", "convergence", "beta", "k", "m",
                            "shockStrength", "shockReach", "shockValence", "n", "steps"];

export const AXIS_RANGE = {
  confidence: [0.05, 1.0], stubbornness: [0, 0.95], activity: [0.05, 1],
  zealots: [0, 0.5], spread: [0.02, 0.6],
  repulsion: [0, 0.3], repulsionThreshold: [0.3, 2], convergence: [0.02, 0.5],
  beta: [0, 1], k: [2, 20], m: [1, 8],
  shockStrength: [0, 1], shockReach: [0, 1], shockValence: [-1, 1],
  n: [50, 2000], steps: [40, 600],
};

/** Einen Parameterwert in eine Konfiguration einsetzen. */
export function withAxis(cfg, axis, value) {
  if (FACTION_AXES.includes(axis)) {
    return { ...cfg, factions: (cfg.factions || []).map(f => ({ ...f, [axis]: value })) };
  }
  return { ...cfg, [axis]: axis === "n" || axis === "steps" || axis === "k" || axis === "m"
    ? Math.round(value) : value };
}

const MEASURES = ["polarisation", "support", "opposition", "undecided", "mean", "clusters"];

function summarise(runs) {
  const out = {};
  for (const key of MEASURES) {
    const vals = runs.map(r => r[key]).sort((a, b) => a - b);
    out[key] = {
      median: +vals[Math.floor(vals.length / 2)].toFixed(3),
      lo: +vals[Math.floor(vals.length * 0.1)].toFixed(3),
      hi: +vals[Math.floor(vals.length * 0.9)].toFixed(3),
    };
  }
  const shapes = {};
  for (const r of runs) shapes[r.shape] = (shapes[r.shape] || 0) + 1;
  const ranked = Object.entries(shapes).sort((a, b) => b[1] - a[1]);
  out.shapes = shapes;
  out.dominantShape = ranked[0][0];
  out.agreement = +(ranked[0][1] / runs.length).toFixed(3);
  return out;
}

/* ------------------------------------------------------------ 1. Sweep ---- */

/**
 * Eine Achse abfahren und an jedem Punkt mehrere Startwerte rechnen.
 *
 * Das beantwortet die Frage, die ein Einzellauf offen laesst: nicht "was
 * passiert", sondern "ab wo passiert etwas anderes". Die Kippstelle ist der
 * eigentliche Befund — sie sagt, wie weit die eigene Annahme danebenliegen
 * darf, bevor die Schlussfolgerung eine andere ist.
 */
export function sweep(base, { axis, from, to, points = 21, seeds = 8, onProgress } = {}) {
  const [lo, hi] = AXIS_RANGE[axis] || [0, 1];
  from = from ?? lo; to = to ?? hi;
  const grid = [];
  for (let i = 0; i < points; i++) {
    // points === 1 ist der stueckweise Aufruf aus der Oberflaeche; ohne
    // diese Fallunterscheidung teilt der Ausdruck durch null.
    const value = points === 1 ? from : from + ((to - from) * i) / (points - 1);
    const runs = [];
    for (let s = 0; s < seeds; s++) {
      runs.push(run({ ...withAxis(base, axis, value), seed: 1000 + s }).final);
    }
    grid.push({ value: +value.toFixed(4), ...summarise(runs) });
    onProgress?.((i + 1) / points);
  }

  // Kippstellen: benachbarte Punkte mit verschiedenem vorherrschendem Regime.
  const transitions = [];
  for (let i = 1; i < grid.length; i++) {
    if (grid[i].dominantShape !== grid[i - 1].dominantShape) {
      transitions.push({
        at: +((grid[i].value + grid[i - 1].value) / 2).toFixed(4),
        from: grid[i - 1].dominantShape, to: grid[i].dominantShape,
      });
    }
  }
  return { axis, from, to, points, seeds, grid, transitions };
}

/* ------------------------------------------------- 2. Startwert-Robustheit -- */

/**
 * Denselben Aufbau ueber viele Startwerte rechnen.
 *
 * Ein stochastisches Modell liefert bei jedem Startwert ein etwas anderes
 * Ergebnis. Ob ein Befund traegt, entscheidet sich daran, wie oft er
 * wiederkommt — nicht daran, wie ueberzeugend der eine Lauf aussah, den man
 * zufaellig gesehen hat. Faellt die Uebereinstimmung unter etwa zwei Drittel,
 * ist "das Ergebnis" keine Aussage ueber die Population, sondern ueber den
 * Wuerfel.
 */
export function robustness(cfg, { seeds = 24, onProgress } = {}) {
  const runs = [];
  for (let s = 0; s < seeds; s++) {
    runs.push(run({ ...cfg, seed: 1000 + s }).final);
    onProgress?.((s + 1) / seeds);
  }
  const sum = summarise(runs);
  return {
    seeds, ...sum,
    verdict: sum.agreement >= 0.8 ? "robust"
      : sum.agreement >= 0.6 ? "mixed" : "unstable",
    runs,
  };
}

/* ------------------------------------------------------- 3. Vergleich ----- */

/**
 * Zwei Aufbauten gegeneinander, ueber dieselben Startwerte.
 *
 * Paarweise, nicht unabhaengig: Beide Varianten bekommen denselben Startwert,
 * sodass der Unterschied die Massnahme misst und nicht den Zufall. Genau daran
 * scheitern die meisten Vorher-Nachher-Vergleiche.
 */
export function compare(a, b, { seeds = 16, onProgress } = {}) {
  const pairs = [];
  for (let s = 0; s < seeds; s++) {
    const seed = 1000 + s;
    pairs.push({
      seed,
      a: run({ ...a, seed }).final,
      b: run({ ...b, seed }).final,
    });
    onProgress?.((s + 1) / seeds);
  }
  const deltas = {};
  for (const key of MEASURES) {
    const d = pairs.map(p => p.b[key] - p.a[key]).sort((x, y) => x - y);
    const median = d[Math.floor(d.length / 2)];
    const positive = d.filter(v => v > 0).length;
    deltas[key] = {
      median: +median.toFixed(3),
      lo: +d[0].toFixed(3), hi: +d[d.length - 1].toFixed(3),
      // Anteil der Startwerte, bei denen die Massnahme in dieselbe Richtung
      // wirkt. Ein Median ohne diese Angabe verschweigt, ob die Wirkung
      // verlaesslich ist oder nur im Mittel.
      consistency: +(Math.max(positive, d.length - positive) / d.length).toFixed(3),
    };
  }
  return {
    seeds, deltas, pairs,
    shapeA: summarise(pairs.map(p => p.a)).dominantShape,
    shapeB: summarise(pairs.map(p => p.b)).dominantShape,
  };
}

/* Eine Kalibrierung gegen beobachtete Verlaeufe fehlt hier bewusst. Der Fitter
   waere schnell geschrieben — die Daten sind es nicht. Ohne einen dokumentierten
   Fall, dessen Verlauf man kennt, wuerde er Parameter an erfundene Zahlen
   anpassen und ein Ergebnis liefern, das nach Messung aussieht und keine ist.
   Sobald ein solcher Fall vorliegt, gehoert er hierher. */

/* ------------------------------------------- 4. Layout fuer die Ansicht ---- */

/**
 * Kraftbasiertes Layout (Fruchterman/Reingold, gekuerzt) fuer die
 * Netzansicht. Deterministisch bei gleichem Startwert, damit dasselbe Netz
 * zweimal gleich aussieht — sonst vergleicht das Auge Zufallsanordnungen.
 */
export function layout(adj, { iterations = 160, seed = 7, width = 1, height = 1 } = {}) {
  const n = adj.length;
  let z = seed >>> 0;
  const rnd = () => ((z = (z * 1664525 + 1013904223) >>> 0) / 4294967296);
  const px = new Float64Array(n), py = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
    px[i] = 0.5 + Math.cos(a) * r * 0.45; py[i] = 0.5 + Math.sin(a) * r * 0.45;
  }
  const area = 1, k = Math.sqrt(area / n) * 1.6;
  const dx = new Float64Array(n), dy = new Float64Array(n);
  // Bei vielen Knoten wird die Abstossung auf eine Stichprobe beschraenkt:
  // n^2 waere bei 2000 Knoten pro Iteration vier Millionen Paare.
  const sampleRepulsion = n > 400;

  for (let it = 0; it < iterations; it++) {
    dx.fill(0); dy.fill(0);
    for (let i = 0; i < n; i++) {
      const reps = sampleRepulsion ? 24 : n;
      for (let s = 0; s < reps; s++) {
        const j = sampleRepulsion ? Math.floor(rnd() * n) : s;
        if (i === j) continue;
        let ex = px[i] - px[j], ey = py[i] - py[j];
        let d2 = ex * ex + ey * ey; if (d2 < 1e-6) { ex = rnd() * 1e-3; ey = rnd() * 1e-3; d2 = 1e-6; }
        const f = (k * k) / d2 * (sampleRepulsion ? n / 24 : 1) * 0.35;
        dx[i] += ex * f; dy[i] += ey * f;
      }
    }
    for (let i = 0; i < n; i++) {
      for (const j of adj[i]) {
        if (j < i) continue;
        const ex = px[i] - px[j], ey = py[i] - py[j];
        const d = Math.sqrt(ex * ex + ey * ey) || 1e-4;
        const f = (d * d) / k * 0.8;
        const ux = (ex / d) * f, uy = (ey / d) * f;
        dx[i] -= ux; dy[i] -= uy; dx[j] += ux; dy[j] += uy;
      }
    }
    const t = 0.06 * (1 - it / iterations) + 0.002;
    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1;
      px[i] = Math.min(1, Math.max(0, px[i] + (dx[i] / d) * Math.min(d, t)));
      py[i] = Math.min(1, Math.max(0, py[i] + (dy[i] / d) * Math.min(d, t)));
    }
  }
  return { x: Array.from(px, v => v * width), y: Array.from(py, v => v * height) };
}
