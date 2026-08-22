/*
 * Die Simulationsmaschine — reine Funktionen, kein React, kein Netz.
 *
 * Warum ueberhaupt eine eigene Maschine? Weil die Vorgaengerversion keine war:
 * Dort schrieb ein einziger Modellaufruf pro Runde die Beitraege aller Personas
 * auf einmal, mit Blick auf den gesamten Thread. Das ist ein Autor, der fuenf
 * Rollen spricht. Es gibt darin keine unabhaengigen Agenten, keine lokale
 * Nachbarschaft, keine Emergenz — die "Stimmungsentwicklung" war eine Behauptung
 * des Modells, keine Dynamik.
 *
 * Hier entsteht das Gegenteil: Meinungen aendern sich ausschliesslich durch
 * lokale Begegnungen entlang eines Netzwerks. Polarisierung, Konsens und
 * Zersplitterung sind Ergebnisse des Laufs, nicht Aussagen eines Modells. Das
 * Sprachmodell kommt nur an zwei Stellen vor: Es uebersetzt das Szenario in eine
 * Populationsbeschreibung, und es gibt dem Ergebnis am Schluss eine Stimme.
 *
 * Modellgrundlage ist die Familie der Bounded-Confidence-Modelle
 * (Deffuant/Weisbuch 2000; Hegselmann/Krause 2002) mit Abstossung nach
 * Jager/Amblard (2005). Die Abstossung ist der Grund, warum ueberhaupt
 * Polarisierung entstehen kann: Ohne sie laeuft fast jede Population in
 * Konsens, was empirisch falsch ist.
 */

/* --------------------------------------------------------------- Zufall ---- */

/* Reproduzierbarkeit ist bei einem stochastischen Modell keine Kuer. Ohne
   festen Startwert ist jeder Lauf eine Anekdote und kein Befund; mit ihm kann
   man denselben Lauf zeigen, teilen und bestreiten. mulberry32 ist klein,
   schnell und ausreichend gut fuer Simulationszwecke. */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normalverteilte Zufallszahl (Box-Muller), auf [-1,1] geklemmt. */
function gauss(r, mean, sd) {
  const u = Math.max(1e-9, r()), v = r();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return clamp(mean + z * sd, -1, 1);
}

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/* -------------------------------------------------------------- Topologie -- */

/*
 * Die Topologie entscheidet mehr ueber den Ausgang als die meisten
 * Persoenlichkeitsparameter, und genau deshalb ist sie einstellbar:
 *
 *   small-world  Watts/Strogatz — jeder kennt seine Nachbarn, wenige
 *                Fernverbindungen. Nachrichten brauchen Zeit, Cluster halten
 *                sich. Das Modell fuer ein Fachpublikum.
 *   scale-free   Barabasi/Albert — wenige Knoten mit sehr vielen Kanten.
 *                Was ein Hub aufgreift, ist sofort ueberall. Das Modell fuer
 *                oeffentliche Netzwerke, und der Grund, warum dort einzelne
 *                Stimmen ganze Verlaeufe kippen.
 *   random       Erdos/Renyi — Kontrollfall ohne Struktur.
 */
export function buildNetwork(n, kind, params, r) {
  const adj = Array.from({ length: n }, () => new Set());
  const link = (a, b) => { if (a !== b) { adj[a].add(b); adj[b].add(a); } };

  if (kind === "scale-free") {
    const m = Math.max(1, Math.min(params.m ?? 3, n - 1));
    const targets = [];
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) link(i, j);
    for (let i = 0; i < m; i++) for (const j of adj[i]) targets.push(i, j);
    for (let v = m; v < n; v++) {
      const chosen = new Set();
      let guard = 0;
      while (chosen.size < m && guard++ < 200) {
        // Praeferentielle Bindung: aus der Kantenliste ziehen heisst, mit einer
        // Wahrscheinlichkeit proportional zum Grad zu ziehen.
        const pick = targets.length ? targets[Math.floor(r() * targets.length)] : Math.floor(r() * v);
        if (pick !== v) chosen.add(pick);
      }
      for (const t of chosen) { link(v, t); targets.push(v, t); }
    }
  } else if (kind === "random") {
    const k = Math.max(1, params.k ?? 6);
    const p = k / Math.max(1, n - 1);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (r() < p) link(i, j);
  } else {
    // small-world (Voreinstellung)
    const k = Math.max(2, Math.round((params.k ?? 6) / 2) * 2);
    const beta = params.beta ?? 0.1;
    for (let i = 0; i < n; i++) for (let d = 1; d <= k / 2; d++) link(i, (i + d) % n);
    for (let i = 0; i < n; i++) {
      for (const j of [...adj[i]]) {
        if (r() < beta) {
          const t = Math.floor(r() * n);
          if (t !== i && !adj[i].has(t)) { adj[i].delete(j); adj[j].delete(i); link(i, t); }
        }
      }
    }
  }
  // Isolierte Knoten anbinden: ein Agent ohne Nachbarn nimmt an nichts teil und
  // verzerrt jede Kennzahl, die ueber die Population mittelt.
  for (let i = 0; i < n; i++) if (adj[i].size === 0) link(i, Math.floor(r() * n));
  return adj.map(s => [...s]);
}

/* -------------------------------------------------------------- Population -- */

/**
 * Baut die Agenten aus einer Fraktionsbeschreibung. Die Beschreibung kommt
 * entweder vom Sprachmodell (aus dem Szenario) oder aus den Voreinstellungen.
 *
 * Jeder Agent traegt:
 *   x        Meinung in [-1,1] zum Vorhaben
 *   conf     Konfidenzradius — wie weit entfernte Meinungen er ueberhaupt
 *            noch aufnimmt. Der wichtigste einzelne Parameter des Modells.
 *   stub     Beharrlichkeit — wie stark er sich bewegt, wenn er zuhoert
 *   act      Aktivitaet — wie oft er ueberhaupt spricht
 *   zealot   unbewegbar; solche Agenten sind der Grund, warum Minderheiten
 *            Mehrheiten kippen koennen
 */
export function buildPopulation(n, factions, r) {
  const total = factions.reduce((s, f) => s + (f.share || 0), 0) || 1;
  const agents = [];
  let id = 0;
  factions.forEach((f, fi) => {
    const count = fi === factions.length - 1
      ? n - agents.length
      : Math.round((f.share / total) * n);
    for (let i = 0; i < count && agents.length < n; i++) {
      agents.push({
        id: id++,
        f: fi,
        x: gauss(r, f.opinion ?? 0, f.spread ?? 0.25),
        conf: clamp((f.confidence ?? 0.35) + (r() - 0.5) * 0.12, 0.03, 2),
        stub: clamp((f.stubbornness ?? 0.5) + (r() - 0.5) * 0.2, 0, 0.98),
        act: clamp((f.activity ?? 0.5) + (r() - 0.5) * 0.2, 0.02, 1),
        zealot: r() < (f.zealots ?? 0),
      });
    }
  });
  while (agents.length < n) agents.push({ id: id++, f: 0, x: gauss(r, 0, 0.3), conf: 0.35, stub: 0.5, act: 0.5, zealot: false });
  return agents;
}

/* ---------------------------------------------------------------- Dynamik -- */

/**
 * Ein Zeitschritt. Jede aktive Kante ist eine Begegnung:
 *   liegt die Meinungsdifferenz innerhalb beider Konfidenzradien, naehern sich
 *   beide an (Anziehung); liegt sie jenseits der Abstossungsschwelle, entfernen
 *   sie sich (Abstossung). Dazwischen passiert nichts.
 *
 * Die Abstossung ist der Unterschied zwischen einem Modell, das immer Konsens
 * produziert, und einem, das Polarisierung zeigen kann. Wer sie auf 2 stellt,
 * schaltet sie ab.
 */
export function step(state, p, r) {
  const { agents, adj } = state;
  const mu = p.convergence ?? 0.25;
  const rep = p.repulsion ?? 0.08;
  const repThresh = p.repulsionThreshold ?? 1.1;
  let moved = 0;

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (r() > a.act) continue;
    const nb = adj[i];
    if (!nb.length) continue;
    const b = agents[nb[Math.floor(r() * nb.length)]];
    const d = b.x - a.x;
    const ad = Math.abs(d);

    if (ad < Math.min(a.conf, b.conf)) {
      const ma = a.zealot ? 0 : mu * (1 - a.stub);
      const mb = b.zealot ? 0 : mu * (1 - b.stub);
      a.x = clamp(a.x + ma * d, -1, 1);
      b.x = clamp(b.x - mb * d, -1, 1);
      if (ma || mb) moved++;
    } else if (ad > repThresh) {
      const ma = a.zealot ? 0 : rep * (1 - a.stub);
      const mb = b.zealot ? 0 : rep * (1 - b.stub);
      a.x = clamp(a.x - ma * Math.sign(d), -1, 1);
      b.x = clamp(b.x + mb * Math.sign(d), -1, 1);
      if (ma || mb) moved++;
    }
  }
  return moved;
}

/**
 * Ein externer Anstoss — die Veroeffentlichung selbst, ein Pressebericht, eine
 * Gegenkampagne. Er erreicht nur einen Teil der Population (`reach`), und zwar
 * bevorzugt die gut vernetzten, weil Reichweite so funktioniert.
 */
export function shock(state, { strength = 0.3, reach = 0.3, valence = 1 }, r) {
  const { agents, adj } = state;
  const order = agents.map((a, i) => [i, adj[i].length + r()]).sort((u, v) => v[1] - u[1]);
  const hit = Math.round(reach * agents.length);
  for (let k = 0; k < hit; k++) {
    const a = agents[order[k][0]];
    if (a.zealot) continue;
    a.x = clamp(a.x + valence * strength * (1 - a.stub), -1, 1);
  }
}

/* ------------------------------------------------------------- Kennzahlen -- */

/**
 * Was am Ende gemessen wird — und zwar gemessen, nicht behauptet.
 *
 * `clusters` zaehlt Meinungsgruppen als zusammenhaengende Komponenten auf dem
 * Meinungsstrahl (Abstand < tol). Genau daran haengt die Deutung: eine Gruppe
 * heisst Konsens, zwei weit auseinanderliegende heissen Polarisierung, viele
 * heissen Zersplitterung.
 */
/**
 * Die Toleranz, ab der zwei Meinungen als dieselbe Gruppe zaehlen, darf keine
 * feste Zahl sein. Sie muss zum Konfidenzradius der Population passen: Wer nur
 * Meinungen im Abstand 0,08 ueberhaupt aufnimmt, bildet Gruppen, die enger
 * beieinander liegen als das — und eine Messung mit fester Toleranz 0,12
 * verschmilzt sie zu einer einzigen. Genau so meldete diese Maschine im Test
 * "Konsens" fuer eine Population, die in siebzehn Gruppen zerfallen war.
 */
export function autoTolerance(agents) {
  const cs = agents.map(a => a.conf).sort((u, v) => u - v);
  const med = cs[Math.floor(cs.length / 2)] ?? 0.35;
  return Math.min(0.25, Math.max(0.02, med * 0.5));
}

export function metrics(agents, tol) {
  if (tol == null) tol = autoTolerance(agents);
  const n = agents.length;
  const xs = agents.map(a => a.x).sort((u, v) => u - v);
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const varc = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / n;

  const clusters = [];
  let cur = [xs[0]];
  for (let i = 1; i < n; i++) {
    if (xs[i] - xs[i - 1] < tol) cur.push(xs[i]);
    else { clusters.push(cur); cur = [xs[i]]; }
  }
  clusters.push(cur);
  const groups = clusters.map(c => ({
    size: c.length,
    share: c.length / n,
    mean: c.reduce((s, x) => s + x, 0) / c.length,
  })).sort((a, b) => b.size - a.size);

  const supporters = agents.filter(a => a.x > 0.2);
  const opponents = agents.filter(a => a.x < -0.2);
  const sShare = supporters.length / n, oShare = opponents.length / n;
  const meanOf = arr => (arr.length ? arr.reduce((s2, a) => s2 + a.x, 0) / arr.length : 0);

  // Polarisierung wird aus der Verteilung bestimmt, nicht aus der Gruppenzahl.
  // Der Faktor 4*s*o ist maximal bei einem Verhaeltnis 50:50 und faellt gegen
  // null, sobald ein Lager verschwindet; der zweite Faktor misst, wie weit die
  // Lager auseinanderliegen. Ein Lager allein ist keine Polarisierung, und zwei
  // Lager dicht beieinander auch nicht.
  const gap = Math.abs(meanOf(supporters) - meanOf(opponents)) / 2;
  const polarisation = 4 * sShare * oShare * gap;

  // Das Urteil folgt der Verteilung. Die Gruppenzahl allein reichte nicht: eine
  // lueckenlose Verteilung ueber den ganzen Meinungsbereich ist EINE Gruppe im
  // Sinne des Clusterns und trotzdem alles andere als Konsens.
  const bigGroups = groups.filter(g => g.share > 0.05).length;
  let shape;
  if (varc < 0.05 && groups.length === 1) shape = "consensus";
  else if (Math.min(sShare, oShare) > 0.25) shape = "polarised";
  else if (bigGroups >= 4) shape = "fragmented";
  else if (varc < 0.1 && bigGroups === 1) shape = "consensus";
  else shape = "divided";

  return {
    n, tolerance: +tol.toFixed(3),
    mean: +mean.toFixed(3), variance: +varc.toFixed(3),
    clusters: groups.length,
    majorGroups: groups.filter(g => g.share > 0.05).map(g => ({
      share: +g.share.toFixed(3), mean: +g.mean.toFixed(3), size: g.size,
    })),
    polarisation: +polarisation.toFixed(3),
    shape,
    support: +sShare.toFixed(3),
    opposition: +oShare.toFixed(3),
    undecided: +(1 - sShare - oShare).toFixed(3),
  };
}

/* ------------------------------------------------------------------- Lauf -- */

/**
 * Ein vollstaendiger Lauf. Gibt die Zeitreihe zurueck, nicht nur das Ende:
 * Wie eine Population zu ihrem Zustand kommt, ist die eigentliche Auskunft —
 * ein Konsens nach drei Schritten und einer nach dreihundert sind verschiedene
 * Befunde.
 */
export function run(cfg) {
  const r = rng(cfg.seed ?? 1);
  const agents = buildPopulation(cfg.n ?? 200, cfg.factions ?? DEFAULT_FACTIONS, r);
  const adj = buildNetwork(agents.length, cfg.topology ?? "small-world", cfg, r);
  const state = { agents, adj };

  const series = [];
  const events = [];
  const steps = cfg.steps ?? 120;
  const shockAt = cfg.shockAt ?? 5;

  for (let t = 0; t <= steps; t++) {
    if (t === shockAt && (cfg.shockStrength ?? 0) > 0) {
      shock(state, {
        strength: cfg.shockStrength, reach: cfg.shockReach ?? 0.3,
        valence: cfg.shockValence ?? 1,
      }, r);
      events.push({ t, kind: "launch" });
    }
    if (t > 0) step(state, cfg, r);
    if (t % (cfg.sample ?? 2) === 0 || t === steps) {
      series.push({ t, ...metrics(agents, cfg.clusterTolerance) });
    }
  }

  return { agents, adj, series, events, final: series[series.length - 1] };
}

/* Voreinstellung: eine plausible Oeffentlichkeit, falls das Sprachmodell nicht
   erreichbar ist. Die Simulation muss auch ohne Modell laufen — sonst haengt
   ein deterministisches Verfahren an einem Netzdienst. */
export const DEFAULT_FACTIONS = [
  { name: "Early adopters", share: 0.18, opinion: 0.55, spread: 0.2, confidence: 0.45, stubbornness: 0.35, activity: 0.75, zealots: 0.05 },
  { name: "Pragmatists", share: 0.44, opinion: 0.05, spread: 0.3, confidence: 0.4, stubbornness: 0.45, activity: 0.4, zealots: 0.0 },
  { name: "Sceptics", share: 0.26, opinion: -0.45, spread: 0.25, confidence: 0.3, stubbornness: 0.6, activity: 0.6, zealots: 0.08 },
  { name: "Committed critics", share: 0.12, opinion: -0.8, spread: 0.15, confidence: 0.18, stubbornness: 0.85, activity: 0.9, zealots: 0.35 },
];
