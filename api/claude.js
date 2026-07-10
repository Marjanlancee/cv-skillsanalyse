// ═══════════════════════════════════════════════════════════════
// Dit bestand hoort in de map "api" te staan, in de hoofdmap van je
// project (dus naast je "src"-map), met de bestandsnaam: claude.js
//
// Volledig pad: api/claude.js
//
// WAT DIT DOET:
// Dit is een "achterkamertje" dat op de server draait (niet in de
// browser van de bezoeker). Het ontvangt het verzoek van je website,
// stuurt het door naar Claude AI mét jouw geheime sleutel, en geeft
// het antwoord terug. Zo ziet niemand jouw sleutel, en werkt het
// verzoek ook niet vast door browserbeveiliging (CORS).
// ═══════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Alleen POST-verzoeken toegestaan" } });
  }

  try {
    const { messages, max_tokens } = req.body;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: max_tokens || 1000,
        messages,
      }),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: { message: error.message } });
  }
}
