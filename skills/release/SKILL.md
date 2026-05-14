---
name: release
description: Release tag-based — bump la version, crée un tag vX.Y.Z, push pour déclencher le déploiement prod
argument-hint: "[patch|minor|major]"
disable-model-invocation: true
---

# Release

Crée une nouvelle release sémantique de production. Le workflow Kamal en CI se déclenche sur push de tag `v*`.

> **Modèle trunk-based** : pas de branche `develop`. `main` est la seule branche longue.
> Une release = un commit `chore(release): vX.Y.Z` qui bump la version + un tag `vX.Y.Z`.

## Dynamic context

- Branche courante : !`git branch --show-current`
- Working tree clean : !`git status --porcelain | wc -l | tr -d ' '` (0 = clean)
- Dernier tag : !`git describe --tags --abbrev=0 2>/dev/null || echo "aucun tag"`
- Commits depuis dernier tag : !`git log $(git describe --tags --abbrev=0 2>/dev/null)..HEAD --oneline 2>/dev/null | wc -l | tr -d ' '`
- Version package.json : !`grep -o '"version": *"[^"]*"' package.json 2>/dev/null | head -1 | cut -d'"' -f4 || echo "N/A"`

## Step 0 : Pré-requis

Vérifier dans l'ordre :

1. **Branche `main`** : si on n'est pas sur `main`, demander à l'utilisateur via `AskUserQuestion` :
   - Checkout main et continuer
   - Annuler
2. **Working tree clean** : si des changements non-commités, demander :
   - Stash, release, unstash
   - Annuler (l'utilisateur commit/stash lui-même)
3. **À jour avec origin** : `git fetch origin && git status -sb`
   - Si en retard : `git pull --ff-only origin main`
   - Si en avance : OK, le push poussera tout
4. **`package.json` existe avec une `"version"` valide** : sinon, demander à l'utilisateur la version courante via `AskUserQuestion`.

## Step 1 : Afficher le delta depuis le dernier tag

```bash
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
  git log $LAST_TAG..HEAD --oneline
  git diff $LAST_TAG..HEAD --stat
else
  git log --oneline -20
fi
```

Présenter un résumé clair :
```
Release — delta depuis ${LAST_TAG:-début}
─────────────────────────────────────────
Commits :  N
Fichiers : M

Commits inclus :
  abc1234 feat(xxx): ...
  def5678 fix(yyy): ...
  ...
```

## Step 2 : Choisir le type de bump

Si `$ARGUMENTS` contient `patch`, `minor` ou `major` → l'utiliser directement.

Sinon, demander via `AskUserQuestion` (4 options, recommander en fonction du delta) :
- **patch** (vX.Y.Z+1) — corrections de bugs, aucun changement d'API. *Recommandé si les commits sont majoritairement `fix:` ou `chore:`*.
- **minor** (vX.Y+1.0) — nouvelles fonctionnalités, rétro-compatible. *Recommandé si présence de `feat:`*.
- **major** (vX+1.0.0) — breaking changes. *Recommandé si présence de `feat!:` ou `BREAKING CHANGE:`*.
- **Annuler**

Calculer la nouvelle version à partir de la version courante de `package.json` :
```bash
CURRENT=$(grep -o '"version": *"[^"]*"' package.json | head -1 | cut -d'"' -f4)
# Parser X.Y.Z et bumper selon le choix
```

## Step 3 : Confirmer et exécuter

Afficher le résumé final via `AskUserQuestion` :
```
Release v{NEW_VERSION}
──────────────────────
Bump :       {CURRENT} → {NEW_VERSION} ({type})
Commits :    {N} depuis {LAST_TAG}
Workflow :   .github/workflows/deploy.yml sera déclenché par le tag

Confirmer la release ?
```

Si confirmé, dans cet ordre :

1. **Update `package.json`** (racine, monorepo Bun compatible) :
   ```bash
   # Cibler uniquement le package.json racine (pas les workspaces)
   sed -i.bak 's/"version": *"[^"]*"/"version": "{NEW_VERSION}"/' package.json && rm package.json.bak
   ```
2. **Commit** :
   ```bash
   git add package.json
   git commit -m "chore(release): v{NEW_VERSION}"
   ```
3. **Créer le tag annoté** :
   ```bash
   git tag -a v{NEW_VERSION} -m "Release v{NEW_VERSION}

   {liste courte des commits inclus}"
   ```
4. **Push commit ET tag** :
   ```bash
   git push origin main
   git push origin v{NEW_VERSION}
   ```

## Step 4 : Monitor le workflow de déploiement

```bash
gh run list --workflow=deploy.yml --limit=3
```

Trouver le run déclenché par le tag (`event` est `push` et `headBranch` contient `v{NEW_VERSION}`) et le suivre :
```bash
gh run watch <run-id>
```

Si succès : afficher le résumé final.
Si échec :
- `gh run view <run-id> --log-failed`
- Proposer `/hotfix` si fix rapide nécessaire, ou rollback via `kamal rollback`.

## Step 5 : Résumé final

```
Release v{NEW_VERSION} — terminée
──────────────────────────────────
Tag :         v{NEW_VERSION}
Commits :     {N}
Workflow :    {passed/failed}
URL :         https://github.com/{owner}/{repo}/releases/tag/v{NEW_VERSION}
Prod URL :    {depuis config/deploy.yml proxy.host, si disponible}
```

Optionnel : proposer de créer une release GitHub avec auto-generated notes :
```bash
gh release create v{NEW_VERSION} --generate-notes
```

## Règles importantes

- **TOUJOURS** confirmer avant de commit/tag/push (le push de tag est irréversible côté CI).
- **NE JAMAIS** `--force` un push de tag.
- Si l'utilisateur a `deploy.json` legacy avec `environments` (branches dev/prod) : signaler que le nouveau modèle est tag-based, mais respecter le setup existant si l'utilisateur insiste.
- Si le projet n'a pas de `package.json` ou pas de `version` (genre repo de scripts) : demander une version manuelle via `AskUserQuestion`.

## Arguments

- `patch` | `minor` | `major` — skip Step 2, bump directement
