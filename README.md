# vibe-stack-plugin

Plugin [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) packageant l'écosystème de développement **vibe-stack** : skills, slash commands et conventions partagées pour les projets utilisant la stack Bun + NestJS + React/Vite + tRPC + Prisma + Zod.

## Installation

```bash
# Ajouter le marketplace
claude plugin marketplace add vibe-flow/vibe-stack-plugin

# Installer le plugin
claude plugin install vibe-stack@vibe-stack
```

## Contenu

### Skills

| Skill | Description |
|-------|-------------|
| `sync-vibe-stack` | Synchronise le code template vibe-stack dans un projet existant. |

> Plus de skills à venir : `import-module`, `export-module`, `deploy`, `release`, `init-project`, etc.

## Mise à jour

```bash
claude plugin update vibe-stack@vibe-stack
```

## Développement local

```bash
git clone git@github.com:vibe-flow/vibe-stack-plugin.git
cd vibe-stack-plugin

# Installer en mode local (pour tester)
claude plugin marketplace add .
claude plugin install vibe-stack@vibe-stack
```

## Licence

MIT — voir [LICENSE](LICENSE).
