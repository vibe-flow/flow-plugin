---
name: design-brief
description: Génère un prompt prêt à coller dans Claude Design (claude.ai/design) pour faire maquetter un projet flow — reprend la vision, le cahier des charges et les composants déjà dev, décrit précisément les écrans et composants attendus, mais laisse à Claude Design toute la liberté créative sur le style. Déclencher quand Florian veut une maquette, un design, un prompt pour Claude Design, ou travailler le visuel d'un projet en cours.
argument-hint: "[écrans ou focus optionnel]"
disable-model-invocation: true
---

# Design Brief — prompt pour Claude Design

IMPORTANT : Toujours répondre et communiquer en français avec Florian.

Ce skill produit **un prompt texte** que Florian ira **coller dans Claude Design** (`claude.ai/design`, l'outil prompt-to-prototype d'Anthropic, Opus 4.7). Objectif : lui faire produire une **maquette** du projet flow courant à ~80 %, que Florian valide/itère là-bas puis redonne ici pour adaptation.

## Le principe directeur (à ne jamais perdre de vue)

> **Verrouille le QUOI, libère le COMMENT.**

- **Serré sur le QUOI** : le produit, l'audience, les écrans, les composants et *les données qu'ils affichent*.
- **Libre sur le COMMENT** : palette, typographie, mise en page, ambiance, style. On **n'impose rien** de visuel, sauf les rares contraintes **explicites** du projet.

Deux conséquences directes :

1. **Ne jamais décrire le style existant.** On lit le code des composants pour comprendre *ce qu'ils font et affichent*, jamais pour reproduire leurs couleurs/CSS/thème actuels. Claude Design doit être **force de proposition**, pas photocopieuse. (C'est aussi pourquoi on génère un prompt texte et **non** un import du repo GitHub, qui lui ferait recopier le style en place.)
2. **Contraintes dures = uniquement l'explicite.** On ne fige une contrainte de style que si le projet l'exige vraiment et le dit noir sur blanc : appli forcément mobile, logo d'une couleur imposée, univers imposé (ex. « futuriste »), ton de marque défini. **Dans le doute, on laisse libre** et on le note en « point supposé ».

Claude Design **pose lui-même des questions de clarification** et itère au chat/canvas — c'est natif et voulu. Le prompt doit donc *l'inviter* à questionner Florian sur la direction design, pas tout verrouiller à sa place.

## Process (one-shot)

Le skill génère en un coup, sans questionner Florian. Le rattrapage du spécifique se fait **après** (voir étape 5, la liste « points supposés / à vérifier », que Florian peut corriger, et via les questions que Claude Design lui posera).

### 1. Détecter le projet courant

- Repo courant = `basename` du répertoire de travail (ou repo git détecté).
- Nom du projet = nom du dossier repo. Sert à retrouver la note KB liée.
- Si `$ARGUMENTS` précise un focus (ex. « juste les écrans de réservation », « la partie settings »), le prendre en compte pour restreindre le périmètre.

### 2. Rassembler les sources (sans rien demander)

Chercher, dans l'ordre, et se contenter de ce qui existe (ne pas bloquer si une source manque) :

- **Vision / contexte produit** :
  - `README.md` du repo, `CLAUDE.md` du repo.
  - Note KB du projet : `~/Dev/KB/Projets/<nom>/README.md` (le nom KB peut différer légèrement de la casse/slug du repo — matcher au mieux ; si aucun dossier ne correspond franchement, ignorer silencieusement).
- **Cahier des charges** (souvent côté KB, pas dans le repo) :
  - Dans le repo : `docs/`, tout `*.md` racine ressemblant à un CDC (`cahier-des-charges*.md`, `cdc*.md`, `specs*.md`).
  - Dans la KB : `~/Dev/KB/Projets/<nom>/cahier-des-charges*.md` et autres notes de specs du dossier projet.
- **Écrans déjà dev** :
  - `apps/web/src/pages/*.tsx` (convention flow : `*Page.tsx`).
  - Le routing si présent (souvent `apps/web/src/App.tsx` : `createBrowserRouter` / `<Routes>`).
- **Composants déjà dev** :
  - `apps/web/src/components/**` (sous-dossiers typiques : `layout/`, `ui/`, plus des dossiers métier).
  - Lire assez pour comprendre **fonction + données affichées**, pas le style.

> Si le projet n'est pas une stack flow standard (pas de `apps/web`), s'adapter : repérer le front, ses pages et composants là où ils sont. Si vraiment rien n'est exploitable, le dire et travailler à partir du seul CDC/vision.

### 3. Extraire le QUOI

Construire, en interne :

- **Le produit en 2-3 phrases** : ce que c'est, pour qui, quel problème il résout. (Depuis README/CDC/vision.)
- **La liste des écrans** à maquetter — but en 1 ligne chacun. Inclure :
  - les écrans **déjà dev** (vus dans `pages/`),
  - les écrans **spécifiés au CDC mais pas encore dev** (vision du produit final) — les marquer mentalement « à venir » pour l'étape 5.
- **Par écran** : les composants/blocs clés + **les données/contenu qu'ils affichent** (ex. « liste de réservations avec statut, date, montant ; filtre par période »). Fonctionnel, jamais visuel.

Rester au niveau **des écrans et composants principaux** — Florian ne veut pas un cahier exhaustif de chaque atome UI, juste de quoi que Claude Design voie le produit et propose. Viser l'essentiel structurant.

### 4. Détecter les contraintes dures (explicites seulement)

Repérer uniquement ce qui est **affirmé** par le projet :

- **Plateforme** : responsive par défaut. Ne préciser « mobile-first » / « mobile uniquement » que si le CDC/README l'exige.
- **Marque** : nom du produit ; couleur/logo **seulement** si imposés explicitement.
- **Univers / ton** : seulement si le projet le pose (ex. « rassurant », « premium », « futuriste »).

Tout ce qui n'est pas explicitement contraint → **rien dans le prompt** (liberté), et un item dans la liste « points supposés » de l'étape 5.

### 5. Assembler et sortir

1. **Composer le prompt** selon le gabarit ci-dessous.
2. **Copier au presse-papier** : écrire le prompt dans un fichier temp du scratchpad puis `pbcopy < fichier` (évite les soucis d'échappement shell). Confirmer que c'est copié.
3. **Afficher le prompt** en entier dans le chat, dans un bloc, pour relecture/édition avant de coller.
4. **Lister « Points que j'ai supposés / à vérifier »** : le filet du one-shot. Y mettre notamment :
   - les écrans considérés « à venir » (au CDC, pas encore dev) inclus dans le brief ;
   - les contraintes qu'on a **choisi de laisser libres** faute d'explicite (« j'ai laissé la plateforme en responsive — précise si c'est mobile only ») ;
   - toute déduction sur le produit/l'audience qui mériterait confirmation.
   Inviter Florian à corriger ces points (il peut me demander de régénérer) et rappeler que **Claude Design lui posera aussi ses propres questions de design** une fois le prompt collé.

## Gabarit du prompt à générer

Le prompt est rédigé **en français**, adressé à Claude Design (« tu »). Structure :

```
Je te confie la conception visuelle d'une maquette pour **<Nom du produit>**. Tu as la
main sur tout le design ; moi je te cadre seulement ce que l'appli doit montrer et faire.

## Le produit
<2-3 phrases : ce que c'est, pour qui, le problème résolu.>

## Les écrans à maquetter
- **<Écran 1>** — <but en une ligne>
- **<Écran 2>** — <but en une ligne>
- ...

## Ce que chaque écran doit contenir
### <Écran 1>
- <bloc/composant> : <données et contenu affichés>
- <bloc/composant> : <données et contenu affichés>
### <Écran 2>
- ...

## Contraintes (les seules)
<Uniquement l'explicite. Ex. « Appli utilisée surtout au téléphone → pensée mobile
d'abord. » / « Le nom de marque est X. » — Sinon, écrire :>
Aucune contrainte de style imposée.

## Ta latitude
Tu as toute liberté créative sur le style : palette, typographie, mise en page, ambiance,
composants. Ne reproduis aucun style existant — propose ta propre direction, celle qui
sert le mieux ce produit et cette audience. Avant/pendant, pose-moi tes questions sur la
direction design (ton, univers, références) : je veux qu'on la construise ensemble.

## Format
Une maquette d'interface (UI), écran par écran, interactive si pertinent.
```

Adapter le gabarit au projet : retirer une section vide, fusionner « écrans » et « contenu » si le projet est petit, etc. Ne jamais y injecter de couleurs/typo/CSS venant du code existant.

## Rappels

- **Français, accents corrects**, partout (prompt généré compris).
- **Ne pas importer le repo** dans Claude Design par défaut : ce serait du on-brand qui bride la créativité. (Le mentionner à Florian en aside *seulement* s'il veut justement coller au style existant un jour.)
- **Rester à l'essentiel** : écrans et composants principaux, pas l'exhaustivité.
