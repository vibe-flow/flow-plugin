---
name: init-project
description: Use when creating a new project from the vibe-stack template. Triggers on requests to start, init, scaffold, or bootstrap a new project.
disable-model-invocation: true
argument-hint: "<project-name>"
---

# Init Project

Initialise un nouveau projet a partir du template vibe-stack GitHub.

## Prerequis

- `gh` CLI authentifie
- Acces au repo template vibe-stack sur GitHub

## Process

### 1. Determiner le nom du projet et l'organisation

Utiliser `` si fourni, sinon demander :
- Nom du projet (kebab-case, ex: `mon-app`)
- Organisation GitHub ou compte personnel (ex: `vibe-flow`, ou vide pour le compte par defaut)

### 2. Creer le repo depuis le template

Si une organisation est specifiee :
```bash
gh repo create <org>/<project-name> --template <owner>/vibe-stack --private --clone
cd <project-name>
```

Sinon (compte personnel) :
```bash
gh repo create <project-name> --template <owner>/vibe-stack --private --clone
cd <project-name>
```

> **Note** : Determiner `<owner>` depuis le template : !`cd ~/Dev/vibe-stack && gh repo view --json owner -q '.owner.login' 2>/dev/null || echo "OWNER_INCONNU"`

### 3. Renommer le projet

Remplacer `template-dev` par `<project-name>` dans tous les fichiers :

**package.json (x4)** :
- `package.json` : champ `name` + tous les `--filter=@template-dev/*`
- `apps/api/package.json` : champ `name` + dependance `@template-dev/shared`
- `apps/web/package.json` : champ `name` + dependance `@template-dev/shared`
- `packages/shared/package.json` : champ `name`

**tsconfig** :
- `apps/web/tsconfig.json` : paths `@template-dev/shared`

**Imports TypeScript** :
- Tous les `from '@template-dev/shared'` → `from '@<project-name>/shared'`
- Chercher dans `apps/api/src/` et `apps/web/src/`

**Commande rapide** pour trouver tous les fichiers :
```bash
grep -r "template-dev" --include="*.json" --include="*.ts" --include="*.tsx" -l .
```

### 4. Mettre a jour `.flow/project.json`

```json
{
  "id": "",
  "name": "<project-name>",
  "stack": "vibe-stack"
}
```

### 5. Mettre a jour `.flow/vibe-stack-lock.json`

Renseigner le commit HEAD actuel du repo (celui du template au moment du clone) :

```json
{
  "core": {
    "commit": "<HEAD commit hash>",
    "date": "<date du jour YYYY-MM-DD>"
  },
  "modules": {}
}
```

Obtenir le hash depuis le repo source (pas le projet courant, dont les commits sont differents) : `git -C ~/Dev/vibe-stack rev-parse HEAD`

### 6. Mettre a jour `.env.example`

- `DATABASE_URL` : remplacer `app` par `<project-name>` dans le nom de la base
- `S3_BUCKET` : remplacer `myproject` par `<project-name>`
- `MAIL_FROM` : remplacer `myproject` par `<project-name>`

### 7. Mettre a jour le frontend

- `apps/web/index.html` : mettre a jour le `<title>` avec le nom du projet (remplacer "Vibe Stack")
- `apps/web/index.html` : mettre a jour la `<meta name="description">` si presente
- `apps/web/src/components/layout/AppLayout.tsx` : remplacer "Vibe Stack" par le nom du projet dans le logo sidebar
- `apps/web/src/pages/DashboardPage.tsx` : remplacer "Vibe Stack" par le nom du projet dans le titre h1

### 8. Mettre a jour les fichiers projet

- `README.md` : remplacer le titre par le nom du projet
- `CLAUDE.md` : remplacer `[Nom du projet]` par le nom du projet

### 9. Setup environnement

```bash
cp .env.example .env
```

Generer et remplacer les JWT secrets dans `.env` :
```bash
JWT_SECRET=$(openssl rand -base64 32)
JWT_REFRESH_SECRET=$(openssl rand -base64 32)
```

Mettre a jour `DATABASE_URL`, `S3_BUCKET`, `MAIL_FROM` dans `.env` avec le nom du projet (comme pour `.env.example`).

### 10. Installer et initialiser

```bash
bun install
bunx prisma migrate dev --name init
bunx prisma db seed
```

### 11. Commit d'initialisation

> **Modèle trunk-based** : `main` est la seule branche longue, commit direct autorisé. Pas de branche `develop`.

```bash
git add -A
git commit -m "chore: init project <project-name> from vibe-stack template"
git push
```

### 12. Verification finale

- [ ] `bun run dev` demarre sans erreur
- [ ] Aucune reference a `template-dev` restante : `grep -r "template-dev" --include="*.ts" --include="*.tsx" --include="*.json" .`
- [ ] `.flow/project.json` contient le bon nom

## Erreurs courantes

| Probleme | Solution |
|----------|----------|
| `gh: not found` | Installer GitHub CLI : `brew install gh && gh auth login` |
| Template non trouve | Verifier le nom du repo template et les permissions |
| Prisma migrate echoue | Verifier que PostgreSQL tourne dans local-services |
| Imports casses apres renommage | Verifier `bun.lock` supprime et relancer `bun install` |
