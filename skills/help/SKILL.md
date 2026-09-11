---
name: help
description: Use when the user asks for help about the vibe-stack plugin, wants to list available skills, or asks "qu'est-ce que ce plugin fait", "vibe-stack help", "/help vibe-stack", or any equivalent. Displays the plugin overview, available skills, upcoming features and useful links.
disable-model-invocation: true
---

# Plugin vibe-stack — Aide

Plugin Claude Code packageant l'écosystème de développement **vibe-stack** : skills, slash commands et conventions partagées pour les projets utilisant la stack Bun + NestJS + React/Vite + tRPC + Prisma + Zod.

## Skills disponibles

### Workflow projet

- **`vibe-stack:init-project`** — Bootstrap d'un nouveau projet depuis le template vibe-stack.
- **`vibe-stack:import-module`** — Importer un module réutilisable depuis `~/Dev/vibe-stack-modules/`.
- **`vibe-stack:export-module`** — Extraire une feature d'un projet vers un module réutilisable.
- **`vibe-stack:sync-vibe-stack`** — Synchroniser le code template et les modules vers le projet courant. Met aussi à jour la section conventions du CLAUDE.md projet.
- **`vibe-stack:upstream-vibe-stack`** — Remonter une amélioration vers le template vibe-stack ou vibe-stack-modules.

### Déploiement

- **`vibe-stack:deploy`** — Mettre un projet en ligne : prépare la config à la première mise en ligne, puis délègue tout à `bin/deploy`.
- **`vibe-stack:release`** — Diff dev/prod, merge vers prod et déploiement.
- **`vibe-stack:hotfix`** — Cherry-pick d'un commit vers la branche de production et déploiement.

### Git

- **`vibe-stack:commit`** — Commit git intelligent : analyse les diffs, nettoie le code, découpe en commits logiques avec Conventional Commits. Gère les mono-repos et dossiers multi-repos.

### Maintenance du template

- **`vibe-stack:release-vibe-stack`** — Publier une nouvelle version du template vibe-stack avec tag git, notes et instructions d'intégration.

### Aide

- **`vibe-stack:help`** — Cette aide.

## Liens

- Repo plugin : https://github.com/vibe-flow/vibe-stack-plugin
- Repo template : https://github.com/vibe-flow/vibe-stack
- Repo modules : https://github.com/vibe-flow/vibe-stack-modules

## Instructions

Affiche directement le contenu ci-dessus à l'utilisateur, formaté en markdown lisible. Ne pas exécuter d'autre action.
