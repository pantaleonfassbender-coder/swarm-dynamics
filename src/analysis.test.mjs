/* Prueft die Analyseschicht: findet der Sweep die Kippstelle, erkennt die
   Robustheitspruefung einen wackeligen Aufbau, misst der Vergleich die
   Massnahme statt des Zufalls, und ist das Layout brauchbar.
   Lauf: node src/analysis.test.mjs */
import { sweep, robustness, compare, layout, withAxis } from "./analysis.js";
import { buildNetwork, rng, DEFAULT_FACTIONS, run } from "./swarm.js";

let fails = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${detail ? "  — " + detail : ""}`);
  if (!cond) fails++;
};

const BASE = { n: 250, steps: 150, factions: DEFAULT_FACTIONS };

/* --- withAxis trennt Fraktions- von globalen Parametern ------------------ */
{
  const f = withAxis(BASE, "confidence", 0.9);
  ok("Fraktionsachse wirkt auf alle Fraktionen",
     f.factions.every(x => x.confidence === 0.9) && f.confidence === undefined);
  const g = withAxis(BASE, "repulsion", 0.2);
  ok("globale Achse wirkt global",
     g.repulsion === 0.2 && g.factions === BASE.factions);
  ok("ganzzahlige Achsen werden gerundet", withAxis(BASE, "n", 313.7).n === 314);
}

/* --- 1. Sweep: findet er die Kippstelle? -------------------------------- */
{
  // Der Konfidenzradius ist der Parameter, an dem das Regime haengt: eng heisst
  // getrennte Lager, weit heisst Konsens. Der Sweep muss diesen Uebergang
  // finden, sonst leistet er nichts.
  const sw = sweep(BASE, { axis: "confidence", from: 0.1, to: 1.0, points: 13, seeds: 5 });
  ok("Sweep liefert das ganze Gitter", sw.grid.length === 13, `${sw.grid.length} Punkte`);
  ok("jeder Punkt traegt Streuung ueber Startwerte",
     sw.grid.every(g => g.polarisation.lo <= g.polarisation.median && g.polarisation.median <= g.polarisation.hi));

  const first = sw.grid[0], last = sw.grid[sw.grid.length - 1];
  ok("enge Radien polarisieren staerker als weite",
     first.polarisation.median > last.polarisation.median,
     `${first.polarisation.median} bei 0.10 vs ${last.polarisation.median} bei 1.00`);
  ok("mindestens eine Kippstelle gefunden", sw.transitions.length >= 1,
     sw.transitions.map(t => `${t.from}->${t.to} @ ${t.at}`).join(", ") || "keine");

  // Ein Sweep ueber eine wirkungslose Achse darf keine Kippstelle erfinden.
  const flat = sweep(BASE, { axis: "shockValence", from: 0, to: 0, points: 5, seeds: 4 });
  ok("konstante Achse erzeugt keine Scheinuebergaenge", flat.transitions.length === 0,
     `${flat.transitions.length}`);
}

/* --- 2. Robustheit ------------------------------------------------------ */
{
  // Ein klar bestimmter Aufbau muss ueber Startwerte hinweg stabil sein.
  const stable = robustness({
    ...BASE, repulsion: 0,
    factions: [{ share: 1, opinion: 0, spread: 0.3, confidence: 1.2, stubbornness: 0.2, activity: 0.9, zealots: 0 }],
  }, { seeds: 16 });
  ok("eindeutiger Aufbau gilt als robust",
     stable.verdict === "robust" && stable.agreement >= 0.8,
     `${stable.verdict}, Uebereinstimmung ${stable.agreement}`);

  ok("Robustheit meldet die Streuung mit",
     stable.polarisation.hi >= stable.polarisation.lo && stable.runs.length === 16);

  // Und der Zaehler muss zur Zahl der Laeufe passen.
  const total = Object.values(stable.shapes).reduce((s, v) => s + v, 0);
  ok("Regimezaehlung summiert sich auf die Laufzahl", total === 16, `${total}`);
}

/* --- 3. Vergleich: misst er die Massnahme oder den Zufall? --------------- */
{
  const a = { ...BASE, shockStrength: 0.1, shockReach: 0.2 };
  const b = { ...BASE, shockStrength: 0.9, shockReach: 0.9 };
  const cmp = compare(a, b, { seeds: 12 });
  ok("Vergleich rechnet paarweise ueber dieselben Startwerte",
     cmp.pairs.length === 12 && cmp.pairs.every(p => p.a && p.b));
  ok("ein starker Anstoss hebt die Zustimmung",
     cmp.deltas.support.median > 0, `Median ${cmp.deltas.support.median}`);
  ok("und wirkt ueber die Startwerte hinweg gleichgerichtet",
     cmp.deltas.support.consistency >= 0.75, `${cmp.deltas.support.consistency}`);

  // Zwei identische Aufbauten duerfen keinen Unterschied zeigen. Das ist die
  // Nullprobe: faende der Vergleich hier etwas, waere er kaputt.
  const same = compare(BASE, { ...BASE }, { seeds: 8 });
  ok("identische Aufbauten ergeben keinen Unterschied",
     Object.values(same.deltas).every(d => d.median === 0 && d.lo === 0 && d.hi === 0),
     `Median support ${same.deltas.support.median}`);
}

/* --- 4. Layout ---------------------------------------------------------- */
{
  const r = rng(3);
  const adj = buildNetwork(220, "scale-free", { m: 3 }, r);
  const t0 = Date.now();
  const pos = layout(adj, { iterations: 120, seed: 5 });
  const ms = Date.now() - t0;
  ok("Layout liefert eine Position je Knoten",
     pos.x.length === 220 && pos.y.length === 220);
  ok("alle Positionen sind endlich und im Bild",
     pos.x.every(v => Number.isFinite(v) && v >= 0 && v <= 1) &&
     pos.y.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
  ok("Layout ist deterministisch",
     JSON.stringify(layout(adj, { iterations: 120, seed: 5 }).x) === JSON.stringify(pos.x));
  ok("Knoten liegen nicht alle aufeinander",
     new Set(pos.x.map(v => v.toFixed(2))).size > 8,
     `${new Set(pos.x.map(v => v.toFixed(2))).size} verschiedene x-Werte`);
  ok("Layout schnell genug fuer den Browser", ms < 3000, `${ms} ms`);

  // Verbundene Knoten muessen im Mittel naeher beieinander liegen als
  // beliebige Paare — sonst zeigt das Bild keine Struktur, sondern Rauschen.
  const dist = (i, j) => Math.hypot(pos.x[i] - pos.x[j], pos.y[i] - pos.y[j]);
  let linked = 0, nl = 0;
  adj.forEach((nbs, i) => nbs.forEach(j => { if (j > i) { linked += dist(i, j); nl++; } }));
  let rand = 0;
  for (let s = 0; s < 400; s++) rand += dist(Math.floor(r() * 220), Math.floor(r() * 220));
  ok("verbundene Knoten liegen naeher beieinander als zufaellige Paare",
     linked / nl < rand / 400,
     `Kante Ø ${(linked / nl).toFixed(3)} vs zufaellig Ø ${(rand / 400).toFixed(3)}`);
}


/* --- Der stueckweise Aufruf aus der Oberflaeche -------------------------- */
{
  // Die Oberflaeche rechnet Punkt fuer Punkt, also mit points = 1. Dabei teilte
  // der Achsenwert durch (points - 1) und wurde NaN — und ein NaN-Radius liess
  // die Annaeherung still ausfallen, statt zu scheitern. Der Sweep lieferte
  // dann Zahlen aus einem anderen Modell und meldete sie als Befund.
  const one = sweep(BASE, { axis: "confidence", from: 0.42, to: 0.42, points: 1, seeds: 2 });
  ok("Einzelpunkt-Sweep liefert den gesetzten Wert",
     one.grid[0].value === 0.42, String(one.grid[0].value));
  ok("Einzelpunkt-Sweep liefert brauchbare Kennzahlen",
     Number.isFinite(one.grid[0].polarisation.median));

  let threw = false;
  try {
    run({ n: 60, steps: 10, factions: [{ share: 1, opinion: 0, confidence: NaN }] });
  } catch { threw = true; }
  ok("ein nicht endlicher Parameter scheitert laut statt still", threw);
}

console.log(fails === 0 ? "\nalle Pruefungen bestanden" : `\n${fails} Pruefung(en) fehlgeschlagen`);
process.exit(fails ? 1 : 0);
