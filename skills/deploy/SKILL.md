---
name: deploy
description: Met en ligne un projet flow sur le serveur flow via Kamal. À la première mise en ligne, pose les quelques questions qui manquent et écrit config/deploy.yml et .kamal/secrets ; ensuite, et à chaque fois, délègue tout le travail à bin/deploy. Utiliser pour déployer, mettre en prod, publier une version d'un projet flow.
argument-hint: "[--api-only|--web-only|--redeploy] [--allow-dirty] [--check]"
disable-model-invocation: true
---

# Deploy

Un seul point d'entrée pour mettre un projet flow en ligne.

> **Ce skill ne sait pas déployer — `bin/deploy` le sait.** Le script vient de flow-core,
> il est identique dans tous les projets et enchaîne build de l'API, migrations, garde-fou
> post-migration, `kamal deploy` et redémarrage. Le skill vérifie seulement que le projet a de
> quoi déployer, comble ce qui manque la première fois, puis appelle le script.
>
> Ne jamais lancer `kamal deploy` directement : il ne fait que la partie web, et laisserait
> l'API sur l'ancienne version sans prévenir.

## Dynamic context

- Projet : !`jq -r '.id // "NOT_FOUND"' .flow/project.json 2>/dev/null || echo NOT_FOUND`
- Plomberie flow-core : !`for f in bin/deploy Dockerfile.web infrastructure/nginx/nginx.conf.template .kamal/hooks/pre-deploy; do test -e "$f" || printf "MANQUE:%s " "$f"; done; echo`
- config/deploy.yml : !`test -f config/deploy.yml && echo EXISTS || echo NOT_FOUND`
- .kamal/secrets : !`test -f .kamal/secrets && echo EXISTS || echo NOT_FOUND`
- Projets Bitwarden : !`jq -c '.bws // "AUCUN"' .flow/project.json 2>/dev/null || echo AUCUN`
- API dans le projet : !`test -d apps/api && echo OUI || echo NON`
- Branche : !`git branch --show-current`
- Arbre de travail : !`git status --porcelain | wc -l | tr -d ' '` fichier(s) modifié(s) ou non suivi(s)

## Step 0 — La plomberie est-elle là ?

Si la ligne « Plomberie flow-core » signale un fichier manquant : **ne rien générer**. Ces
fichiers appartiennent à flow-core ; en écrire une copie dans le projet recréerait exactement la
divergence qu'on a supprimée. Le projet n'est pas synchronisé :

> Il manque la plomberie de déploiement de flow-core. Lance `/vibe-stack:sync-vibe-stack` —
> et si la synchro répond « à jour », c'est qu'aucune release de flow-core ne contient encore
> ces fichiers : il faut d'abord en publier une (`/vibe-stack:release-vibe-stack`).

Arrêter là.

Si `$ARGUMENTS` contient `--check` : afficher l'état (Dynamic context + Step 4 sans déployer) et arrêter.

## Step 1 — Première mise en ligne ?

- `config/deploy.yml` **existe** → aller au Step 3.
- Sinon → Step 2, une seule fois dans la vie du projet.

## Step 2 — Préparer la première mise en ligne

### 2.1 Déduire, sans demander

| Valeur | D'où |
|---|---|
| Service | `id` de `.flow/project.json` |
| Hôte | nom MagicDNS du serveur : `tailscale status --json \| jq -r '.Peer[] \| select(.HostName=="flow") \| .DNSName \| rtrimstr(".")'` — **jamais une IP** : le port 22 n'est ouvert qu'au tailnet, et une IP recopiée se périme |
| Utilisateur SSH | `debian` |
| Registry | `registry.fbrotte.fr` |
| Réseau Docker | `server-infra` |
| Accessory API | oui si `apps/api/` existe |
| Taille de corps nginx | `50M` — le projet l'ajustera dans `deploy.yml` s'il le faut |

### 2.2 Demander, via `AskUserQuestion`, seulement ce qui ne se déduit pas

1. **Le ou les domaines.** Proposer `<service>.senpli.fr` en premier — tout ce qui est pro va
   sur `senpli.fr`, couvert par un DNS wildcard.
2. **Confirmer le nom du service** déduit (il nomme les conteneurs, les images et la base).

### 2.3 Projets Bitwarden

Lire le bloc `bws` de `.flow/project.json`.

- **`shared_project_id` manquant** : c'est le projet qui contient `REGISTRY_USER`. Le retrouver en
  listant les **noms** de clés de chaque projet — `bws secret list <id> | jq -r '.[].key'`, jamais
  les valeurs.
- **API présente et `project_id` manquant** : proposer de créer le projet
  (`bws project create <service>`), puis y créer `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`,
  `JWT_REFRESH_SECRET` (`bws secret create <CLE> "<valeur>" <project_id>`). Générer les secrets JWT
  avec `openssl rand -hex 32`. `DATABASE_URL` pointe sur `server-postgres:5432/<base>`.
- Écrire les UUID dans `.flow/project.json` (`bws.project_id`, `bws.shared_project_id`).

**Aucune valeur de secret ne doit apparaître dans une sortie** : pas d'`echo`, pas de
`bws secret get` affiché, et jamais `bash -x` sur un script qui manipule des secrets — la trace
imprime les valeurs en clair.

### 2.4 Base de données (si API)

Nom de la base : le service, tirets remplacés par des underscores.

```bash
ssh flow "docker exec server-postgres psql -U postgres -Atc \"select 1 from pg_database where datname='<base>'\""
```

Si vide, après confirmation :

```bash
ssh flow "docker exec server-postgres psql -U postgres -c 'CREATE DATABASE <base>' && docker exec server-postgres psql -U postgres -d <base> -c 'CREATE EXTENSION IF NOT EXISTS vector'"
```

### 2.5 Écrire la config

- `config/deploy.yml` depuis `templates/deploy.yml.template` (dossier de ce skill). Pour un
  projet sans API, retirer le bloc `accessories` marqué dans le gabarit.
- `.kamal/secrets` depuis `templates/secrets.template`, même règle pour le bloc API.
- `.kamal/secrets` est **versionné** : il ne contient aucune valeur, seulement où les chercher.

Ces deux fichiers appartiennent au projet — ils ne viennent pas de flow-core et ne sont jamais
synchronisés.

### 2.6 DNS

Un sous-domaine de `senpli.fr` est déjà couvert par le wildcard. Pour tout autre domaine, vérifier
que `dig +short <domaine>` renvoie la même IP que `dig +short x.senpli.fr` ; sinon, indiquer
l'enregistrement A à créer et attendre avant de déployer (sans DNS, Let's Encrypt échoue).

### 2.7 Committer

`bin/deploy` refuse un arbre de travail sale. Committer **nommément** ce que ce step a produit
(`config/deploy.yml`, `.kamal/secrets`, `.flow/project.json`) — jamais `git add -A`.

## Step 3 — Déployer

1. **Arbre de travail sale** : lister les fichiers. Ne jamais committer à la place de l'utilisateur
   des fichiers qu'il n'a pas demandé à publier. Proposer : committer ce qui doit partir, ou
   `--allow-dirty` en disant explicitement ce qui part avec, ou un worktree sur un commit précis.
2. **Confirmer** via `AskUserQuestion` : service, commit, domaines, mode.
3. **Appeler le script**, en transmettant les options reçues :

   ```bash
   bin/deploy [--api-only|--web-only|--redeploy] [--allow-dirty]
   ```

   Le script force lui-même la locale UTF-8, lit ses valeurs dans `config/deploy.yml`, et
   s'arrête si une migration n'est pas appliquée : **lire sa sortie** plutôt que la survoler.

4. **Premier déploiement** : si le script échoue parce que l'accessory API n'existe pas encore sur
   le serveur, lancer `kamal accessory boot api`, puis relancer `bin/deploy`.

## Step 4 — Vérifier

```bash
DOMAIN=$(ruby -ryaml -e 'puts YAML.safe_load(File.read("config/deploy.yml"))["proxy"]["hosts"].first')
curl -s -o /dev/null -w '%{http_code}\n' "https://$DOMAIN/health"
curl -s -o /dev/null -w '%{http_code}\n' "https://$DOMAIN/api/health"   # si API
```

Au premier déploiement, le certificat Let's Encrypt peut prendre une à deux minutes : réessayer
avant de conclure à un échec.

## Step 5 — Résumé

```
Deploy — terminé
────────────────
Service :  <service>
Commit :   <hash> — <message>
Mode :     complet | api | web | redeploy
Santé :    web <code> · api <code>
URL :      https://<domaine>
```

**Revenir en arrière** — le web : `kamal app containers` pour lister les versions, puis
`kamal rollback <version>`. L'API n'a pas de rollback Kamal : redéployer le commit précédent
depuis un worktree (`git worktree add .worktrees/deploy <commit> --detach`).

## Règles

- **Toujours passer par `bin/deploy`**, jamais `kamal deploy` seul.
- **Ne jamais modifier dans un projet** `bin/deploy`, les Dockerfiles, `nginx.conf.template` ni
  les hooks Kamal : ils viennent de flow-core. Un réglage qui diffère → variable dans
  `env.clear` de `deploy.yml`. Une route en plus → fichier dans `infrastructure/nginx/extra/`.
  Un besoin commun → corriger dans flow-core, publier une release, synchroniser.
- **Pas de déploiement par la CI.** Le workflow `docker-build.yml` de flow-core vérifie que les
  images se construisent et démarrent ; il ne déploie pas.
- Le serveur se désigne par son **nom MagicDNS**, jamais par une IP.

## Arguments

- `--api-only` : image API, migrations et redémarrage de l'API seulement
- `--web-only` : le front seulement
- `--redeploy` : redémarrage sans rebuild
- `--allow-dirty` : déployer malgré des fichiers non commités — dire lesquels
- `--check` : état du projet, sans déployer
