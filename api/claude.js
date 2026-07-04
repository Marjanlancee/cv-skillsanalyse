import fs from 'fs';
import path from 'path';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

let _hard = null;
let _soft = null;
let _lookup = null;

function laadEsco() {
  if (_hard && _soft) return;
  const dir = process.cwd();
  _hard = JSON.parse(fs.readFileSync(path.join(dir, 'public', 'esco_hardskills.json'), 'utf8'));
  _soft = JSON.parse(fs.readFileSync(path.join(dir, 'public', 'esco_softskills.json'), 'utf8'));
  _lookup = {};
  [..._hard, ..._soft].forEach(r => {
    _lookup[r[1]] = { esco_label: r[0], esco_uri: r[3], esco_definitie: r[4] || null, esco_matched: true };
  });
  console.log(`ESCO geladen: ${_hard.length} hard, ${_soft.length} soft`);
}

function selecteerRelevante(functietitel, taken) {
  const context = [functietitel, ...taken].join(' ').toLowerCase();
  const gescoord = _hard.map(row => {
    const label = row[0].toLowerCase();
    const woorden = label.split(/\s+/).filter(w => w.length > 3);
    const score = woorden.filter(w => context.includes(w)).length;
    return { row, score };
  });
  gescoord.sort((a, b) => b.score - a.score);
  return gescoord.slice(0, 300).map(g => g.row);
}

function herstelJson(json) {
  try { JSON.parse(json); return json; } catch { /**/ }
  const opens = [];
  let inStr = false, esc = false;
  for (const c of json) {
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') opens.push('}');
    else if (c === '[') opens.push(']');
    else if (c === '}' || c === ']') opens.pop();
  }
  let r = json.trimEnd().replace(/,\s*$/, '').replace(/,\s*([}\]])/g, '$1');
  for (let i = opens.length - 1; i >= 0; i--) r += opens[i];
  return r;
}

async function koppelEscoSkills(functietitel, taken, apiKey) {
  laadEsco();
  const topHard = selecteerRelevante(functietitel, taken);
  const hardLijst = topHard.map(r => `${r[0]}|${r[1]}`).join('\n');
  const softLijst = _soft.map(r => `${r[0]}|${r[1]}`).join('\n');
  const takenTekst = taken.map((t, i) => `- T${String(i+1).padStart(2,'0')}: ${t}`).join('\n');

  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      temperature: 0,
      system: 'Je bent ESCO-expert en skills-analist. Geef ALLEEN geldige JSON terug, geen markdown.\nKRITIEKE REGEL: gebruik skills UITSLUITEND uit de meegestuurde ESCO-lijsten.\nGebruik het exacte label en de exacte code. Verzin NOOIT zelf skills of codes.\nMAX 3 hardskills en 2 softskills per taak.',
      messages: [{ role: 'user', content: `Koppel ESCO-skills aan taken voor: ${functietitel}\n\nTAKEN:\n${takenTekst}\n\nBESCHIKBARE HARDSKILLS (label|code):\n${hardLijst}\n\nBESCHIKBARE SOFTSKILLS (label|code):\n${softLijst}\n\nJSON (direct, geen markdown):\n{"taken":[{"id":"T01","hardskills":[{"skill":"exacte label","esco_code":"exacte 8-karakter code","niveau":3}],"softskills":[{"softskill":"exacte label","esco_code":"exacte 8-karakter code","niveau":3}]}]}\n\nNiveaus: 1=Beginner 2=Basis 3=Gemiddeld 4=Gevorderd 5=Expert` }]
    })
  });

  if (!res.ok) throw new Error(`Claude API fout: ${res.status}`);
  const tekst = (await res.json()).content?.[0]?.text ?? '';
  let j = tekst;
  const blok = tekst.match(/```json\s*([\s\S]*?)```/);
  if (blok) j = blok[1].trim();
  else { const raw = tekst.match(/(\{[\s\S]*\})/); if (raw) j = raw[0]; }
  j = herstelJson(j);

  let parsed;
  try { parsed = JSON.parse(j); }
  catch { throw new Error('ESCO JSON parse fout: ' + tekst.slice(0, 200)); }

  return (parsed.taken ?? []).map(taak => ({
    ...taak,
    hardskills: (taak.hardskills ?? []).map(s => {
      const l = _lookup[s.esco_code] ?? {};
      return { ...s, esco_label: l.esco_label ?? s.skill, esco_uri: l.esco_uri ?? null, esco_definitie: l.esco_definitie ?? null, esco_matched: l.esco_matched ?? false };
    }),
    softskills: (taak.softskills ?? []).map(s => {
      const l = _lookup[s.esco_code] ?? {};
      return { ...s, esco_label: l.esco_label ?? s.softskill, esco_uri: l.esco_uri ?? null, esco_definitie: l.esco_definitie ?? null, esco_matched: l.esco_matched ?? false };
    }),
  }));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Alleen POST' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY niet ingesteld' });

  try {
    const body = req.body ?? {};

    if (body.stap === 'esco') {
      const { functietitel, taken } = body;
      if (!functietitel || !taken?.length) return res.status(400).json({ error: 'functietitel en taken verplicht' });
      const taken_met_skills = await koppelEscoSkills(functietitel, taken, apiKey);
      return res.status(200).json({ taken: taken_met_skills });
    }

    // Standaard: doorsturen naar Anthropic API
    const response = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('Handler fout:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
