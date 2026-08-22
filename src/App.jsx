import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Activity, Play, Settings2, Upload, X, File, Info, Loader2, AlertTriangle,
  Users, Network, Sparkles, RotateCcw, Dices, Link2,
} from 'lucide-react';
import { run, DEFAULT_FACTIONS } from './swarm.js';
import { SweepPanel, RobustnessPanel, ComparePanel, NetworkPanel } from './analysis-ui.jsx';
import Guide from './guide.jsx';

/* --------------------------------------------------------------- Helfer --- */

/* Der Endpunkt gibt sich selbst eine Frist von 50 s und antwortet danach mit
   einer Erklaerung. Der Browser wartet etwas laenger — aber nicht unbegrenzt,
   sonst dreht sich der Spinner bei einem haengenden Netz bis in alle Ewigkeit. */
const CALL_TIMEOUT_MS = 58_000;

const callModel = async (payload) => {
  let r;
  try {
    r = await fetch('/api/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new Error('The model endpoint did not answer in time. Your run is unaffected — it was '
        + 'computed here in the browser. Try the request again.');
    }
    throw new Error('The model endpoint could not be reached. Your run is unaffected.');
  }
  const raw = await r.text();
  let data; try { data = JSON.parse(raw); } catch { data = null; }
  // Ein 504 ohne Inhalt kommt von der Plattform, nicht vom Endpunkt; dann fehlt
  // die Erklaerung und der blosse Status waere fuer niemanden brauchbar.
  if (!r.ok) {
    throw new Error(data?.error || (r.status === 504
      ? 'The model endpoint timed out. Your run is unaffected — it was computed here in the browser. '
        + 'Try the request again.'
      : `The model endpoint answered ${r.status}.`));
  }
  return data;
};

const num = (v, d) => (Number.isFinite(+v) ? +v : d);

/* ------------------------------------------------------- Darstellungen ---- */

/** Verlauf der Meinungsverteilung: jede Spalte ein Zeitschritt. Was man hier
 *  sieht, ist der eigentliche Befund — ob sich Gruppen bilden, wann, und ob
 *  sie halten. Ein Endwert allein verschweigt genau das. */
function TimeChart({ series, events }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv || !series.length) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = 220;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);

    const y = v => h - ((v + 1) / 2) * h;
    g.strokeStyle = '#1e293b';
    for (const v of [-1, -0.5, 0, 0.5, 1]) {
      g.beginPath(); g.moveTo(0, y(v)); g.lineTo(w, y(v));
      g.lineWidth = v === 0 ? 1.5 : 0.5; g.stroke();
    }

    // Bänder: Zustimmung / unentschieden / Ablehnung als Flächen
    const x = i => (i / Math.max(1, series.length - 1)) * w;
    const band = (key, color) => {
      g.beginPath();
      series.forEach((s, i) => { const v = s[key]; i ? g.lineTo(x(i), h - v * h) : g.moveTo(x(i), h - v * h); });
      g.strokeStyle = color; g.lineWidth = 2; g.stroke();
    };

    for (const e of events) {
      const i = series.findIndex(s => s.t >= e.t);
      if (i < 0) continue;
      g.strokeStyle = '#f59e0b'; g.setLineDash([4, 4]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(x(i), 0); g.lineTo(x(i), h); g.stroke(); g.setLineDash([]);
    }

    // Mittlere Meinung
    g.beginPath();
    series.forEach((s, i) => { i ? g.lineTo(x(i), y(s.mean)) : g.moveTo(x(i), y(s.mean)); });
    g.strokeStyle = '#38bdf8'; g.lineWidth = 2.5; g.stroke();
    band('support', 'rgba(52,211,153,.55)');
    band('opposition', 'rgba(248,113,113,.55)');
  }, [series, events]);
  return <canvas ref={ref} style={{ width: '100%', height: 220 }} />;
}

/** Endverteilung als Histogramm. Hier wird sichtbar, ob "Mittelwert 0"
 *  Unentschiedenheit heisst oder zwei Lager, die sich gegenseitig aufheben —
 *  ein Unterschied, den keine einzelne Kennzahl transportiert. */
function Histogram({ agents }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv || !agents.length) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = 150;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    const bins = 60, counts = new Array(bins).fill(0);
    for (const a of agents) counts[Math.min(bins - 1, Math.floor(((a.x + 1) / 2) * bins))]++;
    const max = Math.max(...counts, 1);
    counts.forEach((c, i) => {
      const bw = w / bins, bh = (c / max) * (h - 18);
      const centre = (i + 0.5) / bins * 2 - 1;
      g.fillStyle = centre > 0.2 ? '#34d399' : centre < -0.2 ? '#f87171' : '#64748b';
      g.fillRect(i * bw, h - 18 - bh, Math.max(1, bw - 1), bh);
    });
    g.fillStyle = '#475569'; g.font = '10px system-ui';
    g.fillText('opposed', 2, h - 5); g.fillText('undecided', w / 2 - 24, h - 5);
    g.fillText('in favour', w - 48, h - 5);
  }, [agents]);
  return <canvas ref={ref} style={{ width: '100%', height: 150 }} />;
}

/* ------------------------------------------------------------ Parameter --- */

function Slider({ label, hint, value, set, min, max, step }) {
  return (
    <label className="block">
      <div className="flex justify-between items-baseline">
        <span className="text-xs font-medium text-slate-300">{label}</span>
        <span className="text-xs font-mono text-slate-500">{(+value).toFixed(step < 1 ? 2 : 0)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => set(+e.target.value)}
        className="w-full accent-emerald-400 mt-1" />
      {hint && <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{hint}</p>}
    </label>
  );
}

const FIELDS = [
  ['share', 'Share', 0, 1, 0.01],
  ['opinion', 'Opinion', -1, 1, 0.05],
  ['spread', 'Spread', 0.02, 0.6, 0.01],
  ['confidence', 'Confidence', 0.05, 1.2, 0.01],
  ['stubbornness', 'Stubborn.', 0, 0.95, 0.05],
  ['activity', 'Activity', 0.05, 1, 0.05],
  ['zealots', 'Zealots', 0, 0.5, 0.01],
];

function FactionTable({ factions, setFactions }) {
  const total = factions.reduce((s, f) => s + (+f.share || 0), 0);
  const upd = (i, k, v) => setFactions(factions.map((f, j) => (i === j ? { ...f, [k]: v } : f)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 text-left">
            <th className="py-1 pr-2 font-medium">Faction</th>
            {FIELDS.map(([k, label]) => <th key={k} className="py-1 px-1 font-medium">{label}</th>)}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {factions.map((f, i) => (
            <tr key={i} className="border-t border-slate-800">
              <td className="py-1 pr-2 align-top" style={{ minWidth: 130 }}>
                <input value={f.name || ''} onChange={e => upd(i, 'name', e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-slate-200" />
                {f.note && <p className="text-[10px] text-slate-600 mt-0.5 leading-tight">{f.note}</p>}
              </td>
              {FIELDS.map(([k, , min, max, step]) => (
                <td key={k} className="py-1 px-1 align-top">
                  <input type="number" min={min} max={max} step={step} value={f[k] ?? 0}
                    onChange={e => upd(i, k, num(e.target.value, 0))}
                    className="w-16 bg-slate-950 border border-slate-800 rounded px-1 py-1 font-mono text-slate-200" />
                </td>
              ))}
              <td className="align-top">
                <button onClick={() => setFactions(factions.filter((_, j) => j !== i))}
                  className="text-slate-600 hover:text-red-400 p-1"><X size={13} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-3 mt-2">
        <button onClick={() => setFactions([...factions, { name: 'New faction', share: 0.1, opinion: 0, spread: 0.2, confidence: 0.35, stubbornness: 0.5, activity: 0.5, zealots: 0 }])}
          className="text-xs text-emerald-400 hover:text-emerald-300">+ faction</button>
        <span className={`text-xs font-mono ${Math.abs(total - 1) > 0.02 ? 'text-amber-400' : 'text-slate-600'}`}>
          shares sum to {total.toFixed(2)}{Math.abs(total - 1) > 0.02 ? ' — will be normalised' : ''}
        </span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- App ---- */

export default function SwarmDynamics() {
  const [view, setView] = useState('sim');
  const [scenario, setScenario] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  const [factions, setFactions] = useState(DEFAULT_FACTIONS);
  const [reasoning, setReasoning] = useState('');
  const [drafting, setDrafting] = useState(false);

  const [p, setP] = useState({
    n: 400, topology: 'small-world', k: 6, beta: 0.1, m: 3,
    steps: 200, seed: 1, convergence: 0.25,
    repulsion: 0.08, repulsionThreshold: 1.1,
    shockAt: 5, shockStrength: 0.35, shockReach: 0.3, shockValence: 1,
  });
  const set = (k) => (v) => setP(o => ({ ...o, [k]: v }));

  const [tab, setTab] = useState('run');
  const [result, setResult] = useState(null);
  const [reading, setReading] = useState(null);
  const [interpreting, setInterpreting] = useState(false);

  const combined = useMemo(() =>
    `${scenario}${attachment?.data ? `\n\n[Attached ${attachment.type}: ${attachment.name}]\n${attachment.data}` : ''}`,
    [scenario, attachment]);

  /* ---- Anhang. Ein Link wird jetzt als Link ausgewiesen, nicht als Inhalt.
     Vorher stand die URL selbst im Prompt, als waere sie der Text der Seite —
     das Modell hat dann ueber eine Seite geredet, die es nie gesehen hat. */
  const onFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = null;
    const ext = file.name.split('.').pop().toLowerCase();
    if (file.size > 8 * 1024 * 1024) { setErr('That file is larger than 8 MB.'); return; }
    if (['txt', 'md', 'csv', 'json'].includes(ext)) {
      setAttachment({ type: 'file', name: file.name, data: (await file.text()).slice(0, 40000) });
      return;
    }
    if (!['pdf', 'docx'].includes(ext)) { setErr(`Unsupported file type: .${ext}`); return; }
    setUploading(true);
    try {
      const b64 = await new Promise((res, rej) => {
        const rd = new FileReader();
        rd.onload = () => res(rd.result.split(',')[1]); rd.onerror = rej;
        rd.readAsDataURL(file);
      });
      const r = await fetch('/api/parse-document', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, fileData: b64 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not read that document.');
      setAttachment({ type: 'file', name: file.name, data: (d.text || '').slice(0, 40000), warning: d.warning });
    } catch (e2) { setErr(e2.message); }
    setUploading(false);
  };

  const draftPopulation = async () => {
    if (combined.trim().length < 10) { setErr('Describe the scenario first.'); return; }
    setErr(''); setDrafting(true);
    try {
      const d = await callModel({ task: 'population', scenario: combined });
      if (Array.isArray(d.factions) && d.factions.length) {
        setFactions(d.factions);
        setReasoning(d.reasoning || '');
      } else throw new Error('The model returned no factions.');
    } catch (e) { setErr(e.message); }
    setDrafting(false);
  };

  const simulate = () => {
    setErr(''); setReading(null);
    try {
      setResult(run({ ...p, factions, keepSnapshots: p.n <= 900 }));
    } catch (e) { setErr(`Simulation failed: ${e.message}`); }
  };

  const interpret = async () => {
    if (!result) return;
    setErr(''); setInterpreting(true);
    try {
      setReading(await callModel({
        task: 'reading', scenario: combined, factions,
        params: { ...p }, result: result.final,
      }));
    } catch (e) { setErr(e.message); }
    setInterpreting(false);
  };

  // Die Analysepanels rechnen denselben Aufbau, nur oefter. Ohne
  // Momentaufnahmen: sie brauchen nur die Kennzahlen, und tausende
  // Aufnahmen waeren verschenkter Speicher.
  const cfg = useMemo(() => ({ ...p, factions }), [p, factions]);
  const f = result?.final;
  const shapeWord = { consensus: 'Consensus', polarised: 'Polarised', fragmented: 'Fragmented', divided: 'Divided' };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-8">
      <header className="mb-6 border-b border-slate-800 pb-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Activity className="text-emerald-400 w-7 h-7" />
            <h1 className="text-2xl font-bold text-white tracking-tight">SwarmDynamics</h1>
          </div>
          <p className="text-slate-400 max-w-2xl text-sm">
            An agent-based opinion model. Hundreds of agents change their minds only through local
            encounters on a network — consensus, polarisation and fragmentation are outcomes of the run,
            not assertions of a language model.
          </p>
        </div>
        <nav className="flex gap-2">
          {[['sim', 'Simulator'], ['guide', 'Guide'], ['about', 'About'], ['legal', 'Legal']].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-3 py-1.5 rounded-lg text-sm ${view === k ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/50'}`}>{l}</button>
          ))}
        </nav>
      </header>

      {err && (
        <div className="mb-4 flex items-start gap-2 bg-red-950/40 border border-red-900 rounded-lg p-3 text-sm text-red-200">
          <AlertTriangle size={16} className="mt-0.5 flex-none" /><span>{err}</span>
          <button onClick={() => setErr('')} className="ml-auto text-red-400"><X size={14} /></button>
        </div>
      )}

      {view === 'guide' ? <Guide /> : view === 'about' ? <About /> : view === 'legal' ? <Legal /> : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">

          {/* ---- Links: Szenario und Population ---- */}
          <div className="xl:col-span-5 space-y-5">
            <Panel icon={<Settings2 size={17} className="text-blue-400" />} title="Scenario">
              <textarea value={scenario} onChange={e => setScenario(e.target.value)}
                placeholder="What are you about to publish, launch or announce?"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm h-24 resize-none outline-none focus:border-blue-500" />
              <div className="flex items-center gap-2 mt-2">
                <input ref={fileRef} type="file" hidden onChange={onFile}
                  accept=".txt,.md,.csv,.json,.pdf,.docx" />
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-800 rounded px-2 py-1">
                  {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Attach
                </button>
                {attachment && (
                  <span className="flex items-center gap-1.5 text-xs bg-slate-800 rounded px-2 py-1">
                    {attachment.type === 'link' ? <Link2 size={12} /> : <File size={12} />}
                    {attachment.name.slice(0, 34)}
                    <button onClick={() => setAttachment(null)}><X size={12} /></button>
                  </span>
                )}
              </div>
              {attachment?.warning && <p className="text-[11px] text-amber-400 mt-1">{attachment.warning}</p>}
              <button onClick={draftPopulation} disabled={drafting}
                className="mt-3 w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium">
                {drafting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                Draft the population from this scenario
              </button>
              <p className="text-[11px] text-slate-500 mt-1.5">
                Optional. This is the only step that sends anything anywhere; the simulation itself runs here.
              </p>
            </Panel>

            <Panel icon={<Users size={17} className="text-emerald-400" />} title="Population">
              {reasoning && <p className="text-xs text-slate-400 mb-3 italic border-l-2 border-slate-700 pl-2">{reasoning}</p>}
              <FactionTable factions={factions} setFactions={setFactions} />
              <button onClick={() => { setFactions(DEFAULT_FACTIONS); setReasoning(''); }}
                className="mt-2 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300">
                <RotateCcw size={12} /> reset to defaults
              </button>
            </Panel>
          </div>

          {/* ---- Mitte: Parameter ---- */}
          <div className="xl:col-span-3 space-y-5">
            <Panel icon={<Network size={17} className="text-purple-400" />} title="Dynamics">
              <div className="space-y-3">
                <Slider label="Agents" value={p.n} set={set('n')} min={20} max={3000} step={20}
                  hint="Two thousand agents run in about a fifth of a second." />
                <label className="block">
                  <span className="text-xs font-medium text-slate-300">Topology</span>
                  <select value={p.topology} onChange={e => set('topology')(e.target.value)}
                    className="w-full mt-1 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-sm">
                    <option value="small-world">Small world — neighbours, few shortcuts</option>
                    <option value="scale-free">Scale free — a few hubs reach everyone</option>
                    <option value="random">Random — control case</option>
                  </select>
                  <p className="text-[11px] text-slate-500 mt-0.5">Decides more about the outcome than most personality parameters.</p>
                </label>
                {p.topology === 'scale-free'
                  ? <Slider label="Edges per new node" value={p.m} set={set('m')} min={1} max={8} step={1} />
                  : <Slider label="Neighbours" value={p.k} set={set('k')} min={2} max={20} step={2} />}
                {p.topology === 'small-world' &&
                  <Slider label="Rewiring" value={p.beta} set={set('beta')} min={0} max={1} step={0.02}
                    hint="0 = ring, 1 = random. The shortcuts are what let a view travel." />}
                <Slider label="Convergence" value={p.convergence} set={set('convergence')} min={0.02} max={0.5} step={0.01}
                  hint="How far two people move toward each other when they do listen." />
                <Slider label="Repulsion" value={p.repulsion} set={set('repulsion')} min={0} max={0.3} step={0.01}
                  hint="Set to 0 and almost any population reaches consensus — which is empirically false." />
                <Slider label="Repulsion threshold" value={p.repulsionThreshold} set={set('repulsionThreshold')} min={0.3} max={2} step={0.05}
                  hint="Distance beyond which disagreement pushes people apart. 2 disables it." />
                <Slider label="Steps" value={p.steps} set={set('steps')} min={20} max={600} step={20} />
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Slider label="Seed" value={p.seed} set={set('seed')} min={1} max={9999} step={1}
                      hint="Same seed, same run. Without it every result is an anecdote." />
                  </div>
                  <button onClick={() => set('seed')(Math.floor(Math.random() * 9999) + 1)}
                    className="mb-4 text-slate-500 hover:text-slate-300"><Dices size={15} /></button>
                </div>
              </div>
            </Panel>

            <Panel icon={<Play size={17} className="text-amber-400" />} title="The launch itself">
              <div className="space-y-3">
                <Slider label="Step of publication" value={p.shockAt} set={set('shockAt')} min={0} max={100} step={1} />
                <Slider label="Strength" value={p.shockStrength} set={set('shockStrength')} min={0} max={1} step={0.05} />
                <Slider label="Reach" value={p.shockReach} set={set('shockReach')} min={0} max={1} step={0.05}
                  hint="Reaches the best-connected first, because that is how reach works." />
                <Slider label="Direction" value={p.shockValence} set={set('shockValence')} min={-1} max={1} step={0.1}
                  hint="+1 the message lands well, −1 it backfires." />
              </div>
              <button onClick={simulate}
                className="mt-4 w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg py-2.5 font-medium">
                <Play size={16} /> Run the simulation
              </button>
            </Panel>
          </div>

          {/* ---- Rechts: Ergebnis ---- */}
          <div className="xl:col-span-4 space-y-5">
            <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
              {[['run', 'Result'], ['network', 'Network'], ['sweep', 'Sweep'],
                ['robust', 'Robustness'], ['compare', 'Compare']].map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`flex-1 px-2 py-1.5 rounded text-xs ${tab === k ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'}`}>{l}</button>
              ))}
            </div>

            {tab === 'sweep' ? <SweepPanel base={cfg} />
             : tab === 'robust' ? <RobustnessPanel base={cfg} />
             : tab === 'compare' ? <ComparePanel base={cfg} />
             : tab === 'network' ? (
               result ? <NetworkPanel result={result} />
                 : <Panel icon={<Info size={17} className="text-slate-500" />} title="No run yet">
                     <p className="text-sm text-slate-400">Run the simulation once; the network view draws that run.</p>
                   </Panel>
             )
             : !result ? (
              <Panel icon={<Info size={17} className="text-slate-500" />} title="No run yet">
                <p className="text-sm text-slate-400">
                  Set the population and press run. The simulation is local and instant — nothing is sent
                  anywhere, and you can sweep a parameter as fast as you can drag it.
                </p>
              </Panel>
            ) : (
              <>
                <Panel icon={<Activity size={17} className="text-emerald-400" />} title="Outcome">
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <Metric label="Shape" value={shapeWord[f.shape] || f.shape} big />
                    <Metric label="Polarisation" value={f.polarisation.toFixed(2)} big />
                    <Metric label="In favour" value={`${Math.round(f.support * 100)}%`} tone="pos" />
                    <Metric label="Opposed" value={`${Math.round(f.opposition * 100)}%`} tone="neg" />
                    <Metric label="Undecided" value={`${Math.round(f.undecided * 100)}%`} />
                    <Metric label="Groups" value={f.clusters} />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Groups counted at a tolerance of {f.tolerance} on the opinion axis, derived from the
                    population's own confidence radii — a coarser tolerance would merge these groups into one.
                  </p>
                </Panel>

                <Panel icon={<Activity size={17} className="text-sky-400" />} title="How it got there">
                  <TimeChart series={result.series} events={result.events} />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Blue: mean opinion. Green and red: shares in favour and opposed. Amber: the publication.
                  </p>
                  <div className="mt-3"><Histogram agents={result.agents} /></div>
                </Panel>

                <Panel icon={<Sparkles size={17} className="text-blue-400" />} title="Reading">
                  {!reading ? (
                    <>
                      <button onClick={interpret} disabled={interpreting}
                        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm">
                        {interpreting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                        Interpret this run
                      </button>
                      <p className="text-[11px] text-slate-500 mt-1.5">
                        Sends the measured result and your parameters — not your file — to a model, which
                        explains the mechanism. It may not revise the numbers.
                      </p>
                    </>
                  ) : (
                    <div className="space-y-3 text-sm">
                      <p className="font-medium text-white">{reading.headline}</p>
                      <p className="text-slate-300">{reading.mechanism}</p>
                      {reading.voices?.length > 0 && (
                        <div className="space-y-1.5">
                          {reading.voices.map((v, i) => (
                            <div key={i} className="border-l-2 pl-2" style={{ borderColor: v.stance > 0.2 ? '#34d399' : v.stance < -0.2 ? '#f87171' : '#64748b' }}>
                              <span className="text-[11px] text-slate-500">{v.faction}</span>
                              <p className="text-slate-300 text-[13px]">“{v.quote}”</p>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="bg-amber-950/30 border border-amber-900/50 rounded p-2">
                        <span className="text-[11px] text-amber-500 font-medium">Risk</span>
                        <p className="text-slate-300 text-[13px]">{reading.risk}</p>
                      </div>
                      <div className="bg-slate-800/40 rounded p-2">
                        <span className="text-[11px] text-slate-500 font-medium">Most fragile assumption</span>
                        <p className="text-slate-400 text-[13px]">{reading.fragility}</p>
                      </div>
                    </div>
                  )}
                </Panel>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ Bausteine --- */

const Panel = ({ icon, title, children }) => (
  <section className="bg-slate-900 rounded-xl p-4 border border-slate-800">
    <h2 className="flex items-center gap-2 text-sm font-semibold text-white mb-3">{icon}{title}</h2>
    {children}
  </section>
);

const Metric = ({ label, value, tone, big }) => (
  <div className="bg-slate-950 rounded-lg px-3 py-2 border border-slate-800">
    <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className={`${big ? 'text-lg' : 'text-base'} font-semibold ${tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-red-400' : 'text-white'}`}>{value}</div>
  </div>
);

function About() {
  return (
    <div className="max-w-3xl space-y-4 text-sm text-slate-300">
      <h2 className="text-xl font-semibold text-white">What this does, and what it cannot</h2>
      <p>Hundreds of agents each hold an opinion between −1 and +1 and sit on a social network. On every
      step some of them meet a neighbour. If the two views are close enough that both are still willing to
      listen — each agent's <em>confidence radius</em> — they move toward one another. If they are far
      enough apart, they move away. Nothing else happens. Consensus, polarisation and fragmentation are
      what this produces, not what anything asserts.</p>
      <p>The model is the bounded-confidence family: Deffuant and Weisbuch (2000), Hegselmann and Krause
      (2002), with repulsion after Jager and Amblard (2005). The repulsion matters: without it almost every
      population converges to a single view, which is empirically false.</p>
      <h3 className="text-white font-medium pt-2">Where the language model is used</h3>
      <p>Twice, and never inside the dynamics. It drafts a population from your scenario — who is in the
      room, and with which parameters — and it explains a finished run. It cannot change a measurement, and
      the simulation runs without it.</p>
      <p>This matters because the previous version of this tool worked the other way round: one model call
      per round wrote every persona's message at once, having seen the whole thread. That is a single author
      speaking five parts. There were no independent agents and nothing emerged.</p>
      <h3 className="text-white font-medium pt-2">What it is not</h3>
      <ul className="list-disc pl-5 space-y-1 text-slate-400">
        <li><strong>Not a forecast.</strong> It is a way of asking what follows from assumptions you have
        made explicit. Change a confidence radius and the answer changes; that sensitivity is the finding.</li>
        <li><strong>Not calibrated.</strong> No parameter here was fitted to data about your audience.
        The drafted population is a plausible guess, not a measurement.</li>
        <li><strong>Not people.</strong> An agent is a number that moves. The quotes in the reading are
        illustrations of a simulated stance, not evidence about anyone.</li>
        <li><strong>Sensitive to the seed.</strong> Run it several times before believing a result. If the
        outcome flips between seeds, that is itself the answer.</li>
      </ul>
    </div>
  );
}

function Legal() {
  return (
    <div className="max-w-3xl space-y-4 text-sm text-slate-300">
      <h2 className="text-xl font-semibold text-white">Legal notice and privacy</h2>
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Operator</p>
        <p>Dr. Pantaleon Fassbender<br />16751 NE 5th Street<br />Williston, FL 32696<br />United States</p>
        <p className="mt-2">Email: <a className="text-emerald-400" href="mailto:pantaleonfassbender@gmail.com">pantaleonfassbender@gmail.com</a></p>
      </div>
      <p>A private research project of a natural person resident in the United States, not operated on
      behalf of any institution or employer. No company stands behind it; it carries no advertising and no
      sponsorship. Responsible for the content: Dr. Pantaleon Fassbender, at the address above. The site is
      reachable from the European Economic Area, so the GDPR applies by virtue of Art. 3(2); the controller
      within the meaning of Art. 4(7) is the operator named here.</p>

      <h3 className="text-white font-medium pt-2">What happens to what you type</h3>
      <p><strong>The simulation never leaves your browser.</strong> Agents, network and dynamics are
      computed locally; no scenario, parameter or result is transmitted for that.</p>
      <p>Two actions do send something, both only when you press the button:</p>
      <ul className="list-disc pl-5 space-y-1 text-slate-400">
        <li><em>Draft the population</em> sends your scenario text — including the extracted text of any
        file you attached — to Anthropic through Netlify's AI Gateway.</li>
        <li><em>Interpret this run</em> sends the scenario, your parameters and the measured result. Not
        the attached file.</li>
      </ul>
      <p>An attached PDF or Word file is sent to this site's own function once, to extract its text; the
      file is not stored and the function keeps no copy. <strong>Do not attach anything confidential</strong>
      — treat the box the way you would treat a search engine.</p>
      <p>The site sets no cookies, runs no analytics and stores nothing in your browser. Hosting is by
      Netlify, whose infrastructure logs requests as any web server does (IP, time, URL, status); that is
      the only routine server-side collection, it is not analysed by the operator, and its retention
      follows Netlify's periods. Legal basis: Art. 6(1)(f) GDPR. Recipients are Netlify, Inc. and
      Anthropic PBC, both in the United States, and only for the two actions above.</p>
      <p>You have the rights of access, rectification, erasure, restriction, portability and objection
      (Arts. 15–21 GDPR) and may complain to a supervisory authority (Art. 77). No representative under
      Art. 27 has been designated; the operator relies on the exception in Art. 27(2)(a). This site does
      not track visitors, so a Do-Not-Track signal changes nothing — there is no tracking to switch off.</p>

      <h3 className="text-white font-medium pt-2">No warranty</h3>
      <p>Offered free of charge and without warranty. This is a simulation of assumptions, not a forecast
      of behaviour, and no parameter here has been calibrated against data about any real audience. Do not
      use it as the basis of a decision that matters without independent evidence.</p>
      <p className="text-[11px] text-slate-500 pt-2">Status: 21 August 2026. If this statement and the
      behaviour of the site ever diverge, the statement is wrong and will be corrected.</p>
    </div>
  );
}
