/* Prueft die Simulationsmaschine gegen das, was von einem Meinungsmodell
   verlangt werden muss: Reproduzierbarkeit, ein zusammenhaengendes Netz, und
   dass die drei Regime — Konsens, Polarisierung, Zersplitterung — tatsaechlich
   aus den Parametern folgen und nicht behauptet werden.
   Lauf: node src/swarm.test.mjs */
import { run, rng, buildNetwork, metrics, DEFAULT_FACTIONS } from "./swarm.js";

let fails = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${detail ? "  — " + detail : ""}`);
  if (!cond) fails++;
};

/* --- Reproduzierbarkeit ------------------------------------------------- */
const a = run({ seed: 42, n: 200, steps: 60 });
const b = run({ seed: 42, n: 200, steps: 60 });
const c = run({ seed: 43, n: 200, steps: 60 });
ok("gleicher Startwert, gleiches Ergebnis",
   JSON.stringify(a.final) === JSON.stringify(b.final), `mean ${a.final.mean}`);
ok("anderer Startwert, anderes Ergebnis",
   JSON.stringify(a.final) !== JSON.stringify(c.final), `${a.final.mean} vs ${c.final.mean}`);

/* --- Topologie ---------------------------------------------------------- */
for (const kind of ["small-world", "scale-free", "random"]) {
  const r = rng(7);
  const adj = buildNetwork(300, kind, { k: 6, m: 3, beta: 0.1 }, r);
  const isolated = adj.filter(v => v.length === 0).length;
  const deg = adj.map(v => v.length);
  const avg = deg.reduce((s, d) => s + d, 0) / deg.length;
  const max = Math.max(...deg);
  // Symmetrie: jede Kante muss in beide Richtungen stehen, sonst wandern
  // Meinungen einseitig und die Dynamik ist stillschweigend falsch.
  let asym = 0;
  adj.forEach((nbs, i) => nbs.forEach(j => { if (!adj[j].includes(i)) asym++; }));
  ok(`${kind}: keine isolierten Knoten`, isolated === 0, `${isolated}`);
  ok(`${kind}: Kanten symmetrisch`, asym === 0, `${asym} einseitig`);
  ok(`${kind}: mittlerer Grad plausibel`, avg > 1 && avg < 40, `Ø ${avg.toFixed(1)}, max ${max}`);
}
// Skalenfrei muss ausgepraegte Hubs haben, sonst ist es keine.
{
  const r = rng(9);
  const sf = buildNetwork(400, "scale-free", { m: 3 }, r).map(v => v.length);
  const sw = buildNetwork(400, "small-world", { k: 6, beta: 0.1 }, r).map(v => v.length);
  ok("skalenfrei hat Hubs, Kleine-Welt nicht",
     Math.max(...sf) > 3 * Math.max(...sw) / 2, `max ${Math.max(...sf)} vs ${Math.max(...sw)}`);
}

/* --- Die drei Regime ----------------------------------------------------- */
// Weite Konfidenzradien, keine Abstossung, keine Zeloten -> Konsens.
const consensus = run({
  seed: 3, n: 300, steps: 250, repulsion: 0,
  factions: [{ share: 1, opinion: 0, spread: 0.5, confidence: 1.2, stubbornness: 0.2, activity: 0.9, zealots: 0 }],
});
ok("weite Radien fuehren zu Konsens",
   consensus.final.shape === "consensus",
   `${consensus.final.shape}, ${consensus.final.clusters} Gruppe(n)`);

// Zwei entfernte Lager, enge Radien, starke Abstossung -> Polarisierung.
const polarised = run({
  seed: 5, n: 300, steps: 250, repulsion: 0.12, repulsionThreshold: 0.7,
  factions: [
    { share: 0.5, opinion: 0.6, spread: 0.15, confidence: 0.25, stubbornness: 0.4, activity: 0.8, zealots: 0.1 },
    { share: 0.5, opinion: -0.6, spread: 0.15, confidence: 0.25, stubbornness: 0.4, activity: 0.8, zealots: 0.1 },
  ],
});
ok("enge Radien plus Abstossung fuehren zu Polarisierung",
   polarised.final.shape === "polarised",
   `${polarised.final.shape}, Index ${polarised.final.polarisation}`);

// Enge Radien muessen die Population feiner zerlegen als weite. Auf eine feste
// Gruppenzahl zu pruefen waere unredlich: Wie viele Gruppen gezaehlt werden,
// haengt an der Messtoleranz, und die ist eine Konvention. Die Richtung des
// Zusammenhangs ist es nicht — sie ist die eigentliche Aussage des Modells.
const narrow = run({
  seed: 11, n: 400, steps: 250, repulsion: 0,
  factions: [{ share: 1, opinion: 0, spread: 0.6, confidence: 0.08, stubbornness: 0.3, activity: 0.9, zealots: 0 }],
});
const wide = run({
  seed: 11, n: 400, steps: 250, repulsion: 0,
  factions: [{ share: 1, opinion: 0, spread: 0.6, confidence: 0.9, stubbornness: 0.3, activity: 0.9, zealots: 0 }],
});
ok("enge Radien zerlegen feiner als weite",
   narrow.final.clusters > wide.final.clusters,
   `${narrow.final.clusters} vs ${wide.final.clusters} Gruppen`);
ok("die Messtoleranz wird ausgewiesen",
   typeof narrow.final.tolerance === "number" && narrow.final.tolerance < 0.1,
   `Toleranz ${narrow.final.tolerance} bei Konfidenzradius 0.08`);

/* --- Zeloten bewegen sich nicht ----------------------------------------- */
{
  const res = run({
    seed: 21, n: 200, steps: 200,
    factions: [{ share: 1, opinion: -0.9, spread: 0.02, confidence: 2, stubbornness: 0, activity: 1, zealots: 1 }],
  });
  const drift = Math.abs(res.final.mean + 0.9);
  ok("eine Population aus Zeloten bewegt sich nicht", drift < 0.06, `Drift ${drift.toFixed(3)}`);
}

/* --- Der Anstoss wirkt, und zwar begrenzt -------------------------------- */
{
  const base = run({ seed: 31, n: 300, steps: 40, shockStrength: 0 });
  const hit = run({ seed: 31, n: 300, steps: 40, shockStrength: 0.5, shockReach: 0.5, shockValence: 1 });
  ok("ein Anstoss verschiebt die Population", hit.final.mean > base.final.mean + 0.05,
     `${base.final.mean} -> ${hit.final.mean}`);
}

/* --- Anteile und Groessen ------------------------------------------------ */
{
  const res = run({ seed: 4, n: 250, steps: 80 });
  const f = res.final;
  ok("Agentenzahl stimmt", res.agents.length === 250, `${res.agents.length}`);
  ok("Anteile summieren sich zu 1",
     Math.abs(f.support + f.opposition + f.undecided - 1) < 0.005,
     `${(f.support + f.opposition + f.undecided).toFixed(3)}`);
  ok("alle Meinungen im Wertebereich",
     res.agents.every(a => a.x >= -1 && a.x <= 1 && Number.isFinite(a.x)));
  ok("Zeitreihe vorhanden", res.series.length > 10, `${res.series.length} Punkte`);
}

/* --- Groesse: traegt es ueber 100 Agenten hinaus? ------------------------ */
{
  const t0 = Date.now();
  const big = run({ seed: 8, n: 2000, steps: 200, topology: "scale-free", m: 3 });
  const ms = Date.now() - t0;
  ok("2000 Agenten, 200 Schritte laufen durch", big.agents.length === 2000);
  ok("und zwar schnell genug fuer den Browser", ms < 4000, `${ms} ms`);
}

/* --- Die Ueberschrift darf dem Histogramm nicht widersprechen ------------- */
{
  // Genau der Fall, der die Kennzahl auffliegen liess: die Standardpopulation
  // endet mit zwei etwa gleich grossen Lagern und trotzdem ohne Luecke auf dem
  // Meinungsstrahl. Single-Linkage sieht eine Gruppe; "Konsens" waere falsch.
  const res = run({ seed: 1, n: 400, steps: 200 });
  const f = res.final;
  const balanced = Math.min(f.support, f.opposition) > 0.25;
  ok("kein Konsens-Urteil bei zwei grossen Lagern",
     !(balanced && f.shape === "consensus"),
     `${f.shape}: ${Math.round(f.support * 100)}% dafuer, ${Math.round(f.opposition * 100)}% dagegen`);
  ok("Polarisierung wird bei zwei Lagern auch gemessen",
     !balanced || f.polarisation > 0.1, `Index ${f.polarisation}`);
}

console.log(fails === 0 ? "\nalle Pruefungen bestanden" : `\n${fails} Pruefung(en) fehlgeschlagen`);
process.exit(fails ? 1 : 0);
