---
name: commit
description: Commit git intelligent — analyse les diffs, nettoie le code, decoupe en commits logiques avec Conventional Commits. Gere les mono-repos et dossiers multi-repos.
argument-hint: "[message optionnel]"
disable-model-invocation: true
---

# Commit intelligent

IMPORTANT : Toujours repondre et communiquer en francais avec l'utilisateur.

Analyse le diff git, nettoie le code, decoupe en commits logiques et cree les commits en suivant les Conventional Commits.

## Etape 0 — Detection des repos git

Avant toute chose, determiner la structure git du repertoire courant :

1. Verifier si le repertoire courant est un repo git (`git rev-parse --git-dir`)
2. Si NON, chercher les sous-repertoires contenant un `.git` (1 niveau de profondeur max)
3. Si des sous-repos sont trouves, executer les etapes 1 a 5 pour CHAQUE sous-repo independamment, en indiquant clairement dans quel repo on travaille
4. Si aucun repo git n'est trouve, informer l'utilisateur et arreter

## Etape 0b — Gestion des branches protegees

Apres detection du repo, verifier si la branche courante est protegee :

1. Recuperer la branche courante : `git branch --show-current`
2. Si la branche est `main` ou `master` :
   - Creer une branche temporaire : `git checkout -b quick/<scope-ou-description>`
   - Le nom est derive du scope principal des changements detectes (ex: `quick/fix-typo`, `quick/config-update`)
   - Informer l'utilisateur : "Branche protegee detectee, creation de `quick/xxx` pour les commits."
   - Stocker le nom de la branche d'origine pour l'etape 5b
3. Si la branche n'est PAS protegee, continuer normalement

## Etape 1 — Analyse du diff

Pour chaque repo git detecte :

1. Executer `git status` (sans `-uall`) pour voir l'etat global
2. Executer `git diff` (staged + unstaged) pour voir les modifications
3. Executer `git diff --cached` pour voir ce qui est deja stage
4. Lister les fichiers non-tracked avec `git ls-files --others --exclude-standard`
5. Lire le contenu des fichiers modifies/ajoutes pour comprendre les changements en detail
6. Consulter `git log --oneline -10` pour voir le style de commit existant

## Etape 2 — Nettoyage du code

Avant de committer, scanner les fichiers modifies/ajoutes pour detecter :

- `console.log`, `console.debug`, `console.warn` oublies (hors fichiers de config/logging)
- Commentaires de debug temporaires (`// TODO: remove`, `// test`, `// debug`, `// FIXME`, `// HACK`, `// temp`)
- Code commente qui devrait etre supprime
- Imports inutilises (non references dans le fichier)
- Variables declarees mais non utilisees
- Fichiers `.env`, credentials ou secrets qui ne devraient pas etre commites
- Incoherences evidentes (fonctions dupliquees, typos dans les noms, etc.)

**Si des problemes sont detectes**, presenter la liste a l'utilisateur via `AskUserQuestion` :

- Pour chaque probleme, indiquer le fichier, la ligne et le type
- Proposer les options : "Nettoyer tout", "Choisir lesquels nettoyer", "Ignorer et continuer"
- Si l'utilisateur veut nettoyer, effectuer les corrections AVANT de passer aux commits

**Si aucun probleme n'est detecte**, passer directement a l'etape 3.

## Etape 3 — Decoupage en commits

Analyser les changements et proposer un decoupage logique en commits separes :

### Criteres de decoupage

- **Par fonctionnalite** : chaque feature/fix/refacto = 1 commit
- **Par scope** : changements sur des modules differents = commits separes
- **Dependances** : les changements de schema/migration AVANT les changements de code qui en dependent
- **Config** : les changements de config/deps separes du code applicatif

### Format Conventional Commits

```
type(scope): description concise en minuscules

[corps optionnel — explique le "pourquoi" si necessaire]
```

**Types disponibles** :
- `feat` : nouvelle fonctionnalite
- `fix` : correction de bug
- `refactor` : refactorisation sans changement de comportement
- `chore` : maintenance, deps, config
- `docs` : documentation
- `style` : formatage, espaces, points-virgules
- `perf` : amelioration de performance
- `test` : ajout ou correction de tests
- `ci` : changements CI/CD
- `build` : systeme de build, deps externes

**Scope** : module ou zone affectee (`api`, `web`, `prisma`, `auth`, `invoices`, etc.)

**Regles** :
- Description en minuscules, sans point final
- Description en francais, imperatif present (ex: "ajout du systeme de connecteurs", "correction du bug de synchro")
- Max 72 caracteres pour la premiere ligne
- Si l'utilisateur a fourni un `$ARGUMENTS`, l'utiliser comme base pour le message

### Presentation du plan

Presenter le plan de commits a l'utilisateur via `AskUserQuestion` sous cette forme :

Pour chaque commit propose :
- Le message de commit complet
- La liste des fichiers concernes
- Un resume de ce que le commit contient

Options : "Valider et executer", "Modifier les messages", "Fusionner en un seul commit", "Annuler"

## Etape 4 — Execution des commits

Pour chaque commit valide, dans l'ordre :

1. `git add` des fichiers specifiques (JAMAIS `git add -A` ou `git add .`)
2. Creer le commit avec le message valide via heredoc :
   ```bash
   git commit -m "$(cat <<'EOF'
   type(scope): description

   Corps optionnel

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
   ```
3. Verifier que le commit a reussi (`git log -1 --oneline`)
4. Si un hook pre-commit echoue : corriger le probleme et creer un NOUVEAU commit (ne JAMAIS `--amend`)

## Etape 5 — Merge et retour sur la branche protegee

Si une branche temporaire a ete creee a l'etape 0b :

1. Revenir sur la branche d'origine : `git checkout main`
2. Merger en fast-forward : `git merge --ff-only quick/xxx`
3. Supprimer la branche temporaire : `git branch -d quick/xxx`
4. Si le fast-forward echoue (branche a diverge), informer l'utilisateur et ne PAS forcer

Si aucune branche temporaire n'a ete creee, passer directement au resume.

## Etape 6 — Resume final

Afficher un resume de tous les commits crees :

```
Repo : nom-du-repo (branche: main)
  abc1234 feat(api): ajout du systeme de connecteurs
  def5678 chore(prisma): ajout migration connecteurs
  ghi9012 refactor(pennylane): extraction de la logique connecteur
```

Si une branche temporaire a ete utilisee, l'indiquer dans le resume :
```
Branche temporaire quick/xxx creee, mergee en fast-forward et supprimee.
```

Si plusieurs repos ont ete traites, afficher le resume pour chacun.

## Regles importantes

- **JAMAIS** `git add -A` ou `git add .` — toujours ajouter les fichiers par nom
- **JAMAIS** `--amend` sauf demande explicite de l'utilisateur
- **JAMAIS** `--no-verify` — si un hook echoue, corriger le probleme
- **JAMAIS** push automatiquement — le push est une action separee
- **TOUJOURS** utiliser `AskUserQuestion` pour les validations (pas de texte libre)
- **TOUJOURS** verifier que les fichiers sensibles (.env, credentials) ne sont pas inclus
- **TOUJOURS** ajouter `Co-Authored-By: Claude <noreply@anthropic.com>` en derniere ligne du message
