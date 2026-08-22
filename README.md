# SwarmDynamics

An agent-based opinion model. Hundreds of agents — up to a few thousand — change their minds only through local encounters on a social network. Consensus, polarisation and fragmentation are **outcomes of the run**, not assertions of a language model.
Genuine swarm behaviour comes from **local rules on a topology**. So the dynamics moved into the browser, and the language model was moved to the two places where it is actually good:

| | Before | Now |
|---|---|---|
| Agents | 5 | 20 – 3,000 (default 400) |
| Who writes the dynamics | the model | the simulation |
| Model calls per run | 5 | 0 required, 2 optional |
| Reproducible | no | yes, by seed |
| Where it runs | server | browser, instantly |

The model now drafts a **population** from your scenario and **interprets** a finished run. It cannot change a measurement, and the simulation runs without it.

---

## The model

Bounded confidence, after Deffuant and Weisbuch (2000) and Hegselmann and Krause (2002), with repulsion after Jager and Amblard (2005).

Each agent holds an opinion in [−1, 1] and four traits. On each step, active agents meet a neighbour:

- if the two views lie within **both** confidence radii, they move toward each other;
- if they lie beyond the **repulsion threshold**, they move apart;
- otherwise nothing happens.

The repulsion is not decoration. Without it almost every population converges to a single view, which is empirically false — real publics polarise. Set it to 0 and you can watch that happen.

### Population parameters, per faction

| Parameter | Meaning |
|---|---|
| `share` | fraction of the population |
| `opinion` | mean initial stance, −1 hostile … +1 enthusiastic |
| `spread` | standard deviation of that stance within the faction |
| `confidence` | how far from their own view a person still listens — **the most consequential single parameter** |
| `stubbornness` | how little they move when they do listen |
| `activity` | how often they speak at all |
| `zealots` | fraction who never move; the reason minorities can turn majorities |

### Network and dynamics

`topology` (small world · scale free · random), neighbours `k` or edges-per-node `m`, rewiring `beta`, `convergence`, `repulsion`, `repulsionThreshold`, `steps`, `seed`, and the launch itself (`shockAt`, `shockStrength`, `shockReach`, `shockValence`).

**Topology decides more than most personality parameters.** On a scale-free network a few hubs reach everyone and a single voice can turn a run; on a small world the same population holds its clusters for far longer.

---

## What the numbers mean

Two measurement decisions are exposed rather than buried, because both changed the headline during development:

**Cluster tolerance is derived, not fixed.** How many opinion groups you count depends on how close two opinions must be to count as one. A fixed tolerance of 0.12 reported *one* group — "consensus" — for a population that had actually split into seventeen, because those groups sat 0.03 apart. The tolerance now follows the population's own confidence radii and is displayed with the result.

**The verdict does not come from the cluster count.** A population 42 % in favour and 42 % opposed was labelled "Consensus" because its opinions filled the whole range *without a gap*, and single-linkage clustering sees that as one group. The headline contradicted the histogram directly beneath it. `shape` and `polarisation` are now computed from the distribution: two substantial opposing camps are polarisation, whatever the linkage says.

---

## Code review of the previous version

Findings, most consequential first:

1. **The link attachment was a lie.** `handleAddLink` stored the URL string itself as the attachment's content. The prompt then said "context attached via link" and supplied the URL — so the model talked about a page it had never seen. Removed; only files whose text is actually extracted can be attached now.
2. **No rate limiting** on either endpoint. Five model calls per run, open to the internet. Both endpoints now carry an edge limit.
3. **No size limit** on `parse-document`: an arbitrary base64 blob went straight into `Buffer.from` and `pdf-parse`. Capped at 8 MB, checked before decoding.
4. **The retry loop retried everything**, including 400s that could never succeed — three attempts with exponential backoff to reach the same error.
5. **Tailwind from the CDN in production.** The CDN build says itself it is not for production, and it disclosed every visitor's IP to a third party. Now built locally; the site makes no external requests at all.
6. **No reproducibility.** Nothing was seeded, so no run could be repeated, shown or contested.
7. **Sentiment was authored, not measured.** The model assigned each message a sentiment score and those scores were then averaged into an "analytics" figure — a number that looks measured and is not.

---

## Four ways of asking, beyond the single run

A single run is an anecdote: one seed, one parameter choice, one answer. These four panels ask the questions a single run cannot.

### Parameter sweep — where does it tip?

Walks one axis end to end and runs every point several times. The output is a phase diagram: regime shares as coloured bands, median polarisation as a line with its 10–90 % spread, and the **tipping points** marked.

That is the useful number. On the default population, widening the confidence radius tips the outcome from *polarised* to *divided* at ≈ 0.69 and from *divided* to *consensus* at ≈ 0.83. It tells you how far your assumption may be wrong before the conclusion is a different one.

An axis that changes nothing produces no transitions — also a finding, and a reassuring one.

### Seed robustness — does the finding hold?

The same setup over many draws, reporting how often the same regime comes back. Under about 80 % agreement it says so plainly; under 60 % it says the result is about the dice rather than the population.

### Compare an intervention — paired, not independent

Two setups over the **same seeds**, so the difference measures the intervention and not the draw. Five interventions are built in: publish earlier, more reach, engage the critics, recruit advocates, soften the message.

Every measure comes with a **consistency** column: the share of seeds in which the effect went the same way. This matters more than the median. On the default population, *engage the critics* lowers polarisation by a median of −0.11 with 88 % consistency, but moves support by only +0.03 with 63 % consistency — it reliably cools the argument and does not reliably win it. A median alone would have hidden that.

### The network itself

The graph drawn with a force layout, colour by opinion, node size by degree, and a scrubber over the run. On a scale-free topology you can watch a hub turn its neighbourhood — which is the clearest argument for why topology decides more than most personality parameters. Drawn up to 900 agents; above that the picture is a smear and the panel says so instead.

### Not included: calibration against observed cases

Deliberately absent. The fitter would be quick to write; the data is not. Without a documented case whose course is known, it would fit parameters to invented numbers and return something that looks like a measurement and is not.

---

## Two bugs the tests caught, both silent

Recorded because neither would have announced itself:

**A NaN parameter disabled the dynamics instead of failing.** The chunked sweep called `sweep()` with `points: 1`, and the axis value divided by `points - 1` — zero. The resulting `NaN` passed straight through `clamp()`, and in the step function every comparison against `NaN` is false, so no agent ever moved toward another. The sweep quietly computed a *different model* and reported its numbers as findings. Fixed at both ends: the division is guarded, and a non-finite faction parameter now throws.

**The verdict contradicted the histogram.** Described above under *What the numbers mean* — worth repeating that both of these produced plausible output. Nothing crashed; the screen just said something untrue.

---

## Running it

```bash
npm install
npm run dev            # http://localhost:5173
npm run build
node src/swarm.test.mjs      # 26 checks on the engine
node src/analysis.test.mjs   # 24 checks on sweep, robustness, compare, layout
```

The engine (`src/swarm.js`) is pure functions with no React and no network, which is why it can be tested at all. The tests assert what the model must do: same seed same result, symmetric networks without isolated nodes, scale-free topologies with real hubs, and each of the three regimes following from its parameters.

Deployment is Netlify: `npm run build`, publish `dist`, functions from `netlify/functions`.

### Environment

No API key of your own is needed: Netlify's **AI Gateway** injects `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL`. Optional: `SWARM_MODEL` (default `claude-sonnet-4-6`, with two fallbacks).

Provider switched from Google Gemini to Anthropic. Both remaining model tasks demand strict JSON against a fixed schema, which is what the switch was for.

---

## Limits

- **Not a forecast.** It shows what follows from assumptions you made explicit. Change a confidence radius and the answer changes — that sensitivity *is* the finding.
- **Not calibrated.** No parameter here was fitted to data about any real audience. A drafted population is a plausible guess.
- **Seed-sensitive.** Run it several times. If the outcome flips between seeds, that is the answer.
- **Agents are numbers, not people.** The quotes in the reading illustrate a simulated stance; they are not evidence about anyone.

---

## Legal and privacy

See the **Legal** tab in the app. In short: the simulation never leaves your browser; only *Draft the population* and *Interpret this run* send anything, and only when pressed. No cookies, no analytics, no external requests.

© 2026 — Dr. Pantaleon Fassbender — pantaleonfassbender@gmail.com
