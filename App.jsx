import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// ═══════════════════════════════════════════════════════════════
// SUPABASE — koppeling met de SkillsPortaal database
// ═══════════════════════════════════════════════════════════════
const SUPABASE_URL = "https://stzgxsgocqbuquzavgsu.supabase.co";
const SUPABASE_KEY = "sb_publishable_JaDLY5jH7poc4oRjx_EoeQ_c2jyT39c";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const NIVEAUS = ["Beginner", "Basis", "Gemiddeld", "Gevorderd", "Expert"];
const LEUK_LABELS = ["Helemaal niet", "Een beetje", "Gemiddeld", "Best wel", "Heel erg"];

// ─── Matcht een lijst skill-teksten parallel aan ESCO (sneller dan één voor één). ──
async function verrijkMetEsco(teksten) {
  const matches = await Promise.all(teksten.map(tekst => vindEscoMatch(tekst)));
  return teksten.map((tekst, i) => ({ tekst, esco: matches[i] }));
}

// ─── Zoekt de best passende ESCO-skill voor een stukje tekst, via het achterkamertje. ──
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

/** Slaat het complete skillsprofiel op: skills per taak (met niveau) + hobbyskills. */
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
    console.error("Fout bij opslaan CV-skills:", error);
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
  if (error) console.error("Fout bij opslaan ESCO-match:", error);
}

// ─── Drijfveren types (plain taal, geen RIASEC letters zichtbaar) ─────────────
const DRIJFVEER_TYPES = {
  R: { label: "De Maker", emoji: "🔧", kleur: "#e67e22", omschrijving: "Jij houdt van praktisch werken en dingen voor elkaar krijgen. Je werkt graag met je handen of in de buitenlucht en ziet resultaat van je werk." },
  I: { label: "De Denker", emoji: "🔬", kleur: "#2980b9", omschrijving: "Jij wordt gedreven door kennis en inzicht. Je analyseert graag, stelt vragen en wil begrijpen hoe dingen werken." },
  A: { label: "De Creator", emoji: "🎨", kleur: "#8e44ad", omschrijving: "Jij haalt energie uit creëren en vernieuwen. Je denkt buiten de kaders en wil iets neerzetten dat uniek en origineel is." },
  S: { label: "De Helper", emoji: "🤝", kleur: "#27ae60", omschrijving: "Jij doet het voor de mensen. Je begeleidt, ondersteunt en verbindt — en dat geeft jou energie." },
  E: { label: "De Leider", emoji: "🚀", kleur: "#c0392b", omschrijving: "Jij wil impact maken. Je overtuigt, neemt initiatief en stuurt aan op resultaat en groei." },
  C: { label: "De Organisator", emoji: "📋", kleur: "#16a085", omschrijving: "Jij houdt van structuur en overzicht. Je werkt nauwkeurig, betrouwbaar en zorgt dat alles goed geregeld is." },
};

const DRIJFVEER_VRAGEN = [
  { id: 1, vraag: "Waar krijg jij het meeste energie van op je werk?", opties: [
    { tekst: "Iets bouwen, maken of repareren — zichtbaar resultaat zien", type: "R" },
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
    { tekst: "Werken met je handen of techniek — iets tastbaars opleveren", type: "R" },
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
    { tekst: "Vakmanschap — echt goed worden in iets concreets", type: "R" },
    { tekst: "Kennis — altijd blijven leren en begrijpen", type: "I" },
    { tekst: "Expressie — mijn eigen stempel drukken op mijn werk", type: "A" },
    { tekst: "Betekenis — er zijn voor anderen en het verschil maken", type: "S" },
    { tekst: "Impact — zichtbaar bijdragen aan groei en succes", type: "E" },
    { tekst: "Betrouwbaarheid — zorgen dat alles klopt en goed geregeld is", type: "C" },
  ]},
];

const MAIN_TABS = [
  { id: "cv", label: "📄 CV Analyse" },
  { id: "drijfveren", label: "🔥 Drijfveren Test" },
  { id: "ontwikkel", label: "🌱 Ontwikkeladvies" },
];

const RESULT_TABS = [
  { id: "functies", label: "💼 Functies & Skills" },
  { id: "wksw", label: "🧠 Weten · Kunnen · Zijn · Willen" },
  { id: "meer", label: "🎓 Meer over jou" },
];

function SkillsModel() {
  return <img src="/skills-model.jpg" alt="Weten Kunnen Zijn Willen skills model" style={{ width: "100%", maxWidth: 280, display: "block", margin: "0 auto", borderRadius: 12 }} />;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width: 50, height: 50, border: "3px solid #e0e0d8", borderTopColor: "#e8c547", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
    </>
  );
}

function Card({ children, style }) {
  return <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e8e7e0", padding: "22px 24px", ...style }}>{children}</div>;
}

function SectionTitle({ children }) {
  return <div style={{ fontFamily: "Georgia,serif", fontSize: 16, fontWeight: 600, color: "#1a1a2e", marginBottom: 14 }}>{children}</div>;
}

// ─── Legenda: uitleg over kleuren en ESCO-koppeling ────────────────────────────
function SkillsLegenda() {
  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", padding: "12px 16px", background: "#fafaf8", border: "1px solid #eeede8", borderRadius: 12, marginBottom: 18, fontSize: 12, color: "#555" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: "#eef2ff", border: "1px solid #c7d2fe", display: "inline-block" }} /> Hardskill — vakinhoudelijk, aan te leren</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: "#fef3c7", border: "1px solid #fde68a", display: "inline-block" }} /> Softskill — persoonlijk, wie je bent</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>🔗 code — geverifieerde ESCO-koppeling, klik om te checken</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>⚠️ geen match — geen passende ESCO-skill gevonden</div>
    </div>
  );
}

// ─── Toont een skill-pill met de gekoppelde ESCO-code, altijd zichtbaar en klikbaar ──
function EscoSkillPill({ item, bg, col }) {
  const { tekst, esco } = typeof item === "string" ? { tekst: item, esco: null } : item;
  return (
    <span style={{ fontSize: 12, padding: "4px 11px", borderRadius: 20, fontWeight: 500, background: bg, color: col, display: "inline-flex", alignItems: "center", gap: 6 }}>
      {tekst}
      {esco ? (
        <a href={esco.uri} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
          title={`ESCO-label: ${esco.label}\nZekerheid: ${Math.round((esco.confidence || 0) * 100)}%\nKlik om te controleren in de ESCO-database`}
          style={{ fontSize: 10, fontFamily: "monospace", color: "inherit", opacity: 0.8, textDecoration: "underline", textDecorationStyle: "dotted" }}>
          🔗 {esco.code}
        </a>
      ) : (
        <span style={{ fontSize: 10, opacity: 0.6 }} title="Geen ESCO-match gevonden">⚠️ geen match</span>
      )}
    </span>
  );
}

// ─── Mini-schaal 1-5 met altijd zichtbaar label ────────────────────────────────
function MiniSchaal({ label, labels, waarde, onChange }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>{label}: <strong style={{ color: "#1a1a2e" }}>{labels[waarde - 1]}</strong></div>
      <div style={{ display: "flex", gap: 4 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} onClick={() => onChange(n)} title={labels[n - 1]}
            style={{ width: 26, height: 22, borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", border: n === waarde ? "2px solid #1a1a2e" : "1px solid #d0cfc8", background: n <= waarde ? "#e8c547" : "#fff", color: n <= waarde ? "#1a1a2e" : "#aaa" }}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Beoordelingsrij: hoe goed beheers je deze skill ────────────────────────────
function BeoordelingRij({ tekst, waarde, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "8px 12px", background: "#fafaf8", borderRadius: 10, border: "1px solid #eeede8", marginBottom: 6, flexWrap: "wrap" }}>
      <div style={{ fontSize: 12, color: "#333", minWidth: 130, flex: "1 1 130px" }}>{tekst}</div>
      <MiniSchaal label="Hoe beheers je deze skill" labels={NIVEAUS} waarde={waarde || 3} onChange={v => onChange(tekst, v)} />
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
        else { setFoutmelding("Account aangemaakt! Check je e-mail om te bevestigen, en log daarna in."); setModus("inloggen"); }
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
      <div style={{ background: "#fff", borderRadius: 20, border: "1px solid #e8e7e0", padding: "40px 36px", maxWidth: 400, width: "100%" }}>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 600, color: "#1a1a2e", marginBottom: 6, textAlign: "center" }}>{modus === "inloggen" ? "Inloggen" : "Account aanmaken"}</div>
        <p style={{ fontSize: 13, color: "#888", textAlign: "center", marginBottom: 24 }}>Log in om je skillsprofiel te bewaren in SkillsPortaal.</p>
        <form onSubmit={versturen}>
          <label style={{ fontSize: 13, color: "#555", display: "block", marginBottom: 6 }}>E-mailadres</label>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="naam@bedrijf.nl"
            style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #d0cfc8", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", marginBottom: 16 }} />
          <label style={{ fontSize: 13, color: "#555", display: "block", marginBottom: 6 }}>Wachtwoord</label>
          <input type="password" required value={wachtwoord} onChange={e => setWachtwoord(e.target.value)} placeholder="Minimaal 6 tekens" minLength={6}
            style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #d0cfc8", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", marginBottom: 16 }} />
          {foutmelding && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", color: "#991b1b", fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>⚠️ {foutmelding}</div>}
          <button type="submit" disabled={bezig} style={{ width: "100%", padding: "12px 0", borderRadius: 10, background: "#1a1a2e", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: bezig ? "default" : "pointer", fontFamily: "inherit" }}>{bezig ? "Bezig…" : modus === "inloggen" ? "Inloggen" : "Account aanmaken"}</button>
        </form>
        <div style={{ textAlign: "center", marginTop: 18 }}>
          <button onClick={() => { setModus(modus === "inloggen" ? "registreren" : "inloggen"); setFoutmelding(""); }} style={{ background: "none", border: "none", color: "#2a9d8f", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>{modus === "inloggen" ? "Nog geen account? Registreer hier" : "Al een account? Log hier in"}</button>
        </div>
      </div>
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

  const [mainTab, setMainTab] = useState("cv");

  const [cvStage, setCvStage] = useState("upload");
  const [activeResultTab, setActiveResultTab] = useState("functies");
  const [cvData, setCvData] = useState(null);
  const [cvError, setCvError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef();
  const [saveStatus, setSaveStatus] = useState(null);
  const [escoMatchCount, setEscoMatchCount] = useState(0);

  const [geselecteerdeFuncties, setGeselecteerdeFuncties] = useState(new Set());
  const [functieTaken, setFunctieTaken] = useState({});
  const [functieSkills, setFunctieSkills] = useState({});
  const [beoordelingen, setBeoordelingen] = useState({}); // { tekst: { goed: 3, leuk: 3 } }

  const [verhaalLoading, setVerhaalLoading] = useState(false);
  const [verhaalError, setVerhaalError] = useState("");
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

  async function callClaude(messages, maxTokens = 1000) {
    const res = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, messages }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error?.message || `API fout: ${res.status}`); }
    const json = await res.json();
    return json.content?.map(b => b.text || "").join("") || "";
  }

  function parseJSON(text) {
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : text.replace(/```json|```/g, "").trim());
  }

  // ── STAP 1: CV uploaden, lichte extractie ───────────────────────────────────
  async function handleFile(file) {
    if (!file || file.type !== "application/pdf") { setCvError("Upload een geldig PDF-bestand."); setCvStage("error"); return; }
    setCvStage("analyseren");
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = () => rej(new Error("Bestand kon niet worden gelezen."));
        r.readAsDataURL(file);
      });
      const text = await callClaude([{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }, { type: "text", text: CV_PROMPT }] }], 6000);
      const parsed = parseJSON(text);
      setCvData(parsed);
      setGeselecteerdeFuncties(new Set(parsed.functies?.length ? [0] : []));
      setCvStage("kiesFuncties");
    } catch (e) { setCvError(e.message); setCvStage("error"); }
  }

  function toggleFunctie(idx) {
    setGeselecteerdeFuncties(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  }

  async function genereerTaken() {
    setCvStage("takenGenereren");
    try {
      const indices = [...geselecteerdeFuncties];
      const resultaten = await Promise.all(indices.map(idx => {
        const functie = cvData.functies[idx];
        return callClaude([{ role: "user", content: takenPrompt(functie) }], 1500).then(parseJSON);
      }));
      const nieuweTaken = {};
      indices.forEach((idx, i) => { nieuweTaken[idx] = (resultaten[i].taken || []).map((t, j) => ({ id: j, taak: t.taak, bron: t.bron || "beroep", geselecteerd: true })); });
      setFunctieTaken(nieuweTaken);
      setCvStage("takenSelecteren");
    } catch (e) { setCvError(e.message); setCvStage("error"); }
  }

  function toggleTaak(functieIdx, taakId) {
    setFunctieTaken(prev => ({ ...prev, [functieIdx]: prev[functieIdx].map(t => t.id === taakId ? { ...t, geselecteerd: !t.geselecteerd } : t) }));
  }

  async function koppelSkills() {
    setCvStage("skillsMatchen");
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
      setCvStage("result");

      setSaveStatus("opslaan...");
      const resultaat = await slaCvSkillsOp(verrijkt, hobbyVerrijkt, beoordelingInit, sessie.user.id, sessie.user.email);
      setSaveStatus(resultaat.success ? "opgeslagen" : "fout");
      setEscoMatchCount(resultaat.aantalEscoGematcht || 0);
    } catch (e) { setCvError(e.message); setCvStage("error"); }
  }

  function wijzigBeoordeling(tekst, waarde) {
    setBeoordelingen(prev => ({ ...prev, [tekst]: waarde }));
  }

  function nieuwCv() {
    setCvStage("upload"); setCvData(null); setSaveStatus(null);
    setGeselecteerdeFuncties(new Set()); setFunctieTaken({}); setFunctieSkills({}); setBeoordelingen({});
  }

  function copyStory() {
    const txt = [cvData?.verhaal?.alinea1, cvData?.verhaal?.alinea2, cvData?.verhaal?.alinea3].filter(Boolean).join("\n\n");
    navigator.clipboard.writeText(txt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2200); });
  }

  // ── Verhaal + Top5 pas genereren na (optioneel) alle 3 stappen ──────────────
  async function genereerVerhaalEnTop5() {
    setVerhaalLoading(true); setVerhaalError("");
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
    } catch (e) { setVerhaalError(e.message || "Er is iets misgegaan."); }
    setVerhaalLoading(false);
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
      const cvSamenvatting = cvData ? `CV-profiel: functies: ${(cvData.functies||[]).map(f=>`${f.titel} bij ${f.bedrijf}`).join(", ")}. Weten: ${(cvData.weten||[]).join(", ")}. Kunnen: ${(cvData.kunnen||[]).join(", ")}. Zijn: ${(cvData.zijn||[]).join(", ")}. Willen: ${(cvData.willen||[]).join(", ")}.` : "Geen CV geüpload.";
      const drijfSamenvatting = drijfResultaat ? `Drijfveren profiel: ${Object.entries(drijfResultaat.scores).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k])=>DRIJFVEER_TYPES[k].label).join(", ")}` : "Drijfveren test niet gedaan.";
      const text = await callClaude([{ role: "user", content: ontwikkelPrompt(cvSamenvatting, drijfSamenvatting, ontwikkelDoel) }], 1500);
      setOntwikkelAdvies(parseJSON(text));
    } catch (e) { setOntwikkelError(e.message || "Er is een fout opgetreden."); }
    setOntwikkelLoading(false);
  }

  const huidigVraag = drijfStap >= 1 && drijfStap <= DRIJFVEER_VRAGEN.length ? DRIJFVEER_VRAGEN[drijfStap - 1] : null;
  const alleBeantwoord = Object.keys(antwoorden).length === DRIJFVEER_VRAGEN.length;
  const heeftContext = cvData || drijfResultaat;

  if (sessieAanHetLaden) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f4f0" }}><Spinner /></div>;

  if (!sessie) {
    return (
      <div style={{ fontFamily: "'Segoe UI',sans-serif", minHeight: "100vh", background: "#f5f4f0", display: "flex", flexDirection: "column" }}>
        <div style={{ background: "#1a1a2e", padding: "18px 32px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#e8c547,#f0a500)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📄</div>
          <div>
            <div style={{ fontFamily: "Georgia,serif", fontSize: 19, fontWeight: 700, color: "#fff" }}>CV Skills Extractor</div>
            <div style={{ fontSize: 12, color: "#8a8aaa", marginTop: 1 }}>Weten · Kunnen · Zijn · Willen in kaart brengen</div>
          </div>
        </div>
        <LoginScherm onIngelogd={setSessie} />
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Segoe UI',sans-serif", minHeight: "100vh", background: "#f5f4f0", display: "flex", flexDirection: "column" }}>

      <div style={{ background: "#1a1a2e", padding: "18px 32px", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#e8c547,#f0a500)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📄</div>
        <div>
          <div style={{ fontFamily: "Georgia,serif", fontSize: 19, fontWeight: 700, color: "#fff" }}>CV Skills Extractor</div>
          <div style={{ fontSize: 12, color: "#8a8aaa", marginTop: 1 }}>Weten · Kunnen · Zijn · Willen in kaart brengen</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 12, color: "#8a8aaa" }}>{sessie.user.email}</span>
          <button onClick={() => supabase.auth.signOut()} style={{ fontSize: 12, color: "#e8c547", background: "none", border: "1px solid #e8c547", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}>Uitloggen</button>
        </div>
      </div>

      <div style={{ background: "#fff", borderBottom: "1px solid #e8e7e0", display: "flex", padding: "0 32px" }}>
        {MAIN_TABS.map(t => (<button key={t.id} onClick={() => setMainTab(t.id)} style={{ padding: "14px 18px", fontSize: 13, fontWeight: 500, color: mainTab === t.id ? "#1a1a2e" : "#888", border: "none", borderBottom: mainTab === t.id ? "2px solid #e8c547" : "2px solid transparent", background: "none", cursor: "pointer", fontFamily: "inherit" }}>{t.label}</button>))}
      </div>

      {/* ══ CV TAB ══ */}
      {mainTab === "cv" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>

          {cvStage === "upload" && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 24px", gap: 48, flexWrap: "wrap" }}>
              <div style={{ maxWidth: 260, width: "100%" }}>
                <SkillsModel />
                <p style={{ fontSize: 13, color: "#666", textAlign: "center", marginTop: 16, lineHeight: 1.6 }}>De tool analyseert jouw CV op basis van dit model: wat je <strong>weet</strong>, wat je <strong>kunt</strong>, wie je <strong>bent</strong> en wat je <strong>wil</strong> — en zo krijg je een skillsprofiel.</p>
              </div>
              <div style={{ maxWidth: 380, width: "100%" }}>
                <div onClick={() => fileInputRef.current.click()} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
                  style={{ background: dragging ? "#fffef5" : "#fff", borderRadius: 20, border: `2px dashed ${dragging ? "#e8c547" : "#d0cfc8"}`, padding: "44px 36px", textAlign: "center", cursor: "pointer" }}>
                  <div style={{ fontSize: 48 }}>📋</div>
                  <div style={{ fontFamily: "Georgia,serif", fontSize: 21, color: "#1a1a2e", margin: "14px 0 8px" }}>Upload je CV</div>
                  <div style={{ fontSize: 14, color: "#888", lineHeight: 1.6, marginBottom: 8 }}>Sleep een PDF hierheen of klik om te bladeren.</div>
                  <div style={{ fontSize: 12, color: "#aaa", lineHeight: 1.5, marginBottom: 20 }}>Daarna kies je zelf welke functies je wilt uitwerken tot een gedetailleerd, ESCO-gekoppeld skillsprofiel.</div>
                  <input type="file" ref={fileInputRef} accept="application/pdf" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
                  <button style={{ padding: "12px 28px", borderRadius: 10, background: "#1a1a2e", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>📁 Kies PDF-bestand</button>
                </div>
              </div>
            </div>
          )}

          {cvStage === "analyseren" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48, textAlign: "center", gap: 16 }}>
              <Spinner />
              <div style={{ fontFamily: "Georgia,serif", fontSize: 20, color: "#1a1a2e" }}>CV wordt gelezen…</div>
              <div style={{ fontSize: 14, color: "#888", maxWidth: 320, lineHeight: 1.6 }}>We halen je functies, opleidingen en hobby's eruit — daarna kies je zelf waar we dieper op ingaan.</div>
            </div>
          )}

          {cvStage === "kiesFuncties" && cvData && (
            <div style={{ flex: 1, display: "flex", justifyContent: "center", padding: 32, overflowY: "auto" }}>
              <div style={{ maxWidth: 600, width: "100%" }}>
                <div style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 600, color: "#1a1a2e", marginBottom: 8 }}>Welke functies wil je uitwerken?</div>
                <p style={{ fontSize: 13, color: "#666", lineHeight: 1.6, marginBottom: 20 }}>Je huidige functie staat al aangevinkt. Je mag er gerust meer aanvinken — functies waar je goed in was of die je leuk vond — maar dat hoeft niet. We raden ongeveer 3 functies aan voor een compleet skillsprofiel.</p>
                {(cvData.functies || []).map((f, i) => (
                  <div key={i} onClick={() => toggleFunctie(i)} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 16px", borderRadius: 12, border: geselecteerdeFuncties.has(i) ? "2px solid #2a9d8f" : "2px solid #e8e7e0", background: geselecteerdeFuncties.has(i) ? "#f0faf8" : "#fff", marginBottom: 10, cursor: "pointer" }}>
                    <div style={{ width: 20, height: 20, borderRadius: 6, border: geselecteerdeFuncties.has(i) ? "none" : "2px solid #d0cfc8", background: geselecteerdeFuncties.has(i) ? "#2a9d8f" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                      {geselecteerdeFuncties.has(i) && <span style={{ color: "#fff", fontSize: 12 }}>✓</span>}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a2e" }}>{f.titel} {i === 0 && <span style={{ fontSize: 10, color: "#2a9d8f", fontWeight: 500 }}>· huidig</span>}</div>
                      <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{f.bedrijf} · {f.periode}</div>
                    </div>
                  </div>
                ))}
                <button onClick={genereerTaken} disabled={geselecteerdeFuncties.size === 0} style={{ marginTop: 12, padding: "12px 28px", borderRadius: 10, background: geselecteerdeFuncties.size === 0 ? "#ccc" : "#1a1a2e", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: geselecteerdeFuncties.size === 0 ? "not-allowed" : "pointer", fontFamily: "inherit" }}>Taken genereren voor {geselecteerdeFuncties.size} functie(s) →</button>
              </div>
            </div>
          )}

          {cvStage === "takenGenereren" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48, textAlign: "center", gap: 16 }}>
              <Spinner />
              <div style={{ fontFamily: "Georgia,serif", fontSize: 20, color: "#1a1a2e" }}>Taken worden gegenereerd…</div>
              <div style={{ fontSize: 14, color: "#888", maxWidth: 340, lineHeight: 1.6 }}>Per functie stellen we een lijst samen: taken uit je CV, aangevuld met gebruikelijke taken voor dit beroep.</div>
            </div>
          )}

          {cvStage === "takenSelecteren" && (
            <div style={{ flex: 1, padding: "28px 32px", overflowY: "auto" }}>
              <div style={{ maxWidth: 700, margin: "0 auto" }}>
                <div style={{ fontFamily: "Georgia,serif", fontSize: 21, fontWeight: 600, color: "#1a1a2e", marginBottom: 8 }}>Check je taken</div>
                <p style={{ fontSize: 13, color: "#666", marginBottom: 20, lineHeight: 1.6 }}>Alles staat aangevinkt. Vink taken uit die je nooit doet — de rest gebruiken we om je skills te bepalen.</p>
                {[...geselecteerdeFuncties].map(idx => {
                  const f = cvData.functies[idx];
                  return (
                    <Card key={idx} style={{ marginBottom: 20 }}>
                      <div style={{ fontFamily: "Georgia,serif", fontSize: 16, fontWeight: 600, color: "#1a1a2e", marginBottom: 2 }}>{f.titel}</div>
                      <div style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>{f.bedrijf}</div>
                      {(functieTaken[idx] || []).map(t => (
                        <div key={t.id} onClick={() => toggleTaak(idx, t.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer", background: t.geselecteerd ? "transparent" : "#faf5f5" }}>
                          <div style={{ width: 16, height: 16, borderRadius: 4, border: t.geselecteerd ? "none" : "2px solid #d0cfc8", background: t.geselecteerd ? "#2a9d8f" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{t.geselecteerd && <span style={{ color: "#fff", fontSize: 9 }}>✓</span>}</div>
                          <span style={{ fontSize: 13, color: t.geselecteerd ? "#333" : "#aaa", textDecoration: t.geselecteerd ? "none" : "line-through", flex: 1 }}>{t.taak}</span>
                          <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: t.bron === "cv" ? "#eef2ff" : "#fef3c7", color: t.bron === "cv" ? "#3730a3" : "#92400e" }}>{t.bron === "cv" ? "📄 CV" : "🔧 beroep"}</span>
                        </div>
                      ))}
                    </Card>
                  );
                })}
                <button onClick={koppelSkills} style={{ padding: "13px 28px", borderRadius: 10, background: "#1a1a2e", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Skills koppelen aan geselecteerde taken →</button>
              </div>
            </div>
          )}

          {cvStage === "skillsMatchen" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48, textAlign: "center", gap: 16 }}>
              <Spinner />
              <div style={{ fontFamily: "Georgia,serif", fontSize: 20, color: "#1a1a2e" }}>Skills worden gekoppeld aan ESCO…</div>
              <div style={{ fontSize: 14, color: "#888", maxWidth: 340, lineHeight: 1.6 }}>Per taak bepalen we de benodigde skills en matchen we deze aan de officiële ESCO-database.</div>
            </div>
          )}

          {cvStage === "error" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48, textAlign: "center", gap: 16 }}>
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "18px 24px", color: "#991b1b", fontSize: 14, lineHeight: 1.6, maxWidth: 440 }}>⚠️ {cvError}</div>
              <button onClick={nieuwCv} style={{ padding: "10px 22px", borderRadius: 10, background: "#1a1a2e", color: "#fff", border: "none", fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>← Opnieuw proberen</button>
            </div>
          )}

          {cvStage === "result" && cvData && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <div style={{ background: "#fafaf8", borderBottom: "1px solid #e8e7e0", display: "flex", padding: "0 32px", overflowX: "auto", alignItems: "center" }}>
                {RESULT_TABS.map(t => (<button key={t.id} onClick={() => setActiveResultTab(t.id)} style={{ padding: "13px 16px", fontSize: 13, fontWeight: 500, color: activeResultTab === t.id ? "#1a1a2e" : "#888", border: "none", borderBottom: activeResultTab === t.id ? "2px solid #e8c547" : "2px solid transparent", background: "none", cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit" }}>{t.label}</button>))}
                {saveStatus && (<span style={{ marginLeft: 16, fontSize: 12, color: saveStatus === "opgeslagen" ? "#166534" : saveStatus === "fout" ? "#991b1b" : "#888" }}>{saveStatus === "opslaan..." && "⏳ Opslaan in SkillsPortaal…"}{saveStatus === "opgeslagen" && `✅ Opgeslagen (${escoMatchCount} ESCO-skills gekoppeld)`}{saveStatus === "fout" && "⚠️ Opslaan mislukt"}</span>)}
                <button onClick={nieuwCv} style={{ marginLeft: "auto", padding: "13px 16px", fontSize: 13, color: "#c0392b", border: "none", borderBottom: "2px solid transparent", background: "none", cursor: "pointer", fontFamily: "inherit" }}>↩ Nieuw CV</button>
              </div>

              <div style={{ flex: 1, padding: "28px 32px", overflowY: "auto" }}>

                {/* Functies & Skills */}
                {activeResultTab === "functies" && (
                  <>
                    <SkillsLegenda />
                    {[...geselecteerdeFuncties].map(idx => {
                      const f = cvData.functies[idx];
                      const taken = functieSkills[idx] || [];
                      return (
                        <div key={idx} style={{ background: "#fff", borderRadius: 16, border: "1px solid #e8e7e0", marginBottom: 20, overflow: "hidden" }}>
                          <div style={{ background: "#1a1a2e", padding: "16px 22px" }}>
                            <div style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 600, color: "#fff" }}>{f.titel}</div>
                            <div style={{ fontSize: 13, color: "#8a8aaa", marginTop: 2 }}>{f.bedrijf}</div>
                          </div>
                          <div style={{ padding: "18px 22px" }}>
                            {taken.length === 0 && <p style={{ fontSize: 13, color: "#888" }}>Geen taken geselecteerd voor deze functie.</p>}
                            {taken.map((t, j) => {
                              const skillsVoorTaak = [...t.hardskills, ...t.softskills];
                              return (
                                <div key={j} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: j < taken.length - 1 ? "1px solid #f0efe8" : "none" }}>
                                  <div style={{ fontSize: 13, color: "#444", marginBottom: 8 }}>→ {t.taak}</div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                                    {t.hardskills.map((s, k) => <EscoSkillPill key={"h"+k} item={s} bg="#eef2ff" col="#3730a3" />)}
                                    {t.softskills.map((s, k) => <EscoSkillPill key={"s"+k} item={s} bg="#fef3c7" col="#92400e" />)}
                                  </div>
                                  {skillsVoorTaak.map(s => <BeoordelingRij key={s.tekst} tekst={s.tekst} waarde={beoordelingen[s.tekst]} onChange={wijzigBeoordeling} />)}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}

                {/* WKSW */}
                {activeResultTab === "wksw" && (
                  <div>
                    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 24, marginBottom: 16, alignItems: "start" }}>
                      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e8e7e0", padding: 20 }}><SkillsModel /></div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                        {[
                          { key: "weten", label: "Weten", icon: "📚", sub: "Kennis & expertise", col: "#4a9e4e" },
                          { key: "kunnen", label: "Kunnen", icon: "⚙️", sub: "Vaardigheden", col: "#2a8abf" },
                          { key: "zijn", label: "Zijn", icon: "🌱", sub: "Persoonskenmerken", col: "#3aada8" },
                          { key: "willen", label: "Willen", icon: "🔥", sub: "Motivatie & drijfveren", col: "#7b5ea7" },
                        ].map(({ key, label, icon, sub, col }) => (
                          <Card key={key}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}><div style={{ width: 10, height: 10, borderRadius: 3, background: col, flexShrink: 0 }} /><div style={{ fontFamily: "Georgia,serif", fontSize: 16, fontWeight: 600 }}>{icon} {label}</div></div>
                            <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>{sub}</div>
                            {(cvData[key] || []).map((item, i) => <div key={i} style={{ fontSize: 13, color: "#333", padding: "7px 12px", background: "#fafaf8", borderRadius: 8, border: "1px solid #eeede8", lineHeight: 1.5, marginBottom: 7 }}>{item}</div>)}
                          </Card>
                        ))}
                      </div>
                    </div>
                    {cvData.drijfveren && <div style={{ background: "#1a1a2e", borderRadius: 14, padding: "18px 22px", marginBottom: 14 }}><div style={{ fontFamily: "Georgia,serif", fontSize: 15, color: "#e8c547", marginBottom: 8 }}>🎯 Drijfveren</div><p style={{ fontSize: 13, color: "#ccc", lineHeight: 1.7, margin: 0 }}>{cvData.drijfveren}</p></div>}
                    {cvData.ontwikkeltip && <div style={{ background: "#f0fdf4", borderRadius: 14, padding: "18px 22px", border: "1px solid #bbf7d0" }}><div style={{ fontSize: 14, fontWeight: 600, color: "#166534", marginBottom: 8 }}>💡 Ontwikkeltip</div><p style={{ fontSize: 13, color: "#166534", lineHeight: 1.7, margin: 0 }}>{cvData.ontwikkeltip}</p></div>}
                  </div>
                )}

                {/* Meer over jou: Opleiding & Hobby's + Verhaal & Top5 */}
                {activeResultTab === "meer" && (
                  <div style={{ maxWidth: 700 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
                      <Card>
                        <SectionTitle>🎓 Opleidingen & cursussen</SectionTitle>
                        {!(cvData.opleidingen?.length) && <p style={{ fontSize: 13, color: "#888" }}>Geen opleidingsgegevens gevonden.</p>}
                        {(cvData.opleidingen || []).map((o, i) => (<div key={i} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: i < cvData.opleidingen.length - 1 ? "1px solid #f0efe8" : "none" }}><div style={{ fontSize: 14, fontWeight: 500, color: "#1a1a2e" }}>{o.naam}</div><div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{[o.instelling, o.jaar].filter(Boolean).join(" · ")}</div></div>))}
                      </Card>
                      <Card>
                        <SectionTitle>🎨 Hobby's & interesses</SectionTitle>
                        {!(cvData.hobbies?.length) && <p style={{ fontSize: 13, color: "#888" }}>Geen hobby's gevonden in het CV.</p>}
                        <div style={{ marginBottom: 14 }}>{(cvData.hobbies || []).map((h, i) => <span key={i} style={{ fontSize: 13, padding: "7px 16px", borderRadius: 20, background: "#f5f4f0", color: "#444", border: "1px solid #e0dfd8", fontWeight: 500, display: "inline-block", margin: "0 6px 6px 0" }}>{h}</span>)}</div>
                        {(cvData.hobbySkills?.length > 0) && (<><div style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 }}>Skills die hieruit blijken</div><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{cvData.hobbySkills.map((item, i) => <EscoSkillPill key={i} item={item} bg="#eef2ff" col="#3730a3" />)}</div></>)}
                      </Card>
                    </div>

                    <div style={{ fontFamily: "Georgia,serif", fontSize: 21, fontWeight: 600, color: "#1a1a2e", marginBottom: 14 }}>✨ Jouw verhaal</div>

                    {!cvData.verhaal && !verhaalLoading && (
                      <Card>
                        <p style={{ fontSize: 13, color: "#666", lineHeight: 1.7, marginBottom: 16 }}>
                          Je persoonlijke verhaal combineert je skillsprofiel met (indien beschikbaar) je Drijfveren Test en je Ontwikkeladvies. Hoe meer je hebt ingevuld, hoe rijker het verhaal.
                        </p>
                        <div style={{ display: "flex", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12, color: "#166534" }}>✅ CV-skills</span>
                          <span style={{ fontSize: 12, color: drijfResultaat ? "#166534" : "#aaa" }}>{drijfResultaat ? "✅" : "⬜"} Drijfveren Test</span>
                          <span style={{ fontSize: 12, color: ontwikkelAdvies ? "#166534" : "#aaa" }}>{ontwikkelAdvies ? "✅" : "⬜"} Ontwikkeladvies</span>
                        </div>
                        {verhaalError && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", color: "#991b1b", fontSize: 13, marginBottom: 14 }}>⚠️ {verhaalError}</div>}
                        <button onClick={genereerVerhaalEnTop5} style={{ padding: "12px 26px", borderRadius: 10, background: "#1a1a2e", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Genereer mijn verhaal en top 5 →</button>
                      </Card>
                    )}

                    {verhaalLoading && (<div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 0", gap: 16, textAlign: "center" }}><Spinner /><div style={{ fontFamily: "Georgia,serif", fontSize: 18, color: "#1a1a2e" }}>Jouw verhaal wordt geschreven…</div></div>)}

                    {cvData.verhaal && !verhaalLoading && (
                      <>
                        {cvData.verhaalBronnen && <p style={{ fontSize: 12, color: "#888", fontStyle: "italic", marginBottom: 16 }}>{cvData.verhaalBronnen}</p>}
                        {(cvData.top5?.length > 0) && (
                          <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 26, marginBottom: 22 }}>
                            <div style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 600, color: "#e8c547", marginBottom: 18 }}>⭐ Jouw top 5 skills</div>
                            {cvData.top5.map((item, i) => (<div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14 }}><div style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(232,197,71,0.2)", color: "#e8c547", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div><div style={{ fontSize: 14, color: "#ddd", lineHeight: 1.6 }}><span style={{ fontWeight: 600, color: "#fff" }}>{item.skill}</span> — {item.toelichting}</div></div>))}
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                          <button onClick={copyStory} style={{ padding: "9px 18px", borderRadius: 10, background: copied ? "#166534" : "#1a1a2e", color: "#fff", border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>{copied ? "✓ Gekopieerd!" : "📋 Kopieer verhaal"}</button>
                        </div>
                        <Card>{[cvData.verhaal?.alinea1, cvData.verhaal?.alinea2, cvData.verhaal?.alinea3].filter(Boolean).map((p, i, arr) => (<p key={i} style={{ fontSize: 15, color: "#333", lineHeight: 1.85, marginBottom: i < arr.length - 1 ? 18 : 0 }}>{p}</p>))}</Card>
                        <button onClick={genereerVerhaalEnTop5} style={{ marginTop: 14, padding: "9px 18px", borderRadius: 10, background: "#f5f4f0", color: "#444", border: "1px solid #d0cfc8", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>↻ Opnieuw genereren</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ DRIJFVEREN TAB ══ */}
      {mainTab === "drijfveren" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {drijfStap === 0 && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 24px", gap: 48, flexWrap: "wrap" }}>
              <div style={{ maxWidth: 240 }}>
                <SkillsModel />
                <p style={{ fontSize: 12, color: "#888", textAlign: "center", marginTop: 12, lineHeight: 1.5 }}>De test brengt jouw <strong>Willen</strong> in kaart — je motivatie en drijfveren.</p>
              </div>
              <div style={{ background: "#fff", borderRadius: 20, border: "1px solid #e8e7e0", padding: "40px 36px", maxWidth: 420, width: "100%", textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🔥</div>
                <div style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 600, color: "#1a1a2e", marginBottom: 12 }}>Wat drijft jou?</div>
                <p style={{ fontSize: 14, color: "#555", lineHeight: 1.7, marginBottom: 24 }}>In 5 vragen ontdek je wat jou écht motiveert op het werk. Geen goed of fout antwoord — kies gewoon wat het meest bij jou past.</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 28 }}>{Object.entries(DRIJFVEER_TYPES).map(([k, v]) => (<span key={k} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 20, background: v.kleur + "20", color: v.kleur, fontWeight: 600, border: `1px solid ${v.kleur}44` }}>{v.emoji} {v.label}</span>))}</div>
                <button onClick={() => { setDrijfStap(1); setAntwoorden({}); setDrijfResultaat(null); }} style={{ padding: "13px 32px", borderRadius: 12, background: "#1a1a2e", color: "#fff", border: "none", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Start de test →</button>
              </div>
            </div>
          )}
          {drijfStap >= 1 && drijfStap <= DRIJFVEER_VRAGEN.length && huidigVraag && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
              <div style={{ maxWidth: 580, width: "100%" }}>
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#888", marginBottom: 8 }}><span>Vraag {drijfStap} van {DRIJFVEER_VRAGEN.length}</span><span>{Math.round((drijfStap - 1) / DRIJFVEER_VRAGEN.length * 100)}%</span></div>
                  <div style={{ height: 6, background: "#e0e0d8", borderRadius: 10 }}><div style={{ height: "100%", background: "linear-gradient(90deg,#e8c547,#f0a500)", borderRadius: 10, width: `${((drijfStap - 1) / DRIJFVEER_VRAGEN.length) * 100}%`, transition: "width 0.3s" }} /></div>
                </div>
                <Card style={{ padding: "32px 28px" }}>
                  <div style={{ fontFamily: "Georgia,serif", fontSize: 20, fontWeight: 600, color: "#1a1a2e", marginBottom: 24, lineHeight: 1.4 }}>{huidigVraag.vraag}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {huidigVraag.opties.map((opt, i) => { const type = DRIJFVEER_TYPES[opt.type]; const gekozen = antwoorden[drijfStap] === opt.type; return (<button key={i} onClick={() => kiesAntwoord(opt.type)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderRadius: 12, border: gekozen ? `2px solid ${type.kleur}` : "2px solid #e8e7e0", background: gekozen ? type.kleur + "18" : "#fafaf8", cursor: "pointer", textAlign: "left", transition: "all 0.15s", fontFamily: "inherit" }}><span style={{ fontSize: 18, flexShrink: 0 }}>{type.emoji}</span><span style={{ fontSize: 14, color: "#333", lineHeight: 1.5 }}>{opt.tekst}</span></button>); })}
                  </div>
                </Card>
                {alleBeantwoord && drijfStap === DRIJFVEER_VRAGEN.length && (<div style={{ textAlign: "center", marginTop: 24 }}><button onClick={async () => { const scores = berekenScores(antwoorden); setDrijfStap(DRIJFVEER_VRAGEN.length + 1); await genereerDrijfverenProfiel(scores); }} style={{ padding: "13px 32px", borderRadius: 12, background: "#1a1a2e", color: "#fff", border: "none", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Bekijk mijn drijfveren →</button></div>)}
              </div>
            </div>
          )}
          {drijfStap > DRIJFVEER_VRAGEN.length && drijfLoading && (<div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48, textAlign: "center", gap: 16 }}><Spinner /><div style={{ fontFamily: "Georgia,serif", fontSize: 20, color: "#1a1a2e" }}>Jouw drijfveren worden in kaart gebracht…</div></div>)}
          {drijfStap > DRIJFVEER_VRAGEN.length && !drijfLoading && drijfResultaat && (() => {
            const { scores, gesorteerd, interpretatie } = drijfResultaat;
            const top3 = gesorteerd.slice(0, 3);
            return (
              <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
                <div style={{ maxWidth: 680 }}>
                  <div style={{ background: "#1a1a2e", borderRadius: 20, padding: "24px 28px", marginBottom: 20 }}>
                    <div style={{ fontSize: 12, color: "#8a8aaa", marginBottom: 10, letterSpacing: "0.8px", textTransform: "uppercase" }}>Jouw belangrijkste drijfveren</div>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{top3.map(([k], i) => { const t = DRIJFVEER_TYPES[k]; return (<div key={k} style={{ display: "flex", alignItems: "center", gap: 10, background: t.kleur + "25", border: `1px solid ${t.kleur}55`, borderRadius: 12, padding: "10px 16px" }}><span style={{ fontSize: 22 }}>{t.emoji}</span><div><div style={{ fontSize: 11, color: "#8a8aaa", fontWeight: 500 }}>#{i + 1}</div><div style={{ fontSize: 15, fontWeight: 700, color: t.kleur }}>{t.label}</div></div></div>); })}</div>
                  </div>
                  <Card style={{ marginBottom: 16 }}><SectionTitle>📊 Jouw drijfverenprofiel</SectionTitle>{gesorteerd.map(([k, v]) => { const t = DRIJFVEER_TYPES[k]; return (<div key={k} style={{ marginBottom: 12 }}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}><span style={{ fontWeight: 500 }}>{t.emoji} {t.label}</span><span style={{ fontSize: 12, color: "#888" }}>{t.omschrijving.split(".")[0]}</span></div><div style={{ height: 8, background: "#f0efe8", borderRadius: 10 }}><div style={{ height: "100%", background: t.kleur, borderRadius: 10, width: v === 0 ? "4px" : `${(v / DRIJFVEER_VRAGEN.length) * 100}%`, transition: "width 0.5s" }} /></div></div>); })}</Card>
                  {interpretatie && (<Card style={{ marginBottom: 16 }}><SectionTitle>🧠 Wat dit over jou zegt</SectionTitle><p style={{ fontSize: 14, color: "#333", lineHeight: 1.75, marginBottom: 14 }}>{interpretatie.intro}</p><p style={{ fontSize: 14, color: "#333", lineHeight: 1.75, marginBottom: 18 }}>{interpretatie.werkvoorkeur}</p><div style={{ fontWeight: 600, fontSize: 13, color: "#555", marginBottom: 10 }}>💼 Werkomgevingen die bij jou passen</div><div style={{ marginBottom: 18 }}>{(interpretatie.beroepen || []).map((b, i) => <span key={i} style={{ fontSize: 13, padding: "7px 16px", borderRadius: 20, background: "#f0f4ff", color: "#3730a3", fontWeight: 500, border: "1px solid #c7d2fe", display: "inline-block", margin: "0 6px 6px 0" }}>{b}</span>)}</div><div style={{ background: "#f0fdf4", borderRadius: 12, padding: "14px 18px", border: "1px solid #bbf7d0" }}><div style={{ fontSize: 13, fontWeight: 600, color: "#166534", marginBottom: 6 }}>💡 Tip voor jouw loopbaan</div><div style={{ fontSize: 13, color: "#166534", lineHeight: 1.6 }}>{interpretatie.tip}</div></div></Card>)}
                  <Card style={{ marginBottom: 20 }}><SectionTitle>📖 Wat betekenen de drijfveren?</SectionTitle><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{Object.entries(DRIJFVEER_TYPES).map(([k, v]) => (<div key={k} style={{ padding: "12px 14px", borderRadius: 10, background: v.kleur + "12", border: `1px solid ${v.kleur}30` }}><div style={{ fontWeight: 600, fontSize: 13, color: v.kleur, marginBottom: 4 }}>{v.emoji} {v.label}</div><div style={{ fontSize: 12, color: "#555", lineHeight: 1.5 }}>{v.omschrijving}</div></div>))}</div></Card>
                  <button onClick={() => { setDrijfStap(0); setAntwoorden({}); setDrijfResultaat(null); }} style={{ padding: "11px 24px", borderRadius: 10, background: "#1a1a2e", color: "#fff", border: "none", fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>↩ Test opnieuw doen</button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ══ ONTWIKKELADVIES TAB ══ */}
      {mainTab === "ontwikkel" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "32px" }}>
          <div style={{ maxWidth: 680 }}>
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e8e7e0", padding: "14px 20px", marginBottom: 24, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}><span>{cvData ? "✅" : "⬜"}</span><span style={{ color: cvData ? "#166534" : "#888", fontWeight: 500 }}>{cvData ? "CV geanalyseerd" : "Nog geen CV — upload eerst"}</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}><span>{drijfResultaat ? "✅" : "⬜"}</span><span style={{ color: drijfResultaat ? "#166534" : "#888", fontWeight: 500 }}>{drijfResultaat ? `Drijfveren: ${Object.entries(drijfResultaat.scores).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k])=>DRIJFVEER_TYPES[k].label).join(" · ")}` : "Drijfveren test nog niet gedaan"}</span></div>
              {!heeftContext && <div style={{ fontSize: 12, color: "#f0a500", fontStyle: "italic", width: "100%" }}>Tip: doe eerst de CV Analyse en/of Drijfveren Test voor een persoonlijker advies.</div>}
            </div>
            <Card style={{ marginBottom: 20 }}>
              <SectionTitle>🌱 Waar wil jij naartoe groeien?</SectionTitle>
              <p style={{ fontSize: 13, color: "#666", lineHeight: 1.6, marginBottom: 16 }}>Beschrijf zo concreet mogelijk wat je wilt ontwikkelen. Dat kan een richting zijn, een rol, een vaardigheid of iets heel persoonlijks.</p>
              <textarea value={ontwikkelDoel} onChange={e => setOntwikkelDoel(e.target.value)} placeholder="Bijv: Ik wil doorgroeien naar een leidinggevende rol, maar merk dat ik moeite heb om mensen aan te sturen…" style={{ width: "100%", minHeight: 110, padding: "14px 16px", borderRadius: 10, border: "1px solid #d0cfc8", fontSize: 14, fontFamily: "inherit", lineHeight: 1.6, color: "#333", background: "#fafaf8", resize: "vertical", outline: "none", boxSizing: "border-box" }} />
              <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#aaa" }}>{ontwikkelDoel.length} tekens</span>
                <button onClick={genereerOntwikkelAdvies} disabled={ontwikkelDoel.trim().length < 10 || ontwikkelLoading} style={{ padding: "12px 28px", borderRadius: 10, background: ontwikkelDoel.trim().length < 10 ? "#ccc" : "#1a1a2e", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: ontwikkelDoel.trim().length < 10 ? "not-allowed" : "pointer", fontFamily: "inherit" }}>{ontwikkelLoading ? "Bezig…" : "Genereer ontwikkeladvies →"}</button>
              </div>
            </Card>
            {ontwikkelLoading && (<div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 0", gap: 16, textAlign: "center" }}><Spinner /><div style={{ fontFamily: "Georgia,serif", fontSize: 18, color: "#1a1a2e" }}>Ontwikkeladvies wordt opgesteld…</div></div>)}
            {ontwikkelError && !ontwikkelLoading && (<div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "16px 20px", color: "#991b1b", fontSize: 14, lineHeight: 1.6 }}>⚠️ {ontwikkelError}</div>)}
            {ontwikkelAdvies && !ontwikkelLoading && (
              <div>
                <div style={{ background: "#1a1a2e", borderRadius: 16, padding: "24px 28px", marginBottom: 16 }}><div style={{ fontSize: 11, color: "#8a8aaa", marginBottom: 6, letterSpacing: "0.8px", textTransform: "uppercase" }}>Aanbevolen ontwikkelrichting</div><div style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 700, color: "#e8c547", marginBottom: 10 }}>{ontwikkelAdvies.richting}</div><p style={{ fontSize: 14, color: "#ccc", lineHeight: 1.7, margin: 0 }}>{ontwikkelAdvies.richtingToelichting}</p></div>
                <Card style={{ marginBottom: 16 }}><SectionTitle>🎯 Waarom past dit bij jou?</SectionTitle><p style={{ fontSize: 14, color: "#333", lineHeight: 1.7, margin: 0 }}>{ontwikkelAdvies.waaromPassend}</p></Card>
                <Card style={{ marginBottom: 16 }}><SectionTitle>📈 Concrete leerstappen</SectionTitle><div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{(ontwikkelAdvies.leerstappen || []).map((stap, i) => (<div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}><div style={{ width: 28, height: 28, borderRadius: 8, background: "#1a1a2e", color: "#e8c547", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div><div><div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a2e", marginBottom: 3 }}>{stap.titel}</div><div style={{ fontSize: 13, color: "#555", lineHeight: 1.6 }}>{stap.omschrijving}</div>{stap.tijdsindicatie && <div style={{ fontSize: 12, color: "#e67e22", marginTop: 4, fontWeight: 500 }}>⏱ {stap.tijdsindicatie}</div>}</div></div>))}</div></Card>
                <div style={{ background: "#f0fdf4", borderRadius: 14, padding: "18px 22px", border: "1px solid #bbf7d0", marginBottom: 14 }}><div style={{ fontSize: 14, fontWeight: 700, color: "#166534", marginBottom: 8 }}>⚡ Jouw eerste actie — doe dit deze week</div><p style={{ fontSize: 14, color: "#166534", lineHeight: 1.7, margin: 0 }}>{ontwikkelAdvies.eersteActie}</p></div>
                {ontwikkelAdvies.aandachtspunt && (<div style={{ background: "#fffbeb", borderRadius: 14, padding: "16px 20px", border: "1px solid #fde68a", marginBottom: 16 }}><div style={{ fontSize: 14, fontWeight: 600, color: "#92400e", marginBottom: 6 }}>⚠️ Houd dit in de gaten</div><p style={{ fontSize: 13, color: "#92400e", lineHeight: 1.6, margin: 0 }}>{ontwikkelAdvies.aandachtspunt}</p></div>)}
                <button onClick={() => { setOntwikkelAdvies(null); setOntwikkelDoel(""); }} style={{ padding: "10px 22px", borderRadius: 10, background: "#f5f4f0", color: "#444", border: "1px solid #d0cfc8", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>↩ Nieuw advies genereren</button>
              </div>
            )}
          </div>
        </div>
      )}
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
- Haal maximaal 8 functies op uit het CV (de meest recente/relevante als er meer zijn) — de gebruiker kiest zelf welke functies hij verder wil uitwerken.
- Per functie: "taken" bevat 4-6 taken die letterlijk of licht herschreven uit het CV blijken (basis voor een latere, uitgebreidere taken-analyse — GEEN hardSkills/softSkills hier).
- BELANGRIJK — wees zo specifiek/fijnmazig mogelijk: gebruik de meest precieze term die het CV noemt. Voorbeeld: "MIG-lassen" i.p.v. "lassen". Val alleen terug op een algemenere term als het CV zelf geen specifiekere aanduiding geeft.
- "hobbySkills": leid concrete skills af uit de hobby's/nevenactiviteiten (bijv. vrijwilligerswerk als trainer → "coachen", "geduld hebben"). Altijd verplicht als er hobby's/nevenactiviteiten gevonden zijn. Ook hier: wees zo specifiek mogelijk.
- Genereer GEEN verhaal en GEEN top5 — dat gebeurt in een latere stap.
- ontbrekende info = lege array []
- UITSLUITEND het JSON-object retourneren`;

function takenPrompt(functie) {
  return `Je bent een loopbaanexpert. Genereer een realistische lijst van taken voor de volgende functie.

Functietitel: "${functie.titel}"
Bedrijf/context: "${functie.bedrijf}"
Taken die al uit het CV blijken: ${JSON.stringify(functie.taken || [])}

Genereer een lijst van precies 8 taken in totaal:
- Neem de taken uit het CV letterlijk of licht herschreven over, met "bron": "cv"
- Vul aan met taken die gebruikelijk zijn voor dit beroep/deze functie, met "bron": "beroep"
- Wees zo specifiek/fijnmazig mogelijk (bijv. "MIG-lassen uitvoeren" i.p.v. "lassen uitvoeren")

Antwoord ALLEEN met dit JSON-object (geen backticks):
{"taken": [{"taak": "", "bron": "cv"}, {"taak": "", "bron": "beroep"}]}`;
}

function skillsPerTaakPrompt(functieTitel, taken) {
  return `Je bent een skills-expert. Voor de functie "${functieTitel}" krijg je een lijst met taken. Bepaal per taak welke concrete hardskills (vakinhoudelijk) en softskills (persoonlijk/sociaal) hierbij nodig zijn.

Taken:
${taken.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Regels:
- Per taak: 1-3 hardskills en 0-2 softskills
- Wees zo specifiek mogelijk (bijv. "MIG-lassen" i.p.v. "lassen")
- Gebruik korte, concrete termen (geen hele zinnen)

Antwoord ALLEEN met dit JSON-object (geen backticks):
{"taken": [{"taak":"<exacte taaktekst zoals hierboven>", "hardskills":["",""], "softskills":[""]}]}`;
}

function verhaalTop5Prompt(cvData, skillsMetNiveau, drijfSamenvatting, ontwikkelSamenvatting) {
  return `Je bent een loopbaancoach. Schrijf een persoonlijk verhaal IN DE JIJ-VORM (dus "Jij bent...", "Jouw kracht zit in...", NIET "Ik ben...") gebaseerd op onderstaande bronnen.

Functies: ${(cvData.functies || []).map(f => f.titel).join(", ")}
Skills met zelfbeoordeeld niveau: ${JSON.stringify(skillsMetNiveau)}
${drijfSamenvatting ? `Drijfveren: ${drijfSamenvatting}` : "Geen drijfverentest beschikbaar."}
${ontwikkelSamenvatting ? `Ontwikkelrichting: ${ontwikkelSamenvatting}` : "Geen ontwikkelrichting beschikbaar."}

Regels:
- Schrijf ALTIJD in de jij-vorm
- Als er meer dan alleen skills beschikbaar is (drijfveren en/of ontwikkelrichting), verwijs daar expliciet naar in "bronnenGebruikt" en laat dit ook doorklinken in het verhaal
- Top5: kies bij voorkeur skills met een hoog zelfbeoordeeld niveau (Gevorderd/Expert) en hoge "leuk"-score, aangevuld met opvallende overige skills

Antwoord ALLEEN met dit JSON (geen backticks):
{
  "bronnenGebruikt": "Korte zin die uitlegt welke bronnen gebruikt zijn, bijv. 'Dit verhaal combineert je CV-skills met je drijfverenprofiel.' of 'Dit verhaal is gebaseerd op je CV-skills.' als er geen andere bronnen zijn.",
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
  "intro": "Persoonlijke intro over de sterkste drijfveren. Gebruik gewone taal, geen vakjargon. (2-3 zinnen)",
  "werkvoorkeur": "Wat dit zegt over hoe iemand het beste werkt, wat energie geeft en wat energie kost. (3-4 zinnen)",
  "beroepen": ["passende werkomgeving of rol 1", "passende werkomgeving of rol 2", "passende werkomgeving of rol 3"],
  "tip": "Concrete loopbaantip gebaseerd op deze drijfveren. (2 zinnen)"
}`;
}

function ontwikkelPrompt(cvSamenvatting, drijfSamenvatting, doel) {
  return `Je bent een ervaren loopbaancoach. Maak een concreet, persoonlijk ontwikkeladvies.

${cvSamenvatting}
${drijfSamenvatting}

Ontwikkeldoel: "${doel}"

Retourneer ALLEEN dit JSON-object (geen backticks):
{
  "richting": "Aanbevolen ontwikkelrichting (max 8 woorden)",
  "richtingToelichting": "Hoe verhoudt dit zich tot het eigen doel? (2-3 zinnen)",
  "waaromPassend": "Waarom past dit bij dit profiel? Concreet en persoonlijk. (3-4 zinnen)",
  "leerstappen": [
    {"titel":"","omschrijving":"Wat doe je precies en wat levert het op?","tijdsindicatie":"bijv. 1-2 maanden"},
    {"titel":"","omschrijving":"","tijdsindicatie":""},
    {"titel":"","omschrijving":"","tijdsindicatie":""},
    {"titel":"","omschrijving":"","tijdsindicatie":""}
  ],
  "eersteActie": "Één concrete actie die deze week gedaan kan worden. Specifiek en motiverend.",
  "aandachtspunt": "Één valkuil of aandachtspunt. Positief geformuleerd."
}`;
}
