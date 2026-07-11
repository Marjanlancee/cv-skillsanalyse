// ═══════════════════════════════════════════════════════════════
// Dit bestand hoort in: api/esco-match.js
//
// WAT DIT DOET:
// Matcht een los stukje tekst (bijv. "veldbekabeling" of "elektrotechnische
// installaties aanleggen") aan de dichtstbijzijnde officiële ESCO-skill,
// op dezelfde manier als de taakskills-analyse-tool: eerst een voorselectie
// van kandidaten uit de echte ESCO-lijst, daarna laat Claude de beste
// kiezen op basis van de definitie — zodat er nooit een verzonnen
// code/URI kan ontstaan.
//
// BRONGEGEVENS: dezelfde twee bestanden als de taakskills-analyse-tool
//   - esco_hardskills.json  (~13.000 vakinhoudelijke skills)
//   - esco_softskills.json  (~90 transversale/soft skills)
// ═══════════════════════════════════════════════════════════════

const HARDSKILLS_URL = "https://raw.githubusercontent.com/Marjanlancee/taakskills-analyse-esco/refs/heads/main/esco_hardskills.json";
const SOFTSKILLS_URL = "https://raw.githubusercontent.com/Marjanlancee/taakskills-analyse-esco/refs/heads/main/esco_softskills.json";

// Cache in het geheugen van de server, zodat we niet bij elke aanvraag
// opnieuw de hele lijst (13.000+ items) hoeven te downloaden.
let escoCache = null;

async function laadEscoData() {
  if (escoCache) return escoCache;
  const [hardRes, softRes] = await Promise.all([fetch(HARDSKILLS_URL), fetch(SOFTSKILLS_URL)]);
  const hard = await hardRes.json();
  const soft = await softRes.json();
  // Elke regel heeft de vorm: [label, code, type, uri, definitie]
  escoCache = [...hard, ...soft].map(([label, code, type, uri, definitie]) => ({ label, code, type, uri, definitie }));
  return escoCache;
}

/** Simpele voorselectie: score kandidaten op woordoverlap met de zoekterm. */
function vindKandidaten(zoekterm, alleSkills, aantal = 12) {
  const zoekwoorden = zoekterm.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const gescoord = alleSkills.map(skill => {
    const tekst = (skill.label + " " + skill.definitie).toLowerCase();
    const score = zoekwoorden.filter(w => tekst.includes(w)).length;
    return { ...skill, score };
  });
  return gescoord.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, aantal);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Alleen POST-verzoeken toegestaan" });
  }

  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: "Parameter 'text' is verplicht" });
  }

  try {
    const alleSkills = await laadEscoData();
    const kandidaten = vindKandidaten(text, alleSkills);

    if (kandidaten.length === 0) {
      return res.status(200).json({ match: null, reden: "geen kandidaten gevonden" });
    }

    // Claude kiest de beste match uit de ECHTE kandidatenlijst — nooit
    // een zelfverzonnen code, precies zoals bij de taakskills-analyse-tool.
    const prompt = `Je krijgt een term uit een CV en een lijst met mogelijke ESCO-skills. Kies de skill die semantisch het beste past bij de term, gebaseerd op de definitie — niet alleen op letterlijke woorden.

Term uit CV: "${text}"

Mogelijke ESCO-skills:
${kandidaten.map((k, i) => `${i + 1}. "${k.label}" — ${k.definitie}`).join("\n")}

Antwoord ALLEEN met dit JSON-object (geen uitleg, geen backticks):
{"beste_match_nummer": <nummer 1-${kandidaten.length}, of 0 als geen enkele skill goed past>, "confidence": <getal tussen 0 en 1>}`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const antwoordTekst = claudeData.content?.map(b => b.text || "").join("") || "{}";
    const { beste_match_nummer, confidence } = JSON.parse(antwoordTekst.replace(/```json|```/g, "").trim());

    if (!beste_match_nummer || beste_match_nummer === 0) {
      return res.status(200).json({ match: null, reden: "geen goede match gevonden" });
    }

    const gekozenSkill = kandidaten[beste_match_nummer - 1];
    res.status(200).json({
      match: {
        label: gekozenSkill.label,
        code: gekozenSkill.code,
        uri: gekozenSkill.uri,
        type: gekozenSkill.type === "tr" ? "softskill" : "hardskill",
        confidence: confidence || 0.5,
      },
    });
  } catch (error) {
    // Bij een fout geven we gewoon "geen match" terug, zodat het opslaan
    // van de rest van het skillsprofiel niet vastloopt.
    res.status(200).json({ match: null, error: error.message });
  }
}
