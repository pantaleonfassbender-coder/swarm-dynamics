/*
 * Der einzige Modellaufruf dieser Seite — und er tut nur noch zwei Dinge.
 *
 * Vorher lief hier die ganze Simulation: ein Aufruf erzeugte fuenf Personas,
 * drei weitere schrieben je eine komplette Diskussionsrunde, ein fuenfter
 * deutete das Ergebnis. Das Modell war damit Autor und Gutachter zugleich, und
 * die "Stimmungsentwicklung" war seine Behauptung.
 *
 * Jetzt laeuft die Dynamik im Browser (src/swarm.js), und das Modell macht das,
 * worin es gut ist:
 *   population  aus einem Szenario eine Fraktionsbeschreibung mit Parametern
 *   reading     zu einem fertig gerechneten Ergebnis eine Deutung samt Stimmen
 *
 * Anthropic statt Gemini, ueber Netlifys AI Gateway: ANTHROPIC_API_KEY und
 * ANTHROPIC_BASE_URL werden zur Laufzeit injiziert, es liegt kein Schluessel im
 * Quelltext. Der Wechsel hat einen sachlichen Grund und nicht nur einen
 * Geschmack: Beide Aufgaben verlangen striktes JSON nach vorgegebenem Schema.
 */

import type { Config, Context } from "@netlify/functions"

const MODEL = env("SWARM_MODEL") || "claude-sonnet-4-6"
const FALLBACK = ["claude-sonnet-4-5", "claude-3-7-sonnet-latest"]
const MAX_SCENARIO = 12_000

function env(key: string): string | undefined {
  const g = globalThis as any
  return g.Netlify?.env?.get(key) ?? g.process?.env?.[key]
}

/* Die Parameter, die das Modell setzen darf, sind genau die des Modells in
   src/swarm.js — nicht mehr. Es beschreibt eine Population; es simuliert sie
   nicht und es deutet an dieser Stelle auch nichts. */
const POPULATION_SYSTEM = `You translate a real-world scenario into the starting population of an opinion-dynamics simulation. You do not simulate anything and you do not predict outcomes — the simulation does that. You describe who is in the room.

Return ONLY valid JSON, no prose and no code fences:
{
  "factions": [
    {
      "name": "short label, 2-4 words",
      "note": "one sentence: who these people are and what they care about here",
      "share": 0.25,
      "opinion": -0.4,
      "spread": 0.2,
      "confidence": 0.35,
      "stubbornness": 0.55,
      "activity": 0.7,
      "zealots": 0.05
    }
  ],
  "reasoning": "two sentences on why this cast, and on the single most uncertain assumption in it"
}

Parameter meanings — respect them exactly:
- share: fraction of the population, all shares sum to 1.0
- opinion: mean initial stance toward the scenario, -1 hostile … +1 enthusiastic
- spread: standard deviation of that stance within the faction, 0.05-0.5
- confidence: how far from their own view a person still listens, 0.05-0.9. This is the most consequential parameter: below ~0.2 groups stop hearing each other and the population fragments.
- stubbornness: how little they move when they do listen, 0-0.95
- activity: how often they speak at all, 0.05-1
- zealots: fraction who never move at all, 0-0.5

Rules:
1. Between 3 and 6 factions. Fewer is usually truer than more.
2. Shares must sum to 1.0.
3. Include the quiet majority. Most real publics are mostly indifferent, and a cast made only of loud partisans produces a simulation that tells you nothing you did not already assume.
4. Differentiate the parameters. If every faction gets confidence 0.4 and stubbornness 0.5, you have not described a population, you have described a fog.
5. Base the cast on the scenario given, not on a generic internet.`

const READING_SYSTEM = `You interpret the result of an opinion-dynamics simulation that has already run. The numbers are given to you; they are measurements of the simulated population, not opinions you may revise.

Return ONLY valid JSON, no prose and no code fences:
{
  "headline": "one sentence naming what happened to this population",
  "mechanism": "two to four sentences: WHY it happened, in terms of the parameters — confidence radii, stubbornness, zealots, topology, the shock. Name the parameter that mattered most.",
  "voices": [
    { "faction": "faction name", "stance": 0.6, "quote": "one sentence this person would plausibly post" }
  ],
  "risk": "the single most consequential thing that could go wrong for whoever runs this scenario in reality",
  "fragility": "which one parameter, if it were slightly different, would change the outcome most — and in which direction"
}

Rules:
1. The measurements are given. Do not contradict them, do not soften them, do not invent numbers that were not supplied.
2. Explain by mechanism, not by narrative. "The sceptics had a confidence radius of 0.18 and stopped hearing the majority by step 40" is an explanation; "the community was divided" is not.
3. One voice per faction, at most six. A quote is an illustration of a simulated stance, not evidence about real people.
4. Say plainly where the simulation is weakest for this scenario.
5. Sober analytical English. No marketing register.`

export default async (req: Request, _ctx: Context) => {
  let body: any
  try { body = await req.json() } catch { return json({ error: "Malformed JSON." }, 400) }

  const task = body?.task === "reading" ? "reading" : "population"
  const key = env("ANTHROPIC_API_KEY")
  const base = (env("ANTHROPIC_BASE_URL") || "https://api.anthropic.com").replace(/\/$/, "")

  if (!key) {
    return json({
      error: "No access to the Anthropic endpoint is configured. In Netlify, enable AI Gateway under " +
             "Project configuration → AI Gateway, or set ANTHROPIC_API_KEY. The simulation itself runs " +
             "in your browser and does not need it — only the population draft and the reading do.",
    }, 503)
  }

  let system: string, user: string
  if (task === "population") {
    const scenario = String(body?.scenario || "").slice(0, MAX_SCENARIO).trim()
    if (scenario.length < 10) return json({ error: "Describe the scenario in a sentence or two." }, 400)
    system = POPULATION_SYSTEM
    user = `SCENARIO\n\n${scenario}\n\nDescribe the population that would react to this.`
  } else {
    const scenario = String(body?.scenario || "").slice(0, 4000).trim()
    const factions = JSON.stringify(body?.factions ?? []).slice(0, 6000)
    const result = JSON.stringify(body?.result ?? {}).slice(0, 6000)
    const params = JSON.stringify(body?.params ?? {}).slice(0, 2000)
    system = READING_SYSTEM
    user = `SCENARIO\n${scenario}\n\nPOPULATION AS CONFIGURED\n${factions}\n\nSIMULATION PARAMETERS\n${params}\n\nMEASURED RESULT\n${result}\n\nInterpret this run.`
  }

  let last = ""
  for (const model of [MODEL, ...FALLBACK]) {
    try {
      const r = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model, max_tokens: 2000, temperature: 0.4,
          system, messages: [{ role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(22_000),
      })
      if (!r.ok) { last = `${model}: HTTP ${r.status}`; continue }
      const data = await r.json()
      const finish = data?.stop_reason
      const text = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim()
      // Am Token-Limit abgeschnittenes JSON laesst sich nicht parsen; das als
      // "Modell nicht erreichbar" zu melden hat anderswo schon Stunden gekostet.
      if (finish === "max_tokens") { last = `${model}: answer truncated at the token limit`; continue }
      if (!text) { last = `${model}: empty answer`; continue }
      const parsed = parseLenient(text)
      if (!parsed) { last = `${model}: answer was not valid JSON`; continue }
      return json({ ...parsed, model })
    } catch (e: any) {
      last = `${model}: ${e?.message ?? e}`
    }
  }
  return json({ error: `No model in the chain answered. Last: ${last}` }, 502)
}

/* Modelle liefern trotz klarer Anweisung gelegentlich Code-Zaeune oder einen
   Satz davor. Den Lauf daran scheitern zu lassen waere Verschwendung. */
function parseLenient(text: string): any | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim()
  const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}")
  if (s === -1 || e <= s) return null
  try { return JSON.parse(cleaned.slice(s, e + 1)) } catch { return null }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { "Content-Type": "application/json" },
  })
}

export const config: Config = {
  path: "/api/model",
  method: "POST",
  // Der Endpunkt kostet echte Inferenz und steht offen im Netz. Die Simulation
  // laeuft ohne ihn, ein Missbrauch nimmt der Seite also nichts als den Entwurf.
  rateLimit: { windowSize: 60, windowLimit: 8, aggregateBy: ["ip", "domain"] },
}
