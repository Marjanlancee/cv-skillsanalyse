// ═══════════════════════════════════════════════════════════════
// Dit bestand hoort in: api/embed-batch.js
//
// WAT DIT DOET (eenmalig te gebruiken):
// Haalt de ESCO-skills-lijst op, zet er per portie (standaard 100
// tegelijk) een "betekenis-vingerafdruk" (embedding) voor, en slaat
// dat op in de nieuwe esco_embeddings-tabel. Omdat er 13.000+ skills
// zijn, moet dit in kleine stapjes — dit bestand verwerkt telkens
// één portie en vertelt waar de volgende moet beginnen.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";

const HARDSKILLS_URL = "https://raw.githubusercontent.com/Marjanlancee/taakskills-analyse-esco/refs/heads/main/esco_hardskills.json";
const SOFTSKILLS_URL = "https://raw.githubusercontent.com/Marjanlancee/taakskills-analyse-esco/refs/heads/main/esco_softskills.json";

let escoCache = null;
async function laadEscoData() {
  if (escoCache) return escoCache;
  const [hardRes, softRes] = await Promise.all([fetch(HARDSKILLS_URL), fetch(SOFTSKILLS_URL)]);
  const hard = await hardRes.json();
  const soft = await softRes.json();
  escoCache = [...hard, ...soft].map(([label, code, type, uri, definitie]) => ({
    label, code, uri, definitie, type: type === "tr" ? "softskill" : "hardskill",
  }));
  return escoCache;
}

export default async function handler(req, res) {
  const offset = parseInt(req.query.offset || "0", 10);
  const limit = parseInt(req.query.limit || "100", 10);

  try {
    const alle = await laadEscoData();
    const batch = alle.slice(offset, offset + limit);

    if (batch.length === 0) {
      return res.status(200).json({ done: true, totaal: alle.length });
    }

    // In één keer een "betekenis-vingerafdruk" ophalen voor de hele portie.
    // BELANGRIJK: we gebruiken alleen het label (niet de definitie erbij), omdat
    // een zoekterm ook altijd kort is (bijv. "Nauwkeurigheid") — zo vergelijken
    // we appels met appels in plaats van een kort woord met een lange definitie.
    const teksten = batch.map(s => s.label);
    const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: teksten }),
    });
    const embedData = await embedRes.json();

    if (!embedData.data) {
      return res.status(500).json({ error: "Fout bij ophalen embeddings", details: embedData });
    }

    const supabase = createClient(
      "https://stzgxsgocqbuquzavgsu.supabase.co",
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const rijen = batch.map((s, i) => ({
      bron_taxonomie: "esco",
      label: s.label,
      code: s.code,
      uri: s.uri,
      definitie: s.definitie,
      type: s.type,
      embedding: embedData.data[i].embedding,
    }));

    const { error } = await supabase.from("skills_embeddings").insert(rijen);
    if (error) return res.status(500).json({ error: error.message });

    res.status(200).json({
      done: false,
      verwerkt: offset + batch.length,
      totaal: alle.length,
      volgendeOffset: offset + limit,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
