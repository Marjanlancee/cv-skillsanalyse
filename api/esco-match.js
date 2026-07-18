// ═══════════════════════════════════════════════════════════════
// Dit bestand hoort in: api/esco-match.js
//
// WAT DIT DOET (nieuwe versie — betekenis-zoeken):
// Matcht een los stukje tekst (bijv. "nauwkeurigheid") aan de
// dichtstbijzijnde officiële ESCO-skill, door BETEKENIS te vergelijken
// in plaats van woorden. Zo wordt bijvoorbeeld "nauwkeurigheid" wél
// herkend als vergelijkbaar met "zorgvuldig werken", ook al delen ze
// geen enkel woord.
//
// Dit gebruikt de gedeelde esco_embeddings-tabel in Supabase — dezelfde
// tabel die ook andere tools (taakskills-tool, CompetentNL/Lightcast-
// tools) straks kunnen gebruiken.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://stzgxsgocqbuquzavgsu.supabase.co";
const SUPABASE_KEY = "sb_publishable_JaDLY5jH7poc4oRjx_EoeQ_c2jyT39c";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Onder deze grens (0-1) beschouwen we het niet als een goede match
const MINIMALE_ZEKERHEID = 0.70;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Alleen POST-verzoeken toegestaan" });
  }

  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: "Parameter 'text' is verplicht" });
  }

  try {
    // Stap 1: de zoekterm omzetten naar een "betekenis-vingerafdruk"
    const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
    });
    const embedData = await embedRes.json();
    if (!embedData.data) {
      return res.status(200).json({ match: null, reden: "kon geen betekenis-vingerafdruk maken" });
    }
    const queryEmbedding = embedData.data[0].embedding;

    // Stap 2: de dichtstbijzijnde skill(s) opzoeken in de gedeelde tabel (alleen binnen ESCO)
    const { data: resultaten, error } = await supabase.rpc("match_skill", {
      query_embedding: queryEmbedding,
      match_count: 1,
      filter_bron: "esco",
    });

    if (error || !resultaten || resultaten.length === 0) {
      return res.status(200).json({ match: null, reden: "geen kandidaten gevonden" });
    }

    const beste = resultaten[0];
    if (beste.similarity < MINIMALE_ZEKERHEID) {
      return res.status(200).json({ match: null, reden: "geen goede match gevonden" });
    }

    res.status(200).json({
      match: {
        label: beste.label,
        code: beste.code,
        uri: beste.uri,
        type: beste.type,
        confidence: beste.similarity,
      },
    });
  } catch (error) {
    res.status(200).json({ match: null, error: error.message });
  }
}
