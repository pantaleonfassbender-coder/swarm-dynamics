# SwarmDynamics

An agent-based opinion model. Hundreds of agents — up to a few thousand — change their minds only through local encounters on a social network. Consensus, polarisation and fragmentation are **outcomes of the run**, not assertions of a language model.

---

## What changed, and why it had to

The previous version was not a swarm. Each round, **one** model call wrote the messages of **all five** personas at once, having seen the entire thread. That is a single author speaking five parts: no independent agents, no local neighbourhoods, nothing emerges. The "sentiment shift" it displayed was the model's claim about a conversation it had just written itself.

Scaling that to a hundred agents would not have fixed it. A hundred agents each making their own model call is neither affordable nor more truthful — it is a hundred copies of the same model, still with no mechanism connecting them.

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

## Running it

```bash
npm install
npm run dev            # http://localhost:5173
npm run build
node src/swarm.test.mjs   # 26 checks on the engine
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
