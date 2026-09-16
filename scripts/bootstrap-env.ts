#!/usr/bin/env bun
// @ts-nocheck -- script standalone execute par bun, pas type-check
// Hook SessionStart: bootstrap un .env local (gitignore) avec les defaults dev.
//
// Idempotent : si .env existe deja, on n'ecrase pas les valeurs deja definies.
// Les defaults sont inline ici (plus besoin de .env.example versionne dans le repo).
//
// Convention : le repo ne contient jamais de .env* versionne. Les vrais secrets
// vivent dans Bitwarden Secret Manager (BSM), pas ici. Ce hook genere uniquement
// des valeurs de dev qui n'ont pas vocation a aller en prod.
//
// PLUS D'ALLOCATION DE PORTS. Le hook attribuait auparavant des ports "libres" a
// chaque SessionStart, en reecrivant .env.local et .claude/launch.json. Trois
// raisons de l'avoir retire :
//   - un port occupe par le propre dev server du projet passait pour indisponible,
//     donc le hook en reattribuait un autre SOUS les serveurs en cours -> proxy
//     Vite vers un port mort, instances zombies ;
//   - le hook etait declare deux fois (settings.json + hooks.json du plugin), avec
//     deux copies du script de versions differentes : elles se disputaient le meme
//     .env.local a chaque demarrage, resultat non deterministe ;
//   - et malgre tout ca, l'isolation promise n'etait pas au rendez-vous : cinq
//     projets s'etaient vu attribuer le port 3000, trois le 5174.
// Les ports sont desormais un choix explicite du dev, ecrit une fois dans
// .env.local (et .claude/launch.json), que plus rien ne vient bouger.
//
// Detection projet : early exit si .flow/project.json absent (= pas un projet Vibe Stack).
//
// Early exit aussi si le projet a bin/dev : il compose son environnement a chaque
// lancement (.flow/project.json + projet BSM), sans aucun fichier .env. Ecrire un
// .env ici y serait non seulement inutile mais trompeur : DATABASE_URL pointerait
// sur une base `app` commune a tous les projets. Ce hook ne sert plus qu'aux
// projets anterieurs a bin/dev.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const FLOW_MARKER = join(PROJECT_ROOT, '.flow/project.json')
const ENV = join(PROJECT_ROOT, '.env')

// Defaults dev pour generer .env localement. JWT secrets sont generes aleatoirement
// par session via generateSecret(). Les autres valeurs ciblent les services exposes
// par le repo local-services (Postgres, Redis, LiteLLM, MinIO, Mailpit sur localhost).
const DEV_DEFAULTS: Record<string, string | (() => string)> = {
  DATABASE_URL: '"postgresql://postgres:postgres@localhost:5432/app?schema=public"',
  REDIS_URL: '"redis://localhost:6379"',
  JWT_SECRET: () => `"${generateSecret()}"`,
  JWT_EXPIRES_IN: '"15m"',
  JWT_REFRESH_SECRET: () => `"${generateSecret()}"`,
  JWT_REFRESH_EXPIRES_IN: '"7d"',
  QUEUE_ENABLED: '"false"',
  MAIL_HOST: '"localhost"',
  MAIL_PORT: '"1025"',
  MAIL_FROM: '"noreply@myproject.localhost"',
  VITE_DEV_LOGIN: '"true"',
  // NB: FRONTEND_PORT / BACKEND_PORT / FRONTEND_URL ne sont volontairement PAS ici.
  // Ce sont des valeurs PAR-INSTANCE, choisies une fois par le dev dans .env.local.
  // Les figer aussi dans .env casserait NestJS (ConfigModule : le .env l'emporte sur
  // .env.local pour ces cles) -> l'API ecouterait sur le mauvais port.
}

if (!existsSync(FLOW_MARKER) || existsSync(join(PROJECT_ROOT, 'bin/dev'))) {
  // Pas un projet Vibe Stack, ou projet sans .env (bin/dev) -> on ne touche a rien
  process.exit(0)
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

function getMainRepoRoot(): string | null {
  try {
    const commonDir = execSync('git rev-parse --git-common-dir', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const absCommonDir = isAbsolute(commonDir) ? commonDir : resolve(PROJECT_ROOT, commonDir)
    const mainRoot = dirname(absCommonDir)
    if (resolve(mainRoot) === resolve(PROJECT_ROOT)) return null // pas un worktree
    return mainRoot
  } catch {
    return null
  }
}

function findMainRepoEnv(): string | null {
  const mainRoot = getMainRepoRoot()
  if (!mainRoot) return null
  const mainEnv = join(mainRoot, '.env')
  return existsSync(mainEnv) ? mainEnv : null
}

function generateSecret(): string {
  return randomBytes(32).toString('hex') // 64 chars hex
}

function bootstrapEnv(): number {
  // 1. Si .env n'existe pas dans le worktree, copier celui du repo principal s'il existe
  // (permet aux worktrees de partager les overrides locaux du repo parent par defaut).
  if (!existsSync(ENV)) {
    const mainEnv = findMainRepoEnv()
    if (mainEnv) writeFileSync(ENV, readFileSync(mainEnv))
  }

  // 2. Completer avec les defaults dev (DEV_DEFAULTS, inline ci-dessus).
  const envContent = existsSync(ENV) ? readFileSync(ENV, 'utf-8') : ''
  const envVars = parseEnv(envContent)

  const additions: string[] = []
  for (const [key, defaultValue] of Object.entries(DEV_DEFAULTS)) {
    if (envVars[key] !== undefined) continue // deja defini, on ne touche pas
    const value = typeof defaultValue === 'function' ? defaultValue() : defaultValue
    additions.push(`${key}=${value}`)
  }

  if (additions.length === 0) return 0

  const prefix = envContent === '' || envContent.endsWith('\n') ? '' : '\n'
  const block = `\n# Auto-generated by vibe-stack hook (${new Date().toISOString()})\n${additions.join('\n')}\n`
  writeFileSync(ENV, envContent + prefix + block)
  return additions.length
}

const added = bootstrapEnv()
if (added > 0) console.log(`Vibe Stack: ${added} defaults dev ajoutes a .env`)
