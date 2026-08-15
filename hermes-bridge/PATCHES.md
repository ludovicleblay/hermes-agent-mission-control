# Hermy HQ bridge — Modifs locales Le Blay (Zero-Patch)

> Principe : AUCUNE source Hermes modifiée. Ce fichier trace les écarts entre
> notre copie locale de `bridge.mjs` et le repo amont (sharbelxyz/hermes-agent-mission-control),
> pour les rejouer après un `git pull` / update.

## Contexte
- Bridge déployé en conteneur Docker (`hermyhq-bridge`, image `node:22` — glibc, car
  le wrapper appelle le binaire `docker` hôte lié à glibc ; `node:22-alpine` → « docker: not found »).
- Le wrapper `/bridge/bin/hermes` (créé, pas dans le repo amont) :
  `exec docker exec hermes /opt/hermes/bin/hermes "$@"` — nécessite socket Docker + binaire docker montés.

## Patches appliqués à bridge.mjs (3)
1. **`-z` → `chat -q`** (2 occurrences) : notre build de `hermes` a `-z/--oneshot`
   qui n'imprime QUE le coût (spend), pas la réponse → le bridge stockerait le spend
   comme résultat. `hermes chat -q <prompt>` renvoie la réponse (avec bruit d'init).
   - ligne ~217 (generateBriefing) : `hermes(["chat","-q",BRIEF_PROMPT])`
   - ligne ~244 (runRequest oneshot/chat) : `hermes(["chat","-q",r.prompt||r.title])`
2. **`isLocal` regex** : ajout de `|hermyhq-postgres` — sinon SSL activé contre notre
   Postgres local → « The server does not support SSL connections ».
   - ligne ~51 : `/@(localhost|127\.0\.0\.1|hermyhq-postgres)/`

## Vérifications post-patch (15/08/2026)
- `docker logs hermyhq-bridge` → « hermes-bridge up » sans erreur
- BDD : event « Bridge connected », DataStore (hermes-crons/health/cost), HermesTask mirrorés ✅
- Faux négatif cosmétique : `hermes-health.gateway="stopped"` (regex du bridge
  `/gateway[^\n]*(running|online)/i` ne matche pas la sortie de `hermes status` — à ignorer)
