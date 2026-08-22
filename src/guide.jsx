import React from 'react';
import { BookOpen, Lightbulb, AlertTriangle, Sliders, FlaskConical } from 'lucide-react';

/* Die Erklaerseite. Sie richtet sich an Leserinnen und Leser, die noch nie
   etwas von Netzwerktopologie gehoert haben, und muss trotzdem genau genug
   sein, dass jemand nach der Lektuere sinnvoll an den Reglern dreht statt
   zufaellig. Deshalb steht bei jedem Parameter nicht nur, was er bedeutet,
   sondern was passiert, wenn man ihn hoch- oder herunterzieht. */

const H = ({ children }) => <h2 className="text-lg font-semibold text-white mt-8 mb-2">{children}</h2>;
const P = ({ children }) => <p className="mb-3 leading-relaxed">{children}</p>;

const Param = ({ name, what, up, down, watch }) => (
  <div className="border-t border-slate-800 py-3">
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="font-mono text-emerald-400 text-[13px]">{name}</span>
      <span className="text-slate-300 text-[13px]">{what}</span>
    </div>
    <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 mt-1.5 text-[12px]">
      <p className="text-slate-400"><span className="text-slate-500">Raise it:</span> {up}</p>
      <p className="text-slate-400"><span className="text-slate-500">Lower it:</span> {down}</p>
    </div>
    {watch && <p className="text-[12px] text-amber-400/80 mt-1.5">{watch}</p>}
  </div>
);

export default function Guide() {
  return (
    <div className="max-w-3xl text-sm text-slate-300 pb-12">

      <div className="flex items-center gap-2 mb-1">
        <BookOpen size={20} className="text-emerald-400" />
        <h1 className="text-xl font-semibold text-white">How this works, and how to use it</h1>
      </div>
      <p className="text-slate-400 mb-6">
        No background needed. Ten minutes here and you will know what the sliders do and which of them
        actually matter.
      </p>

      {/* ---------------------------------------------------------------- */}
      <H>The one idea</H>
      <P>
        Imagine a few hundred people, each with an opinion about the same thing — your launch, your paper,
        your announcement. Some are enthusiastic, some hostile, most somewhere in between.
      </P>
      <P>
        Now the only rule: <strong>people talk to the people they know, and they only really listen to
        views that are not too far from their own.</strong> If a colleague says something close to what you
        already think, you move a little toward them. If they say something wildly opposed, you do not
        move — and if it is far enough out, you may even dig in against it.
      </P>
      <P>
        That is the whole model. Run it a few hundred times over a few hundred people and something
        happens that nobody put in: the group settles into one view, or splits into two hostile camps, or
        breaks into a dozen small islands. <strong>Which of those happens is the result</strong> — it is
        not decided in advance, and nothing here writes it for you.
      </P>
      <div className="bg-slate-900 border border-slate-800 border-l-2 border-l-emerald-500 rounded-r-lg p-3 my-4">
        <p className="text-[13px] text-slate-300 m-0">
          This is why it is a simulation and not a chatbot answer. A language model asked “how will people
          react?” gives you its impression of similar situations. Here, the outcome is produced by a
          mechanism you can inspect, change and disagree with.
        </p>
      </div>

      {/* ---------------------------------------------------------------- */}
      <H>What the four outcomes mean</H>
      <div className="grid sm:grid-cols-2 gap-2 my-3">
        {[
          ['Consensus', '#34d399', 'One view wins. Everyone ends up roughly agreeing — which can mean agreeing against you.'],
          ['Divided', '#fbbf24', 'A spread of positions with no hard front. Disagreement without a fight.'],
          ['Polarised', '#f87171', 'Two substantial camps, far apart, and they have stopped listening to each other.'],
          ['Fragmented', '#a78bfa', 'Many small groups, none dominant. A conversation that never converged.'],
        ].map(([name, colour, note]) => (
          <div key={name} className="bg-slate-900 border border-slate-800 rounded-lg p-3">
            <span className="text-[13px] font-semibold" style={{ color: colour }}>{name}</span>
            <p className="text-[12px] text-slate-400 mt-1 mb-0 leading-snug">{note}</p>
          </div>
        ))}
      </div>
      <P>
        Watch the <em>shares</em> as well as the label. “Consensus” with 70 % opposed is a clear result and
        a bad one. The histogram under the chart shows the actual distribution — always look at it before
        believing the headline.
      </P>

      {/* ---------------------------------------------------------------- */}
      <H><span className="inline-flex items-center gap-2"><Lightbulb size={17} className="text-amber-400" />If you change only one thing</span></H>
      <P>
        Change <strong className="text-emerald-400">confidence</strong>. It is how far from their own view
        a person still listens, and it decides more than everything else combined.
      </P>
      <P>
        Set it wide (above ~0.8) and almost any population talks itself into agreement. Set it narrow
        (below ~0.2) and groups stop hearing each other; whatever divisions existed at the start harden and
        stay. Most real audiences live somewhere between 0.25 and 0.5 — but that is a guess, not a
        measurement, and it is exactly the assumption worth testing with a sweep.
      </P>

      {/* ---------------------------------------------------------------- */}
      <H><span className="inline-flex items-center gap-2"><Sliders size={17} className="text-purple-400" />The parameters, one by one</span></H>

      <h3 className="text-white font-medium mt-5 mb-1 text-[15px]">The people (set per faction)</h3>
      <p className="text-[12px] text-slate-500 mb-1">
        A faction is a group with similar starting attitudes. Three to six is usually enough; more rarely
        adds insight.
      </p>
      <Param name="share" what="how much of the audience this group is"
        up="this group's dynamics dominate the whole run"
        down="the group becomes a minority that can still matter if it is stubborn"
        watch="Shares are normalised, so they need not add to exactly 1 — but if one group is 90 % of the room, you are really simulating one group." />
      <Param name="opinion" what="where the group starts, from −1 hostile to +1 enthusiastic"
        up="starts friendlier to your scenario" down="starts more hostile"
        watch="Be honest here. A cast where everyone starts mildly positive will tell you what you hoped to hear." />
      <Param name="spread" what="how varied opinions are inside the group"
        up="a loose group whose members disagree among themselves"
        down="a tight bloc that moves as one" />
      <Param name="confidence" what="how different a view can be before they stop listening"
        up="more minds change; the room converges"
        down="the room stops talking to itself and divisions freeze"
        watch="The single most consequential parameter. If you sweep one thing, sweep this." />
      <Param name="stubbornness" what="how little they move when they do listen"
        up="opinions barely budge; the starting distribution largely survives"
        down="opinions move easily and the last thing said carries a lot of weight" />
      <Param name="activity" what="how often they speak at all"
        up="this group shapes the conversation out of proportion to its size"
        down="a silent majority — present in the numbers, absent from the argument"
        watch="Real publics are mostly quiet. A cast where everyone is at 0.9 is a comment section, not an audience." />
      <Param name="zealots" what="the fraction who never change their mind at all"
        up="a hard core that pulls others in and cannot be pulled"
        down="a movable population"
        watch="Small numbers here do a lot. A committed 10 % can hold a position that 90 % drift toward — this is how minorities turn majorities." />

      <h3 className="text-white font-medium mt-6 mb-1 text-[15px]">The world they live in</h3>
      <Param name="Agents" what="how many people are in the simulation"
        up="smoother, more reliable numbers; slower runs"
        down="noisier results that swing between seeds"
        watch="Below ~150 the run-to-run scatter is large enough to mislead. Use a few hundred." />
      <Param name="Topology" what="who talks to whom"
        up="—" down="—"
        watch="Small world: everyone talks to neighbours plus a few distant contacts — a professional community. Scale free: a few very well-connected people reach everyone — public social networks, where one voice can turn a run. Random: a control case with no structure. This choice often matters more than any personality setting." />
      <Param name="Neighbours / Edges per node" what="how many people each person talks to"
        up="ideas travel fast and the room converges sooner"
        down="local pockets survive much longer" />
      <Param name="Rewiring" what="how many contacts are distant rather than local (small world only)"
        up="closer to a random mixing bowl; local clusters dissolve"
        down="a ring of neighbours where news travels slowly"
        watch="Those few long-distance links are what let a view escape its corner. Set it to 0 and watch clusters survive that otherwise would not." />
      <Param name="Convergence" what="how far two people move toward each other when they do listen"
        up="fast, sometimes unrealistically decisive shifts"
        down="slow drift; you may need more steps to see the end state" />
      <Param name="Repulsion" what="how strongly people push away from views they find far too extreme"
        up="camps harden and separate — the mechanism behind polarisation"
        down="almost everything ends in agreement"
        watch="Set this to 0 and nearly every population reaches consensus. That is a known weakness of the simpler models, and it is empirically wrong — real audiences do split." />
      <Param name="Repulsion threshold" what="how far apart two views must be before disagreement pushes people apart"
        up="repulsion rarely triggers; set to 2 it is effectively off"
        down="people are pushed apart easily and polarise quickly" />
      <Param name="Steps" what="how long the conversation runs"
        up="the population settles fully"
        down="you see the early dynamics, before things have finished moving"
        watch="If the lines in the chart are still moving at the right-hand edge, the run ended too early — the result is a snapshot mid-argument." />
      <Param name="Seed" what="which particular random draw you are watching"
        up="—" down="—"
        watch="Same seed, same run, exactly. Different seed, a different draw of the same population. One seed is one anecdote — this is what the Robustness tab is for." />

      <h3 className="text-white font-medium mt-6 mb-1 text-[15px]">The launch itself</h3>
      <Param name="Step of publication" what="when your announcement lands"
        up="the audience has already formed views before you speak"
        down="you speak into a room that has not made up its mind" />
      <Param name="Strength" what="how much the message moves those it reaches" up="a louder message" down="a quieter one" />
      <Param name="Reach" what="what fraction of the audience it reaches, best-connected first"
        up="broad exposure" down="a narrow announcement that spreads by word of mouth or not at all" />
      <Param name="Direction" what="whether the message lands well (+1) or backfires (−1)"
        up="—" down="—"
        watch="Try −1 once. Modelling a launch that lands badly is often more instructive than modelling one that goes to plan." />

      {/* ---------------------------------------------------------------- */}
      <H><span className="inline-flex items-center gap-2"><AlertTriangle size={17} className="text-red-400" />Four mistakes that are easy to make</span></H>
      <ol className="list-decimal pl-5 space-y-2 text-slate-300">
        <li><strong>Believing one run.</strong> Every run is one roll of the dice. Before you take a result
        seriously, open <em>Robustness</em>: if the same regime comes back in fewer than about eight runs
        out of ten, you have learned something about the dice and not about the audience.</li>
        <li><strong>Tuning until you like the answer.</strong> The parameters are assumptions, not dials to
        be adjusted toward a preferred conclusion. If you find yourself nudging confidence upward because
        the result looked bad, you have stopped simulating and started wishing.</li>
        <li><strong>Reading it as a forecast.</strong> It is not one, and nothing here has been calibrated
        against a real audience. What it gives you is: <em>if</em> the room looks like this, <em>then</em>
        this follows. The value is in seeing which assumptions the conclusion actually depends on.</li>
        <li><strong>Ignoring the tipping point.</strong> The most useful output is not the outcome but the
        distance to the point where it changes. If a small change in confidence flips polarised into
        consensus, your conclusion is fragile — and knowing that is worth more than the conclusion.</li>
      </ol>

      {/* ---------------------------------------------------------------- */}
      <H><span className="inline-flex items-center gap-2"><FlaskConical size={17} className="text-sky-400" />Three things worth trying</span></H>
      <div className="space-y-3">
        {[
          ['Watch consensus collapse', 'Set repulsion to 0 and run. Then raise it to 0.15 and run again with the same seed. Almost the same population, opposite outcome — this is the mechanism that makes polarisation possible at all.'],
          ['See topology decide', 'Keep everything fixed and switch from small world to scale free. Then open the Network tab and watch which agents change first: on a scale-free network the well-connected turn their neighbourhoods, and the whole run follows a handful of people.'],
          ['Find your own tipping point', 'Open Sweep, choose confidence, run it. The marked transitions tell you how far your guess about your audience may be wrong before your conclusion changes. If the tipping point sits right next to your assumption, that is the finding.'],
        ].map(([title, body]) => (
          <div key={title} className="bg-slate-900 border border-slate-800 rounded-lg p-3">
            <p className="text-[13px] font-medium text-white mb-1">{title}</p>
            <p className="text-[12px] text-slate-400 m-0 leading-snug">{body}</p>
          </div>
        ))}
      </div>

      {/* ---------------------------------------------------------------- */}
      <H>Where the language model comes in — and where it does not</H>
      <P>
        Twice, both optional, and never inside the dynamics. <em>Draft the population</em> turns your
        scenario into a starting cast with parameters, so you do not have to invent seven numbers per group
        from nothing. <em>Interpret this run</em> explains a finished result in terms of the parameters that
        produced it.
      </P>
      <P>
        It cannot change a measurement. If the simulation says 42 % opposed, that is what the reading has to
        work with. And the whole simulation runs without either — the model is a convenience at the start
        and a translator at the end, not the thing doing the work.
      </P>

      <p className="text-[12px] text-slate-500 mt-8 border-t border-slate-800 pt-3">
        The full method, the sources for the model, and the limits are in the <strong>About</strong> tab;
        the operator and privacy details are under <strong>Legal</strong>.
      </p>
    </div>
  );
}
