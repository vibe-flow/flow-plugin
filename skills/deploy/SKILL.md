---
name: deploy
description: Déploie le projet via Kamal — soit en déclenchant le workflow GitHub Actions (push main / tag v*), soit en exécutant kamal deploy directement depuis le local. Wrapper léger autour de Kamal v2.
argument-hint: "[--local] [--skip-fixes] [--dry-run]"
disable-model-invocation: true
---

# Deploy

Déclenche un déploiement Kamal pour le projet courant.

> **Deux modes** :
> - **CI (défaut)** : commit + push → le workflow `.github/workflows/deploy.yml` fait `kamal deploy` en CI. Logs unifiés sur GitHub, traçabilité.
> - **Local (`--local`)** : `kamal deploy` exécuté depuis ta machine. Plus rapide pour debug, moins traçable.

## Dynamic context

- Branche : !`git branch --show-current`
- config/deploy.yml : !`test -f config/deploy.yml && echo EXISTS || echo NOT_FOUND`
- Workflow GHA : !`test -f .github/workflows/deploy.yml && echo EXISTS || echo NOT_FOUND`
- Working tree : !`git status --porcelain | wc -l | tr -d ' '` modifications non-commitées
- Service name (config/deploy.yml) : !`grep -E '^service:' config/deploy.yml 2>/dev/null | head -1 | awk '{print $2}' || echo UNKNOWN`
- Primary host (config/deploy.yml) : !`grep -E '^\s*-\s+' config/deploy.yml 2>/dev/null | head -1 | sed 's/^[[:space:]]*-[[:space:]]*//' || echo UNKNOWN`

## Step 0 — Pré-requis

Si `config/deploy.yml` est NOT_FOUND : invoquer `/deploy-setup` puis revenir sur ce skill. Demander confirmation via `AskUserQuestion` ("Le projet n'a pas de config Kamal. Lancer /deploy-setup maintenant ?").

Si workflow GHA NOT_FOUND et qu'on est en mode CI : forcer le mode local (`--local`) ou demander à l'utilisateur.

## Step 1 — Détecter le mode

- Si `$ARGUMENTS` contient `--local` → mode **local**.
- Sinon → mode **CI** par défaut.

## Step 2 — Vérifier l'état local

1. **Branche** : si on n'est pas sur `main` ni sur une branche `feature/*` `fix/*` `hotfix/*`, demander confirmation.

2. **Working tree** : si modifications non-commitées :
   - Lister les fichiers modifiés
   - `AskUserQuestion` :
     - Commit via `/commit` puis continuer
     - Continuer sans commit (les modifs ne seront pas déployées)
     - Annuler

3. **Sync avec origin** : `git fetch && git status -sb`. Si en retard, proposer `git pull --ff-only`.

## Step 3 — Mode CI : push pour déclencher le workflow

```bash
git push origin <current-branch>
```

Si la branche n'est PAS `main` : informer l'utilisateur que le push **ne déclenchera pas** le workflow (qui n'écoute que `main` + tags `v*`). Suggérer de créer une PR + merger, ou d'utiliser `--local`.

Si push sur `main` :

1. **Wait for workflow run to appear** (jusqu'à 30s) :
   ```bash
   gh run list --workflow=deploy.yml --branch=main --limit=1
   ```

2. **Monitor** :
   ```bash
   gh run watch <run-id>
   ```

3. **Si échec** :
   - `gh run view <run-id> --log-failed`
   - Proposer : voir les logs détaillés, `kamal rollback`, ou debug local.

## Step 3-bis — Mode local : `kamal deploy` direct

Vérifier que toutes les env vars secrets sont set localement (lecture de `.kamal/secrets` pour la liste) :
```bash
test -f .kamal/secrets && grep -oE '^\w+' .kamal/secrets
```

Pour chaque variable manquante, demander via `AskUserQuestion` ou refuser de continuer.

Lancer Kamal via Docker (Ruby local pas requis) :
```bash
docker run --rm \
  -v "$(pwd):/workdir" \
  -v "$HOME/.ssh:/root/.ssh" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e KAMAL_REGISTRY_PASSWORD \
  -e DATABASE_URL -e REDIS_URL -e JWT_SECRET -e JWT_REFRESH_SECRET \
  $(grep -oE '^\w+' .kamal/secrets | grep -v KAMAL_REGISTRY_PASSWORD | sed 's/^/-e /') \
  ghcr.io/basecamp/kamal:latest deploy
```

> **Note** : si c'est le PREMIER deploy sur ce serveur, utiliser `setup` au lieu de `deploy` (bootstrap kamal-proxy + accessories).

Si `--dry-run` : afficher la commande sans l'exécuter, et lancer `kamal config` à la place pour valider le YAML.

## Step 4 — Health check

Récupérer le primary host depuis `config/deploy.yml` :
```bash
PRIMARY_HOST=$(grep -A5 '^proxy:' config/deploy.yml | grep -E '^\s*-\s+' | head -1 | sed 's/^[[:space:]]*-[[:space:]]*//')

# Polling avec retry (le SSL Let's Encrypt peut prendre 30s-2min au premier deploy)
for i in 1 2 3 4 5 6; do
  if curl -sf --max-time 10 "https://$PRIMARY_HOST/health" >/dev/null; then
    echo "✓ Health check OK"
    break
  fi
  echo "Attempt $i — waiting 10s..."
  sleep 10
done
```

Si toujours KO après 6 tentatives :
- `docker run ... kamal app logs --lines 50`
- Proposer `kamal rollback` ou debug.

## Step 4-bis — Vérifier l'image déployée correspond au commit

```bash
EXPECTED=$(git rev-parse HEAD)
ssh {SSH_USER}@{SSH_HOST} "docker inspect <SERVICE>-web-${EXPECTED:0:40} --format '{{.Config.Image}}'"
```

Confirmer que le container actif est bien celui du commit poussé.

## Step 5 — Fix scripts (si applicable, à l'ancienne)

Si `.flow/deploy.json` legacy contient une section `fixes`, garder la logique existante : SSH au serveur, lister les scripts dans `scripts/fixes/`, dry-run puis apply, update tracking file.

Sauter complètement si `$ARGUMENTS` contient `--skip-fixes`.

## Step 6 — Résumé

```
Deploy — terminé
────────────────
Service :       {SERVICE_NAME}
Commit :        {HASH} - {MESSAGE}
Mode :          CI (workflow {RUN_ID}) | local (kamal deploy)
Workflow :      passed / failed
Health :        OK / FAIL
Primary URL :   https://{PRIMARY_HOST}
```

## Rollback

Si le deploy a réussi mais l'app montre des erreurs en prod :
```bash
docker run --rm -v "$(pwd):/workdir" -v "$HOME/.ssh:/root/.ssh" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ghcr.io/basecamp/kamal:latest rollback
```

Kamal rollback connaît la version précédente automatiquement. Bascule en quelques secondes (zero-downtime).

## Règles importantes

- **TOUJOURS** utiliser `AskUserQuestion` avant un push ou un `kamal deploy` direct.
- **NE JAMAIS** force-push (`--force`) sur `main`.
- Si la branche courante n'est pas `main`, le mode CI **ne déploie pas** (le workflow écoute `main` + `v*` only). Avertir clairement.
- Pour déployer une **version spécifique** (release tag-based), utiliser `/release` à la place (qui crée le tag → déclenche le workflow prod).
- Le mode `--local` est utile pour debug, mais perd la traçabilité GitHub Actions. À utiliser avec parcimonie.

## Arguments

- `--local` : skip CI, lance `kamal deploy` directement depuis la machine locale.
- `--skip-fixes` : ne pas exécuter les scripts dans `scripts/fixes/` (legacy `.flow/deploy.json`).
- `--dry-run` : afficher ce qui serait fait sans rien exécuter.
