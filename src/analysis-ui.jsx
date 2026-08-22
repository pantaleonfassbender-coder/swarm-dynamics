import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Loader2, Play, GitCompare, Repeat, Network as NetIcon, TrendingUp } from 'lucide-react';
import { sweep, robustness, compare, layout, AXIS_RANGE, FACTION_AXES, GLOBAL_AXES } from './analysis.js';

const SHAPE_COLOR = {
  consensus: '#34d399', divided: '#fbbf24', polarised: '#f87171', fragmented: '#a78bfa',
};
const AXIS_LABEL = {
  confidence: 'Confidence radius', stubbornness: 'Stubbornness', activity: 'Activity',
  zealots: 'Zealot fraction', spread: 'Opinion spread',
  repulsion: 'Repulsion', repulsionThreshold: 'Repulsion threshold', convergence: 'Convergence',
  beta: 'Rewiring', k: 'Neighbours', m: 'Edges per node',
  shockStrength: 'Launch strength', shockReach: 'Launch reach', shockValence: 'Launch direction',
  n: 'Agents', steps: 'Steps',
};

/* Laenger laufende Rechnungen stueckweise ausfuehren, damit der Browser
   zwischendurch zeichnen kann. Ein eingefrorenes Fenster sieht aus wie ein
   Absturz, auch wenn nur gerechnet wird. */
const yieldToBrowser = () => new Promise(r => setTimeout(r, 0));

const Bar = ({ value }) => (
  <div className="h-1 bg-slate-800 rounded overflow-hidden">
    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round(value * 100)}%` }} />
  </div>
);

const Panel = ({ icon, title, children, note }) => (
  <section className="bg-slate-900 rounded-xl p-4 border border-slate-800">
    <h2 className="flex items-center gap-2 text-sm font-semibold text-white mb-1">{icon}{title}</h2>
    {note && <p className="text-[11px] text-slate-500 mb-3 leading-snug">{note}</p>}
    {children}
  </section>
);

/* ============================================================ 1. Sweep ==== */

function PhaseDiagram({ result }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv || !result) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = 260, padL = 34, padB = 26, padT = 8;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);

    const grid = result.grid;
    const iw = w - padL - 6, ih = h - padB - padT;
    const bx = i => padL + (i / grid.length) * iw;
    const bw = iw / grid.length;

    // Regime-Streifen: an jedem Punkt die Anteile der Regime uebereinander.
    // Das zeigt nicht nur, wo es kippt, sondern wie scharf.
    grid.forEach((pt, i) => {
      const total = Object.values(pt.shapes).reduce((s, v) => s + v, 0);
      let y = padT;
      for (const [shape, count] of Object.entries(pt.shapes).sort()) {
        const seg = (count / total) * ih;
        g.fillStyle = SHAPE_COLOR[shape] || '#64748b';
        g.globalAlpha = 0.5;
        g.fillRect(bx(i), y, Math.max(1, bw - 0.5), seg);
        y += seg;
      }
    });
    g.globalAlpha = 1;

    // Polarisierung als Linie mit 10–90-Prozent-Band ueber die Startwerte.
    const py = v => padT + ih - v * ih;
    g.beginPath();
    grid.forEach((pt, i) => { const x = bx(i) + bw / 2; i ? g.lineTo(x, py(pt.polarisation.hi)) : g.moveTo(x, py(pt.polarisation.hi)); });
    for (let i = grid.length - 1; i >= 0; i--) g.lineTo(bx(i) + bw / 2, py(grid[i].polarisation.lo));
    g.closePath(); g.fillStyle = 'rgba(255,255,255,.10)'; g.fill();

    g.beginPath();
    grid.forEach((pt, i) => { const x = bx(i) + bw / 2; i ? g.lineTo(x, py(pt.polarisation.median)) : g.moveTo(x, py(pt.polarisation.median)); });
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();

    // Kippstellen
    for (const t of result.transitions) {
      const frac = (t.at - result.from) / (result.to - result.from || 1);
      const x = padL + frac * iw;
      g.strokeStyle = '#38bdf8'; g.setLineDash([3, 3]); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ih); g.stroke(); g.setLineDash([]);
    }

    g.fillStyle = '#64748b'; g.font = '10px system-ui';
    g.fillText('1.0', 4, py(1) + 4); g.fillText('0', 10, py(0) + 4);
    g.fillText(String(+result.from.toFixed(2)), padL, h - 8);
    g.fillText(String(+result.to.toFixed(2)), w - 26, h - 8);
    g.fillText('polarisation', padL + iw / 2 - 26, h - 8);
  }, [result]);
  return <canvas ref={ref} style={{ width: '100%', height: 260 }} />;
}

export function SweepPanel({ base }) {
  const [axis, setAxis] = useState('confidence');
  const [points, setPoints] = useState(15);
  const [seeds, setSeeds] = useState(6);
  const [busy, setBusy] = useState(0);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');

  const cost = points * seeds;
  const run = async () => {
    setErr(''); setBusy(0.001); setRes(null);
    try {
      // Punktweise rechnen und zwischendurch zurueck an den Browser.
      const [lo, hi] = AXIS_RANGE[axis];
      const grid = [];
      let out = null;
      for (let i = 0; i < points; i++) {
        const partial = sweep(base, {
          axis, from: lo + ((hi - lo) * i) / (points - 1), to: lo + ((hi - lo) * i) / (points - 1),
          points: 1, seeds,
        });
        grid.push(partial.grid[0]);
        setBusy((i + 1) / points);
        await yieldToBrowser();
      }
      const transitions = [];
      for (let i = 1; i < grid.length; i++) {
        if (grid[i].dominantShape !== grid[i - 1].dominantShape) {
          transitions.push({ at: +((grid[i].value + grid[i - 1].value) / 2).toFixed(4),
            from: grid[i - 1].dominantShape, to: grid[i].dominantShape });
        }
      }
      out = { axis, from: lo, to: hi, points, seeds, grid, transitions };
      setRes(out);
    } catch (e) { setErr(e.message); }
    setBusy(0);
  };

  return (
    <Panel icon={<TrendingUp size={17} className="text-sky-400" />} title="Parameter sweep"
      note="Where does the outcome change? One axis is walked from end to end and every point is run several times. The tipping point is the finding — it says how far your assumption may be wrong before the conclusion is a different one.">
      <div className="grid grid-cols-2 gap-2 mb-3">
        <label className="col-span-2">
          <span className="text-xs text-slate-400">Axis</span>
          <select value={axis} onChange={e => setAxis(e.target.value)}
            className="w-full mt-1 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-sm">
            <optgroup label="Population">
              {FACTION_AXES.map(a => <option key={a} value={a}>{AXIS_LABEL[a] || a}</option>)}
            </optgroup>
            <optgroup label="World">
              {GLOBAL_AXES.map(a => <option key={a} value={a}>{AXIS_LABEL[a] || a}</option>)}
            </optgroup>
          </select>
        </label>
        <label><span className="text-xs text-slate-400">Points</span>
          <input type="number" min="5" max="41" value={points} onChange={e => setPoints(+e.target.value)}
            className="w-full mt-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm font-mono" /></label>
        <label><span className="text-xs text-slate-400">Seeds per point</span>
          <input type="number" min="2" max="20" value={seeds} onChange={e => setSeeds(+e.target.value)}
            className="w-full mt-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm font-mono" /></label>
      </div>
      <button onClick={run} disabled={busy > 0}
        className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg py-2 text-sm text-white">
        {busy > 0 ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
        Sweep {AXIS_LABEL[axis] || axis} · {cost} runs
      </button>
      {busy > 0 && <div className="mt-2"><Bar value={busy} /></div>}
      {err && <p className="text-xs text-red-400 mt-2">{err}</p>}

      {res && (
        <div className="mt-4">
          <PhaseDiagram result={res} />
          <div className="flex flex-wrap gap-2 mt-2 text-[11px]">
            {Object.entries(SHAPE_COLOR).map(([s, c]) => (
              <span key={s} className="flex items-center gap-1 text-slate-400">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c, opacity: .6 }} />{s}
              </span>
            ))}
            <span className="flex items-center gap-1 text-slate-400"><span className="w-4 h-0.5 bg-white" />median polarisation</span>
          </div>
          <div className="mt-3">
            {res.transitions.length ? (
              <ul className="text-xs space-y-1">
                {res.transitions.map((t, i) => (
                  <li key={i} className="text-slate-300">
                    Tips from <strong style={{ color: SHAPE_COLOR[t.from] }}>{t.from}</strong> to{' '}
                    <strong style={{ color: SHAPE_COLOR[t.to] }}>{t.to}</strong> at{' '}
                    <span className="font-mono text-sky-400">{AXIS_LABEL[res.axis]} ≈ {t.at}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">
                No regime change across this axis — within this range the outcome does not depend on it.
                That is a finding too, and a reassuring one.
              </p>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ====================================================== 2. Robustheit ===== */

export function RobustnessPanel({ base }) {
  const [seeds, setSeeds] = useState(24);
  const [busy, setBusy] = useState(0);
  const [res, setRes] = useState(null);

  const go = async () => {
    setBusy(0.001); setRes(null);
    await yieldToBrowser();
    setRes(robustness(base, { seeds }));
    setBusy(0);
  };

  const verdictStyle = {
    robust: 'text-emerald-400', mixed: 'text-amber-400', unstable: 'text-red-400',
  };
  const verdictWord = {
    robust: 'Robust — the same regime in almost every run.',
    mixed: 'Mixed — the regime depends noticeably on the draw.',
    unstable: 'Unstable — this result says more about the dice than about the population.',
  };

  return (
    <Panel icon={<Repeat size={17} className="text-emerald-400" />} title="Seed robustness"
      note="The same setup, many different draws. A stochastic model gives a slightly different answer every time; whether a finding holds is decided by how often it comes back, not by how convincing the one run looked that you happened to see.">
      <div className="flex items-end gap-2 mb-3">
        <label className="flex-1"><span className="text-xs text-slate-400">Seeds</span>
          <input type="number" min="4" max="100" value={seeds} onChange={e => setSeeds(+e.target.value)}
            className="w-full mt-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm font-mono" /></label>
        <button onClick={go} disabled={busy > 0}
          className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg py-2 text-sm text-white">
          {busy > 0 ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Run {seeds}×
        </button>
      </div>
      {res && (
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Agreement on the regime</span>
              <span className="font-mono text-white">{Math.round(res.agreement * 100)}%</span>
            </div>
            <Bar value={res.agreement} />
            <p className={`text-xs mt-1.5 ${verdictStyle[res.verdict]}`}>{verdictWord[res.verdict]}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(res.shapes).sort((a, b) => b[1] - a[1]).map(([s, c]) => (
              <span key={s} className="text-[11px] px-2 py-0.5 rounded"
                style={{ background: `${SHAPE_COLOR[s]}22`, color: SHAPE_COLOR[s] }}>
                {s} × {c}
              </span>
            ))}
          </div>
          <table className="w-full text-xs">
            <thead><tr className="text-slate-500 text-left">
              <th className="font-medium py-1">Measure</th><th className="font-medium">10 %</th>
              <th className="font-medium">median</th><th className="font-medium">90 %</th></tr></thead>
            <tbody>
              {['polarisation', 'support', 'opposition', 'undecided'].map(k => (
                <tr key={k} className="border-t border-slate-800">
                  <td className="py-1 text-slate-300">{k}</td>
                  <td className="font-mono text-slate-500">{res[k].lo}</td>
                  <td className="font-mono text-white">{res[k].median}</td>
                  <td className="font-mono text-slate-500">{res[k].hi}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ======================================================== 3. Vergleich ==== */

const INTERVENTIONS = [
  { id: 'earlier', label: 'Publish earlier', note: 'the launch lands at step 1 instead of later',
    apply: c => ({ ...c, shockAt: 1 }) },
  { id: 'louder', label: 'More reach', note: 'the launch reaches twice as many, hubs first',
    apply: c => ({ ...c, shockReach: Math.min(1, (c.shockReach ?? 0.3) * 2) }) },
  { id: 'engage', label: 'Engage the critics', note: 'every faction listens a little further — the one intervention you actually control',
    apply: c => ({ ...c, factions: c.factions.map(f => ({ ...f, confidence: Math.min(1.2, (f.confidence ?? 0.35) + 0.2) })) }) },
  { id: 'seed', label: 'Recruit advocates', note: 'a tenth of the population starts clearly in favour',
    apply: c => ({ ...c, factions: [...c.factions.map(f => ({ ...f, share: (f.share ?? 0) * 0.9 })),
      { name: 'Recruited advocates', share: 0.1, opinion: 0.75, spread: 0.1, confidence: 0.4, stubbornness: 0.6, activity: 0.9, zealots: 0.2 }] }) },
  { id: 'quiet', label: 'Soften the message', note: 'half the strength, same reach',
    apply: c => ({ ...c, shockStrength: (c.shockStrength ?? 0.35) * 0.5 }) },
];

export function ComparePanel({ base }) {
  const [pick, setPick] = useState('engage');
  const [seeds, setSeeds] = useState(16);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);

  const chosen = INTERVENTIONS.find(i => i.id === pick);

  const go = async () => {
    setBusy(true); setRes(null);
    await yieldToBrowser();
    setRes(compare(base, chosen.apply(base), { seeds }));
    setBusy(false);
  };

  const row = (key, label, goodIfUp) => {
    const d = res.deltas[key];
    const good = goodIfUp ? d.median > 0 : d.median < 0;
    return (
      <tr key={key} className="border-t border-slate-800">
        <td className="py-1 text-slate-300">{label}</td>
        <td className={`font-mono ${Math.abs(d.median) < 0.005 ? 'text-slate-500' : good ? 'text-emerald-400' : 'text-red-400'}`}>
          {d.median > 0 ? '+' : ''}{d.median}
        </td>
        <td className="font-mono text-slate-500">{d.lo} … {d.hi}</td>
        <td className="font-mono text-slate-400">{Math.round(d.consistency * 100)}%</td>
      </tr>
    );
  };

  return (
    <Panel icon={<GitCompare size={17} className="text-purple-400" />} title="Compare an intervention"
      note="Two setups over the same seeds, paired. Both variants get the same draw, so the difference measures the intervention and not the dice — which is exactly where most before-and-after comparisons go wrong.">
      <div className="space-y-2 mb-3">
        {INTERVENTIONS.map(i => (
          <label key={i.id} className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer border ${pick === i.id ? 'border-purple-600 bg-purple-950/20' : 'border-slate-800'}`}>
            <input type="radio" checked={pick === i.id} onChange={() => setPick(i.id)} className="mt-0.5 accent-purple-500" />
            <span>
              <span className="text-xs text-slate-200">{i.label}</span>
              <span className="block text-[11px] text-slate-500 leading-snug">{i.note}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <label className="w-24"><span className="text-xs text-slate-400">Seeds</span>
          <input type="number" min="4" max="60" value={seeds} onChange={e => setSeeds(+e.target.value)}
            className="w-full mt-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm font-mono" /></label>
        <button onClick={go} disabled={busy}
          className="flex-1 flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg py-2 text-sm text-white">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Compare over {seeds} seeds
        </button>
      </div>

      {res && (
        <div className="mt-4">
          <p className="text-xs text-slate-400 mb-2">
            Baseline regime <strong style={{ color: SHAPE_COLOR[res.shapeA] }}>{res.shapeA}</strong> →
            with the intervention <strong style={{ color: SHAPE_COLOR[res.shapeB] }}>{res.shapeB}</strong>
          </p>
          <table className="w-full text-xs">
            <thead><tr className="text-slate-500 text-left">
              <th className="font-medium py-1">Change</th><th className="font-medium">median</th>
              <th className="font-medium">range</th><th className="font-medium">same direction</th></tr></thead>
            <tbody>
              {row('support', 'In favour', true)}
              {row('opposition', 'Opposed', false)}
              {row('polarisation', 'Polarisation', false)}
              {row('undecided', 'Undecided', false)}
            </tbody>
          </table>
          <p className="text-[11px] text-slate-500 mt-2">
            “Same direction” is the share of seeds in which the intervention pushed the measure the same
            way. A median without it hides whether the effect is reliable or merely true on average —
            anything under about 70 % should not be reported as an effect.
          </p>
        </div>
      )}
    </Panel>
  );
}

/* ========================================================== 4. Netzwerk === */

export function NetworkPanel({ result }) {
  const ref = useRef(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);

  const pos = useMemo(() => {
    if (!result?.adj || result.adj.length > 900) return null;
    return layout(result.adj, { iterations: 150, seed: 7 });
  }, [result]);

  const frames = result?.snapshots?.length ?? 0;

  useEffect(() => {
    if (!playing || !frames) return;
    const id = setInterval(() => setFrame(f => (f + 1) % frames), 90);
    return () => clearInterval(id);
  }, [playing, frames]);

  useEffect(() => {
    const cv = ref.current; if (!cv || !pos || !result) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = 340;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    const pad = 12;
    const X = i => pad + pos.x[i] * (w - 2 * pad);
    const Y = i => pad + pos.y[i] * (h - 2 * pad);

    g.strokeStyle = 'rgba(148,163,184,.13)'; g.lineWidth = 0.5;
    g.beginPath();
    result.adj.forEach((nbs, i) => nbs.forEach(j => {
      if (j > i) { g.moveTo(X(i), Y(i)); g.lineTo(X(j), Y(j)); }
    }));
    g.stroke();

    const xs = result.snapshots?.[Math.min(frame, frames - 1)]
      ?? Float32Array.from(result.agents, a => a.x);
    const deg = result.adj.map(a => a.length);
    const maxDeg = Math.max(...deg, 1);
    for (let i = 0; i < xs.length; i++) {
      const v = xs[i];
      // Rot bis gruen ueber die Meinung; Groesse nach Grad, damit Hubs als
      // solche erkennbar sind — bei skalenfreier Topologie ist das der Punkt.
      g.fillStyle = v > 0.2 ? '#34d399' : v < -0.2 ? '#f87171' : '#64748b';
      g.globalAlpha = 0.85;
      const r = 1.6 + 3.4 * Math.sqrt(deg[i] / maxDeg);
      g.beginPath(); g.arc(X(i), Y(i), r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }, [pos, result, frame, frames]);

  if (!result) return null;
  if (!pos) return (
    <Panel icon={<NetIcon size={17} className="text-amber-400" />} title="Network">
      <p className="text-xs text-slate-400">
        The network view is drawn up to 900 agents. This run has {result.adj.length} — the layout would
        take longer than the simulation and the picture would be a smear. Reduce the agent count to see it.
      </p>
    </Panel>
  );

  return (
    <Panel icon={<NetIcon size={17} className="text-amber-400" />} title="The network itself"
      note="Colour is opinion, size is how many neighbours an agent has. On a scale-free topology you can watch a hub turn its whole neighbourhood — which is why the topology decides more than most personality parameters.">
      <canvas ref={ref} style={{ width: '100%', height: 340 }} />
      {frames > 0 && (
        <div className="flex items-center gap-2 mt-2">
          <button onClick={() => setPlaying(p => !p)}
            className="text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-1 text-slate-200">
            {playing ? 'Pause' : 'Play'}
          </button>
          <input type="range" min="0" max={frames - 1} value={frame}
            onChange={e => { setPlaying(false); setFrame(+e.target.value); }}
            className="flex-1 accent-amber-400" />
          <span className="text-[11px] font-mono text-slate-500 w-20 text-right">
            step {result.series[Math.min(frame, frames - 1)]?.t ?? 0}
          </span>
        </div>
      )}
    </Panel>
  );
}
