# Hermy HQ bridge — Modifs locales Le Blay (Zero-Patch)

> Principe : AUCUNE source Hermes modifiée. Ce fichier trace les écarts entre
> notre copie locale de `bridge.mjs` et le repo amont (sharbelxyz/hermes-agent-mission-control),
> pour les rejouer après un `git pull` / update.

## Contexte
- Bridge déployé en conteneur Docker (`hermyhq-bridge`, image `node:22` — glibc, car
  le wrapper appelle le binaire `docker` hôte lié à glibc ; `node:22-alpine` → « docker: not found »).
- Le wrapper `/bridge/bin/hermes` (créé, pas dans le repo amont) :
  `exec docker exec hermes /opt/hermes/bin/hermes "$@"` — nécessite socket Docker + binaire docker montés.

## Patches appliqués à bridge.mjs (4)
1. **`-z` → `chat -q`** (1 occurrence, runRequest oneshot/chat) : notre build de
   `hermes` a `-z/--oneshot` qui n'imprime QUE le coût (spend), pas la réponse →
   le bridge stockerait le spend comme résultat. `hermes chat -q <prompt>` renvoie
   la réponse (avec bruit d'init). ⚠️ Depuis le 16/08/2026 soir, `generateBriefing`
   n'utilise PLUS le CLI (voir patch 4) — seul runRequest conserve le fallback CLI.
   - ligne ~244 (runRequest oneshot/chat) : `hermes(["chat","-q",r.prompt||r.title])`
2. **`isLocal` regex** : ajout de `|hermyhq-postgres` — sinon SSL activé contre notre
   Postgres local → « The server does not support SSL connections ».
   - ligne ~51 : `/@(localhost|127\.0\.0\.1|hermyhq-postgres)/`
3. **hermesChat via API HTTP** (ajout local) : le bridge chatte avec Hermes via
   `POST http://hermes:8642/v1/chat/completions` (OpenAI-compatible, Bearer =
   `API_SERVER_KEY` lu dans `/opt/data/.env` du conteneur hermes) au lieu du CLI —
   supprime le SIGABRT intermittent de `hermes chat`. Fallback CLI si API KO.
4. **Section « Chief of Staff » — brief refondu (16/08/2026 soir, carte t_ce3006c3)** :
   - Le brief était généré par le CLI (`hermes chat -Q -q BRIEF_PROMPT`) : DeepSeek
     colle son cadre `┌─ Reasoning ┐` dans le stdout → parse JSON KO → fallback =
     reasoning brut dans `summary` + `sections: []` → le dashboard affichait du
     reasoning sur des consignes obsolètes (« read your memory wiki open-loops »).
   - `generateBriefing()` utilise maintenant `hermesChat()` (API HTTP, réponse
     propre) + stripReasoning + fallback PROPRE (message clair, jamais de reasoning).
   - `BRIEF_PROMPT` remplacé par `buildBriefPrompt(ctx)` : plus AUCUNE mention de
     wiki (abandonné → Outline + MEMORY.md + Honcho) ; le modèle est appelé SANS
     outils donc toutes les données réelles sont injectées par `collectBriefContext()`
     : cartes kanban actives (API REST :9119), événements AgentEvent 24h, dernier
     brief (anti-redite). Brief en français, 4 sections (À décider / Priorités /
     Récemment livré / Prochaines actions).
   - UI `src/components/hermes-briefing.tsx` : `sectionTone()` étendu aux labels FR
     (décid/valid → warn, livr/termin → up, priorit/prochain/à suivre → accent).

## Vérifications post-patch (15/08/2026)
- `docker logs hermyhq-bridge` → « hermes-bridge up » sans erreur
- BDD : event « Bridge connected », DataStore (hermes-crons/health/cost), HermesTask mirrorés ✅
- Faux négatif cosmétique : `hermes-health.gateway="stopped"` (regex du bridge
  `/gateway[^\n]*(running|online)/i` ne matche pas la sortie de `hermes status` — à ignorer)

## Ajout local site (15/08/2026) — section « Mémoire Dialectic »
Le site Next.js (`/opt/AppData/hermyhq/app/src/`) a reçu un ajout LOCAL (pas dans le
repo amont sharbelxyz/hermes-agent-mission-control) :
- **Page** `src/app/memory-dialectic/page.tsx` — explorateur de la mémoire Honcho
  locale : sélecteur de workspace, stats (peers/conclusions/sessions), recherche
  sémantique, card/context (représentation dérivée) par peer, sessions + résumés + messages.
- **Route API** `src/app/api/hermes/honcho/route.ts` — proxy LECTURE SEULE vers l'API
  Honcho locale (`HONCHO_BASE_URL`, défaut `http://192.168.68.107:8000`, réseau hôte ;
  le site est sur le réseau `hermyhq`, honcho-api sur `hermes_default`). Whitelist
  stricte d'actions : workspaces, peers, sessions, messages, conclusions, conclusion,
  card, context, summaries, representation, search. AUCUN endpoint d'écriture/keys.
- **Sidebar** `src/components/sidebar.tsx` — lien « Mémoire Dialectic » (icône Brain)
  dans le groupe System, sous « Memory Wiki ».
- Motivations : remplacer le dashboard honcho.dev (cloud) après bascule Honcho 100 %
  locale ; route protégée par le middleware NextAuth existant (JWT ou x-internal-secret).
- Rejouable après `git pull` : re-copier les 3 fichiers ci-dessus + `npm run build`.
