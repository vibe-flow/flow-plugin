---
name: hotfix
description: Hotfix tag-based — branche depuis le dernier tag prod, applique le fix, bump patch + nouveau tag
argument-hint: "[commit-hash]"
disable-model-invocation: true
---

# Hotfix

Crée une release de patch urgente sans embarquer les commits non-finalisés de `main`.

> **Cas d'usage** : un bug critique en prod alors que `main` contient déjà du code WIP qu'on ne veut pas déployer. On branche depuis le dernier tag, on applique uniquement le fix, on tag une nouvelle release patch.

## Dynamic context

- Branche courante : !`git branch --show-current`
- Working tree clean : !`git status --porcelain | wc -l | tr -d ' '` (0 = clean)
- Dernier tag : !`git describe --tags --abbrev=0 2>/dev/null || echo "aucun tag"`
- Version actuelle prod (depuis tag) : !`git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo "N/A"`
- 10 derniers commits main : !`git log main --oneline -10 2>/dev/null`

## Step 0 : Pré-requis

1. **Working tree clean** : si non, demander de stash ou annuler via `AskUserQuestion`.
2. **Au moins un tag `v*` existant** : sinon, c'est une release initiale → renvoyer vers `/release`.
3. **Fetch origin** : `git fetch origin --tags`.

Garder en mémoire `ORIGINAL_BRANCH = git branch --show-current` pour revenir à la fin.

## Step 1 : Choisir le mode de hotfix

Demander via `AskUserQuestion` :

- **Cherry-pick un commit déjà sur `main`** (Recommandé)
  Le fix a déjà été poussé sur `main` (workflow normal feature/fix → PR → merge). On cherry-pick juste ce commit dans la branche hotfix.
- **Hotfix en partant du tag** (fix urgent, on code dans la branche hotfix)
  Le fix n'existe pas encore. On part du tag, on crée la branche, l'utilisateur code, on continue.

## Step 2 : Identifier le commit à cherry-pick (mode 1 seulement)

Si `$ARGUMENTS` contient un hash, l'utiliser. Sinon :

```bash
git log main --oneline -15
```

Demander via `AskUserQuestion` quel commit cherry-pick. Proposer les 3-4 derniers `fix:` en tête de liste, avec une option "Autre" pour saisir un hash manuellement.

## Step 3 : Créer la branche hotfix depuis le dernier tag

```bash
LAST_TAG=$(git describe --tags --abbrev=0)
SLUG=<demander à l'utilisateur ou dériver du commit cherry-pické : ex "fix-csrf-bug">

git checkout -b hotfix/$SLUG $LAST_TAG
```

## Step 4 : Appliquer le fix

**Mode 1 (cherry-pick)** :
```bash
git cherry-pick <commit-hash>
```
Si conflit :
- Afficher les fichiers en conflit.
- Demander via `AskUserQuestion` : "Résoudre manuellement et continuer, ou annuler ?"
- Si annuler : `git cherry-pick --abort && git checkout $ORIGINAL_BRANCH && git branch -D hotfix/$SLUG`.

**Mode 2 (code manuel)** :
- Dire à l'utilisateur : "Tu peux faire ton fix maintenant. Je continue quand tu me dis 'go'."
- Attendre que l'utilisateur ait commit son fix dans la branche hotfix.

## Step 5 : Bump version patch + tag

```bash
# Parser LAST_TAG vX.Y.Z et calculer NEW_VERSION = X.Y.(Z+1)
CURRENT=${LAST_TAG#v}
NEW_VERSION=<bump patch>

# Update package.json (racine)
sed -i.bak 's/"version": *"[^"]*"/"version": "'"$NEW_VERSION"'"/' package.json && rm package.json.bak

# Commit + tag
git add package.json
git commit -m "chore(release): v$NEW_VERSION

Hotfix: <description courte du fix>"

git tag -a v$NEW_VERSION -m "Hotfix v$NEW_VERSION

<liste des commits inclus depuis $LAST_TAG>"
```

## Step 6 : Confirmer et pusher

Via `AskUserQuestion` :
```
Hotfix v{NEW_VERSION}
─────────────────────
Depuis :     {LAST_TAG}
Branche :    hotfix/{SLUG}
Commits :    {N} (incl. le fix)
Workflow :   .github/workflows/deploy.yml sera déclenché par le tag

Confirmer le push ?
```

Si confirmé :
```bash
git push origin hotfix/$SLUG       # traçabilité de la branche
git push origin v$NEW_VERSION       # déclenche le workflow prod
```

## Step 7 : Merger hotfix sur main (pour ne pas perdre le fix dans la prochaine release)

**Important** : sans ce merge, le fix existe sur le tag mais pas sur `main` → il sera "perdu" à la prochaine release.

```bash
git checkout main
git pull origin main
git merge --no-ff hotfix/$SLUG -m "merge: hotfix v$NEW_VERSION dans main"
git push origin main
```

Si conflit (parce que main a évolué depuis le tag) :
- Afficher les conflits.
- `AskUserQuestion` : résoudre manuellement, ou abandonner le merge (le fix reste sur le tag uniquement, à merger plus tard).

## Step 8 : Monitor le workflow

```bash
gh run list --workflow=deploy.yml --limit=3
gh run watch <run-id>
```

Si succès : afficher le résumé final.
Si échec :
- `gh run view <run-id> --log-failed`
- Proposer `kamal rollback` (revient au tag précédent).

## Step 9 : Cleanup et retour

```bash
git checkout $ORIGINAL_BRANCH
git branch -d hotfix/$SLUG   # local
# La branche reste sur origin pour traçabilité, à toi de la nettoyer plus tard
```

## Step 10 : Résumé final

```
Hotfix v{NEW_VERSION} — terminé
────────────────────────────────
Depuis :       {LAST_TAG}
Vers :         v{NEW_VERSION}
Fix :          <hash> <message>
Mergé sur :    main (oui / conflit à résoudre)
Workflow :     {passed/failed}
URL :          https://github.com/{owner}/{repo}/releases/tag/v{NEW_VERSION}
```

## Règles importantes

- **TOUJOURS** revenir à la branche d'origine à la fin (même en cas d'erreur — bloc cleanup).
- **TOUJOURS** merger le hotfix sur `main` après le push du tag (sinon le fix est perdu).
- **NE JAMAIS** `--force` un push de tag (`v{NEW_VERSION}` est immutable).
- Si le cherry-pick échoue ou si le merge sur main est conflictuel, **proposer d'annuler proprement** plutôt que de tenter une résolution risquée à chaud.
- Le tag de hotfix est toujours un `patch` bump (X.Y.Z → X.Y.Z+1). Pour un fix qui demande un minor ou major, c'est `/release`, pas `/hotfix`.

## Arguments

- `commit-hash` (optionnel) — hash du commit à cherry-pick (mode 1)
