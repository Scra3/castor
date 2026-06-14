castor 🦫
=========

**Construis ton Forest avec ton compagnon castor.**

`castor` est une CLI (oclif, TypeScript, ESM) qui couvre tout le cycle de vie d'un
projet Forest Admin depuis le terminal : **onboarding** d'un projet de bout en bout,
**layout-as-code**, **pilotage des données** de l'agent, et le **moteur de workflows**
(création, exécution, executor).

## Installation (dev)

```sh
yarn install
yarn build          # tsc -> dist/  (à relancer après chaque modif)
node ./bin/run.js <commande>
```

> Yarn 4, node-modules linker. `yarn test` ne lance PAS `yarn lint` (Yarn 4 n'exécute
> pas les `pre/post` scripts) — lance `yarn lint` explicitement, objectif **0 erreur**.

## 1. Onboarding — `init`

De zéro à un agent Forest qui tourne, en une commande : connexion → création du projet
→ base de données → génération de l'agent `agent-nodejs` → démarrage → vérification.

```sh
# Interactif, contre la production :
node ./bin/run.js init --name "Mon Projet"

# Contre un serveur de dev, avec une base existante :
FOREST_URL=http://localhost:3001 node ./bin/run.js init \
  --name "Mon Projet" \
  --database-url postgres://user:pass@localhost:5432/ma_base

# Avec un workflow executor branché d'emblée :
node ./bin/run.js init --name "Mon Projet" --with-executor
```

Sans `--database-url`, une base Postgres d'exemple est provisionnée via Docker.
Auth : `login`, `signup` (email/mot de passe ou `--oauth` Google/SSO), `logout`.

## 2. Layout-as-code — `layout`

Versionne et applique le layout (collections, dashboards, dossiers, workflows) comme
du code.

```sh
node ./bin/run.js layout pull            # exporte le layout dans forest-layout.yml
node ./bin/run.js layout diff            # plan des changements
node ./bin/run.js layout apply           # applique (patch atomique par domaine)
node ./bin/run.js layout patch --domain layout --file ops.json   # JSON Patch brut
```

Catalogue complet des patchs supportés : **`docs/LAYOUT-PATCHES.md`**.

## 3. Piloter l'agent — `agent`

Interroge et modifie les données servies par un agent qui tourne (via
`@forestadmin/agent-client`, token forgé localement depuis le `FOREST_AUTH_SECRET`).

```sh
node ./bin/run.js agent describe customers --project-dir ./mon-projet
node ./bin/run.js agent list customers --filter '{"field":"email","operator":"Contains","value":"a"}'
node ./bin/run.js agent create customers --data '{"email":"a@b.com"}'
node ./bin/run.js agent export orders -o orders.csv
```

Sous-commandes : `describe, list, get, count, create, update, delete, export,
relation, associate, dissociate, action, chart`.

## 4. Workflows — `workflow`

Crée, exécute et pilote le **moteur de workflow orchestrator** (uniquement sur les
environnements en moteur `orchestrator`).

```sh
# Créer un workflow depuis une spec YAML (compilée en BPMN) :
node ./bin/run.js workflow create -f workflow.yml --project "Mon Projet"

# L'exécuter de bout en bout (autopilote) :
node ./bin/run.js workflow run --workflow <uuid> --collection customers --record 1 \
  --project-dir ./mon-projet --inputs '{"1":{"userConfirmed":true,"value":"x@y.z"}}'

# Installer + démarrer le workflow executor (le service qui exécute les runs) :
node ./bin/run.js workflow setup-executor --project-dir ./mon-projet --in-memory
```

Exemple de spec (`workflow.yml`) :

```yaml
name: Mettre à jour l'email
collection: customers
steps:
  - {id: read, type: read, title: Lire la fiche, auto: true, next: update}
  - {id: update, type: update, title: Mettre à jour l'email, next: done}
  - {id: done, type: end, title: Terminé}
```

Sous-commandes : `create, run, list, start, resume, continue, revise, abort,
handle-manually, escalate, trigger` + `setup-executor`.
Le modèle d'exécution complet (machine à états, boucle de pilotage, payloads par type
de step) est documenté dans **`docs/WORKFLOWS.md`**.

## Conventions

- ESM + `Node16` → les imports relatifs portent l'extension `.js`.
- Erreurs typées (`ForestApiError`, `AuthError`, `WorkflowError`, `AgentError`, …),
  jamais de strings brutes.
- Effets de bord (fetch, process, prompts, horloge) **injectables** pour les tests.
- Strings utilisateur en anglais ; ce README et le branding en français.
- Token stocké dans `~/.config/castor/credentials.json` (0600), clé par URL de serveur.

## Tests

```sh
yarn test           # mocha (test/**/*.test.ts)
yarn lint           # eslint — 0 erreur attendu
```
