#!/usr/bin/env bun
// @ts-nocheck -- script standalone execute par bun, pas type-check
// Hook SessionStart: alloue des ports dev libres pour chaque projet/worktree Vibe Stack
// et bootstrap un .env local (gitignore) avec les defaults dev.
//
// Idempotent : si .env existe deja, on n'ecrase pas les valeurs deja definies.
// Les defaults sont inline ici (plus besoin de .env.example versionne dans le repo).
//
// Convention : le repo ne contient jamais de .env* versionne. Les vrais secrets
// vivent dans Bitwarden Secret Manager (BSM), pas ici. Ce hook genere uniquement
// des valeurs de dev qui n'ont pas vocation a aller en prod.
//
// Detection projet : early exit si .flow/project.json absent (= pas un projet Vibe Stack).

import { createServer } from 'node:net'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const FLOW_MARKER = join(PROJECT_ROOT, '.flow/project.json')
const ENV = join(PROJECT_ROOT, '.env')
const ENV_LOCAL = join(PROJECT_ROOT, '.env.local')
const LAUNCH_JSON = join(PROJECT_ROOT, '.claude/launch.json')

const FRONTEND_DEFAULT = 5173
const BACKEND_DEFAULT = 3000

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
  FRONTEND_PORT: '"5173"',
  BACKEND_PORT: '"3000"',
  MAIL_HOST: '"localhost"',
  MAIL_PORT: '"1025"',
  MAIL_FROM: '"noreply@myproject.localhost"',
  FRONTEND_URL: '"http://localhost:5173"',
  VITE_DEV_LOGIN: '"true"',
}

if (!existsSync(FLOW_MARKER)) {
  // Pas un projet Vibe Stack -> on ne touche a rien
  process.exit(0)
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

async function findFreePort(start: number, exclude: Set<number>): Promise<number> {
  let p = start
  while (exclude.has(p) || !(await isFree(p))) p++
  return p
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

function upsertEnv(content: string, updates: Record<string, string>): string {
  const lines = content.split('\n')
  const seen = new Set<string>()
  const next = lines.map((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=/)
    if (m && updates[m[1]] !== undefined) {
      seen.add(m[1])
      return `${m[1]}=${updates[m[1]]}`
    }
    return line
  })
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) next.push(`${k}=${v}`)
  }
  return next.join('\n').replace(/\n+$/, '') + '\n'
}

async function pickPort(
  current: number,
  fallbackStart: number,
  exclude: Set<number>
): Promise<number> {
  if (current && !exclude.has(current) && (await isFree(current))) return current
  return findFreePort(fallbackStart, exclude)
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

function bootstrapEnv(): void {
  // 1. Si .env n'existe pas dans le worktree, copier celui du repo principal s'il existe
  // (permet aux worktrees de partager les overrides locaux du repo parent par defaut).
  if (!existsSync(ENV)) {
    const mainEnv = findMainRepoEnv()
    if (mainEnv) writeFileSync(ENV, readFileSync(mainEnv))
  }

  // 2. Completer avec les defaults dev (DEV_DEFAULTS, inline ci-dessus).
  // Aucune dependance a un fichier versionne dans le repo.
  const envContent = existsSync(ENV) ? readFileSync(ENV, 'utf-8') : ''
  const envVars = parseEnv(envContent)

  const additions: string[] = []
  for (const [key, defaultValue] of Object.entries(DEV_DEFAULTS)) {
    if (envVars[key] !== undefined) continue // deja defini, on ne touche pas
    const value = typeof defaultValue === 'function' ? defaultValue() : defaultValue
    additions.push(`${key}=${value}`)
  }

  if (additions.length === 0) return

  const prefix = envContent === '' || envContent.endsWith('\n') ? '' : '\n'
  const block = `\n# Auto-generated by vibe-stack hook (${new Date().toISOString()})\n${additions.join('\n')}\n`
  writeFileSync(ENV, envContent + prefix + block)
}

async function main() {
  bootstrapEnv()

  const existingContent = existsSync(ENV_LOCAL) ? readFileSync(ENV_LOCAL, 'utf-8') : ''
  const existing = parseEnv(existingContent)

  const isWorktree = getMainRepoRoot() !== null

  let frontendPort: number
  let backendPort: number

  if (isWorktree) {
    // Worktree : isoler sur des ports libres pour ne pas entrer en conflit avec
    // les autres worktrees ou le repo principal.
    const currentFrontend = parseInt(existing.FRONTEND_PORT ?? '0', 10) || 0
    const currentBackend = parseInt(existing.BACKEND_PORT ?? '0', 10) || 0
    frontendPort = await pickPort(currentFrontend, FRONTEND_DEFAULT, new Set([currentBackend]))
    backendPort = await pickPort(currentBackend, BACKEND_DEFAULT, new Set([frontendPort]))
  } else {
    // Repo principal : toujours utiliser les ports de base, sans scanner.
    // Plusieurs sessions Claude Code sur le repo principal partagent ces ports
    // (une seule fait tourner le dev server a la fois).
    frontendPort = FRONTEND_DEFAULT
    backendPort = BACKEND_DEFAULT
  }

  const updates: Record<string, string> = {
    FRONTEND_PORT: String(frontendPort),
    BACKEND_PORT: String(backendPort),
    FRONTEND_URL: `http://localhost:${frontendPort}`,
  }
  const nextContent = upsertEnv(existingContent, updates)
  if (nextContent !== existingContent) writeFileSync(ENV_LOCAL, nextContent)

  mkdirSync(dirname(LAUNCH_JSON), { recursive: true })

  let launch: { version: string; configurations: Array<Record<string, unknown>> } = {
    version: '0.0.1',
    configurations: [],
  }
  if (existsSync(LAUNCH_JSON)) {
    try {
      const parsed = JSON.parse(readFileSync(LAUNCH_JSON, 'utf-8'))
      launch = {
        version: typeof parsed?.version === 'string' ? parsed.version : '0.0.1',
        configurations: Array.isArray(parsed?.configurations) ? parsed.configurations : [],
      }
    } catch {
      // launch.json corrompu : on repart d'un launch vide
    }
  }

  const managed = new Set(['web', 'api'])
  const preserved = launch.configurations.filter((c) => !managed.has(c?.name as string))

  launch.configurations = [
    ...preserved,
    {
      name: 'web',
      runtimeExecutable: 'bun',
      runtimeArgs: ['run', 'dev:web'],
      port: frontendPort,
    },
    {
      name: 'api',
      runtimeExecutable: 'bun',
      runtimeArgs: ['run', 'dev:api'],
      port: backendPort,
    },
  ]

  writeFileSync(LAUNCH_JSON, JSON.stringify(launch, null, 2) + '\n')

  console.log(`Vibe Stack ports: web=${frontendPort}, api=${backendPort}`)
}

main()
