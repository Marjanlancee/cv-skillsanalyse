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

// ─── Eigen lijntekening-icoontjes per drijfveer-type (i.p.v. emoji) ────────────
function DrijfveerIcon({ type, kleur, size = 22 }) {
  const paden = {
    R: <path d="M18 6 L14 10 L16 12 L20 8 L21 9 C22 11 20 13 18 12 L8 22 C7 23 5 23 4 22 C3 21 3 19 4 18 L14 8 C13 6 15 4 17 5 Z" />,
    I: <><circle cx="11" cy="11" r="6" /><line x1="16" y1="16" x2="21" y2="21" /></>,
    A: <path d="M4 20 L4 16 L16 4 L20 8 L8 20 Z M13 7 L17 11" />,
    S: <><path d="M4 17 L9.5 11.5" /><path d="M20 17 L14.5 11.5" /><circle cx="12" cy="10.5" r="2" /><path d="M4 17 C4 15 5.5 14 7 14.5" /><path d="M20 17 C20 15 18.5 14 17 14.5" /></>,
    E: <path d="M5 3 L5 21 M5 4 L18 4 L14 8 L18 12 L5 12" />,
    C: <><rect x="4" y="4" width="16" height="16" rx="1" /><line x1="8" y1="9" x2="16" y2="9" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={kleur} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {paden[type]}
    </svg>
  );
}

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
  { id: "profiel", label: "Skillsprofiel" },
  { id: "vergelijken", label: "Vergelijk" },
  { id: "ontwikkelen", label: "Ontwikkelen" },
  { id: "roadmap", label: "Roadmap" },
  { id: "feedback", label: "Feedback" },
];

const ROUTE_UITLEG = [
  { titel: "CV", tekst: "Upload je CV, wij lezen 'm" },
  { titel: "Functies", tekst: "Kies welke functies we uitwerken" },
  { titel: "Taken", tekst: "Check welke taken bij jou horen" },
  { titel: "Skills", tekst: "Geef aan hoe goed je elke skill beheerst" },
  { titel: "Drijfveren", tekst: "Ontdek wat jou motiveert" },
  { titel: "Skillsprofiel", tekst: "Bekijk je complete verhaal tot nu toe" },
  { titel: "Vergelijk", tekst: "Zet jezelf af tegen een functie" },
  { titel: "Ontwikkelen", tekst: "Bepaal waar je naartoe wil" },
  { titel: "Roadmap", tekst: "Krijg concrete vervolgstappen" },
  { titel: "Feedback", tekst: "Bekijk feedback van collega's" },
];

function SkillsModel() {
  return <img src="/skills-model.jpg" alt="Weten Kunnen Zijn Willen skills model" style={{ width: "100%", maxWidth: 220, display: "block", margin: "0 auto", borderRadius: 8 }} />;
}

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
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>🔗 code</div>
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
function Stappenbalk({ huidigeStap, hoogsteBezochte, voltooidValideren, gaNaar, aantalFeedback }) {
  const huidigIdx = STAPPEN.findIndex(s => s.id === huidigeStap);
  return (
    <div className="niet-printen" style={{ background: "#fff", borderBottom: `1px solid ${KLEUR.lijn}`, padding: "14px 32px", display: "flex", alignItems: "center", gap: 4, overflowX: "auto" }}>
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
                position: "relative",
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
              {s.id === "feedback" && aantalFeedback > 0 && (
                <span style={{ position: "absolute", top: -4, right: -4, background: "#c0392b", color: "#fff", fontSize: 9, fontWeight: 700, borderRadius: "50%", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>{aantalFeedback}</span>
              )}
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
// ─── Routekaart: metro-lijn stijl overzicht van de hele reis ──────────────────
function RouteKaart() {
  return (
    <div style={{ maxWidth: 320, width: "100%", textAlign: "left" }}>
      <div style={{ fontSize: 11, color: "#8a94a0", letterSpacing: "0.5px", marginBottom: 14 }}>Dit is de reis die je gaat maken</div>
      {ROUTE_UITLEG.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: 9, height: 9, borderRadius: "50%", background: KLEUR.messing, flexShrink: 0 }} />
            {i < ROUTE_UITLEG.length - 1 && <div style={{ width: 2, flex: 1, background: "rgba(184,134,63,0.35)", minHeight: 20 }} />}
          </div>
          <div style={{ paddingBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{s.titel}</div>
            <div style={{ fontSize: 12, color: "#a8b3bd", marginTop: 1 }}>{s.tekst}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

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
  // Als iemand op een gedeelde feedback-link klikt, hoeft die niet in te loggen —
  // toon dan meteen de openbare feedbackpagina, en sla al het andere over.
  const feedbackToken = new URLSearchParams(window.location.search).get("feedback");
  if (feedbackToken) return <FeedbackPagina token={feedbackToken} />;

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
  const [verhaalFout, setVerhaalFout] = useState("");
  const [toekomstblik, setToekomstblik] = useState(null);
  const [toekomstLaden, setToekomstLaden] = useState(false);

  async function genereerToekomstblik(functieTitel) {
    setToekomstLaden(true);
    try {
      const text = await callClaude([{ role: "user", content: toekomstPrompt(functieTitel) }], 800);
      setToekomstblik(parseJSON(text).punten || []);
    } catch (e) { console.error(e); setToekomstblik([]); }
    setToekomstLaden(false);
  }

  // Vergelijken + Roadmap state
  const [functiesLijst, setFunctiesLijst] = useState([]);
  const [functiesLaden, setFunctiesLaden] = useState(false);
  const [gekozenVergelijkFunctie, setGekozenVergelijkFunctie] = useState(null);
  const [gapResultaat, setGapResultaat] = useState(null);
  const [gapLaden, setGapLaden] = useState(false);
  const [roadmapOpgeslagen, setRoadmapOpgeslagen] = useState(false);
  const [roadmapLaden, setRoadmapLaden] = useState(false);

  // Feedback-functie
  const [feedbackLinks, setFeedbackLinks] = useState({}); // { functieIdx: { link, laden } }

  async function vraagFeedback(functieIdx) {
    setFeedbackLinks(prev => ({ ...prev, [functieIdx]: { laden: true } }));
    try {
      const functie = cvData.functies[functieIdx];
      const taken = functieSkills[functieIdx] || [];
      const skillsSnapshot = [];
      const gezien = new Set();
      taken.forEach(t => [...t.hardskills, ...t.softskills].forEach(s => {
        if (!gezien.has(s.tekst)) { gezien.add(s.tekst); skillsSnapshot.push({ tekst: s.tekst, eigenNiveau: beoordelingen[s.tekst] || 3 }); }
      }));

      const token = crypto.randomUUID();
      const verloopt = new Date(); verloopt.setDate(verloopt.getDate() + 14);

      const medewerker = await supabase.from("medewerkers").select("id").eq("auth_user_id", sessie.user.id).maybeSingle();
      const { error } = await supabase.from("feedback_verzoeken").insert({
        token, medewerker_id: medewerker.data.id,
        functie_titel: functie.titel, skills: skillsSnapshot, verloopt_op: verloopt.toISOString(),
      });
      if (error) throw error;

      const link = `${window.location.origin}${window.location.pathname}?feedback=${token}`;
      setFeedbackLinks(prev => ({ ...prev, [functieIdx]: { laden: false, link } }));
    } catch (e) { console.error(e); setFeedbackLinks(prev => ({ ...prev, [functieIdx]: { laden: false, fout: true } })); }
  }

  const [ontvangenFeedback, setOntvangenFeedback] = useState({}); // { functieIdx: { laden, reacties: [{naam, reacties: [{tekst,score,toelichting}]}] } }

  const [alleFeedback, setAlleFeedback] = useState(null); // null = nog niet geladen
  const aantalFeedback = alleFeedback?.items?.reduce((som, it) => som + it.reacties.length, 0) || 0;

  useEffect(() => {
    if (sessie && !alleFeedback) haalAlleFeedbackOp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessie]);

  async function haalAlleFeedbackOp() {
    setAlleFeedback({ laden: true });
    try {
      const medewerker = await supabase.from("medewerkers").select("id").eq("auth_user_id", sessie.user.id).maybeSingle();
      const { data: verzoeken } = await supabase.from("feedback_verzoeken").select("id, functie_titel, skills").eq("medewerker_id", medewerker.data.id).order("aangemaakt_op", { ascending: false });
      if (!verzoeken || verzoeken.length === 0) { setAlleFeedback({ laden: false, items: [] }); return; }

      const verzoekIds = verzoeken.map(v => v.id);
      const { data: reacties } = await supabase.from("feedback_reacties").select("verzoek_id, naam_feedbackgever, reacties, aangemaakt_op").in("verzoek_id", verzoekIds);

      const items = verzoeken.map(v => ({
        functieTitel: v.functie_titel,
        skillsSnapshot: v.skills, // [{tekst, eigenNiveau}], de zelfbeoordeling van tóen
        reacties: (reacties || []).filter(r => r.verzoek_id === v.id),
      }));
      setAlleFeedback({ laden: false, items });
    } catch (e) { console.error(e); setAlleFeedback({ laden: false, items: [] }); }
  }

  // Drijfveren state
  const [drijfStap, setDrijfStap] = useState(0);
  const [antwoorden, setAntwoorden] = useState({});
  const [drijfResultaat, setDrijfResultaat] = useState(null);
  const [drijfLoading, setDrijfLoading] = useState(false);
  const [drijfFout, setDrijfFout] = useState("");

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

  async function laadFuncties() {
    setFunctiesLaden(true);
    const { data } = await supabase.from("functies").select("id, titel, werkgevers(naam)").order("titel");
    setFunctiesLijst(data || []);
    setFunctiesLaden(false);
  }

  async function berekenGap(functieId) {
    setGapLaden(true);
    setGapResultaat(null);
    setRoadmapOpgeslagen(false);
    try {
      const { data: medewerker } = await supabase.from("medewerkers").select("id").eq("auth_user_id", sessie.user.id).maybeSingle();
      const { data: eigenRijen } = await supabase.from("medewerker_skills").select("skills(bron_label, skill_matches(esco_anker_code))").eq("medewerker_id", medewerker.id);
      const { data: functieRijen } = await supabase.from("functie_skills").select("verplicht, skills(id, bron_label, skill_matches(esco_anker_code))").eq("functie_id", functieId);

      const eigenSet = new Set();
      (eigenRijen || []).forEach(r => {
        const codes = (r.skills?.skill_matches || []).map(m => m.esco_anker_code).filter(Boolean);
        if (codes.length) codes.forEach(c => eigenSet.add(c));
        else if (r.skills?.bron_label) eigenSet.add("label:" + r.skills.bron_label.toLowerCase());
      });

      const matched = [], missing = [];
      (functieRijen || []).forEach(r => {
        const label = r.skills?.bron_label;
        const codes = (r.skills?.skill_matches || []).map(m => m.esco_anker_code).filter(Boolean);
        const sleutels = codes.length ? codes : ["label:" + (label || "").toLowerCase()];
        const heeftMatch = sleutels.some(s => eigenSet.has(s));
        (heeftMatch ? matched : missing).push({ label, verplicht: r.verplicht, skillId: r.skills?.id });
      });

      setGapResultaat({ matched, missing });
    } catch (e) { console.error(e); }
    setGapLaden(false);
  }

  async function maakRoadmap() {
    setRoadmapLaden(true);
    try {
      const { data: medewerker } = await supabase.from("medewerkers").select("id").eq("auth_user_id", sessie.user.id).maybeSingle();
      const functieTitel = functiesLijst.find(f => f.id === gekozenVergelijkFunctie)?.titel || "nieuwe functie";
      const { data: roadmap, error } = await supabase.from("roadmaps").insert({
        medewerker_id: medewerker.id,
        functie_id: gekozenVergelijkFunctie,
        titel: `Route naar ${functieTitel}`,
      }).select("id").single();
      if (error) throw error;

      const stappen = gapResultaat.missing.filter(s => s.skillId).map((s, i) => ({
        roadmap_id: roadmap.id,
        skill_id: s.skillId,
        volgorde: i + 1,
      }));
      if (stappen.length) await supabase.from("roadmap_stappen").insert(stappen);
      setRoadmapOpgeslagen(true);
    } catch (e) { console.error(e); }
    setRoadmapLaden(false);
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
    setVerhaalFout("");
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
    } catch (e) { console.error(e); setVerhaalFout("Het lukte niet om je verhaal te maken. Probeer het nog eens."); }
    setLaden(null);
  }

  // ── Drijfveren ────────────────────────────────────────────────────────────
  function kiesAntwoord(type) {
    const nieuw = { ...antwoorden, [drijfStap]: type };
    setAntwoorden(nieuw);
    if (drijfStap < DRIJFVEER_VRAGEN.length) {
      setTimeout(() => setDrijfStap(drijfStap + 1), 280);
    } else {
      setTimeout(async () => {
        setDrijfStap(DRIJFVEER_VRAGEN.length + 1);
        await genereerDrijfverenProfiel(berekenScores(nieuw));
      }, 400);
    }
  }
  function berekenScores(antw) {
    const s = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };
    Object.values(antw).forEach(t => { if (s[t] !== undefined) s[t]++; });
    return s;
  }
  async function genereerDrijfverenProfiel(scores) {
    setDrijfLoading(true);
    setDrijfFout("");
    const gesorteerd = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const top3 = gesorteerd.slice(0, 3).map(([k]) => `${DRIJFVEER_TYPES[k].label}`).join(", ");
    try {
      const text = await callClaude([{ role: "user", content: drijfverenPrompt(scores, top3) }], 2000);
      console.log("Drijfveren-antwoord ontvangen:", text);
      const geparsed = parseJSON(text);
      console.log("Drijfveren-antwoord verwerkt:", geparsed);
      setDrijfResultaat({ scores, gesorteerd, interpretatie: geparsed });
    } catch (e) {
      console.error("Drijfveren-fout:", e);
      setDrijfResultaat({ scores, gesorteerd, interpretatie: null });
      setDrijfFout("Het lukte niet om de toelichting te maken.");
    }
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

  const sterrenCSS = `
    .sterrenhemel {
      background-color: #0a121c;
      background-image:
        radial-gradient(1.5px 1.5px at 20px 30px, rgba(255,255,255,0.75), transparent),
        radial-gradient(1px 1px at 90px 40px, rgba(255,255,255,0.55), transparent),
        radial-gradient(1.5px 1.5px at 130px 80px, rgba(255,255,255,0.65), transparent),
        radial-gradient(1px 1px at 160px 120px, rgba(255,255,255,0.45), transparent),
        radial-gradient(2px 2px at 50px 160px, rgba(255,255,255,0.6), transparent),
        radial-gradient(1px 1px at 190px 10px, rgba(255,255,255,0.45), transparent),
        radial-gradient(1px 1px at 10px 190px, rgba(255,255,255,0.5), transparent),
        linear-gradient(180deg, #0a121c 0%, #16232f 55%, #1e2a35 100%);
      background-repeat: repeat;
      background-size: 220px 220px, 220px 220px, 220px 220px, 220px 220px, 220px 220px, 220px 220px, 220px 220px, 100% 100%;
    }
    @media print {
      .sterrenhemel { background: #fff !important; background-image: none !important; }
    }
  `;

  if (sessieAanHetLaden) return <div className="sterrenhemel" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><style>{sterrenCSS}</style><Spinner /></div>;

  if (!sessie) {
    return (
      <div className="sterrenhemel" style={{ fontFamily: "'Segoe UI',sans-serif", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <style>{sterrenCSS}</style>
        <Kop sessie={null} />
        <LoginScherm onIngelogd={setSessie} />
      </div>
    );
  }

  return (
    <div className="sterrenhemel" style={{ fontFamily: "'Segoe UI',sans-serif", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <style>{sterrenCSS}</style>
      <Kop sessie={sessie} onUitloggen={() => supabase.auth.signOut()} />
      <Stappenbalk huidigeStap={stap} hoogsteBezochte={hoogsteBezochte} voltooidValideren={voltooidValideren} gaNaar={gaNaarStap} aantalFeedback={aantalFeedback} />
      <div className="niet-printen" style={{ position: "fixed", bottom: 14, right: 18, display: "flex", alignItems: "center", gap: 8, zIndex: 50 }}>
        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>Powered by</span>
        <a href="https://www.brightworksolutions.nl" target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center" }}>
          <img src="/logo-bright-dark.png" alt="Bright Work Solutions" style={{ height: 34, display: "block", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.6))" }} />
        </a>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>

        {/* ── STAP: upload ── */}
        {stap === "upload" && !laden && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 24px", gap: 56, flexWrap: "wrap" }}>
            <RouteKaart />
            <div style={{ maxWidth: 380, width: "100%", textAlign: "center" }}>
              <div style={{ fontFamily: "Georgia,serif", fontSize: 26, fontWeight: 700, color: "#fff", marginBottom: 12 }}>Jouw skillsprofiel</div>
              <p style={{ fontSize: 12, color: "#c4cdd4", lineHeight: 1.6, marginBottom: 22, fontStyle: "italic" }}>
                Je leert je hele leven: tijdens je studie, maar net zo goed thuis en op je werk. Een diploma is waardevol, maar vertelt maar een deel van het verhaal. Op de werkvloer heb je vaak veel meer geleerd dan je zelf beseft, en dat brengen we hier in kaart.
              </p>
              <div onClick={() => fileInputRef.current.click()} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
                style={{ background: dragging ? "#eef4fb" : "linear-gradient(180deg,#f4f8fc,#e9f0f8)", borderRadius: 10, border: `2px dashed ${dragging ? KLEUR.messing : "#9fb4c9"}`, padding: "30px 26px", textAlign: "center", cursor: "pointer", boxShadow: "0 12px 34px rgba(15,25,35,0.35)" }}>
                <div style={{ fontSize: 30 }}>📋</div>
                <div style={{ fontFamily: "Georgia,serif", fontSize: 17, color: KLEUR.inkt, margin: "8px 0 5px" }}>Upload je CV</div>
                <p style={{ fontSize: 13, color: "#555", lineHeight: 1.5, marginBottom: 6 }}>Wij lezen je CV en zoeken uit wat je allemaal kan, jij hoeft niks over te typen.</p>
                <div style={{ fontSize: 12, color: "#888", lineHeight: 1.5, marginBottom: 14 }}>Sleep een PDF of Word-bestand hierheen, of klik om te bladeren.</div>
                <input type="file" ref={fileInputRef} accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
                <button style={{ padding: "10px 22px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>📁 Kies PDF of Word-bestand</button>
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
              <div style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 600, color: "#fff", marginBottom: 8 }}>Welke functies wil je uitwerken?</div>
              <p style={{ fontSize: 13, color: "#c4cdd4", lineHeight: 1.6, marginBottom: 20 }}>
                We hebben deze functies in je CV gevonden. Je huidige functie staat al aangevinkt. Vink er gerust meer aan waar je goed in was of die je leuk vond, maar dat hoeft niet. Zo'n 3 functies geeft meestal het meest complete beeld van wat je allemaal kan.
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
          <LaadScherm titel="Taken worden opgezocht…" tekst="We zoeken op wat er bij dit werk hoort en vullen aan met wat er in je CV staat." />
        )}

        {/* ── STAP: taken uitvinken ── */}
        {stap === "taken" && !laden && (
          <div style={{ flex: 1, padding: "28px 32px", overflowY: "auto" }}>
            <div style={{ maxWidth: 700, margin: "0 auto" }}>
              <div style={{ fontFamily: "Georgia,serif", fontSize: 21, fontWeight: 600, color: "#fff", marginBottom: 8 }}>Check je taken</div>
              <p style={{ fontSize: 13, color: "#c4cdd4", marginBottom: 20, lineHeight: 1.6 }}>Alles staat al aangevinkt. Vink uit wat jij nooit doet, de rest gebruiken we om te kijken wat jij precies kan.</p>
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
              <div style={{ fontFamily: "Georgia,serif", fontSize: 21, fontWeight: 600, color: "#fff", marginBottom: 8 }}>Valideer je skills</div>
              <p style={{ fontSize: 13, color: "#c4cdd4", marginBottom: 18, lineHeight: 1.6 }}>Hier zie je precies wat er bij je taken hoort. Schuif de balk naar hoe goed jij dit kan, van net begonnen tot expert.</p>
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
                    <div style={{ padding: "0 22px 20px", borderTop: `1px solid ${KLEUR.lijn}`, paddingTop: 16 }}>
                      {!feedbackLinks[idx]?.link ? (
                        <>
                          <p style={{ fontSize: 12, color: "#888", marginBottom: 10, lineHeight: 1.6 }}>Wil je weten hoe een collega of leidinggevende jouw skills ziet? Maak een link aan, kopieer 'm en mail 'm door. Zij geven dan hun feedback, zonder dat ze hoeven in te loggen.</p>
                          <button onClick={() => vraagFeedback(idx)} disabled={feedbackLinks[idx]?.laden} style={{ padding: "9px 18px", borderRadius: 6, background: "#fff", color: KLEUR.inkt, border: `1px solid ${KLEUR.lijn}`, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                            {feedbackLinks[idx]?.laden ? "Bezig…" : "💬 Vraag feedback op deze functie"}
                          </button>
                        </>
                      ) : (
                        <div>
                          <p style={{ fontSize: 12, color: "#166534", marginBottom: 8 }}>✓ Link aangemaakt (14 dagen geldig). Kopieer 'm en mail 'm naar je collega of leidinggevende:</p>
                          <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <input readOnly value={feedbackLinks[idx].link} onClick={e => e.target.select()} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 4, border: "1px solid #d0cfc8", width: 260 }} />
                            <button onClick={() => navigator.clipboard.writeText(feedbackLinks[idx].link)} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, background: KLEUR.inkt, color: "#fff", border: "none", cursor: "pointer" }}>Kopieer</button>
                          </div>
                        </div>
                      )}
                      <p style={{ fontSize: 11, color: "#999", marginTop: 8 }}>Ontvangen feedback vind je terug bij stap 10 (Feedback) in de stappenbalk.</p>
                    </div>
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>
                <button onClick={async () => { await handOpslaan(); gaNaarStap("drijfveren"); }} style={{ padding: "13px 28px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  Volgende stap →
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
                  <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 18, fontSize: 28 }}>
                    {Object.values(DRIJFVEER_TYPES).map((t, i) => <span key={i}>{t.emoji}</span>)}
                  </div>
                  <div style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 600, color: KLEUR.inkt, marginBottom: 12 }}>Wat drijft jou?</div>
                  <p style={{ fontSize: 14, color: "#555", lineHeight: 1.7, marginBottom: 6 }}>5 korte vragen over wat je energie geeft op je werk. Geen goed of fout antwoord, kies gewoon wat het meest bij jou past.</p>
                  <p style={{ fontSize: 12, color: "#999", marginBottom: 24 }}>Duurt nog geen 2 minuten.</p>
                  <button onClick={() => setDrijfStap(1)} style={{ padding: "13px 32px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Start de test →</button>
                </div>
              </div>
            )}
            {drijfStap >= 1 && drijfStap <= DRIJFVEER_VRAGEN.length && huidigVraag && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
                <div style={{ maxWidth: 580, width: "100%" }}>
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#888", marginBottom: 8 }}><span>Vraag {drijfStap} van {DRIJFVEER_VRAGEN.length}</span></div>
                    <div style={{ height: 6, background: "#e8e5da", borderRadius: 4 }}><div style={{ height: "100%", background: KLEUR.messing, borderRadius: 4, width: `${(drijfStap / DRIJFVEER_VRAGEN.length) * 100}%`, transition: "width 0.3s" }} /></div>
                  </div>
                  <Card style={{ padding: "32px 28px" }}>
                    <div style={{ fontFamily: "Georgia,serif", fontSize: 20, fontWeight: 600, color: KLEUR.inkt, marginBottom: 24, lineHeight: 1.4 }}>{huidigVraag.vraag}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {huidigVraag.opties.map((opt, i) => { const type = DRIJFVEER_TYPES[opt.type]; const gekozen = antwoorden[drijfStap] === opt.type; return (<button key={i} onClick={() => kiesAntwoord(opt.type)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 18px", borderRadius: 8, border: gekozen ? `2px solid ${type.kleur}` : `2px solid ${KLEUR.lijn}`, background: gekozen ? type.kleur + "18" : KLEUR.papier, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}><span style={{ fontSize: 22, flexShrink: 0 }}>{type.emoji}</span><span style={{ fontSize: 14, color: "#333", lineHeight: 1.5 }}>{opt.tekst}</span></button>); })}
                    </div>
                  </Card>
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
                        {top3.map(([k], i) => { const t = DRIJFVEER_TYPES[k]; return (<div key={k} style={{ display: "flex", alignItems: "center", gap: 10, background: t.kleur + "25", border: `1px solid ${t.kleur}55`, borderRadius: 8, padding: "10px 16px" }}><span style={{ fontSize: 24 }}>{t.emoji}</span><div><div style={{ fontSize: 11, color: "#a8b3bd", fontWeight: 500 }}>#{i + 1}</div><div style={{ fontSize: 15, fontWeight: 700, color: t.kleur }}>{t.label}</div></div></div>); })}
                      </div>
                    </div>
                    {!interpretatie && (
                      <Card style={{ marginBottom: 16 }}>
                        <p style={{ fontSize: 13, color: "#c0392b", marginBottom: 10 }}>⚠️ {drijfFout || "Het lukte niet om de toelichting te maken."}</p>
                        <button onClick={() => genereerDrijfverenProfiel(scores)} style={{ padding: "9px 18px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Opnieuw proberen</button>
                      </Card>
                    )}
                    {interpretatie && !interpretatie.intro && (
                      <Card style={{ marginBottom: 16 }}>
                        <p style={{ fontSize: 13, color: "#c0392b", marginBottom: 10 }}>⚠️ De toelichting kwam niet helemaal goed door.</p>
                        <button onClick={() => genereerDrijfverenProfiel(scores)} style={{ padding: "9px 18px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Opnieuw proberen</button>
                      </Card>
                    )}
                    {interpretatie && interpretatie.intro && (
                      <Card style={{ marginBottom: 16 }}>
                        <SectionTitle>Wat dit over jou zegt</SectionTitle>
                        <p style={{ fontSize: 14, color: "#333", lineHeight: 1.75, marginBottom: 14 }}>{interpretatie.intro}</p>
                        <p style={{ fontSize: 14, color: "#333", lineHeight: 1.75, marginBottom: 0 }}>{interpretatie.werkvoorkeur}</p>
                      </Card>
                    )}
                    <button onClick={() => gaNaarStap("profiel")} style={{ padding: "13px 28px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Volgende stap →</button>
                    <p style={{ fontSize: 11, color: "#8a94a0", marginTop: 14 }}>Gebaseerd op een erkend model uit de loopbaanpsychologie.</p>
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
              <div style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 600, color: "#fff", marginBottom: 8 }}>Wat zou jij nog willen ontwikkelen?</div>
              <p style={{ fontSize: 13, color: "#c4cdd4", lineHeight: 1.6, marginBottom: 16 }}>Dat kan binnen je huidige functie zijn, of juist richting iets anders. Vul in wat je wilt: op basis van je CV maken we een analyse en vullen we het verder aan. Dat betekent niet dat dit per se de weg is die je moet inslaan, maar het laat wel de rode draad zien die door je CV loopt.</p>
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
                <button onClick={() => gaNaarStap("roadmap")} style={{ padding: "13px 28px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Naar je roadmap →</button>
              </div>
            </div>
          </div>
        )}

        {/* ── STAP: skillsprofiel (eindresultaat) ── */}
        {stap === "profiel" && cvData && (
          <ProfielStap
            cvData={cvData} functieSkills={functieSkills} beoordelingen={beoordelingen} wijzigBeoordeling={wijzigBeoordeling}
            drijfResultaat={drijfResultaat} ontwikkelAdvies={ontwikkelAdvies}
            laden={laden === "profielGenereren"} genereerVerhaalEnTop5={genereerVerhaalEnTop5} verhaalFout={verhaalFout}
            copyStory={copyStory} copied={copied} handOpslaan={handOpslaan} saveStatus={saveStatus} escoMatchCount={escoMatchCount}
            nieuwCv={nieuwCv} gaNaarStap={gaNaarStap}
            alleFeedback={alleFeedback} haalAlleFeedbackOp={haalAlleFeedbackOp}
          />
        )}

        {/* ── STAP: vergelijken met een functie ── */}
        {stap === "vergelijken" && (
          <VergelijkStap
            functiesLijst={functiesLijst} functiesLaden={functiesLaden} laadFuncties={laadFuncties}
            gekozenVergelijkFunctie={gekozenVergelijkFunctie} setGekozenVergelijkFunctie={setGekozenVergelijkFunctie}
            berekenGap={berekenGap} gapResultaat={gapResultaat} gapLaden={gapLaden} gaNaarStap={gaNaarStap}
          />
        )}

        {/* ── STAP: roadmap ── */}
        {stap === "roadmap" && (
          <RoadmapStap gapResultaat={gapResultaat} maakRoadmap={maakRoadmap} roadmapLaden={roadmapLaden} roadmapOpgeslagen={roadmapOpgeslagen}
            functieTitel={functiesLijst.find(f => f.id === gekozenVergelijkFunctie)?.titel} gaNaarStap={gaNaarStap}
            toekomstblik={toekomstblik} toekomstLaden={toekomstLaden} genereerToekomstblik={genereerToekomstblik} />
        )}

        {/* ── STAP: feedback ── */}
        {stap === "feedback" && <FeedbackStap alleFeedback={alleFeedback} />}
      </div>
    </div>
  );
}

// ─── Kop (header) ───────────────────────────────────────────────────────────
function Kop({ sessie, onUitloggen, onFeedback }) {
  return (
    <div className="niet-printen" style={{ background: KLEUR.inkt, padding: "18px 32px", display: "flex", alignItems: "center", gap: 14 }}>
      <div>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 19, fontWeight: 700, color: "#fff" }}>CV Skillsanalyse</div>
        <div style={{ fontSize: 12, color: "#a8b3bd", marginTop: 1 }}>Weten · Kunnen · Zijn · Willen in kaart brengen</div>
      </div>
      {sessie && (
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={onFeedback} style={{ fontSize: 12, color: "#a8b3bd", background: "none", border: `1px solid #45566b`, borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}>💬 Ontvangen feedback</button>
          <span style={{ fontSize: 12, color: "#a8b3bd" }}>{sessie.user.email}</span>
          <button onClick={onUitloggen} style={{ fontSize: 12, color: KLEUR.messing, background: "none", border: `1px solid ${KLEUR.messing}`, borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}>Uitloggen</button>
        </div>
      )}
    </div>
  );
}

function FeedbackStap({ alleFeedback }) {
  const items = (alleFeedback?.items || []).filter(it => it.reacties.length > 0);
  return (
    <div style={{ flex: 1, padding: "28px 32px", overflowY: "auto" }}>
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 600, color: "#fff", marginBottom: 8 }}>Ontvangen feedback</div>
        <p style={{ fontSize: 13, color: "#c4cdd4", lineHeight: 1.6, marginBottom: 20 }}>Hier verschijnt automatisch alle feedback die collega's of leidinggevenden via een link hebben achtergelaten.</p>

        <div style={{ background: "radial-gradient(circle at 50% 30%, #f1f2fb 0%, #d3d6f0 60%, #a8ade0 100%)", borderRadius: 12, padding: 30, boxShadow: "0 16px 36px rgba(92,98,160,0.35)", border: "1px solid #9299d6" }}>
          {alleFeedback?.laden && <p style={{ fontSize: 13, color: "#3c3f6b" }}>Bezig met ophalen…</p>}
          {!alleFeedback?.laden && items.length === 0 && <p style={{ fontSize: 13, color: "#3c3f6b" }}>Nog geen feedback ontvangen. Vraag 'm aan bij de stap "Skills".</p>}

          {items.map((item, ii) => (
            <div key={ii} style={{ marginBottom: 20, paddingBottom: 20, borderBottom: ii < items.length - 1 ? "1px solid rgba(92,98,160,0.25)" : "none" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#2a2d4d", marginBottom: 12 }}>Over: {item.functieTitel}</div>
              {item.reacties.map((r, ri) => (
                <div key={ri} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#3c3f6b", marginBottom: 10 }}>
                    Feedback van {r.naam_feedbackgever}
                    <span style={{ fontWeight: 400, color: "#6a6d8f" }}> · {new Date(r.aangemaakt_op).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}</span>
                  </div>
                  {item.skillsSnapshot.map((s, si) => {
                    const gevonden = r.reacties.find(x => x.tekst === s.tekst);
                    const feedbackScore = gevonden ? gevonden.score : 3;
                    return (
                      <div key={si} style={{ background: "rgba(255,255,255,0.5)", borderRadius: 8, padding: "10px 14px", marginBottom: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#2a2d4d", marginBottom: 6 }}>{s.tekst}</div>
                        <div style={{ fontSize: 11, color: "#3a3d5c", marginBottom: 3 }}>Jij: <strong>{NIVEAUS[s.eigenNiveau - 1]}</strong></div>
                        <div style={{ fontSize: 11, color: "#3a3d5c" }}>{r.naam_feedbackgever}: <strong>{NIVEAUS[feedbackScore - 1]}</strong></div>
                        {gevonden?.toelichting && <div style={{ fontSize: 11, color: "#6a6d8f", marginTop: 6, fontStyle: "italic" }}>"{gevonden.toelichting}"</div>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LaadScherm({ titel, tekst }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48, textAlign: "center", gap: 16 }}>
      <Spinner />
      <div style={{ fontFamily: "Georgia,serif", fontSize: 20, color: "#fff" }}>{titel}</div>
      {tekst && <div style={{ fontSize: 14, color: "#c4cdd4", maxWidth: 340, lineHeight: 1.6 }}>{tekst}</div>}
    </div>
  );
}

// ─── Laatste stap: het complete skillsprofiel ──────────────────────────────────
function ProfielStap({ cvData, functieSkills, beoordelingen, wijzigBeoordeling, drijfResultaat, ontwikkelAdvies, laden, genereerVerhaalEnTop5, verhaalFout, copyStory, copied, handOpslaan, saveStatus, escoMatchCount, nieuwCv, gaNaarStap, alleFeedback, haalAlleFeedbackOp }) {
  useEffect(() => {
    if (!cvData.verhaal && !laden) genereerVerhaalEnTop5();
    if (!alleFeedback) haalAlleFeedbackOp();
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
  const drijfTop3 = drijfResultaat ? [...drijfResultaat.gesorteerd].slice(0, 3) : null;
  const [toonFeedback, setToonFeedback] = useState(false);

  // Lavendelblauw, midden licht → randen donkerder, met een stevig 3D pop-effect
  const kaartStijl = {
    background: "radial-gradient(circle at 50% 38%, #f1f2fb 0%, #d3d6f0 55%, #a8ade0 100%)",
    boxShadow: "0 16px 36px rgba(92,98,160,0.4), 0 2px 0 rgba(255,255,255,0.6) inset",
    border: "1px solid #9299d6",
  };

  return (
    <div style={{ flex: 1, padding: "28px 32px", overflowY: "auto" }}>
      <style>{`
        @media print {
          .niet-printen { display: none !important; }
          body { background: #fff; }
          .skillsprofiel-titel { color: #1e2a35 !important; }
          .skillsprofiel-subtitel { color: #666 !important; }
        }
      `}</style>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>

        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div className="skillsprofiel-titel" style={{ fontFamily: "Georgia,serif", fontSize: 28, fontWeight: 700, color: "#ffffff" }}>Skillsprofiel{cvData.naam ? ` ${cvData.naam}` : ""}</div>

        </div>

        {/* Jouw verhaal + top 5 — het hoogtepunt */}
        {laden && <LaadScherm titel="Jouw verhaal wordt geschreven…" tekst="We combineren je skills, drijfveren en ontwikkelrichting tot één overzicht." />}
        {!laden && verhaalFout && (
          <div style={{ textAlign: "center", padding: "24px 0", marginBottom: 20 }}>
            <p style={{ fontSize: 13, color: "#e0a0a0", marginBottom: 12 }}>⚠️ {verhaalFout}</p>
            <button onClick={genereerVerhaalEnTop5} style={{ padding: "10px 22px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Opnieuw proberen</button>
          </div>
        )}
        {!laden && cvData.verhaal && (
          <>
            {(cvData.top5?.length > 0) && (
              <div style={{ ...kaartStijl, borderRadius: 12, padding: 30, marginBottom: 22 }}>
                <div style={{ fontSize: 11, color: "#5c62a0", letterSpacing: "1px", textTransform: "uppercase", textAlign: "center", marginBottom: 6 }}>Hier blink jij in uit</div>
                <div style={{ fontFamily: "Georgia,serif", fontSize: 21, fontWeight: 600, color: "#3c3f6b", marginBottom: 20, textAlign: "center" }}>Jouw top 5 skills</div>
                {cvData.top5.map((item, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 6, background: "rgba(92,98,160,0.2)", color: "#3c3f6b", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ fontSize: 14, color: "#3a3d5c", lineHeight: 1.6 }}><span style={{ fontWeight: 600, color: "#2a2d4d" }}>{item.skill}</span>: {item.toelichting}</div>
                  </div>
                ))}
              </div>
            )}
            {cvData.verhaalBronnen && <p style={{ fontSize: 12, color: "#c4cdd4", fontStyle: "italic", marginBottom: 14, textAlign: "center" }}>{cvData.verhaalBronnen}</p>}
            <div style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 600, color: "#fff", marginBottom: 12 }}>Jouw verhaal</div>
            <Card style={{ ...kaartStijl, marginBottom: 24 }}>
              {[cvData.verhaal?.alinea1, cvData.verhaal?.alinea2, cvData.verhaal?.alinea3].filter(Boolean).map((p, i, arr) => (
                <p key={i} style={{ fontSize: 15, color: "#333", lineHeight: 1.85, marginBottom: i < arr.length - 1 ? 18 : 0 }}>{p}</p>
              ))}
            </Card>
          </>
        )}

        {/* Weten · Kunnen · Zijn · Willen */}
        <Card style={{ ...kaartStijl, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 20, alignItems: "start" }}>
            <SkillsModel />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[
                { key: "weten", label: "Weten", sub: "Kennis" },
                { key: "kunnen", label: "Kunnen", sub: "Vaardigheden" },
                { key: "zijn", label: "Zijn", sub: "Persoonlijkheid" },
                { key: "willen", label: "Willen", sub: "Motivatie" },
              ].map(({ key, label, sub }) => (
                <div key={key}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: KLEUR.inkt }}>{label}</div>
                  <div style={{ fontSize: 11, color: "#999", marginBottom: 6 }}>{sub}</div>
                  {(cvData[key] || []).map((item, i) => <div key={i} style={{ fontSize: 12, color: "#444", padding: "4px 0" }}>{item}</div>)}
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Drijfveren, indien ingevuld */}
        {drijfTop3 && (
          <Card style={{ ...kaartStijl, marginBottom: 16 }}>
            <SectionTitle>Jouw drijfveren</SectionTitle>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: drijfResultaat?.interpretatie?.intro ? 16 : 0 }}>
              {drijfTop3.map(([k], i) => { const t = DRIJFVEER_TYPES[k]; return (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, background: t.kleur + "15", border: `1px solid ${t.kleur}40`, borderRadius: 8, padding: "8px 14px" }}>
                  <span style={{ fontSize: 18 }}>{t.emoji}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: t.kleur }}>{t.label}</span>
                </div>
              ); })}
            </div>
            {drijfResultaat?.interpretatie?.intro && (
              <>
                <p style={{ fontSize: 13, color: "#3a3d5c", lineHeight: 1.7, marginBottom: 10 }}>{drijfResultaat.interpretatie.intro}</p>
                <p style={{ fontSize: 13, color: "#3a3d5c", lineHeight: 1.7, marginBottom: 0 }}>{drijfResultaat.interpretatie.werkvoorkeur}</p>
              </>
            )}
          </Card>
        )}

        {/* Alle skills, compact, in twee kolommen */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          {hardList.length > 0 && (
            <Card style={kaartStijl}>
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
            <Card style={kaartStijl}>
              <SectionTitle>Softskills ({softList.length})</SectionTitle>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {softList.map(item => (
                  <div key={item.tekst} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <EscoSkillPill item={item} bg="#fef3c7" col="#92400e" />
                    <span style={{ fontSize: 10, color: "#999" }}>{NIVEAUS[(beoordelingen[item.tekst] || 3) - 1]}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
        <p style={{ fontSize: 11, color: "#aaa", marginTop: -8, marginBottom: 16 }}>Niveau aanpassen? Ga terug naar de stap "Valideren".</p>

        {/* Opleiding & hobby's */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 16 }}>
          <Card style={kaartStijl}>
            <SectionTitle>Opleidingen & cursussen</SectionTitle>
            {!(cvData.opleidingen?.length) && <p style={{ fontSize: 13, color: "#888" }}>Niets gevonden.</p>}
            {(cvData.opleidingen || []).map((o, i) => (<div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i < cvData.opleidingen.length - 1 ? `1px solid ${KLEUR.lijn}` : "none" }}><div style={{ fontSize: 14, fontWeight: 500, color: KLEUR.inkt }}>{o.naam}</div><div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{[o.instelling, o.jaar].filter(Boolean).join(" · ")}</div></div>))}
          </Card>
          <Card style={kaartStijl}>
            <SectionTitle>Hobby's & interesses</SectionTitle>
            {!(cvData.hobbies?.length) && <p style={{ fontSize: 13, color: "#888" }}>Niets gevonden.</p>}
            <div style={{ marginBottom: 12 }}>{(cvData.hobbies || []).map((h, i) => <span key={i} style={{ fontSize: 13, padding: "6px 14px", borderRadius: 6, background: KLEUR.papier, color: "#444", border: `1px solid ${KLEUR.lijn}`, fontWeight: 500, display: "inline-block", margin: "0 6px 6px 0" }}>{h}</span>)}</div>
            {hobbyList.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{hobbyList.map((item, i) => <EscoSkillPill key={i} item={item} bg="#eef2ff" col="#3730a3" />)}</div>}
          </Card>
        </div>

        {(!drijfResultaat || !ontwikkelAdvies) && (
          <div style={{ padding: "14px 18px", background: KLEUR.papier, borderRadius: 8, border: `1px dashed ${KLEUR.lijn}`, fontSize: 12, color: "#777", lineHeight: 1.6, marginBottom: 16 }}>
            {!drijfResultaat && <div>Je hebt de Drijfveren nog niet ingevuld. <button onClick={() => gaNaarStap("drijfveren")} style={{ background: "none", border: "none", color: KLEUR.messingDonker, fontWeight: 600, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", padding: 0 }}>Alsnog invullen →</button></div>}
            {!ontwikkelAdvies && <div style={{ marginTop: 6 }}>Je hebt nog geen ontwikkelrichting ingevuld. <button onClick={() => gaNaarStap("ontwikkelen")} style={{ background: "none", border: "none", color: KLEUR.messingDonker, fontWeight: 600, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", padding: 0 }}>Alsnog invullen →</button></div>}
          </div>
        )}

        <div className="niet-printen" style={{ textAlign: "center", padding: "10px 0 20px" }}>
          <button onClick={() => gaNaarStap("vergelijken")} style={{ padding: "13px 28px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            Volgende stap: vergelijk met een functie →
          </button>
        </div>

        <div className="niet-printen" style={{ display: "flex", justifyContent: "center", gap: 18, alignItems: "center", marginTop: 10, paddingTop: 18, borderTop: "1px solid rgba(244,241,232,0.12)" }}>
          <button onClick={() => window.print()} style={{ background: "none", border: "none", color: "#8a94a0", fontSize: 12, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}>🖨️ Print / bewaar als PDF</button>
          <button onClick={nieuwCv} style={{ background: "none", border: "none", color: "#8a94a0", fontSize: 12, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}>↩ Begin opnieuw met een ander CV</button>
        </div>
        {saveStatus && (
          <div className="niet-printen" style={{ fontSize: 11, color: saveStatus === "opgeslagen" ? "#5a9c76" : saveStatus === "fout" ? "#c07a7a" : "#8a94a0", textAlign: "center", marginTop: 8 }}>
            {saveStatus === "opslaan..." && "Bezig met opslaan…"}
            {saveStatus === "opgeslagen" && `✓ Opgeslagen (${escoMatchCount} skills gekoppeld)`}
            {saveStatus === "fout" && "Opslaan mislukt"}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stap: vergelijk je skills met een functie ─────────────────────────────────
function VergelijkStap({ functiesLijst, functiesLaden, laadFuncties, gekozenVergelijkFunctie, setGekozenVergelijkFunctie, berekenGap, gapResultaat, gapLaden, gaNaarStap }) {
  useEffect(() => {
    if (functiesLijst.length === 0 && !functiesLaden) laadFuncties();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ flex: 1, padding: "28px 32px", overflowY: "auto" }}>
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 600, color: "#fff", marginBottom: 8 }}>Vergelijk met een functie</div>
        <p style={{ fontSize: 13, color: "#c4cdd4", lineHeight: 1.6, marginBottom: 20 }}>Kies een functie om je skillsprofiel mee te vergelijken. Zo zie je precies wat je al kan, en wat je nog zou kunnen ontwikkelen.</p>

        {functiesLaden && <LaadScherm titel="Functies worden opgehaald…" tekst="" />}

        {!functiesLaden && functiesLijst.length === 0 && (
          <Card><p style={{ fontSize: 13, color: "#888" }}>Er staan nog geen functieprofielen in het systeem om mee te vergelijken.</p></Card>
        )}

        {!functiesLaden && functiesLijst.length > 0 && (
          <>
            <Card style={{ marginBottom: 20 }}>
              <select value={gekozenVergelijkFunctie || ""} onChange={e => setGekozenVergelijkFunctie(e.target.value)} style={{ width: "100%", padding: "12px 14px", borderRadius: 6, border: "1px solid #d0cfc8", fontSize: 14, fontFamily: "inherit", marginBottom: 14 }}>
                <option value="" disabled>Kies een functie…</option>
                {functiesLijst.map(f => <option key={f.id} value={f.id}>{f.titel}{f.werkgevers?.naam ? ` (${f.werkgevers.naam})` : ""}</option>)}
              </select>
              <button onClick={() => berekenGap(gekozenVergelijkFunctie)} disabled={!gekozenVergelijkFunctie || gapLaden} style={{ padding: "12px 26px", borderRadius: 6, background: !gekozenVergelijkFunctie ? "#ccc" : KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: !gekozenVergelijkFunctie ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                {gapLaden ? "Bezig…" : "Vergelijk →"}
              </button>
            </Card>

            {gapResultaat && (
              <>
                <Card style={{ marginBottom: 16 }}>
                  <SectionTitle>✓ Skills die je al hebt ({gapResultaat.matched.length})</SectionTitle>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {gapResultaat.matched.map((s, i) => <span key={i} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6, background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0" }}>{s.label}</span>)}
                  </div>
                </Card>
                <Card style={{ marginBottom: 20 }}>
                  <SectionTitle>Nog te ontwikkelen ({gapResultaat.missing.length})</SectionTitle>
                  {gapResultaat.missing.length === 0 && <p style={{ fontSize: 13, color: "#888" }}>Niets, je hebt alle skills voor deze functie al!</p>}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {gapResultaat.missing.map((s, i) => <span key={i} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6, background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}>{s.label}{s.verplicht === false ? " (niet verplicht)" : ""}</span>)}
                  </div>
                </Card>
                <button onClick={() => gaNaarStap("ontwikkelen")} style={{ padding: "13px 28px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  Volgende stap →
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Stap: roadmap maken op basis van de skillsgap ─────────────────────────────
function RoadmapStap({ gapResultaat, maakRoadmap, roadmapLaden, roadmapOpgeslagen, functieTitel, gaNaarStap, toekomstblik, toekomstLaden, genereerToekomstblik }) {
  if (!gapResultaat || gapResultaat.missing.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48, textAlign: "center", gap: 16 }}>
        <p style={{ fontSize: 14, color: "#888" }}>Vergelijk eerst je skills met een functie om hier een roadmap voor te maken.</p>
        <button onClick={() => gaNaarStap("vergelijken")} style={{ padding: "12px 26px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>← Naar Vergelijken</button>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, padding: "28px 32px", overflowY: "auto" }}>
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 600, color: "#ffffff", marginBottom: 8 }}>Jouw roadmap{functieTitel ? ` naar ${functieTitel}` : ""}</div>
        <p style={{ fontSize: 13, color: "#c4cdd4", lineHeight: 1.6, marginBottom: 20 }}>Dit zijn de concrete stappen die je kan zetten. Sla ze op om je voortgang bij te houden.</p>

        <Card style={{ marginBottom: 20 }}>
          {gapResultaat.missing.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: i < gapResultaat.missing.length - 1 ? `1px solid ${KLEUR.lijn}` : "none" }}>
              <div style={{ width: 26, height: 26, borderRadius: 6, background: KLEUR.inkt, color: KLEUR.messing, fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div>
              <div style={{ fontSize: 14, color: "#333" }}>{s.label}</div>
            </div>
          ))}
        </Card>

        <Card style={{ marginBottom: 20 }}>
          <SectionTitle>Blik op de toekomst van dit vakgebied</SectionTitle>
          {!toekomstblik && !toekomstLaden && (
            <>
              <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>Een algemene inschatting van hoe dit vakgebied zich zou kunnen ontwikkelen, geen harde voorspelling.</p>
              <button onClick={() => genereerToekomstblik(functieTitel)} style={{ padding: "9px 18px", borderRadius: 6, background: "#f5f4f0", color: KLEUR.inkt, border: `1px solid ${KLEUR.lijn}`, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Toon toekomstblik</button>
            </>
          )}
          {toekomstLaden && <p style={{ fontSize: 13, color: "#888" }}>Bezig…</p>}
          {toekomstblik && toekomstblik.length > 0 && (
            <>
              <p style={{ fontSize: 11, color: "#aaa", marginBottom: 10, fontStyle: "italic" }}>Een algemene inschatting, geen harde voorspelling.</p>
              {toekomstblik.map((p, i) => (
                <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                  <span style={{ color: KLEUR.messingDonker }}>→</span>
                  <span style={{ fontSize: 13, color: "#444", lineHeight: 1.6 }}>{p}</span>
                </div>
              ))}
            </>
          )}
        </Card>

        {!roadmapOpgeslagen ? (
          <button onClick={maakRoadmap} disabled={roadmapLaden} style={{ padding: "13px 28px", borderRadius: 6, background: KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            {roadmapLaden ? "Bezig…" : "Roadmap opslaan →"}
          </button>
        ) : (
          <div style={{ padding: "14px 18px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 13, color: "#166534" }}>
            ✓ Je roadmap is opgeslagen. Je kan hier straks je voortgang bijhouden.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Radar-diagram: zelfbeoordeling vs. feedback van een collega ──────────────
function RadarDiagram({ skills, eigenScores, feedbackScores, size = 280 }) {
  const n = skills.length;
  if (n < 3) return null; // een radar heeft minimaal 3 punten nodig om iets te tonen
  const midden = size / 2;
  const straal = size / 2 - 50;

  function punt(index, waarde) {
    const hoek = (Math.PI * 2 * index) / n - Math.PI / 2;
    const r = (waarde / 5) * straal;
    return [midden + r * Math.cos(hoek), midden + r * Math.sin(hoek)];
  }
  function label(index) {
    const hoek = (Math.PI * 2 * index) / n - Math.PI / 2;
    return [midden + (straal + 30) * Math.cos(hoek), midden + (straal + 30) * Math.sin(hoek)];
  }

  const eigenPad = skills.map((s, i) => punt(i, eigenScores[i]).join(",")).join(" ");
  const feedbackPad = feedbackScores ? skills.map((s, i) => punt(i, feedbackScores[i]).join(",")).join(" ") : null;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[1, 2, 3, 4, 5].map(r => (
        <polygon key={r} points={skills.map((s, i) => punt(i, r).join(",")).join(" ")} fill="none" stroke="#e3ded0" strokeWidth="1" />
      ))}
      {skills.map((s, i) => { const [x, y] = punt(i, 5); return <line key={i} x1={midden} y1={midden} x2={x} y2={y} stroke="#e3ded0" strokeWidth="1" />; })}
      {feedbackPad && <polygon points={feedbackPad} fill="rgba(184,134,63,0.25)" stroke={KLEUR.messing} strokeWidth="2" />}
      <polygon points={eigenPad} fill="rgba(47,102,144,0.2)" stroke="#2f6690" strokeWidth="2" />
      {skills.map((s, i) => { const [x, y] = label(i); return <text key={i} x={x} y={y} fontSize="10" fill="#555" textAnchor="middle">{s.length > 16 ? s.slice(0, 14) + "…" : s}</text>; })}
    </svg>
  );
}

// ─── Openbare feedbackpagina (geen login nodig) ─────────────────────────────
function FeedbackPagina({ token }) {
  const [verzoek, setVerzoek] = useState(null);
  const [laden, setLaden] = useState(true);
  const [fout, setFout] = useState("");
  const [naam, setNaam] = useState("");
  const [scores, setScores] = useState({});
  const [toelichtingen, setToelichtingen] = useState({});
  const [verzonden, setVerzonden] = useState(false);
  const [versturen, setVersturen] = useState(false);

  useEffect(() => {
    async function laadVerzoek() {
      const { data, error } = await supabase.from("feedback_verzoeken").select("*").eq("token", token).maybeSingle();
      if (error || !data) { setFout("Deze link is niet geldig."); setLaden(false); return; }
      if (new Date(data.verloopt_op) < new Date()) { setFout("Deze link is verlopen. Vraag de collega om een nieuwe link."); setLaden(false); return; }
      setVerzoek(data);
      const initScores = {};
      data.skills.forEach(s => { initScores[s.tekst] = 3; });
      setScores(initScores);
      setLaden(false);
    }
    laadVerzoek();
  }, [token]);

  async function versturenFeedback() {
    if (!naam.trim()) return;
    setVersturen(true);
    const reacties = verzoek.skills.map(s => ({ tekst: s.tekst, score: scores[s.tekst] || 3, toelichting: toelichtingen[s.tekst] || "" }));
    const { error } = await supabase.from("feedback_reacties").insert({ verzoek_id: verzoek.id, naam_feedbackgever: naam.trim(), reacties });
    if (!error) setVerzonden(true);
    setVersturen(false);
  }

  if (laden) return <div style={{ minHeight: "100vh", background: KLEUR.papier, display: "flex", alignItems: "center", justifyContent: "center" }}><Spinner /></div>;

  if (fout) return (
    <div style={{ minHeight: "100vh", background: KLEUR.papier, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <p style={{ fontSize: 14, color: "#991b1b" }}>⚠️ {fout}</p>
    </div>
  );

  if (verzonden) return (
    <div style={{ minHeight: "100vh", background: KLEUR.papier, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 20, color: KLEUR.inkt }}>Bedankt voor je feedback!</div>
        <p style={{ fontSize: 13, color: "#888", marginTop: 8 }}>Je reactie is verstuurd.</p>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: KLEUR.papier, fontFamily: "'Segoe UI',sans-serif", padding: "32px 20px" }}>
      <div style={{ maxWidth: 600, margin: "0 auto" }}>
        <div style={{ background: "#fff", borderRadius: 10, border: `1px solid ${KLEUR.lijn}`, padding: "28px 30px", marginBottom: 20 }}>
          <div style={{ fontFamily: "Georgia,serif", fontSize: 20, fontWeight: 700, color: KLEUR.inkt, marginBottom: 10 }}>Feedback gevraagd op: {verzoek.functie_titel}</div>
          <p style={{ fontSize: 13, color: "#555", lineHeight: 1.7 }}>
            Je collega heeft zelf een inschatting gemaakt van de skills die horen bij de taken van zijn of haar huidige functie. Hieronder staan die taken en skills. Geef per skill aan hoe goed jij denkt dat je collega dit beheerst, van Beginner tot Expert, en licht dat kort toe als je dat wilt. Zo krijgt je collega, naast het eigen beeld, ook jouw blik erbij, voor een completer en eerlijker totaalbeeld.
          </p>
        </div>

        <div style={{ background: "#fff", borderRadius: 10, border: `1px solid ${KLEUR.lijn}`, padding: "20px 24px", marginBottom: 20 }}>
          <label style={{ fontSize: 13, color: "#555", display: "block", marginBottom: 6 }}>Jouw naam</label>
          <input type="text" value={naam} onChange={e => setNaam(e.target.value)} placeholder="Bijv. Jan de Vries"
            style={{ width: "100%", padding: "10px 14px", borderRadius: 6, border: "1px solid #d0cfc8", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" }} />
        </div>

        {verzoek.skills.map((s, i) => (
          <div key={i} style={{ background: "#fff", borderRadius: 10, border: `1px solid ${KLEUR.lijn}`, padding: "18px 22px", marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: KLEUR.inkt, marginBottom: 10 }}>{s.tekst}</div>
            <MiniSchaal label="Jouw inschatting" labels={NIVEAUS} waarde={scores[s.tekst] || 3} onChange={v => setScores(prev => ({ ...prev, [s.tekst]: v }))} />
            <textarea value={toelichtingen[s.tekst] || ""} onChange={e => setToelichtingen(prev => ({ ...prev, [s.tekst]: e.target.value }))}
              placeholder="Toelichting (optioneel)" style={{ width: "100%", marginTop: 10, padding: "8px 12px", borderRadius: 6, border: "1px solid #d0cfc8", fontSize: 13, fontFamily: "inherit", minHeight: 50, boxSizing: "border-box" }} />
          </div>
        ))}

        <button onClick={versturenFeedback} disabled={!naam.trim() || versturen} style={{ padding: "13px 28px", borderRadius: 6, background: !naam.trim() ? "#ccc" : KLEUR.inkt, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: !naam.trim() ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
          {versturen ? "Bezig…" : "Feedback versturen →"}
        </button>
      </div>
    </div>
  );
}

// ─── Prompts ──────────────────────────────────────────────────────────────────
const CV_PROMPT = `Je bent een expert loopbaancoach en CV-analist. Analyseer het meegestuurde CV grondig.

Retourneer ALLEEN een JSON-object (geen uitleg, geen markdown backticks) met EXACT deze structuur:

{
  "naam": "",
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
- "naam": de volledige naam van de persoon zoals die bovenaan het CV staat. Leeg laten als niet te vinden.
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

function toekomstPrompt(functieTitel) {
  return `Je bent een arbeidsmarktexpert. Geef een algemene inschatting (geen harde voorspelling) van hoe het vakgebied van "${functieTitel}" er de komende jaren waarschijnlijk uit gaat zien, en welke skills daardoor belangrijker zouden kunnen worden.

Regels:
- Precies 3 punten
- Kort en concreet, geen vage algemeenheden
- Wees eerlijk over onzekerheid, dit zijn algemene trends, geen garanties

Antwoord ALLEEN met dit JSON (geen backticks):
{"punten": ["", "", ""]}`;
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
