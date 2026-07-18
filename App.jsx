import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import mammoth from "mammoth";

// ═══════════════════════════════════════════════════════════════
// SUPABASE — koppeling met de SkillsPortaal database
// ═══════════════════════════════════════════════════════════════
const SUPABASE_URL = "https://stzgxsgocqbuquzavgsu.supabase.co";
const SUPABASE_KEY = "sb_publishable_JaDLY5jH7poc4oRjx_EoeQ_c2jyT39c";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const NIVEAUS = ["Beginner", "Basis", "Gemiddeld", "Gevorderd", "Expert"];

const KLEUR = {
  inkt: "#1e2a35",
  inktLicht: "#45566b",
  messing: "#b8863f",
  messingDonker: "#8a6530",
  papier: "#faf7f0",
  lijn: "#e3ded0",
};

// ─── Matcht een lijst skill-teksten parallel (sneller dan één voor één). ──
async function verrijkMetEsco(teksten) {
  const matches = await Promise.all(teksten.map(tekst => vindEscoMatch(tekst)));
  return teksten.map((tekst, i) => ({ tekst, esco: matches[i] }));
}

async function vindEscoMatch(skillLabel) {
  try {
    const res = await fetch("/api/esco-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: skillLabel }),
    });
    const data = await res.json();
    return data.match || null;
  } catch {
    return null;
  }
}

async function slaCvSkillsOp(functieSkills, hobbySkills, beoordelingen, authUserId, email) {
  try {
    const medewerkerId = await vindOfMaakMedewerker(authUserId, email);
    const alleItems = [];
    Object.values(functieSkills).forEach(taken => {
      taken.forEach(t => {
        (t.hardskills || []).forEach(item => alleItems.push(item));
        (t.softskills || []).forEach(item => alleItems.push(item));
      });
    });
    (hobbySkills || []).forEach(item => alleItems.push(item));

    const uniek = new Map();
    alleItems.forEach(item => { if (!uniek.has(item.tekst)) uniek.set(item.tekst, item); });

    let opgeslagen = 0, escoGematcht = 0;
    for (const [tekst, item] of uniek) {
      const skillId = await vindOfMaakSkill(tekst);
      const goed = beoordelingen[tekst] || 3;
      await koppelSkillAanMedewerker(medewerkerId, skillId, NIVEAUS[goed - 1]);
      if (item.esco) { await slaEscoMatchOp(skillId, item.esco); escoGematcht++; }
      opgeslagen++;
    }
    return { success: true, aantalSkillsOpgeslagen: opgeslagen, aantalEscoGematcht: escoGematcht };
  } catch (error) {
    console.error("Fout bij opslaan:", error);
    return { success: false, error: error.message };
  }
}

async function vindOfMaakMedewerker(authUserId, email) {
  const { data: bestaande } = await supabase.from("medewerkers").select("id").eq("auth_user_id", authUserId).maybeSingle();
  if (bestaande) return bestaande.id;
  const { data: nieuwe, error } = await supabase.from("medewerkers").insert({ auth_user_id: authUserId, email }).select("id").single();
  if (error) throw error;
  return nieuwe.id;
}

async function vindOfMaakSkill(skillLabel) {
  const { data: bestaande } = await supabase.from("skills").select("id").eq("bron_label", skillLabel).eq("bron_taxonomie", "eigen").maybeSingle();
  if (bestaande) return bestaande.id;
  const { data: nieuwe, error } = await supabase.from("skills").insert({ bron_taxonomie: "eigen", bron_label: skillLabel }).select("id").single();
  if (error) throw error;
  return nieuwe.id;
}

async function koppelSkillAanMedewerker(medewerkerId, skillId, niveau) {
  const { error } = await supabase.from("medewerker_skills").insert({ medewerker_id: medewerkerId, skill_id: skillId, bron: "cv_analyse", niveau: niveau || null });
  if (error) console.error("Fout bij koppelen skill:", error);
}

async function slaEscoMatchOp(skillId, escoMatch) {
  const { error } = await supabase.from("skill_matches").insert({
    skill_id: skillId,
    esco_anker_code: escoMatch.uri,
    match_type: "gerelateerd",
    match_bron: "ai_suggestie",
    confidence_score: escoMatch.confidence,
  });
  if (error) console.error("Fout bij opslaan match:", error);
}

// ─── Drijfveren types ────────────────────────────────────────────────────────
const DRIJFVEER_TYPES = {
  R: { label: "De Maker", emoji: "🔧", kleur: "#c17a3a", omschrijving: "Jij houdt van praktisch werken en dingen voor elkaar krijgen. Je werkt graag met je handen of in de buitenlucht en ziet resultaat van je werk." },
  I: { label: "De Denker", emoji: "🔬", kleur: "#2f6690", omschrijving: "Jij wordt gedreven door kennis en inzicht. Je analyseert graag, stelt vragen en wil begrijpen hoe dingen werken." },
  A: { label: "De Creator", emoji: "🎨", kleur: "#7a5aa0", omschrijving: "Jij haalt energie uit creëren en vernieuwen. Je denkt buiten de kaders en wil iets neerzetten dat uniek en origineel is." },
  S: { label: "De Helper", emoji: "🤝", kleur: "#4a8a5c", omschrijving: "Jij doet het voor de mensen. Je begeleidt, ondersteunt en verbindt, en dat geeft jou energie." },
  E: { label: "De Leider", emoji: "🚀", kleur: "#b5482f", omschrijving: "Jij wil impact maken. Je overtuigt, neemt initiatief en stuurt aan op resultaat en groei." },
  C: { label: "De Organisator", emoji: "📋", kleur: "#1f7a6c", omschrijving: "Jij houdt van structuur en overzicht. Je werkt nauwkeurig, betrouwbaar en zorgt dat alles goed geregeld is." },
};

const DRIJFVEER_VRAGEN = [
  { id: 1, vraag: "Waar krijg jij het meeste energie van op je werk?", opties: [
    { tekst: "Iets bouwen, maken of repareren, zichtbaar resultaat zien", type: "R" },
    { tekst: "Een complex vraagstuk uitpluizen en tot de kern komen", type: "I" },
    { tekst: "Een creatief idee uitwerken en iets nieuws bedenken", type: "A" },
    { tekst: "Iemand echt helpen of een team beter laten functioneren", type: "S" },
    { tekst: "Een plan omzetten in actie en mensen meekrijgen", type: "E" },
    { tekst: "Alles op orde hebben en processen soepel laten lopen", type: "C" },
  ]},
  { id: 2, vraag: "Je collega's omschrijven jou als…", opties: [
    { tekst: "Iemand die altijd weet hoe je iets praktisch aanpakt", type: "R" },
    { tekst: "De persoon die altijd met onderbouwde antwoorden komt", type: "I" },
    { tekst: "Degene met de verrassende, originele invalshoek", type: "A" },
    { tekst: "Het sociale hart van het team, altijd aandacht voor anderen", type: "S" },
    { tekst: "De drijvende kracht achter nieuwe initiatieven", type: "E" },
    { tekst: "De persoon die alles gestructureerd en overzichtelijk houdt", type: "C" },
  ]},
  { id: 3, vraag: "Wat voor werk geeft jou echt voldoening?", opties: [
    { tekst: "Werken met je handen of techniek, iets tastbaars opleveren", type: "R" },
    { tekst: "Onderzoeken, leren en nieuwe inzichten opdoen", type: "I" },
    { tekst: "Iets ontwerpen, schrijven of creëren dat er mooi uitziet", type: "A" },
    { tekst: "Mensen begeleiden, coachen of opleiden", type: "S" },
    { tekst: "Resultaten boeken, targets halen en groeien", type: "E" },
    { tekst: "Processen verbeteren en zorgen voor kwaliteit en orde", type: "C" },
  ]},
  { id: 4, vraag: "In welke situatie voel jij je het meest in je element?", opties: [
    { tekst: "Als ik met mijn handen aan de slag ga en iets voor elkaar krijg", type: "R" },
    { tekst: "Als ik een ingewikkeld probleem mag uitzoeken en doorgronden", type: "I" },
    { tekst: "Als ik de vrijheid heb om iets eigens te maken of te bedenken", type: "A" },
    { tekst: "Als ik iemand zie groeien dankzij mijn hulp of begeleiding", type: "S" },
    { tekst: "Als ik een team mag aansturen en richting mag geven", type: "E" },
    { tekst: "Als ik complexe informatie helder en overzichtelijk maak", type: "C" },
  ]},
  { id: 5, vraag: "Wat drijft jou het diepst in je loopbaan?", opties: [
    { tekst: "Vakmanschap, echt goed worden in iets concreets", type: "R" },
    { tekst: "Kennis, altijd blijven leren en begrijpen", type: "I" },
    { tekst: "Expressie, mijn eigen stempel drukken op mijn werk", type: "A" },
    { tekst: "Betekenis, er zijn voor anderen en het verschil maken", type: "S" },
    { tekst: "Impact, zichtbaar bijdragen aan groei en succes", type: "E" },
    { tekst: "Betrouwbaarheid, zorgen dat alles klopt en goed geregeld is", type: "C" },
  ]},
];

const STAPPEN = [
  { id: "upload", label: "CV" },
  { id: "functies", label: "Functies" },
  { id: "taken", label: "Taken" },
  { id: "valideren", label: "Skills" },
  { id: "drijfveren", label: "Drijfveren" },
  { id: "ontwikkelen", label: "Ontwikkelen" },
  { id: "profiel", label: "Profiel" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width: 50, height: 50, border: "3px solid #e0ddd0", borderTopColor: KLEUR.messing, borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
    </>
  );
}

function Card({ children, style }) {
  return <div style={{ background: "#fff", borderRadius: 10, border: `1px solid ${KLEUR.lijn}`, padding: "22px 24px", ...style }}>{children}</div>;
}

function SectionTitle({ children }) {
  return <div style={{ fontFamily: "Georgia,serif", fontSize: 16, fontWeight: 600, color: KLEUR.inkt, marginBottom: 14 }}>{children}</div>;
}

function SkillsLegenda() {
  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", padding: "12px 16px", background: KLEUR.papier, border: `1px solid ${KLEUR.lijn}`, borderRadius: 8, marginBottom: 18, fontSize: 12, color: "#555" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "#eef2ff", border: "1px solid #c7d2fe", display: "inline-block" }} /> Hardskill: vakinhoudelijk, aan te leren</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "#fef3c7", border: "1px solid #fde68a", display: "inline-block" }} /> Softskill: persoonlijk, wie je bent</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>🔗 code: geverifieerde koppeling, klik om te checken</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>⚠️ geen match: geen passende skill gevonden</div>
    </div>
  );
}

function EscoSkillPill({ item, bg, col }) {
  const { tekst, esco } = typeof item === "string" ? { tekst: item, esco: null } : item;
  return (
    <span style={{ fontSize: 12, padding: "4px 11px", borderRadius: 6, fontWeight: 500, background: bg, color: col, display: "inline-flex", alignItems: "center", gap: 6 }}>
      {tekst}
      {esco ? (
        <a href={esco.uri} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
          title={`Label: ${esco.label}\nZekerheid: ${Math.round((esco.confidence || 0) * 100)}%\nKlik om te controleren`}
          style={{ fontSize: 10, fontFamily: "monospace", color: "inherit", opacity: 0.8, textDecoration: "underline", textDecorationStyle: "dotted" }}>
          🔗 {esco.code}
        </a>
      ) : (
        <span style={{ fontSize: 10, opacity: 0.6 }} title="Geen match gevonden">⚠️ geen match</span>
      )}
    </span>
  );
}

function MiniSchaal({ label, labels, waarde, onChange }) {
  return (
    <div style={{ minWidth: 260 }}>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{label}: <strong style={{ color: KLEUR.inkt }}>{labels[waarde - 1]}</strong></div>
      <div style={{ display: "flex", gap: 2, borderRadius: 4, overflow: "hidden", height: 18 }}>
        {labels.map((l, i) => (
          <div key={l} onClick={() => onChange(i + 1)} title={l}
            style={{ flex: 1, cursor: "pointer", background: i < waarde ? KLEUR.messing : "#e8e5da" }} />
        ))}
      </div>
      <div style={{ display: "flex", marginTop: 3 }}>
        {labels.map((l, i) => (
          <span key={l} style={{ flex: 1, fontSize: 9, textAlign: i === 0 ? "left" : i === labels.length - 1 ? "right" : "center", fontWeight: i === waarde - 1 ? 700 : 400, color: i === waarde - 1 ? KLEUR.inkt : "#aaa" }}>{l}</span>
        ))}
      </div>
    </div>
  );
}

function BeoordelingRij({ tekst, waarde, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "8px 12px", background: KLEUR.papier, borderRadius: 6, border: `1px solid ${KLEUR.lijn}`, marginBottom: 6, flexWrap: "wrap" }}>
      <div style={{ fontSize: 12, color: "#333", minWidth: 130, flex: "1 1 130px" }}>{tekst}</div>
      <MiniSchaal label="Hoe goed kan je dit" labels={NIVEAUS} waarde={waarde || 3} onChange={v => onChange(tekst, v)} />
    </div>
  );
}

// ─── Stappenbalk bovenaan: laat zien waar je bent, en waar je heen kan ─────────
function Stappenbalk({ huidigeStap, hoogsteBezochte, voltooidValideren, gaNaar }) {
  const huidigIdx = STAPPEN.findIndex(s => s.id === huidigeStap);
  return (
    <div style={{ background: "#fff", borderBottom: `1px solid ${KLEUR.lijn}`, padding: "14px 32px", display: "flex", alignItems: "center", gap: 4, overflowX: "auto" }}>
      {STAPPEN.map((s, i) => {
        const bereikbaar = i === 0 || i <= hoogsteBezochte || (i >= 4 && voltooidValideren);
        const actief = s.id === huidigeStap;
        const voltooid = i < hoogsteBezochte || (i < huidigIdx);
        return (
          <div key={s.id} style={{ display: "flex", alignItems: "center" }}>
            <button
              onClick={() => bereikbaar && gaNaar(s.id)}
              disabled={!bereikbaar}
              style={{
                display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 20, border: "none",
                background: actief ? KLEUR.inkt : "transparent",
                color: actief ? "#fff" : bereikbaar ? KLEUR.inkt : "#c2bda f",
                fontSize: 13, fontWeight: actief ? 600 : 500, cursor: bereikbaar ? "pointer" : "default", fontFamily: "inherit",
                opacity: bereikbaar ? 1 : 0.4,
              }}>
              <span style={{ width: 18, height: 18, borderRadius: "50%", background: actief ? "rgba(255,255,255,0.25)" : voltooid ? KLEUR.messing : "#e8e5da", color: actief || voltooid ? "#fff" : "#999", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {voltooid && !actief ? "✓" : i + 1}
              </span>
              {s.label}
            </button>
            {i < STAPPEN.length - 1 && <span style={{ color: KLEUR.lijn, margin: "0 2px" }}>–</span>}
          </div>
        );
      })}
    </div>
  );
}

// ─── Login / Registratie scherm ────────────────────────────────────────────
function LoginScherm({ onIngelogd }) {
  const [modus, setModus] = useState("inloggen");
  const [email, setEmail] = useState("");
  const [wachtwoord, setWachtwoord] = useState("");
  const [bezig, setBezig] = useState(false);
  const [foutmelding, setFoutmelding] = useState("");

  async function versturen(e) {
    e.preventDefault();
    setBezig(true);
    setFoutmelding("");
    try {
      if (modus === "registreren") {
        const { data, error } = await supabase.auth.signUp({ email, password: wachtwoord });
        if (error) throw error;
        if (data.session) onIngelogd(data.session);
        else { setFoutmelding("Account aangemaakt. Check je e-mail om te bevestigen, en log daarna in."); setModus("inloggen"); }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password: wachtwoord });
        if (error) throw error;
        onIngelogd(data.session);
      }
    } catch (err) { setFoutmelding(err.message || "Er ging iets mis."); }
    setBezig(false);
  }

  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 32, minHeight: "70vh" }}>
      <div style={{ background: "#fff", borderRadius: 10, border: `1px solid ${KLEUR.lijn}`, padding: "40px 36px", maxWidth: 400, width: "100%" }}>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 600, color: KLEUR.inkt, marginBottom: 6, textAlign: "center" }}>{modus === "inloggen" ? "Inloggen" : "Account aanmaken"}</div>
        <p style={{ fontSize: 13, color: "#888", textAlign: "center", marginBottom: 24 }}>Log in om je skillsprofiel te bewaren.</p>
        <form onSubmit={versturen}>
          <label style={{ fontSize: 13, color: "#555", display: "block", marginBottom: 6 }}>E-mailadres</label>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="naam@bedrijf.nl"
            style={{ width: "100%", padding: "10px 14px", borderRadius: 6, border: "1px solid #d0cfc8", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", marginBottom: 16 }} />
          <label style={{ fontSize: 13, color: "#555", display: "block", marginBottom: 6 }}>Wachtwoord</label>
          <input type="password" required value={wachtwoord} onChange={e => setWachtwoord(e.target.value)} placeholder="Minimaal 6 tekens" minLength={6}
            style={{ width: "100%", padding: "10px 14px", borderRadius: 6, border: "1px solid #d0cfc8", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", marginBottom: 16 }} />
          {foutmelding && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "10px 14px", color: "#991b1b", fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>⚠️ {foutmelding}</div>}
          <button type="submit" disabled={bezig} style={{ width: "100%", padding: "12px 0", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: bezig ? "default" : "pointer", fontFamily: "inherit" }}>{bezig ? "Bezig…" : modus === "inloggen" ? "Inloggen" : "Account aanmaken"}</button>
        </form>
        <div style={{ textAlign: "center", marginTop: 18 }}>
          <button onClick={() => { setModus(modus === "inloggen" ? "registreren" : "inloggen"); setFoutmelding(""); }} style={{ background: "none", border: "none", color: KLEUR.messingDonker, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
            {modus === "inloggen" ? "Nog geen account? Registreer hier" : "Al een account? Log hier in"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Overslaan-knop met uitleg (voor optionele stappen) ────────────────────────
function OverslaanBlok({ onOverslaan }) {
  return (
    <div style={{ textAlign: "center", marginTop: 18, padding: "14px 18px", background: KLEUR.papier, borderRadius: 8, border: `1px dashed ${KLEUR.lijn}` }}>
      <p style={{ fontSize: 12, color: "#777", marginBottom: 8, lineHeight: 1.6 }}>
        Deze stap is niet verplicht. Maar hoe meer je invult, hoe beter je straks kan zien waar je goed in bent en wat je nog zou willen ontwikkelen.
      </p>
      <button onClick={onOverslaan} style={{ background: "none", border: "none", color: KLEUR.messingDonker, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}>
        Deze stap overslaan →
      </button>
    </div>
  );
}

// ─── Hoofd App ────────────────────────────────────────────────────────────────
export default function App() {
  const [sessie, setSessie] = useState(null);
  const [sessieAanHetLaden, setSessieAanHetLaden] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSessie(data.session); setSessieAanHetLaden(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSessie(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  // ── De lineaire stap-status ──────────────────────────────────────────────
  const [stap, setStap] = useState("upload");
  const [laden, setLaden] = useState(null); // null | "analyseren" | "takenGenereren" | "skillsMatchen" | "profielGenereren"
  const [hoogsteBezochte, setHoogsteBezochte] = useState(0);

  const [cvData, setCvData] = useState(null);
  const [cvError, setCvError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef();
  const [saveStatus, setSaveStatus] = useState(null);
  const [escoMatchCount, setEscoMatchCount] = useState(0);

  const [geselecteerdeFuncties, setGeselecteerdeFuncties] = useState(new Set());
  const [functieTaken, setFunctieTaken] = useState({});
  const [functieSkills, setFunctieSkills] = useState({});
  const [beoordelingen, setBeoordelingen] = useState({});

  const [copied, setCopied] = useState(false);

  // Drijfveren state
  const [drijfStap, setDrijfStap] = useState(0);
  const [antwoorden, setAntwoorden] = useState({});
  const [drijfResultaat, setDrijfResultaat] = useState(null);
  const [drijfLoading, setDrijfLoading] = useState(false);

  // Ontwikkeladvies state
  const [ontwikkelDoel, setOntwikkelDoel] = useState("");
  const [ontwikkelAdvies, setOntwikkelAdvies] = useState(null);
  const [ontwikkelLoading, setOntwikkelLoading] = useState(false);
  const [ontwikkelError, setOntwikkelError] = useState("");

  const voltooidValideren = Object.keys(functieSkills).length > 0;

  function gaNaarStap(id) {
    setStap(id);
    const idx = STAPPEN.findIndex(s => s.id === id);
    if (idx > hoogsteBezochte) setHoogsteBezochte(idx);
  }

  async function callClaude(messages, maxTokens = 1000) {
    const res = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, messages }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error?.message || `Fout: ${res.status}`); }
    const json = await res.json();
    return json.content?.map(b => b.text || "").join("") || "";
  }

  function parseJSON(text) {
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : text.replace(/```json|```/g, "").trim());
  }

  // ── STAP 1: CV of Word-bestand uploaden ─────────────────────────────────────
  async function handleFile(file) {
    const isPdf = file?.type === "application/pdf";
    const isWord = file?.name?.toLowerCase().endsWith(".docx");
    if (!file || (!isPdf && !isWord)) { setCvError("Upload een PDF- of Word-bestand (.docx)."); setStap("fout"); return; }

    setLaden("analyseren");
    try {
      let messageContent;
      if (isPdf) {
        const base64 = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result.split(",")[1]);
          r.onerror = () => rej(new Error("Bestand kon niet worden gelezen."));
          r.readAsDataURL(file);
        });
        messageContent = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }, { type: "text", text: CV_PROMPT }];
      } else {
        const arrayBuffer = await file.arrayBuffer();
        const { value: tekst } = await mammoth.extractRawText({ arrayBuffer });
        messageContent = [{ type: "text", text: CV_PROMPT + "\n\nCV-tekst:\n" + tekst }];
      }

      const text = await callClaude([{ role: "user", content: messageContent }], 6000);
      const parsed = parseJSON(text);
      setCvData(parsed);
      setGeselecteerdeFuncties(new Set(parsed.functies?.length ? [0] : []));
      setLaden(null);
      gaNaarStap("functies");
    } catch (e) { setCvError(e.message); setLaden(null); setStap("fout"); }
  }

  function toggleFunctie(idx) {
    setGeselecteerdeFuncties(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  }

  // ── STAP 2 → 3: taken genereren ──────────────────────────────────────────────
  async function genereerTaken() {
    setLaden("takenGenereren");
    try {
      const indices = [...geselecteerdeFuncties];
      const resultaten = await Promise.all(indices.map(idx => {
        const functie = cvData.functies[idx];
        return callClaude([{ role: "user", content: takenPrompt(functie) }], 1500).then(parseJSON);
      }));
      const nieuweTaken = {};
      indices.forEach((idx, i) => { nieuweTaken[idx] = (resultaten[i].taken || []).map((t, j) => ({ id: j, taak: t.taak, bron: t.bron || "beroep", geselecteerd: true })); });
      setFunctieTaken(nieuweTaken);
      setLaden(null);
      gaNaarStap("taken");
    } catch (e) { setCvError(e.message); setLaden(null); setStap("fout"); }
  }

  function toggleTaak(functieIdx, taakId) {
    setFunctieTaken(prev => ({ ...prev, [functieIdx]: prev[functieIdx].map(t => t.id === taakId ? { ...t, geselecteerd: !t.geselecteerd } : t) }));
  }

  // ── STAP 3 → 4: skills koppelen ──────────────────────────────────────────────
  async function koppelSkills() {
    setLaden("skillsMatchen");
    try {
      const indices = [...geselecteerdeFuncties];
      const ruweSkills = {};
      for (const idx of indices) {
        const functie = cvData.functies[idx];
        const gekozenTaken = functieTaken[idx].filter(t => t.geselecteerd).map(t => t.taak);
        if (gekozenTaken.length === 0) { ruweSkills[idx] = []; continue; }
        const text = await callClaude([{ role: "user", content: skillsPerTaakPrompt(functie.titel, gekozenTaken) }], 2200);
        ruweSkills[idx] = (parseJSON(text)).taken || [];
      }

      const alleTeksten = new Set();
      Object.values(ruweSkills).forEach(taken => taken.forEach(t => {
        (t.hardskills || []).forEach(s => alleTeksten.add(s));
        (t.softskills || []).forEach(s => alleTeksten.add(s));
      }));
      (cvData.hobbySkills || []).forEach(s => alleTeksten.add(s));
      const tekstenArr = [...alleTeksten];
      const matches = await Promise.all(tekstenArr.map(t => vindEscoMatch(t)));
      const matchMap = {}; tekstenArr.forEach((t, i) => matchMap[t] = matches[i]);

      const verrijkt = {};
      Object.entries(ruweSkills).forEach(([idx, taken]) => {
        verrijkt[idx] = taken.map(t => ({
          taak: t.taak,
          hardskills: (t.hardskills || []).map(s => ({ tekst: s, esco: matchMap[s] })),
          softskills: (t.softskills || []).map(s => ({ tekst: s, esco: matchMap[s] })),
        }));
      });
      const hobbyVerrijkt = (cvData.hobbySkills || []).map(s => ({ tekst: s, esco: matchMap[s] }));

      const beoordelingInit = {};
      tekstenArr.forEach(t => { beoordelingInit[t] = 3; });

      setFunctieSkills(verrijkt);
      setCvData(prev => ({ ...prev, hobbySkills: hobbyVerrijkt }));
      setBeoordelingen(beoordelingInit);
      setLaden(null);
      gaNaarStap("valideren");

      setSaveStatus("opslaan...");
      const resultaat = await slaCvSkillsOp(verrijkt, hobbyVerrijkt, beoordelingInit, sessie.user.id, sessie.user.email);
      setSaveStatus(resultaat.success ? "opgeslagen" : "fout");
      setEscoMatchCount(resultaat.aantalEscoGematcht || 0);
    } catch (e) { setCvError(e.message); setLaden(null); setStap("fout"); }
  }

  function wijzigBeoordeling(tekst, waarde) {
    setBeoordelingen(prev => ({ ...prev, [tekst]: waarde }));
  }

  async function handOpslaan() {
    setSaveStatus("opslaan...");
    const resultaat = await slaCvSkillsOp(functieSkills, cvData?.hobbySkills || [], beoordelingen, sessie.user.id, sessie.user.email);
    setSaveStatus(resultaat.success ? "opgeslagen" : "fout");
    setEscoMatchCount(resultaat.aantalEscoGematcht || 0);
  }

  function copyStory() {
    const txt = [cvData?.verhaal?.alinea1, cvData?.verhaal?.alinea2, cvData?.verhaal?.alinea3].filter(Boolean).join("\n\n");
    navigator.clipboard.writeText(txt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2200); });
  }

  function nieuwCv() {
    setStap("upload"); setLaden(null); setHoogsteBezochte(0);
    setCvData(null); setSaveStatus(null);
    setGeselecteerdeFuncties(new Set()); setFunctieTaken({}); setFunctieSkills({}); setBeoordelingen({});
    setDrijfStap(0); setAntwoorden({}); setDrijfResultaat(null);
    setOntwikkelDoel(""); setOntwikkelAdvies(null);
  }

  // ── Verhaal + Top5, automatisch gegenereerd zodra je bij het Skillsprofiel komt ──
  async function genereerVerhaalEnTop5() {
    setLaden("profielGenereren");
    try {
      const skillsMetNiveau = [];
      Object.values(functieSkills).forEach(taken => taken.forEach(t => {
        [...t.hardskills, ...t.softskills].forEach(s => {
          skillsMetNiveau.push({ skill: s.tekst, niveau: NIVEAUS[(beoordelingen[s.tekst] || 3) - 1] });
        });
      }));
      const drijfSamenvatting = drijfResultaat ? Object.entries(drijfResultaat.scores).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => DRIJFVEER_TYPES[k].label).join(", ") : null;
      const ontwikkelSamenvatting = ontwikkelAdvies ? `${ontwikkelDoel} → richting: ${ontwikkelAdvies.richting}` : null;

      const text = await callClaude([{ role: "user", content: verhaalTop5Prompt(cvData, skillsMetNiveau, drijfSamenvatting, ontwikkelSamenvatting) }], 2200);
      const data = parseJSON(text);
      setCvData(prev => ({ ...prev, verhaal: data.verhaal, top5: data.top5, verhaalBronnen: data.bronnenGebruikt }));
    } catch (e) { console.error(e); }
    setLaden(null);
  }

  // ── Drijfveren ────────────────────────────────────────────────────────────
  function kiesAntwoord(type) {
    const nieuw = { ...antwoorden, [drijfStap]: type };
    setAntwoorden(nieuw);
    if (drijfStap < DRIJFVEER_VRAGEN.length) setTimeout(() => setDrijfStap(drijfStap + 1), 280);
  }
  function berekenScores(antw) {
    const s = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };
    Object.values(antw).forEach(t => { if (s[t] !== undefined) s[t]++; });
    return s;
  }
  async function genereerDrijfverenProfiel(scores) {
    setDrijfLoading(true);
    const gesorteerd = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const top3 = gesorteerd.slice(0, 3).map(([k]) => `${DRIJFVEER_TYPES[k].label}`).join(", ");
    try {
      const text = await callClaude([{ role: "user", content: drijfverenPrompt(scores, top3) }], 1000);
      setDrijfResultaat({ scores, gesorteerd, interpretatie: parseJSON(text) });
    } catch { setDrijfResultaat({ scores, gesorteerd, interpretatie: null }); }
    setDrijfLoading(false);
  }

  // ── Ontwikkeladvies ───────────────────────────────────────────────────────
  async function genereerOntwikkelAdvies() {
    setOntwikkelLoading(true); setOntwikkelAdvies(null); setOntwikkelError("");
    try {
      const cvSamenvatting = cvData ? `Skillsprofiel: functies: ${(cvData.functies||[]).map(f=>f.titel).join(", ")}. Weten: ${(cvData.weten||[]).join(", ")}. Kunnen: ${(cvData.kunnen||[]).join(", ")}. Zijn: ${(cvData.zijn||[]).join(", ")}. Willen: ${(cvData.willen||[]).join(", ")}.` : "Geen CV geüpload.";
      const drijfSamenvatting = drijfResultaat ? `Drijfveren: ${Object.entries(drijfResultaat.scores).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k])=>DRIJFVEER_TYPES[k].label).join(", ")}` : "Drijfveren nog niet ingevuld.";
      const text = await callClaude([{ role: "user", content: ontwikkelPrompt(cvSamenvatting, drijfSamenvatting, ontwikkelDoel) }], 2200);
      setOntwikkelAdvies(parseJSON(text));
    } catch (e) { setOntwikkelError(e.message || "Er is een fout opgetreden."); }
    setOntwikkelLoading(false);
  }

  const huidigVraag = drijfStap >= 1 && drijfStap <= DRIJFVEER_VRAGEN.length ? DRIJFVEER_VRAGEN[drijfStap - 1] : null;
  const alleBeantwoord = Object.keys(antwoorden).length === DRIJFVEER_VRAGEN.length;

  if (sessieAanHetLaden) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: KLEUR.papier }}><Spinner /></div>;

  if (!sessie) {
    return (
      <div style={{ fontFamily: "'Segoe UI',sans-serif", minHeight: "100vh", background: KLEUR.papier, display: "flex", flexDirection: "column" }}>
        <Kop sessie={null} />
        <LoginScherm onIngelogd={setSessie} />
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Segoe UI',sans-serif", minHeight: "100vh", background: KLEUR.papier, display: "flex", flexDirection: "column" }}>
      <Kop sessie={sessie} onUitloggen={() => supabase.auth.signOut()} />
      <Stappenbalk huidigeStap={stap} hoogsteBezochte={hoogsteBezochte} voltooidValideren={voltooidValideren} gaNaar={gaNaarStap} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>

        {/* ── STAP: upload ── */}
        {stap === "upload" && !laden && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 24px" }}>
            <div style={{ maxWidth: 460, width: "100%", textAlign: "center" }}>
              <div style={{ fontFamily: "Georgia,serif", fontSize: 30, fontWeight: 700, color: KLEUR.inkt, marginBottom: 10 }}>Jouw skillsprofiel</div>
              <p style={{ fontSize: 14, color: "#666", lineHeight: 1.7, marginBottom: 28, maxWidth: 380, marginLeft: "auto", marginRight: "auto" }}>
                Upload je CV. Wij lezen 'm en zoeken uit wat je allemaal kan, jij hoeft niks over te typen.
              </p>
              <div onClick={() => fileInputRef.current.click()} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
                style={{ background: dragging ? "#fffef5" : "linear-gradient(180deg,#fff,#fffdf5)", borderRadius: 10, border: `2px dashed ${dragging ? KLEUR.messing : "#e3d9a8"}`, padding: "44px 36px", textAlign: "center", cursor: "pointer", boxShadow: "0 8px 30px rgba(184,134,63,0.12)" }}>
                <div style={{ fontSize: 40 }}>📋</div>
                <div style={{ fontFamily: "Georgia,serif", fontSize: 20, color: KLEUR.inkt, margin: "12px 0 6px" }}>Upload je CV</div>
                <div style={{ fontSize: 14, color: "#888", lineHeight: 1.6, marginBottom: 20 }}>Sleep een PDF of Word-bestand hierheen, of klik om te bladeren.</div>
                <input type="file" ref={fileInputRef} accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
                <button style={{ padding: "12px 28px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>📁 Kies PDF of Word-bestand</button>
              </div>
            </div>
          </div>
        )}

        {laden === "analyseren" && (
          <LaadScherm titel="Je CV wordt gelezen…" tekst="We zoeken je functies, opleidingen en hobby's op. Daarna kies je zelf waar we dieper op ingaan." />
        )}

        {stap === "fout" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48, textAlign: "center", gap: 16 }}>
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "18px 24px", color: "#991b1b", fontSize: 14, lineHeight: 1.6, maxWidth: 440 }}>⚠️ {cvError}</div>
            <button onClick={nieuwCv} style={{ padding: "10px 22px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>← Opnieuw proberen</button>
          </div>
        )}

        {/* ── STAP: functies kiezen ── */}
        {stap === "functies" && cvData && !laden && (
          <div style={{ flex: 1, display: "flex", justifyContent: "center", padding: 32, overflowY: "auto" }}>
            <div style={{ maxWidth: 600, width: "100%" }}>
              <div style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 600, color: KLEUR.inkt, marginBottom: 8 }}>Welke functies wil je uitwerken?</div>
              <p style={{ fontSize: 13, color: "#666", lineHeight: 1.6, marginBottom: 20 }}>
                We hebben deze functies in je CV gevonden. Je huidige functie staat al aangevinkt. Vink er gerust meer aan waar je goed in was of die je leuk vond, maar dat hoeft niet. Zo'n 3 functies geeft meestal een compleet beeld.
              </p>
              {(cvData.functies || []).map((f, i) => (
                <div key={i} onClick={() => toggleFunctie(i)} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 16px", borderRadius: 8, border: geselecteerdeFuncties.has(i) ? `2px solid ${KLEUR.messing}` : `2px solid ${KLEUR.lijn}`, background: geselecteerdeFuncties.has(i) ? "#fbf6ea" : "#fff", marginBottom: 10, cursor: "pointer" }}>
                  <div style={{ width: 20, height: 20, borderRadius: 4, border: geselecteerdeFuncties.has(i) ? "none" : "2px solid #d0cfc8", background: geselecteerdeFuncties.has(i) ? KLEUR.messing : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                    {geselecteerdeFuncties.has(i) && <span style={{ color: "#fff", fontSize: 12 }}>✓</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: KLEUR.inkt }}>{f.titel} {i === 0 && <span style={{ fontSize: 10, color: KLEUR.messingDonker, fontWeight: 500 }}>· huidig</span>}</div>
                    <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{f.bedrijf} · {f.periode}</div>
                  </div>
                </div>
              ))}
              <button onClick={genereerTaken} disabled={geselecteerdeFuncties.size === 0} style={{ marginTop: 12, padding: "12px 28px", borderRadius: 6, background: geselecteerdeFuncties.size === 0 ? "#ccc" : KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: geselecteerdeFuncties.size === 0 ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                Volgende stap →
              </button>
            </div>
          </div>
        )}

        {laden === "takenGenereren" && (
          <LaadScherm titel="Taken worden opgezocht…" tekst="Dit zijn dingen die vaak bij dit werk horen, aangevuld met wat er in je CV staat." />
        )}

        {/* ── STAP: taken uitvinken ── */}
        {stap === "taken" && !laden && (
          <div style={{ flex: 1, padding: "28px 32px", overflowY: "auto" }}>
            <div style={{ maxWidth: 700, margin: "0 auto" }}>
              <div style={{ fontFamily: "Georgia,serif", fontSize: 21, fontWeight: 600, color: KLEUR.inkt, marginBottom: 8 }}>Check je taken</div>
              <p style={{ fontSize: 13, color: "#666", marginBottom: 20, lineHeight: 1.6 }}>Alles staat al aangevinkt. Vink uit wat jij nooit doet, de rest gebruiken we om te kijken wat jij precies kan.</p>
              {[...geselecteerdeFuncties].map(idx => {
                const f = cvData.functies[idx];
                return (
                  <Card key={idx} style={{ marginBottom: 20 }}>
                    <div style={{ fontFamily: "Georgia,serif", fontSize: 16, fontWeight: 600, color: KLEUR.inkt, marginBottom: 2 }}>{f.titel}</div>
                    <div style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{f.bedrijf}</div>
                    {(functieTaken[idx] || []).map(t => (
                      <div key={t.id} onClick={() => toggleTaak(idx, t.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 6, cursor: "pointer", background: t.geselecteerd ? "transparent" : "#faf5f5" }}>
                        <div style={{ width: 16, height: 16, borderRadius: 3, border: t.geselecteerd ? "none" : "2px solid #d0cfc8", background: t.geselecteerd ? KLEUR.messing : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{t.geselecteerd && <span style={{ color: "#fff", fontSize: 9 }}>✓</span>}</div>
                        <span style={{ fontSize: 13, color: t.geselecteerd ? "#333" : "#aaa", textDecoration: t.geselecteerd ? "none" : "line-through", flex: 1 }}>{t.taak}</span>
                        <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: t.bron === "cv" ? "#eef2ff" : "#fef3c7", color: t.bron === "cv" ? "#3730a3" : "#92400e" }}>{t.bron === "cv" ? "uit je CV" : "gebruikelijk"}</span>
                      </div>
                    ))}
                  </Card>
                );
              })}
              <button onClick={koppelSkills} style={{ padding: "13px 28px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                Volgende stap →
              </button>
            </div>
          </div>
        )}

        {laden === "skillsMatchen" && (
          <LaadScherm titel="Skills worden bepaald…" tekst="Per taak zoeken we uit welke skills daarbij horen." />
        )}

        {/* ── STAP: skills valideren ── */}
        {stap === "valideren" && !laden && (
          <div style={{ flex: 1, padding: "28px 32px", overflowY: "auto" }}>
            <div style={{ maxWidth: 760, margin: "0 auto" }}>
              <div style={{ fontFamily: "Georgia,serif", fontSize: 21, fontWeight: 600, color: KLEUR.inkt, marginBottom: 8 }}>Valideer je skills</div>
              <p style={{ fontSize: 13, color: "#666", marginBottom: 18, lineHeight: 1.6 }}>Hier zie je precies wat er bij je taken hoort. Schuif de balk naar hoe goed jij dit kan, van net begonnen tot expert.</p>
              <SkillsLegenda />
              {[...geselecteerdeFuncties].map(idx => {
                const f = cvData.functies[idx];
                const taken = functieSkills[idx] || [];
                return (
                  <div key={idx} style={{ background: "#fff", borderRadius: 10, border: `1px solid ${KLEUR.lijn}`, marginBottom: 20, overflow: "hidden" }}>
                    <div style={{ background: KLEUR.inkt, padding: "16px 22px" }}>
                      <div style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 600, color: "#fff" }}>{f.titel}</div>
                      <div style={{ fontSize: 13, color: "#a8b3bd", marginTop: 2 }}>{f.bedrijf}</div>
                    </div>
                    <div style={{ padding: "18px 22px" }}>
                      {taken.length === 0 && <p style={{ fontSize: 13, color: "#888" }}>Geen taken geselecteerd voor deze functie.</p>}
                      {taken.map((t, j) => (
                        <div key={j} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: j < taken.length - 1 ? `1px solid ${KLEUR.lijn}` : "none" }}>
                          <div style={{ fontSize: 13, color: "#444", marginBottom: 8 }}>→ {t.taak}</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                            {t.hardskills.map((s, k) => <EscoSkillPill key={"h"+k} item={s} bg="#eef2ff" col="#3730a3" />)}
                            {t.softskills.map((s, k) => <EscoSkillPill key={"s"+k} item={s} bg="#fef3c7" col="#92400e" />)}
                          </div>
                          {[...t.hardskills, ...t.softskills].map(s => <BeoordelingRij key={s.tekst} tekst={s.tekst} waarde={beoordelingen[s.tekst]} onChange={wijzigBeoordeling} />)}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>
                <button onClick={() => gaNaarStap("drijfveren")} style={{ padding: "13px 28px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  Volgende stap →
                </button>
                <button onClick={handOpslaan} style={{ padding: "13px 22px", borderRadius: 6, background: "#fff", color: KLEUR.inkt, border: `1px solid ${KLEUR.lijn}`, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  💾 Sla op
                </button>
                {saveStatus && (
                  <span style={{ fontSize: 12, color: saveStatus === "opgeslagen" ? "#166534" : saveStatus === "fout" ? "#991b1b" : "#888" }}>
                    {saveStatus === "opslaan..." && "Bezig met opslaan…"}
                    {saveStatus === "opgeslagen" && `Opgeslagen (${escoMatchCount} skills gekoppeld)`}
                    {saveStatus === "fout" && "Opslaan mislukt"}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── STAP: drijfveren ── */}
        {stap === "drijfveren" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            {drijfStap === 0 && !drijfResultaat && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32 }}>
                <div style={{ background: "#fff", borderRadius: 10, border: `1px solid ${KLEUR.lijn}`, padding: "40px 36px", maxWidth: 440, width: "100%", textAlign: "center" }}>
                  <div style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 600, color: KLEUR.inkt, marginBottom: 12 }}>Wat drijft jou?</div>
                  <p style={{ fontSize: 14, color: "#555", lineHeight: 1.7, marginBottom: 24 }}>5 korte vragen over wat je energie geeft op je werk. Geen goed of fout antwoord, kies gewoon wat het meest bij jou past.</p>
                  <button onClick={() => setDrijfStap(1)} style={{ padding: "13px 32px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Start de test →</button>
                </div>
                <OverslaanBlok onOverslaan={() => gaNaarStap("ontwikkelen")} />
              </div>
            )}
            {drijfStap >= 1 && drijfStap <= DRIJFVEER_VRAGEN.length && huidigVraag && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
                <div style={{ maxWidth: 580, width: "100%" }}>
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#888", marginBottom: 8 }}><span>Vraag {drijfStap} van {DRIJFVEER_VRAGEN.length}</span></div>
                    <div style={{ height: 6, background: "#e8e5da", borderRadius: 4 }}><div style={{ height: "100%", background: KLEUR.messing, borderRadius: 4, width: `${((drijfStap - 1) / DRIJFVEER_VRAGEN.length) * 100}%`, transition: "width 0.3s" }} /></div>
                  </div>
                  <Card style={{ padding: "32px 28px" }}>
                    <div style={{ fontFamily: "Georgia,serif", fontSize: 20, fontWeight: 600, color: KLEUR.inkt, marginBottom: 24, lineHeight: 1.4 }}>{huidigVraag.vraag}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {huidigVraag.opties.map((opt, i) => { const type = DRIJFVEER_TYPES[opt.type]; const gekozen = antwoorden[drijfStap] === opt.type; return (<button key={i} onClick={() => kiesAntwoord(opt.type)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderRadius: 8, border: gekozen ? `2px solid ${type.kleur}` : `2px solid ${KLEUR.lijn}`, background: gekozen ? type.kleur + "18" : KLEUR.papier, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}><span style={{ fontSize: 18, flexShrink: 0 }}>{type.emoji}</span><span style={{ fontSize: 14, color: "#333", lineHeight: 1.5 }}>{opt.tekst}</span></button>); })}
                    </div>
                  </Card>
                  {alleBeantwoord && drijfStap === DRIJFVEER_VRAGEN.length && (<div style={{ textAlign: "center", marginTop: 24 }}><button onClick={async () => { const scores = berekenScores(antwoorden); setDrijfStap(DRIJFVEER_VRAGEN.length + 1); await genereerDrijfverenProfiel(scores); }} style={{ padding: "13px 32px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Bekijk mijn drijfveren →</button></div>)}
                </div>
              </div>
            )}
            {drijfStap > DRIJFVEER_VRAGEN.length && drijfLoading && <LaadScherm titel="Jouw drijfveren worden bepaald…" tekst="" />}
            {drijfStap > DRIJFVEER_VRAGEN.length && !drijfLoading && drijfResultaat && (() => {
              const { scores, gesorteerd, interpretatie } = drijfResultaat;
              const top3 = gesorteerd.slice(0, 3);
              return (
                <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
                  <div style={{ maxWidth: 680, margin: "0 auto" }}>
                    <div style={{ background: KLEUR.inkt, borderRadius: 10, padding: "24px 28px", marginBottom: 20 }}>
                      <div style={{ fontSize: 12, color: "#a8b3bd", marginBottom: 10, letterSpacing: "0.8px", textTransform: "uppercase" }}>Jouw belangrijkste drijfveren</div>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        {top3.map(([k], i) => { const t = DRIJFVEER_TYPES[k]; return (<div key={k} style={{ display: "flex", alignItems: "center", gap: 10, background: t.kleur + "25", border: `1px solid ${t.kleur}55`, borderRadius: 8, padding: "10px 16px" }}><span style={{ fontSize: 22 }}>{t.emoji}</span><div><div style={{ fontSize: 11, color: "#a8b3bd", fontWeight: 500 }}>#{i + 1}</div><div style={{ fontSize: 15, fontWeight: 700, color: t.kleur }}>{t.label}</div></div></div>); })}
                      </div>
                    </div>
                    {interpretatie && (
                      <Card style={{ marginBottom: 16 }}>
                        <SectionTitle>Wat dit over jou zegt</SectionTitle>
                        <p style={{ fontSize: 14, color: "#333", lineHeight: 1.75, marginBottom: 14 }}>{interpretatie.intro}</p>
                        <p style={{ fontSize: 14, color: "#333", lineHeight: 1.75, marginBottom: 0 }}>{interpretatie.werkvoorkeur}</p>
                      </Card>
                    )}
                    <button onClick={() => gaNaarStap("ontwikkelen")} style={{ padding: "13px 28px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Volgende stap →</button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── STAP: ontwikkelen ── */}
        {stap === "ontwikkelen" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "32px" }}>
            <div style={{ maxWidth: 680, margin: "0 auto" }}>
              <div style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 600, color: KLEUR.inkt, marginBottom: 8 }}>Waar wil jij naartoe groeien?</div>
              <p style={{ fontSize: 13, color: "#666", lineHeight: 1.6, marginBottom: 16 }}>Wil je nog iets leren, of een andere kant op? Typ het hier. Wij denken met je mee.</p>
              <Card style={{ marginBottom: 20 }}>
                <textarea value={ontwikkelDoel} onChange={e => setOntwikkelDoel(e.target.value)} placeholder="Bijv: Ik wil doorgroeien naar een leidinggevende rol, maar merk dat ik moeite heb om mensen aan te sturen…" style={{ width: "100%", minHeight: 110, padding: "14px 16px", borderRadius: 6, border: "1px solid #d0cfc8", fontSize: 14, fontFamily: "inherit", lineHeight: 1.6, color: "#333", background: KLEUR.papier, resize: "vertical", outline: "none", boxSizing: "border-box" }} />
                <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#aaa" }}>{ontwikkelDoel.length} tekens</span>
                  <button onClick={genereerOntwikkelAdvies} disabled={ontwikkelDoel.trim().length < 5 || ontwikkelLoading} style={{ padding: "12px 28px", borderRadius: 6, background: ontwikkelDoel.trim().length < 5 ? "#ccc" : KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: ontwikkelDoel.trim().length < 5 ? "not-allowed" : "pointer", fontFamily: "inherit" }}>{ontwikkelLoading ? "Bezig…" : "Vraag advies →"}</button>
                </div>
              </Card>
              {ontwikkelLoading && <LaadScherm titel="Ontwikkeladvies wordt opgesteld…" tekst="" />}
              {ontwikkelError && !ontwikkelLoading && (<div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "16px 20px", color: "#991b1b", fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>⚠️ {ontwikkelError}</div>)}
              {ontwikkelAdvies && !ontwikkelLoading && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ background: KLEUR.inkt, borderRadius: 10, padding: "24px 28px", marginBottom: 16 }}>
                    <div style={{ fontSize: 11, color: "#a8b3bd", marginBottom: 6, letterSpacing: "0.8px", textTransform: "uppercase" }}>Aanbevolen richting</div>
                    <div style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 700, color: KLEUR.messing, marginBottom: 10 }}>{ontwikkelAdvies.richting}</div>
                    <p style={{ fontSize: 14, color: "#ccc", lineHeight: 1.7, margin: 0 }}>{ontwikkelAdvies.richtingToelichting}</p>
                  </div>
                  <Card style={{ marginBottom: 16 }}>
                    <SectionTitle>Concrete leerstappen</SectionTitle>
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      {(ontwikkelAdvies.leerstappen || []).map((s, i) => (<div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}><div style={{ width: 26, height: 26, borderRadius: 6, background: KLEUR.inkt, color: KLEUR.messing, fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div><div><div style={{ fontSize: 14, fontWeight: 600, color: KLEUR.inkt, marginBottom: 3 }}>{s.titel}</div><div style={{ fontSize: 13, color: "#555", lineHeight: 1.6 }}>{s.omschrijving}</div></div></div>))}
                    </div>
                  </Card>
                </div>
              )}
              <div style={{ display: "flex", gap: 12 }}>
                <button onClick={() => gaNaarStap("profiel")} style={{ padding: "13px 28px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Naar je skillsprofiel →</button>
              </div>
              {!ontwikkelAdvies && <OverslaanBlok onOverslaan={() => gaNaarStap("profiel")} />}
            </div>
          </div>
        )}

        {/* ── STAP: skillsprofiel (eindresultaat) ── */}
        {stap === "profiel" && cvData && (
          <ProfielStap
            cvData={cvData} functieSkills={functieSkills} beoordelingen={beoordelingen} wijzigBeoordeling={wijzigBeoordeling}
            drijfResultaat={drijfResultaat} ontwikkelAdvies={ontwikkelAdvies}
            laden={laden === "profielGenereren"} genereerVerhaalEnTop5={genereerVerhaalEnTop5}
            copyStory={copyStory} copied={copied} handOpslaan={handOpslaan} saveStatus={saveStatus} escoMatchCount={escoMatchCount}
            nieuwCv={nieuwCv} gaNaarStap={gaNaarStap}
          />
        )}
      </div>
    </div>
  );
}

// ─── Kop (header) ───────────────────────────────────────────────────────────
function Kop({ sessie, onUitloggen }) {
  return (
    <div style={{ background: KLEUR.inkt, padding: "18px 32px", display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width: 40, height: 40, borderRadius: 6, background: `linear-gradient(135deg,${KLEUR.messing},${KLEUR.messingDonker})`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Georgia,serif", fontSize: 16, fontWeight: 700, color: KLEUR.papier, letterSpacing: "0.5px" }}>SA</div>
      <div>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 19, fontWeight: 700, color: "#fff" }}>CV Skillsanalyse</div>
        <div style={{ fontSize: 12, color: "#a8b3bd", marginTop: 1 }}>Weten · Kunnen · Zijn · Willen in kaart brengen</div>
      </div>
      {sessie && (
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 12, color: "#a8b3bd" }}>{sessie.user.email}</span>
          <button onClick={onUitloggen} style={{ fontSize: 12, color: KLEUR.messing, background: "none", border: `1px solid ${KLEUR.messing}`, borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}>Uitloggen</button>
        </div>
      )}
    </div>
  );
}

function LaadScherm({ titel, tekst }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48, textAlign: "center", gap: 16 }}>
      <Spinner />
      <div style={{ fontFamily: "Georgia,serif", fontSize: 20, color: KLEUR.inkt }}>{titel}</div>
      {tekst && <div style={{ fontSize: 14, color: "#888", maxWidth: 340, lineHeight: 1.6 }}>{tekst}</div>}
    </div>
  );
}

// ─── Laatste stap: het complete skillsprofiel ──────────────────────────────────
function ProfielStap({ cvData, functieSkills, beoordelingen, wijzigBeoordeling, drijfResultaat, ontwikkelAdvies, laden, genereerVerhaalEnTop5, copyStory, copied, handOpslaan, saveStatus, escoMatchCount, nieuwCv, gaNaarStap }) {
  useEffect(() => {
    if (!cvData.verhaal && !laden) genereerVerhaalEnTop5();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hardMap = new Map(), softMap = new Map();
  Object.values(functieSkills).forEach(taken => taken.forEach(t => {
    t.hardskills.forEach(s => hardMap.set(s.tekst, s));
    t.softskills.forEach(s => softMap.set(s.tekst, s));
  }));
  const hardList = [...hardMap.values()];
  const softList = [...softMap.values()];
  const hobbyList = cvData.hobbySkills || [];

  return (
    <div style={{ flex: 1, padding: "28px 32px", overflowY: "auto" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 6 }}>
          <div>
            <div style={{ fontFamily: "Georgia,serif", fontSize: 24, fontWeight: 700, color: KLEUR.inkt }}>Dit is wat we over jou gevonden hebben</div>
            <p style={{ fontSize: 13, color: "#666", marginTop: 6, maxWidth: 480, lineHeight: 1.6 }}>Waar je goed in bent, wat je erbij hebt geleerd, en wat je nog zou willen leren. Laat dit zien aan je leidinggevende, of bewaar het gewoon voor jezelf.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handOpslaan} style={{ padding: "10px 18px", borderRadius: 6, background: "#fff", color: KLEUR.inkt, border: `1px solid ${KLEUR.lijn}`, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>💾 Sla op</button>
            <button onClick={nieuwCv} style={{ padding: "10px 18px", borderRadius: 6, background: "#fff", color: "#c0392b", border: `1px solid ${KLEUR.lijn}`, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>↩ Nieuw CV</button>
          </div>
        </div>
        {saveStatus && (
          <div style={{ fontSize: 12, color: saveStatus === "opgeslagen" ? "#166534" : saveStatus === "fout" ? "#991b1b" : "#888", marginBottom: 16 }}>
            {saveStatus === "opslaan..." && "Bezig met opslaan…"}
            {saveStatus === "opgeslagen" && `✓ Opgeslagen (${escoMatchCount} skills gekoppeld)`}
            {saveStatus === "fout" && "Opslaan mislukt"}
          </div>
        )}

        {/* Jouw verhaal + top 5 */}
        {laden && <LaadScherm titel="Jouw verhaal wordt geschreven…" tekst="We combineren je skills, drijfveren en ontwikkelrichting tot één overzicht." />}
        {!laden && cvData.verhaal && (
          <>
            {cvData.verhaalBronnen && <p style={{ fontSize: 12, color: "#888", fontStyle: "italic", marginBottom: 16 }}>{cvData.verhaalBronnen}</p>}
            {(cvData.top5?.length > 0) && (
              <div style={{ background: KLEUR.inkt, borderRadius: 10, padding: 26, marginBottom: 22 }}>
                <div style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 600, color: KLEUR.messing, marginBottom: 18 }}>Jouw top 5 skills</div>
                {cvData.top5.map((item, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 6, background: "rgba(184,134,63,0.25)", color: KLEUR.messing, fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ fontSize: 14, color: "#ddd", lineHeight: 1.6 }}><span style={{ fontWeight: 600, color: "#fff" }}>{item.skill}</span>: {item.toelichting}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <button onClick={copyStory} style={{ padding: "9px 18px", borderRadius: 6, background: copied ? "#166534" : KLEUR.inkt, color: "#fff", border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>{copied ? "✓ Gekopieerd" : "📋 Kopieer verhaal"}</button>
            </div>
            <Card style={{ marginBottom: 24 }}>
              {[cvData.verhaal?.alinea1, cvData.verhaal?.alinea2, cvData.verhaal?.alinea3].filter(Boolean).map((p, i, arr) => (
                <p key={i} style={{ fontSize: 15, color: "#333", lineHeight: 1.85, marginBottom: i < arr.length - 1 ? 18 : 0 }}>{p}</p>
              ))}
            </Card>
          </>
        )}

        {/* Alle skills, compact */}
        {hardList.length > 0 && (
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>Hardskills ({hardList.length})</SectionTitle>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {hardList.map(item => (
                <div key={item.tekst} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <EscoSkillPill item={item} bg="#eef2ff" col="#3730a3" />
                  <span style={{ fontSize: 10, color: "#999" }}>{NIVEAUS[(beoordelingen[item.tekst] || 3) - 1]}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
        {softList.length > 0 && (
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>Softskills ({softList.length})</SectionTitle>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {softList.map(item => (
                <div key={item.tekst} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <EscoSkillPill item={item} bg="#fef3c7" col="#92400e" />
                  <span style={{ fontSize: 10, color: "#999" }}>{NIVEAUS[(beoordelingen[item.tekst] || 3) - 1]}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 11, color: "#aaa", marginTop: 12 }}>Niveau aanpassen? Ga terug naar de stap "Valideren".</p>
          </Card>
        )}

        {/* Opleiding & hobby's */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 16 }}>
          <Card>
            <SectionTitle>Opleidingen & cursussen</SectionTitle>
            {!(cvData.opleidingen?.length) && <p style={{ fontSize: 13, color: "#888" }}>Niets gevonden.</p>}
            {(cvData.opleidingen || []).map((o, i) => (<div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i < cvData.opleidingen.length - 1 ? `1px solid ${KLEUR.lijn}` : "none" }}><div style={{ fontSize: 14, fontWeight: 500, color: KLEUR.inkt }}>{o.naam}</div><div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{[o.instelling, o.jaar].filter(Boolean).join(" · ")}</div></div>))}
          </Card>
          <Card>
            <SectionTitle>Hobby's & interesses</SectionTitle>
            {!(cvData.hobbies?.length) && <p style={{ fontSize: 13, color: "#888" }}>Niets gevonden.</p>}
            <div style={{ marginBottom: 12 }}>{(cvData.hobbies || []).map((h, i) => <span key={i} style={{ fontSize: 13, padding: "6px 14px", borderRadius: 6, background: KLEUR.papier, color: "#444", border: `1px solid ${KLEUR.lijn}`, fontWeight: 500, display: "inline-block", margin: "0 6px 6px 0" }}>{h}</span>)}</div>
            {hobbyList.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{hobbyList.map((item, i) => <EscoSkillPill key={i} item={item} bg="#eef2ff" col="#3730a3" />)}</div>}
          </Card>
        </div>

        {(!drijfResultaat || !ontwikkelAdvies) && (
          <div style={{ padding: "14px 18px", background: KLEUR.papier, borderRadius: 8, border: `1px dashed ${KLEUR.lijn}`, fontSize: 12, color: "#777", lineHeight: 1.6 }}>
            {!drijfResultaat && <div>Je hebt de Drijfveren nog niet ingevuld. <button onClick={() => gaNaarStap("drijfveren")} style={{ background: "none", border: "none", color: KLEUR.messingDonker, fontWeight: 600, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", padding: 0 }}>Alsnog invullen →</button></div>}
            {!ontwikkelAdvies && <div style={{ marginTop: 6 }}>Je hebt nog geen ontwikkelrichting ingevuld. <button onClick={() => gaNaarStap("ontwikkelen")} style={{ background: "none", border: "none", color: KLEUR.messingDonker, fontWeight: 600, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", padding: 0 }}>Alsnog invullen →</button></div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Prompts ──────────────────────────────────────────────────────────────────
const CV_PROMPT = `Je bent een expert loopbaancoach en CV-analist. Analyseer het meegestuurde CV grondig.

Retourneer ALLEEN een JSON-object (geen uitleg, geen markdown backticks) met EXACT deze structuur:

{
  "functies": [{"titel":"","bedrijf":"","periode":"","taken":["","","","",""]}],
  "weten": ["","","",""],
  "kunnen": ["","","",""],
  "zijn": ["","","",""],
  "willen": ["","","",""],
  "drijfveren": "",
  "ontwikkeltip": "",
  "opleidingen": [{"naam":"","instelling":"","jaar":""}],
  "hobbies": [""],
  "hobbySkills": ["","",""]
}

Regels:
- Haal maximaal 8 functies op uit het CV (de meest recente/relevante als er meer zijn).
- Per functie: "taken" bevat 4-6 taken die letterlijk of licht herschreven uit het CV blijken.
- BELANGRIJK: wees zo specifiek/fijnmazig mogelijk, gebruik de meest precieze term die het CV noemt. Voorbeeld: "MIG-lassen" i.p.v. "lassen".
- "hobbySkills": leid concrete skills af uit de hobby's/nevenactiviteiten. Altijd verplicht als er hobby's gevonden zijn.
- Genereer GEEN verhaal en GEEN top5, dat gebeurt in een latere stap.
- ontbrekende info = lege array []
- UITSLUITEND het JSON-object retourneren`;

function takenPrompt(functie) {
  return `Je bent een loopbaanexpert. Genereer een realistische lijst van taken voor de volgende functie.

Functietitel: "${functie.titel}"
Bedrijf/context: "${functie.bedrijf}"
Taken die al uit het CV blijken: ${JSON.stringify(functie.taken || [])}

Genereer een lijst van precies 8 taken in totaal:
- Neem de taken uit het CV letterlijk of licht herschreven over, met "bron": "cv"
- Vul aan met taken die gebruikelijk zijn voor dit beroep, met "bron": "beroep"
- Wees zo specifiek/fijnmazig mogelijk

Antwoord ALLEEN met dit JSON-object (geen backticks):
{"taken": [{"taak": "", "bron": "cv"}, {"taak": "", "bron": "beroep"}]}`;
}

function skillsPerTaakPrompt(functieTitel, taken) {
  return `Je bent een skills-expert. Voor de functie "${functieTitel}" krijg je een lijst met taken. Bepaal per taak welke concrete hardskills (vakinhoudelijk) en softskills (persoonlijk/sociaal) hierbij nodig zijn.

Taken:
${taken.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Regels:
- Per taak: 1-3 hardskills en 0-2 softskills
- Wees zo specifiek mogelijk
- Gebruik korte, concrete termen

Antwoord ALLEEN met dit JSON-object (geen backticks):
{"taken": [{"taak":"<exacte taaktekst>", "hardskills":["",""], "softskills":[""]}]}`;
}

function verhaalTop5Prompt(cvData, skillsMetNiveau, drijfSamenvatting, ontwikkelSamenvatting) {
  return `Je bent een loopbaancoach. Schrijf een persoonlijk verhaal IN DE JIJ-VORM (dus "Jij bent...", NIET "Ik ben...") gebaseerd op onderstaande bronnen.

Functies: ${(cvData.functies || []).map(f => f.titel).join(", ")}
Skills met zelfbeoordeeld niveau: ${JSON.stringify(skillsMetNiveau)}
${drijfSamenvatting ? `Drijfveren: ${drijfSamenvatting}` : "Geen drijfverentest beschikbaar."}
${ontwikkelSamenvatting ? `Ontwikkelrichting: ${ontwikkelSamenvatting}` : "Geen ontwikkelrichting beschikbaar."}

Regels:
- Schrijf ALTIJD in de jij-vorm
- Als er meer dan alleen skills beschikbaar is, verwijs daar expliciet naar in "bronnenGebruikt" en laat dit doorklinken in het verhaal
- Top5: kies bij voorkeur skills met een hoog zelfbeoordeeld niveau (Gevorderd/Expert), aangevuld met opvallende overige skills

Antwoord ALLEEN met dit JSON (geen backticks):
{
  "bronnenGebruikt": "Korte zin over welke bronnen gebruikt zijn.",
  "verhaal": {"alinea1":"","alinea2":"","alinea3":""},
  "top5": [{"skill":"","toelichting":""}]
}`;
}

function drijfverenPrompt(scores, top3) {
  const labels = Object.entries(scores).map(([k, v]) => `${DRIJFVEER_TYPES[k].label}: ${v}/5`).join(", ");
  return `Je bent een loopbaancoach. Schrijf een warm, persoonlijk drijfverenprofiel in het Nederlands.

Scores: ${labels}
Sterkste drijfveren: ${top3}

Geef je antwoord als JSON (geen backticks):
{
  "intro": "Persoonlijke intro over de sterkste drijfveren, gewone taal, geen vakjargon. (2-3 zinnen)",
  "werkvoorkeur": "Wat dit zegt over hoe iemand het beste werkt. (3-4 zinnen)",
  "beroepen": ["passende werkomgeving 1", "2", "3"],
  "tip": "Concrete loopbaantip. (2 zinnen)"
}`;
}

function ontwikkelPrompt(cvSamenvatting, drijfSamenvatting, doel) {
  return `Je bent een ervaren loopbaancoach. Maak een concreet, persoonlijk ontwikkeladvies.

${cvSamenvatting}
${drijfSamenvatting}

Ontwikkeldoel (kan vaag/kort zijn): "${doel}"

Belangrijk: als het ontwikkeldoel vaag of summier is, vul dit dan zelf actief aan, geef een concreet voorstel in plaats van te wachten op meer input.

Retourneer ALLEEN dit JSON-object (geen backticks):
{
  "richting": "Aanbevolen ontwikkelrichting (max 8 woorden)",
  "richtingToelichting": "Hoe verhoudt dit zich tot het eigen doel? (2-3 zinnen)",
  "leerstappen": [
    {"titel":"","omschrijving":""},
    {"titel":"","omschrijving":""},
    {"titel":"","omschrijving":""}
  ]
}`;
}
