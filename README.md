forest-onboard
==============

CLI d'onboarding Forest Admin : connexion, création du projet, génération d'un
agent `agent-nodejs` prêt à l'emploi, démarrage et vérification — de bout en bout.

## Installation (dev)

```sh
yarn install
yarn build
```

## Utilisation

Onboarding complet (interactif) :

```sh
./bin/run.js init
```

Contre un serveur de dev local, avec une base existante :

```sh
FOREST_URL=http://localhost:3001 ./bin/run.js init \
  --name mon-projet \
  --database-url postgres://user:pass@localhost:5432/ma_base
```

Sans `--database-url`, une base Postgres d'exemple est provisionnée via Docker.

### Commandes

- `init` — onboarding complet en 5 étapes (auth → projet → base → génération/install → démarrage/vérif).
- `signup` — créer un nouveau compte Forest Admin (email + mot de passe).
- `login` / `logout` — gérer la session Forest Admin stockée localement.
- `layout pull` / `layout diff` / `layout apply` — layout-as-code : exporter le layout
  (collections, dossiers, workflows) en YAML versionnable, voir le plan de changements,
  l'appliquer (confirmation, `--dry-run`, patchs atomiques par domaine).
- `layout patch` — échappatoire experte : envoyer des opérations JSON Patch (RFC 6902)
  brutes, couvrant 100 % des chemins supportés par le serveur.

### Layout-as-code en 30 secondes

```sh
forest-onboard layout pull            # exporte → forest-layout.yml (scope mémorisé)
$EDITOR forest-layout.yml             # renomme, masque des colonnes, ajoute des segments…
forest-onboard layout diff            # plan lisible (+ --json pour scripter)
forest-onboard layout apply           # applique (confirmation, --dry-run dispo)
```

Le scope (projet / environnement / équipe) est résolu automatiquement : projet unique,
environnement de développement, équipe « Operations » — flags `--project/--env/--team`
ou sélecteur interactif sinon.

📖 **Catalogue complet des patchs** (chemins, formats de valeurs, exemples vérifiés,
pièges) : [`docs/LAYOUT-PATCHES.md`](docs/LAYOUT-PATCHES.md).

### Options clés de `init`

| Option | Rôle |
|---|---|
| `--name, -n` | Nom du projet Forest (défaut : nom du dossier courant) |
| `--database-url` | Base Postgres existante (sinon Docker) |
| `--port` | Port d'écoute de l'agent (défaut 3310) |
| `--server` | URL du serveur Forest (`$FOREST_URL` / `$FOREST_SERVER_URL` sinon prod) |
| `--oauth` | Connexion via le navigateur (OAuth/OIDC) — Google/SSO et création de compte |
| `--keep-running` | Garder l'agent en marche jusqu'à Ctrl-C |
| `--yes, -y` | Mode non-interactif (CI) — exige `--name` et un token |
| `--verbose` | Logge les requêtes HTTP (secrets masqués) |
| `--insecure` | Désactive la vérification TLS (dev local uniquement) |

### Authentification

Ordre de résolution du token : `FOREST_TOKEN` > token stocké
(`~/.config/forest-onboard/credentials.json`, perms 600) > prompt interactif.

Trois modes de connexion interactive :

- **Email / mot de passe** (+ code 2FA si activé) — défaut.
- **OAuth/OIDC** via `--oauth` : ouvre le navigateur (device flow RFC 8628), gère
  les comptes Google/SSO et **crée le compte** au premier login. Le token OIDC
  court est échangé contre un *application token* persistant.

## Développement

```sh
yarn build        # compile TypeScript -> dist/
yarn test         # tests unitaires (mocha)
yarn lint         # eslint
```
