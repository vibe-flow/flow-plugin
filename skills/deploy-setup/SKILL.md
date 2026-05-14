---
name: deploy-setup
description: Scaffold Kamal-based deployment for a vibe-stack project (Bun + NestJS + React/Vite, shared server-infra backend). Generates Dockerfiles, nginx.conf with internal proxy_pass, config/deploy.yml, and GitHub Actions workflow.
argument-hint: "[--check-only]"
disable-model-invocation: true
---

# Deploy Setup — scaffolder Kamal pour un projet vibe-stack

Crée toute l'infrastructure de déploiement pour un projet vibe-stack qui sera déployé via **Kamal v2** sur un serveur partageant le réseau Docker `server-infra` (Postgres, Redis, MinIO, LiteLLM mutualisés).

> **Pattern** : web container = front gateway (nginx avec `proxy_pass` interne vers l'API).
> API = accessory Kamal. kamal-proxy = SSL Let's Encrypt + multi-host.
> Trunk-based git : push `main` ou tag `v*` déclenche le workflow.

## Dynamic context

- Service name (depuis .flow/project.json) : !`grep -o '"name": *"[^"]*"' .flow/project.json 2>/dev/null | head -1 | cut -d'"' -f4 || echo NOT_FOUND`
- config/deploy.yml : !`test -f config/deploy.yml && echo EXISTS || echo NOT_FOUND`
- Dockerfile.api : !`test -f Dockerfile.api && echo EXISTS || echo NOT_FOUND`
- Dockerfile.web : !`test -f Dockerfile.web && echo EXISTS || echo NOT_FOUND`
- Dockerfile.web.kamal (overlay) : !`test -f Dockerfile.web.kamal && echo EXISTS || echo NOT_FOUND`
- nginx.conf : !`test -f infrastructure/nginx/nginx.conf && echo EXISTS || echo NOT_FOUND`
- .dockerignore : !`test -f .dockerignore && echo EXISTS || echo NOT_FOUND`
- .github/workflows/deploy.yml : !`test -f .github/workflows/deploy.yml && echo EXISTS || echo NOT_FOUND`
- .kamal/secrets : !`test -f .kamal/secrets && echo EXISTS || echo NOT_FOUND`
- GitHub repo : !`gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || echo UNKNOWN`
- /up endpoint (NestJS health controller) : !`grep -rl "@Controller('up')\|@Controller('/up')\|@Controller(\"up\")" apps/api/src 2>/dev/null | head -1 || echo NOT_FOUND`

## Mode `--check-only`

Si `$ARGUMENTS` contient `--check-only` : afficher le tableau de statut (Step 7) et exit sans rien créer ni modifier.

## Step 1 — Collecter la config

Demander via `AskUserQuestion`, dans l'ordre (afficher les valeurs détectées en pré-rempli quand pertinent) :

1. **Service name** — kebab-case, slug du projet (default: nom du repo). Sert d'identifiant Kamal, de nom de container, et de préfixe registry. Ex: `corseo`.

2. **SSH host** — Tailscale IP (recommandé, ex `100.64.77.59`) ou IP/hostname public. Sert pour `kamal deploy`.

3. **SSH user** — default `debian` (sudo). Si serveur fresh, `root` peut être acceptable.

4. **GHCR organization** — où pusher les images Docker. Options : `vibe-flow` (projets Florian), `fbrotte` (compte perso), ou autre. Détecter depuis le remote git si possible.

5. **Primary host** — domaine principal du projet (ex: `pro.corseo-voyages.com`). Sera utilisé pour `CORS_ORIGIN`, `FRONTEND_URL`, et le healthcheck CI.

6. **Extra hosts** (optionnel) — domaines additionnels routés vers le même service (ex: `devis.corseo-voyages.com`). Vide si aucun.

7. **Docker network** — `server-infra` (défaut, partage Postgres/Redis/MinIO/LiteLLM) ou un nouveau réseau dédié au projet (cas serveur fresh sans server-infra).

8. **Modules optionnels présents dans le projet** (multiSelect, pour ajouter les env vars accessoires correspondantes) :
   - `litellm` → ajoute `LITELLM_BASE_URL` (clear) + `LITELLM_MASTER_KEY` (secret)
   - `brevo` (transactional email) → `BREVO_API_KEY` (secret) + `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` (clear)
   - `mapbox` → `VITE_MAPBOX_TOKEN` (build arg côté web)
   - aucun

## Step 2 — Générer les Dockerfiles (si absents)

### Dockerfile.api
Si NOT_FOUND : lire `~/.claude/skills/deploy-setup/templates/Dockerfile.api.template` et créer `Dockerfile.api`. Remplacer `{SHARED_PKG_NAME}` par le nom du package shared (lu depuis `packages/shared/package.json`).

**Règles critiques** (à respecter dans le template) :
- Stage 2 (build) copie uniquement `packages/shared/`, `apps/api/`, et `prisma/` (jamais `COPY . .` — `apps/web/` ferait crasher SWC).
- Shared compile avec `bunx tsc -p tsconfig.json --module commonjs --moduleResolution node --outDir dist`.
- API build via `nest-cli.docker.json` généré inline (évite les chemins du repo).
- `--mount=type=cache` est OK en CI (buildx), pas en local.

### Dockerfile.web
Si NOT_FOUND : lire `~/.claude/skills/deploy-setup/templates/Dockerfile.web.template` et créer.

### Dockerfile.web.kamal (overlay)
Si NOT_FOUND : lire `templates/Dockerfile.web.kamal.template`, remplacer `{REGISTRY_ORG}` et `{SERVICE_NAME}`, créer à la racine.

### .dockerignore
Si NOT_FOUND : lire `templates/dockerignore.template`, créer.

## Step 3 — Générer nginx.conf avec proxy_pass interne

Si `infrastructure/nginx/nginx.conf` NOT_FOUND ou ne contient pas `upstream {SERVICE_NAME}_api` :

1. Lire `templates/nginx.conf.template`
2. Remplacer `{SERVICE_NAME}` partout
3. Créer/écraser `infrastructure/nginx/nginx.conf`

**Si le fichier existe déjà mais sans le upstream** (cas migration depuis Caddy) : afficher un diff via `AskUserQuestion` :
- "Le `nginx.conf` actuel ne contient pas de routing path-based interne. Le remplacer par le template Kamal ?"
- Si oui : écraser. Sinon : skip et afficher un warning sur la nécessité d'ajouter manuellement le routing.

## Step 4 — Générer config/deploy.yml Kamal

Lire `templates/kamal-deploy.yml.template`, substituer :
- `{SERVICE_NAME}`, `{REGISTRY_ORG}`, `{SSH_HOST}`, `{SSH_USER}`, `{GHCR_USERNAME}`, `{NETWORK}`, `{PRIMARY_HOST}`
- `{HOSTS_YAML_LIST}` : liste YAML des hosts (`primary_host` + `extra_hosts`), indentée
  ```yaml
      - pro.corseo-voyages.com
      - devis.corseo-voyages.com
  ```
- `{EXTRA_CLEAR_ENV}` : env vars clear additionnelles selon les modules optionnels choisis
- `{EXTRA_SECRET_ENV}` : env secrets additionnels selon les modules

Écrire dans `config/deploy.yml`. Créer le dossier `config/` si nécessaire.

## Step 5 — Générer le workflow GitHub Actions

Lire `templates/deploy-workflow.kamal.template.yml`, substituer `{PRIMARY_HOST}`. Écrire dans `.github/workflows/deploy.yml`.

Lister à l'utilisateur les secrets GitHub à configurer dans Settings → Secrets and variables → Actions :
- `SSH_PRIVATE_KEY` — clé SSH privée du runner (correspondant à la pubkey autorisée sur le serveur)
- `SSH_KNOWN_HOSTS` — output de `ssh-keyscan <host>`
- `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`
- + secrets des modules optionnels (`LITELLM_MASTER_KEY`, `BREVO_API_KEY`, etc.)

## Step 6 — Endpoint /health côté API

Le nginx pointe vers `/health` du web container (qui renvoie 200 statique). Kamal accessory `api` n'a pas de healthcheck obligatoire mais c'est mieux d'en avoir un.

Vérifier qu'il existe un endpoint `/health` ou `/up` dans l'API. Pour NestJS, créer un health controller minimal si absent :

```typescript
// apps/api/src/modules/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
```

Enregistrer dans `app.module.ts` si besoin.

**Piège** : pas de redirect HTTPS forcé interne sur `/health` (sinon Kamal proxy reçoit 301 et considère unhealthy).

## Step 7 — Créer .kamal/secrets et l'ajouter à .gitignore

Créer `.kamal/secrets` (template, à remplir manuellement) :
```
# Kamal secrets — JAMAIS commit (gitignored)
# En local : remplir les valeurs ci-dessous puis source manuellement avant kamal deploy.
# En CI : ces vars sont injectées en env directement par le workflow GitHub Actions.

KAMAL_REGISTRY_PASSWORD=${KAMAL_REGISTRY_PASSWORD}
DATABASE_URL=${DATABASE_URL}
REDIS_URL=${REDIS_URL}
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
# + secrets de tes modules optionnels
```

Ajouter à `.gitignore` (si pas déjà) :
```
# Kamal secrets (never commit)
.kamal/secrets
```

## Step 8 — Setup serveur (optionnel, demander à l'utilisateur)

Via `AskUserQuestion` : "Préparer le serveur maintenant ?"

Si oui :

1. **Vérifier accès SSH** :
   ```bash
   ssh -o ConnectTimeout=5 {SSH_USER}@{SSH_HOST} 'echo OK'
   ```

2. **Vérifier Docker** :
   ```bash
   ssh {SSH_USER}@{SSH_HOST} 'docker --version'
   ```
   Si absent, l'installer via le script officiel Docker.

3. **Vérifier que le réseau Docker `{NETWORK}` existe** :
   ```bash
   ssh {SSH_USER}@{SSH_HOST} "docker network inspect {NETWORK} >/dev/null 2>&1 && echo EXISTS || echo MISSING"
   ```
   Si MISSING :
   - Si `server-infra` : informer l'utilisateur qu'il doit déployer server-infra d'abord (`cd ~/server-infra && docker compose up -d`).
   - Sinon : créer le réseau (`docker network create {NETWORK}`).

4. **Créer la database Postgres** (si on utilise server-postgres) :
   ```bash
   ssh {SSH_USER}@{SSH_HOST} "docker exec server-postgres psql -U postgres -c 'CREATE DATABASE {SERVICE_NAME};'"
   ```
   (silencieusement OK si la DB existe déjà)

5. **Login Docker GHCR sur le serveur** (pour pull les images privées) :
   Pré-requis : token GHCR avec scopes `read:packages,write:packages`.
   ```bash
   TOKEN=$(GH_TOKEN="" gh auth token)
   ssh {SSH_USER}@{SSH_HOST} "echo '$TOKEN' | docker login ghcr.io -u {GHCR_USERNAME} --password-stdin"
   ```
   Si le scope n'est pas présent : `GH_TOKEN="" gh auth refresh -h github.com -s read:packages,write:packages` (device flow).

## Step 9 — Premier deploy

Afficher la commande à lancer manuellement (Kamal CLI via Docker, Ruby local pas requis) :

```bash
export KAMAL_REGISTRY_PASSWORD=$(GH_TOKEN="" gh auth token)
# Ajouter les autres secrets en env, ex :
export DATABASE_URL="postgresql://postgres:xxx@server-postgres:5432/{SERVICE_NAME}?schema=public"
export REDIS_URL="redis://:xxx@server-redis:6379"
export JWT_SECRET="..."
export JWT_REFRESH_SECRET="..."

docker run --rm \
  -v "$(pwd):/workdir" \
  -v "$HOME/.ssh:/root/.ssh" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e KAMAL_REGISTRY_PASSWORD \
  -e DATABASE_URL \
  -e REDIS_URL \
  -e JWT_SECRET \
  -e JWT_REFRESH_SECRET \
  ghcr.io/basecamp/kamal:latest setup
```

`kamal setup` (vs `kamal deploy`) :
- Premier deploy → installe kamal-proxy + boote les accessories
- Suivants → `kamal deploy`

Proposer via `AskUserQuestion` : "Lancer `kamal setup` maintenant ?"
- Oui : exécuter la commande (vérifier que les env vars sont bien set).
- Non : laisser l'utilisateur lancer plus tard.

## Step 10 — Résumé final

Afficher le statut de chaque élément :

```
Deploy Setup — Status
─────────────────────
Service name :         {SERVICE_NAME}
GitHub repo :          {OWNER}/{REPO}
SSH :                  {SSH_USER}@{SSH_HOST}
Network Docker :       {NETWORK}
Primary host :         {PRIMARY_HOST}
Extra hosts :          {LIST or none}

Files :
  Dockerfile.api :          ✓ created / ✓ exists / ✗ missing
  Dockerfile.web :          ✓ created / ✓ exists / ✗ missing
  Dockerfile.web.kamal :    ✓ created / ✓ exists / ✗ missing
  .dockerignore :           ✓ created / ✓ exists / ✗ missing
  nginx.conf :              ✓ created / ✓ exists / ✗ missing
  config/deploy.yml :       ✓ created / ✓ exists / ✗ missing
  .github/workflows/deploy.yml :  ✓ created / ✓ exists / ✗ missing
  .kamal/secrets :          ✓ created (placeholder) / ✓ exists
  /health endpoint :        ✓ ok / ⚠ vérifier manuellement

Server :
  SSH access :              ✓ ok / ✗ failed
  Docker installed :        ✓ / ✗
  Network {NETWORK} :       ✓ / ✗
  Database {SERVICE_NAME} : ✓ / ✗
  GHCR login :              ✓ / ✗

Next steps :
  1. Configurer les secrets GitHub Actions (liste ci-dessus)
  2. Remplir .kamal/secrets en local pour deploy manuel
  3. Lancer `kamal setup` (premier deploy) ou push main pour deploy auto
```

## Règles importantes

- **Ne JAMAIS écraser un fichier existant sans confirmation** via `AskUserQuestion`.
- **Le `nginx.conf` est la pièce critique** : sans le `proxy_pass` interne vers l'API, le web container ne servira que les statics SPA et toutes les routes `/api`, `/trpc`, `/uploads` échoueront avec 404.
- **`Dockerfile.web.kamal`** est volontairement minimal (FROM + COPY nginx.conf) — son rôle est de patcher l'image web existante sans re-builder le SPA à chaque deploy. Le build "vrai" du SPA se fait par le workflow CI séparé, ou lors d'un `docker build -f Dockerfile.web`.
- **kamal-proxy bind sur :80/:443** : un seul reverse proxy par serveur. Si d'autres apps Kamal sont sur le même serveur, elles partageront ce kamal-proxy automatiquement.
- **Format `.kamal/secrets`** : les valeurs `${VAR}` sont substituées depuis l'environnement au moment du `kamal deploy`. **Ne pas y mettre de valeurs en clair** en mode CI (les secrets viennent du workflow).

## Arguments

- `--check-only` : afficher uniquement le statut sans rien modifier
