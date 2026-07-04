# CV Skillsanalyse

Een AI-tool die CV's analyseert op basis van het **Weten · Kunnen · Zijn · Willen** model, inclusief ESCO-skillkoppeling, Drijfveren Test en Ontwikkeladvies.

## Lokaal draaien

```bash
npm install
cp .env.example .env
# Vul je Anthropic API key in in .env
npm run dev
```

## Deployen op Vercel

1. Push naar GitHub
2. Ga naar [vercel.com](https://vercel.com) → **Add New Project**
3. Importeer je GitHub repository
4. Voeg environment variable toe:
   - **Key:** `VITE_ANTHROPIC_API_KEY`
   - **Value:** `sk-ant-api03-...` (jouw Anthropic API key)
5. Klik **Deploy**

Je krijgt direct een URL zoals `cv-skillsanalyse.vercel.app`.

## Technologie

- React 18 + Vite
- Anthropic Claude API (`claude-sonnet-4-20250514`)
- ESCO skills database (EU, v1.2 Nederlands)

## Later koppelen aan SkillsPortaal

De ESCO URI's in de output (`http://data.europa.eu/esco/skill/[uuid]`) zijn de sleutel voor terugkoppeling naar het SkillsPortaal. Vervang de AI-schatting later door een echte ESCO API-call via `https://ec.europa.eu/esco/api`.
