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
 * Anthropic ueber Netlifys AI Gateway, mit dem offiziellen SDK: `new Anthropic()`
 * findet ANTHROPIC_API_KEY und ANTHROPIC_BASE_URL zur Laufzeit von selbst, es
 * liegt kein Schluessel im Quelltext und keine URL wird hier zusammengesetzt.
 *
 * Warum der Endpunkt vorher 504 lieferte, und was dagegen getan ist:
 *   1. Drei Modelle nacheinander mit je 22 s Abbruch ergeben 66 s. Die harte
 *      Grenze einer synchronen Function liegt bei 60 s — die Plattform hat den
 *      Lauf beendet, bevor der Code je zu einer Antwort kam. Jetzt gilt ein
 *      gemeinsames Zeitbudget (BUDGET_MS) fuer *alle* Versuche zusammen: ein
 *      zweiter Versuch startet nur, wenn er auch fertig werden kann.
 *   2. Denkzeit ist hier der Kostentreiber, nicht die Ausgabelaenge. Derselbe
 *      Entwurf braucht mit effort "medium" ueber 60 s und laeuft ins Token-Limit,
 *      mit "low" rund 13 s. Beide Aufgaben sind eng vorgegeben; sie brauchen
 *      kein langes Nachdenken, sondern ein sauberes Formular.
 *   3. Gestreamt statt gepuffert: bei einem stillen Verbindungsende haengt der
 *      Aufruf nicht bis zum Ablauf des Budgets.
 *   4. Das Schema kommt jetzt vom Server (output_config.format). Frueher war es
 *      eine Bitte im Prompt und ein Reparaturversuch danach.
 */

import type { Config, Context } from "@netlify/functions"
import Anthropic from "@anthropic-ai/sdk"

/* Gesamtbudget fuer den ganzen Aufruf. Deutlich unter der 60-s-Grenze der
   Plattform, damit im schlechtesten Fall diese Function antwortet und nicht das
   Gateway mit einem nackten 504. */
const BUDGET_MS = 45_000
/* Unter dieser Restzeit lohnt kein weiterer Versuch mehr. */
const MIN_ATTEMPT_MS = 9_000
const MAX_SCENARIO = 12_000

function env(key: string): string | undefined {
  const g = globalThis as any
  return g.Netlify?.env?.get(key) ?? g.process?.env?.[key]
}

/* Reihenfolge der Versuche: Opus fuer den Entwurf, Sonnet als schnellerer
   Rueckfall, danach noch einmal Opus. Beide sind ueber das AI Gateway
   verfuegbar. Der dritte Versuch ist kein Aberglaube: eine unbrauchbare
   Besetzung (siehe complaint()) ist Streuung, keine Eigenschaft des Modells,
   und drei Versuche passen bequem ins Budget. */
function chain(): string[] {
  const primary = env("SWARM_MODEL") || "claude-opus-5"
  return [primary, "claude-sonnet-5", primary]
}

/* Die Parameter, die das Modell setzen darf, sind genau die des Modells in
   src/swarm.js — nicht mehr. Es beschreibt eine Population; es simuliert sie
   nicht und es deutet an dieser Stelle auch nichts. */
const POPULATION_SYSTEM = `You translate a real-world scenario into the starting population of an opinion-dynamics simulation. You do not simulate anything and you do not predict outcomes — the simulation does that. You describe who is in the room, as three to six factions.

The response format is enforced by a schema; spend your effort on the cast, not on the syntax.

Parameter meanings — respect them exactly:
- share: fraction of the population, all shares sum to 1.0
- opinion: mean initial stance toward the scenario, -1 hostile … +1 enthusiastic
- spread: standard deviation of that stance within the faction, 0.05-0.5
- confidence: how far from their own view a person still listens, 0.05-0.9. This is the most consequential parameter: below ~0.2 groups stop hearing each other and the population fragments.
- stubbornness: how little they move when they do listen, 0-0.95
- activity: how often they speak at all, 0.05-1
- zealots: fraction who never move at all, 0-0.5
- name: short label, 2-4 words
- note: one sentence on who these people are and what they care about here
- reasoning: two sentences on why this cast, and on the single most uncertain assumption in it

Rules:
1. Between 3 and 6 factions — never fewer than three, each with a distinct name. A single bloc is not a population, and the simulation has nothing to do with it.
2. Shares must sum to 1.0.
3. Include the quiet majority. Most real publics are mostly indifferent, and a cast made only of loud partisans produces a simulation that tells you nothing you did not already assume.
4. Differentiate the parameters. If every faction gets confidence 0.4 and stubbornness 0.5, you have not described a population, you have described a fog.
5. Base the cast on the scenario given, not on a generic internet.`

const READING_SYSTEM = `You interpret the result of an opinion-dynamics simulation that has already run. The numbers are given to you; they are measurements of the simulated population, not opinions you may revise.

The response format is enforced by a schema. Field meanings:
- headline: one sentence naming what happened to this population
- mechanism: two to four sentences on WHY it happened, in terms of the parameters — confidence radii, stubbornness, zealots, topology, the shock. Name the parameter that mattered most.
- voices: one entry per faction, at most six, each with the faction name, its stance (-1…+1) and one sentence that person would plausibly post
- risk: the single most consequential thing that could go wrong for whoever runs this scenario in reality
- fragility: which one parameter, if it were slightly different, would change the outcome most — and in which direction

Rules:
1. The measurements are given. Do not contradict them, do not soften them, do not invent numbers that were not supplied.
2. Explain by mechanism, not by narrative. "The sceptics had a confidence radius of 0.18 and stopped hearing the majority by step 40" is an explanation; "the community was divided" is not.
3. A quote is an illustration of a simulated stance, not evidence about real people.
4. Say plainly where the simulation is weakest for this scenario.
5. Sober analytical English. No marketing register.`

/* Schemata fuer output_config.format. Die API verlangt additionalProperties:false
   und jedes Feld in required; Laengenangaben wie minItems nimmt sie nicht an —
   die Anzahl der Fraktionen bleibt deshalb eine Regel im Prompt. */
const num = { type: "number" } as const
const str = { type: "string" } as const

const POPULATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["factions", "reasoning"],
  properties: {
    factions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "note", "share", "opinion", "spread", "confidence", "stubbornness", "activity", "zealots"],
        properties: {
          name: str, note: str, share: num, opinion: num, spread: num,
          confidence: num, stubbornness: num, activity: num, zealots: num,
        },
      },
    },
    reasoning: str,
  },
}

const READING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "mechanism", "voices", "risk", "fragility"],
  properties: {
    headline: str,
    mechanism: str,
    voices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["faction", "stance", "quote"],
        properties: { faction: str, stance: num, quote: str },
      },
    },
    risk: str,
    fragility: str,
  },
}

export default async (req: Request, _ctx: Context) => {
  const started = Date.now()
  const left = () => BUDGET_MS - (Date.now() - started)

  let body: any
  try { body = await req.json() } catch { return json({ error: "Malformed JSON." }, 400) }

  const task = body?.task === "reading" ? "reading" : "population"

  if (!env("ANTHROPIC_API_KEY")) {
    return json({
      error: "No access to the Anthropic endpoint is configured. In Netlify, enable AI Gateway under " +
             "Project configuration → AI Gateway, or set ANTHROPIC_API_KEY. The simulation itself runs " +
             "in your browser and does not need it — only the population draft and the reading do.",
    }, 503)
  }

  let system: string, user: string, schema: Record<string, unknown>
  if (task === "population") {
    const scenario = String(body?.scenario || "").slice(0, MAX_SCENARIO).trim()
    if (scenario.length < 10) return json({ error: "Describe the scenario in a sentence or two." }, 400)
    system = POPULATION_SYSTEM
    schema = POPULATION_SCHEMA
    user = `SCENARIO\n\n${scenario}\n\nDescribe the population that would react to this.`
  } else {
    const scenario = String(body?.scenario || "").slice(0, 4000).trim()
    const factions = JSON.stringify(body?.factions ?? []).slice(0, 6000)
    const result = JSON.stringify(body?.result ?? {}).slice(0, 6000)
    const params = JSON.stringify(body?.params ?? {}).slice(0, 2000)
    system = READING_SYSTEM
    schema = READING_SCHEMA
    user = `SCENARIO\n${scenario}\n\nPOPULATION AS CONFIGURED\n${factions}\n\nSIMULATION PARAMETERS\n${params}\n\nMEASURED RESULT\n${result}\n\nInterpret this run.`
  }

  /* Kein Schluessel, keine base_url im Code: das SDK liest beides aus den
     Variablen, die Netlify zur Laufzeit injiziert. Ein Wiederholungsversuch des
     SDK reicht — jeder weitere geht vom selben Budget ab. */
  const client = new Anthropic({ maxRetries: 1 })

  /* Warum ein Versuch nicht getaugt hat, gehoert in die Function-Logs. Genau
     das hat beim 504 gefehlt: sichtbar war nur, dass nichts ankam. */
  let last = ""
  const fail = (why: string) => {
    last = why
    console.warn(`[model] ${task} attempt failed — ${why}`)
  }

  for (const model of chain()) {
    const budget = left()
    if (budget < MIN_ATTEMPT_MS) {
      if (!last) last = "the request budget ran out before a model answered"
      break
    }
    try {
      const stream = client.messages.stream({
        model,
        max_tokens: 6000,
        // effort "low" ist hier kein Sparzwang, sondern die Bedingung dafuer,
        // dass der Aufruf ueberhaupt in die Zeit passt: beide Aufgaben sind eng
        // vorgegeben, das Modell muss nichts entscheiden, was Nachdenken lohnt.
        output_config: { effort: "low", format: { type: "json_schema", schema } },
        system,
        messages: [{ role: "user", content: user }],
      }, { timeout: budget })

      const msg = await stream.finalMessage()
      const text = msg.content.filter(b => b.type === "text").map(b => (b as any).text).join("").trim()

      // Am Token-Limit abgeschnittenes JSON laesst sich nicht parsen; das als
      // "Modell nicht erreichbar" zu melden hat anderswo schon Stunden gekostet.
      if (msg.stop_reason === "max_tokens") { fail(`${model}: answer truncated at the token limit`); continue }
      if (msg.stop_reason === "refusal") { fail(`${model}: the request was declined`); continue }
      if (!text) { fail(`${model}: empty answer`); continue }

      const parsed = parseLenient(text)
      if (!parsed) { fail(`${model}: answer was not valid JSON`); continue }
      const wrong = complaint(task, parsed)
      if (wrong) { fail(`${model}: ${wrong}`); continue }

      return json({ ...parsed, model })
    } catch (e: any) {
      fail(`${model}: ${e?.status ? `HTTP ${e.status}` : e?.message ?? e}`)
    }
  }

  /* Eine eigene Antwort mit Grund ist auch im Fehlerfall mehr wert als ein
     abgewuergter Lauf, bei dem die Plattform 504 sagt und sonst nichts. */
  const timedOut = left() < MIN_ATTEMPT_MS
  return json(
    { error: `No model in the chain answered${timedOut ? " within the time this endpoint has" : ""}. Last: ${last}` },
    timedOut ? 504 : 502,
  )
}

/* Das Schema erzwingt die Form, nicht den Inhalt: eine einzige Fraktion mit
   Anteil 0.44 ist schematisch gueltig und als Population wertlos. Was hier
   durchkommt, muss src/swarm.js rechnen koennen — buildPopulation normiert die
   Anteile selbst, wirft aber bei nicht numerischen Parametern. Gibt den Grund
   zurueck, falls etwas fehlt, sonst null. */
function complaint(task: string, d: any): string | null {
  if (task === "population") {
    const f = d?.factions
    if (!Array.isArray(f) || f.length < 3 || f.length > 6) {
      return `expected 3 to 6 factions, got ${Array.isArray(f) ? f.length : "none"}`
    }
    for (const x of f) {
      if (!String(x?.name || "").trim()) return "a faction came back without a name"
      for (const k of ["share", "opinion", "spread", "confidence", "stubbornness", "activity", "zealots"]) {
        // Nicht +x[k]: null und "" werden dabei zu 0 und rutschen durch, und
        // src/swarm.js setzt dann still seinen Vorgabewert ein.
        if (typeof x[k] !== "number" || !Number.isFinite(x[k])) return `faction "${x.name}" has no numeric ${k}`
      }
    }
    if (f.reduce((s: number, x: any) => s + x.share, 0) <= 0) return "the shares add up to nothing"
    return null
  }
  // Das Schema verlangt die Felder, nicht ihren Inhalt: ein leerer String ist
  // schematisch in Ordnung und in der Oberflaeche ein leerer Kasten.
  for (const k of ["headline", "mechanism", "risk", "fragility"]) {
    if (!String(d?.[k] ?? "").trim()) return `the reading has no ${k}`
  }
  if (!Array.isArray(d?.voices) || !d.voices.length) return "the reading has no voices"
  return null
}

/* Das Schema erzwingt gueltiges JSON; falls ein Modell dennoch etwas davor oder
   einen Code-Zaun drumherum setzt, den Lauf daran scheitern zu lassen waere
   Verschwendung. */
function parseLenient(text: string): any | null {
  try { return JSON.parse(text) } catch { /* weiter unten */ }
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
