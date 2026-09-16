---
name: init-project
description: Use when creating a new project from the flow-core template (formerly vibe-stack). Triggers on requests to start, init, scaffold, or bootstrap a new project.
disable-model-invocation: true
argument-hint: "<project-name>"
---

# Init Project

Crée un nouveau projet à partir du template `flow-core` : repo GitHub, renommage, projet Bitwarden Secrets Manager (BSM) et ses secrets, base et ports de dev dans `local-services`, migration initiale, seed, lancement vérifié, commit.

**Zéro fichier `.env`** : les secrets vivent dans le projet BSM, la config de dev en clair dans `.flow/project.json`, et `bin/dev` compose l'environnement à chaque lancement (section « Dev local — `bin/dev` » de `.flow/conventions.md`).

## Prérequis

- `gh` authentifié, avec accès à `vibe-flow/flow-core`
- `bws`, `jq`, et `BWS_ACCESS_TOKEN` exporté (`bws project list` doit répondre)
- `local-services` démarré : conteneurs `local-postgres`, `local-redis`, `local-portal` (`docker ps`)

## Process

### 1. Nom du projet et organisation

Utiliser `$ARGUMENTS` si fourni, sinon demander :
- Nom du projet (kebab-case, ex : `mon-app`) — noté `<project-name>` ci-dessous
- Organisation GitHub (par défaut `vibe-flow`) ou compte personnel

La base de dev se nomme `<project-name>` avec `_` à la place de `-` (ex : `rmm_console`) — noté `<db-name>`.

### 2. Créer le repo depuis le template

```bash
cd ~/Dev
gh repo create <org>/<project-name> --template vibe-flow/flow-core --private --clone
cd <project-name>
```

(Compte personnel : `gh repo create <project-name> --template vibe-flow/flow-core --private --clone`.)

### 3. Renommer le projet

Remplacer `template-dev` par `<project-name>` dans tous les fichiers suivis (packages, imports `@template-dev/shared`, `tsconfig`, `package.prod.json`, `bun.lock`, `.claude/rules/`) :

```bash
git grep -l "template-dev" | xargs sed -i '' "s/template-dev/<project-name>/g"
git grep -n "template-dev"   # doit ne rien rendre
```

Puis les libellés :
- `apps/web/index.html` : `<title>` (remplacer « Vibe Stack ») et `<meta name="description">` si présente
- `apps/web/src/components/layout/AppLayout.tsx` : « Vibe Stack » dans le logo de la barre latérale
- `apps/web/src/pages/DashboardPage.tsx` : « Vibe Stack » dans le titre `h1`
- `README.md` et `CLAUDE.md` : le titre `# flow-core` devient `# <project-name>` ; remplacer la description du template par une ligne sur le projet

### 4. Projet BSM et secrets

Vérifier d'abord qu'aucun projet BSM ne porte déjà ce nom :

```bash
bws project list | jq -r '.[] | select(.name == "<project-name>") | .id'
```

Puis créer le projet et les deux secrets JWT (valeurs générées, jamais affichées) :

```bash
BWS_PROJECT_ID=$(bws project create "<project-name>" | jq -er .id)
bws secret create JWT_SECRET "$(openssl rand -base64 48)" "$BWS_PROJECT_ID" >/dev/null
bws secret create JWT_REFRESH_SECRET "$(openssl rand -base64 48)" "$BWS_PROJECT_ID" >/dev/null
BWS_SHARED_PROJECT_ID=$(bws project list | jq -er '.[] | select(.name == "senpli") | .id')
bws secret list "$BWS_PROJECT_ID" | jq -r '.[].key'   # JWT_REFRESH_SECRET, JWT_SECRET
```

**Ne pas créer `DATABASE_URL` dans BSM à ce stade** : c'est l'URL de production, elle naît avec `/vibe-stack:deploy`. En dev, `bin/dev` la construit depuis `.flow/project.json`.

### 5. Base et ports de dev (portal de local-services)

Le portal est la seule autorité sur les ports : il les attribue une fois et pour de bon, crée la base (avec `pgvector`) et route `<project-name>.localhost` / `api.<project-name>.localhost`.

```bash
curl -s -X POST http://localhost:4000/api/projects \
  -H 'content-type: application/json' \
  -d '{"name":"<project-name>","db_type":"postgres"}' | jq '.project | {db_name, backend_port, frontend_port}'
```

Deux vérifications, parce que le portal ne remonte pas ces erreurs :
- **la base existe** : `docker exec local-postgres psql -U postgres -lqt | cut -d'|' -f1 | grep -qw <db-name> && echo ok` ;
- **les ports sont réellement libres** : `netstat -an | grep -E '\.(<backend_port>|<frontend_port>) .*LISTEN'` doit ne rien rendre. Pas `lsof` : sans privilèges, il ne voit pas les daemons système — le portal a déjà proposé 8021, tenu par l'un d'eux en loopback. Le portal ne connaît que ses propres attributions ; si un port est pris, en réattribuer un via `PATCH http://localhost:4000/api/projects/<id>` (`{"backend_port": …, "frontend_port": …}`).

**Portal injoignable** : créer la base à la main (`docker exec local-postgres psql -U postgres -c 'CREATE DATABASE <db-name>'`), choisir deux ports libres hors des plages déjà prises par les autres projets, et le signaler à l'utilisateur.

### 6. `.flow/project.json`

```json
{
  "id": "<project-name>",
  "name": "<project-name>",
  "stack": "vibe-stack",
  "bws": {
    "project_id": "<BWS_PROJECT_ID>",
    "shared_project_id": "<BWS_SHARED_PROJECT_ID>"
  },
  "dev": {
    "database": "<db-name>",
    "backend_port": <backend_port>,
    "frontend_port": <frontend_port>
  }
}
```

### 7. `.flow/vibe-stack-lock.json`

Renseigner le commit de `flow-core` **sur GitHub** — c'est lui que le template a copié. Ni le HEAD du projet (ses commits sont différents), ni celui de `~/Dev/vibe-stack` (qui peut être en avance ou en retard sur `main`) :

```bash
gh api repos/vibe-flow/flow-core/commits/main -q .sha
```

```json
{
  "core": {
    "commit": "<sha>",
    "date": "<date du jour YYYY-MM-DD>"
  },
  "modules": {}
}
```

### 8. Installer, migrer, seeder

```bash
bun install
bin/dev bunx prisma migrate dev --name init   # crée prisma/migrations/<date>_init
bin/dev bunx prisma db seed                   # prisma.seed → bun prisma/seed.ts
```

`prisma/migrations` du template ne contient qu'un `.gitkeep` : la migration initiale naît ici et se commite. La base ayant été créée par le portal, `migrate dev` ne lance pas le seed de lui-même — d'où la seconde commande.

### 9. Vérifier le lancement

```bash
bin/dev   # en arrière-plan
curl -sf http://localhost:<backend_port>/api/health
curl -sf -o /dev/null http://localhost:<frontend_port>/ && echo web ok
```

Les deux doivent répondre **sur les ports de `.flow/project.json`**. Vite est en `strictPort` : si un port est pris, le démarrage échoue au lieu de glisser sur le suivant — revenir à l'étape 5. Arrêter les serveurs ensuite.

Connexion : bouton de connexion de dev sur la page de login, ou `admin@example.com` (seed).

### 10. Commit d'initialisation

> **Modèle trunk-based** : `main` est la seule branche longue, commit direct autorisé.

Le dépôt sort du clone : tout ce que montre `git status` vient de cette procédure. Le relire (aucun `.env*`, aucun `dist/`), puis :

```bash
git add -A
git commit -m "chore: init project <project-name> from flow-core template"
git push
```

## Vérification finale

- [ ] `git grep -n "template-dev"` ne rend rien
- [ ] `.flow/project.json` : `id`, `name`, `bws.project_id`, `bws.shared_project_id`, `dev.*` renseignés
- [ ] `.flow/vibe-stack-lock.json` : commit de `vibe-flow/flow-core` sur `main`
- [ ] aucun fichier `.env*` dans le projet
- [ ] `prisma/migrations/<date>_init/migration.sql` commité
- [ ] `bin/dev` démarre API et web sur les ports attribués, `/api/health` répond

## Erreurs courantes

| Problème | Solution |
|----------|----------|
| `bin/dev : pas de base de dev dans .flow/project.json` | Étape 6 non faite : renseigner `dev.database` |
| `BWS_ACCESS_TOKEN manquant` | Le token vit dans `~/.zshrc` ; relancer depuis un shell qui l'a chargé |
| `Invalid environment variables` … `JWT_SECRET` | Secrets absents du projet BSM, ou mauvais `bws.project_id` (étape 4) |
| `P1001 Can't reach database server` | `local-postgres` arrêté, ou une `DATABASE_URL` de production exportée dans le shell |
| `Port … is already in use` (Vite ou API) | Un autre projet ou un dev server oublié tient le port : l'arrêter, ou réattribuer au portal (étape 5) |
| `prisma db seed` ne fait rien | `package.json` sans clé `prisma.seed` (projet créé avant l'ajout au template) : `bin/dev bun prisma/seed.ts` |
