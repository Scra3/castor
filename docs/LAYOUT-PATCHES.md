# Catalogue des patchs layout Forest Admin

Référence des opérations **JSON Patch (RFC 6902)** acceptées par les endpoints
`PATCH /api/layout`, `PATCH /api/folders` et `PATCH /api/workflows` du serveur Forest Admin.

> **Usage avec la CLI** :
> ```sh
> echo '[{"op":"replace","path":"...","value":...}]' | forest-onboard layout patch --domain layout --yes
> # ou : forest-onboard layout patch --file ops.json --domain folders
> ```
> Ce document est extrait du code serveur (`make-layout-patch-patterns.ts` + validateurs Joi,
> juin 2026) et **vérifié exhaustif par extraction automatique : 248 patterns**
> (229 layout + 12 folders + 7 workflows) — tous couverts ci-dessous. Il est destiné à un
> humain ou une IA qui doit composer un patch. ⚠️ Snapshot manuel : en cas de 422 inattendu,
> le serveur a peut-être évolué.

---

## 1. Règles générales (à lire d'abord)

- **Corps de requête** = tableau brut d'opérations : `[{ "op", "path", "value?" }, …]`.
  Ops supportées : `add` (chemin finissant par `/-`), `replace`, `remove` (+ `test` sur de rares chemins).
- **Headers requis** : `forest-environment-id` et `forest-team-id` (entiers). Le scope = environnement × équipe.
- **Atomique par domaine** : toutes les ops d'un PATCH passent, ou aucune. Succès = `204` sans corps.
- **Identifiants dans les chemins** : des **noms** (`customers`, `email`) ou des ids numériques/**uuid**
  (charts, dashboards, inboxes, workflows, dossiers = uuid). Jamais des index de tableau.
- **Réordonner** = `replace …/position` (pas d'op `move`).
- **Renommer** = `replace …/name` ou `…/displayName` (l'élément garde son id).
- **Ajouter** = `add …/-` avec l'objet **complet** (souvent avec un `id` uuid à générer soi-même).
- **Erreurs** :
  - `422 Not-supported patch: {op:'…',path:'…'}` → le chemin/op n'est pas dans la whitelist.
  - `422 Invalid patch value (path…) ValidationError: …` → erreur Joi **précise** (champ manquant,
    type, enum). Une erreur à la fois — corriger et réessayer converge vite.
  - `403` → pack premium manquant (voir §8) ou rôle sans droit d'édition du layout.

---

## 2. Domaine `layout` — collections

### Propriétés de base (`replace`)
| Chemin | Valeur |
|---|---|
| `/collections/<col>/displayName` | string (ou null) |
| `/collections/<col>/displayNamePlural` | string |
| `/collections/<col>/icon` | string (nom d'icône, ex. `users`, `tags`, `shopping-cart`) |
| `/collections/<col>/restrictedToSegments` | boolean — ⚠️ `true` exige ≥ 1 segment existant |
| `/collections/<col>/defaultSortingOrder` | `"ascending"` \| `"descending"` |
| `/collections/<col>/defaultSortingFieldName` | string (nom de champ) ou null |
| `/collections/<col>/displayFieldName` | string — champ d'affichage des références |

```json
[{"op":"replace","path":"/collections/customers/displayName","value":"Clients"},
 {"op":"replace","path":"/collections/customers/icon","value":"users"}]
```

### Colonnes de la vue liste (`replace` uniquement — définies par le schéma de l'agent)
```
/collections/<col>/layout/columns/<field>/position    number (≥ -1)
/collections/<col>/layout/columns/<field>/isVisible   boolean
```
❌ Impossible d'ajouter/supprimer une colonne (elles viennent du schéma posté par l'agent).

### Champs (formulaire / fiche) (`replace`)
```
/collections/<col>/layout/fields/<field>/displayName            string
/collections/<col>/layout/fields/<field>/description            string|null
/collections/<col>/layout/fields/<field>/isReadOnly             boolean
/collections/<col>/layout/fields/<field>/isFilterDisplayed      boolean
/collections/<col>/layout/fields/<field>/isDissociateDisplayed  boolean
/collections/<col>/layout/fields/<field>/widgetEdit             objet widget|null
/collections/<col>/layout/fields/<field>/widgetDisplay          objet widget|null
/collections/<col>/layout/fields/<field>/mappingValues          tableau (mapping d'enums)
/collections/<col>/layout/fields/<field>/conditionalFormatting  objet|null
```
💡 Pour `widgetEdit`/`conditionalFormatting` : configurer une fois dans l'app puis `layout pull`
pour récupérer le JSON exact à répliquer.

### Segments — *premium `scopes`* (`add` / `remove` / `replace`)
```
add     /collections/<col>/layout/segments/-
        { "name": "VIP", "position": 0, "isVisible": true, "filter": { "aggregator":"and","conditions":[…] } }
remove  /collections/<col>/layout/segments/<id>
replace /collections/<col>/layout/segments/<id>/(name|position|isVisible|icon|filter)
replace /collections/<col>/layout/segments/<id>/(defaultSortingFieldName|defaultSortingFieldOrder)
replace /collections/<col>/layout/segments/<id>/(query|connectionName)   // segments SQL
replace /collections/<col>/layout/segments/<id>/hasColumnsConfiguration  // boolean
replace /collections/<col>/layout/segments/<id>/columns                  (tableau entier)
replace /collections/<col>/layout/segments/<id>/columns/<field>/(position|isVisible)
```

### Actions (smart actions — déclarées par l'agent) (`replace`)
```
/collections/<col>/layout/actions/<id>/(position|isVisible|displayName|confirmation|segments|buttonType)
```

### Vue détail (`viewEdit`)
```
replace /collections/<col>/layout/viewEdit/summaryView      (objet : disposition de la fiche)
replace /collections/<col>/layout/viewEdit/rows/<id>/(position|isVisible|explorerConfiguration)
replace /collections/<col>/layout/viewEdit/rows/<id>/explorerConfiguration/(displayFieldNames|isVisible|position|recordsPerPage)
replace /collections/<col>/layout/viewCreate/rows/<id>/(position|isVisible)
```
Charts de la vue détail : mêmes règles que §4, préfixe `/collections/<col>/layout/viewEdit/charts`.

### Vues personnalisées (`viewLists`)
```
add     /collections/<col>/layout/viewLists/-
remove  /collections/<col>/layout/viewLists/<id>
replace /collections/<col>/layout/viewLists/<id>/(name|position|recordsPerPage|allowJavascript|s3Versions)
```
⚠️ La viewList par défaut (`isSmart: false`) ne peut pas être supprimée. `s3Versions`/`allowJavascript` = smart views.

### Scope de collection — *premium `scopes`*
```
replace /collections/<col>/layout/scope        (objet filtre, ou null)
```

---

## 3. Domaine `layout` — sections (barre latérale)

```
replace /sections      (tableau ENTIER, remplacé en bloc)
```
```json
[{"op":"replace","path":"/sections","value":[
  {"name":"Data","isVisible":true},{"name":"Dashboard","isVisible":true},
  {"name":"Workspaces","isVisible":false},{"name":"Collaboration","isVisible":true},
  {"name":"Activity","isVisible":true}]}]
```

---

## 4. Charts (vue détail ET dashboards) — formats VÉRIFIÉS en réel

Un chart = `{ id: uuid (généré par toi), name, description, displaySettings: {x,y,width,height}, …champs du type }`.
`aggregator` ∈ `Sum` | `Count` ; avec `Count`, `aggregateFieldName` peut être `null`.

| Type | Champs requis spécifiques |
|---|---|
| `Value` | `sourceCollectionId`, `aggregator`, `aggregateFieldName`, `filter` (null ok) |
| `Line` | + `groupByFieldName`, `timeRange` (`Day`\|`Week`\|`Month`\|`Quarter`\|`Year`) |
| `Pie` | + `groupByFieldName` |
| `Leaderboard` | `labelFieldName`, `relationshipFieldName`, `aggregateFieldName`, `aggregator`, `limit` |
| `Objective` | + `objective` (number) |
| `Percentage` | numérateur/dénominateur : `numeratorChartId`, `denominatorChartId` |
| `Smart` / query | `query` (SQL) ou code smart — voir un exemple via `layout pull` |

Exemple complet (testé) — KPI + courbe sur le dashboard :
```json
[{"op":"add","path":"/dashboards/<dashId>/charts/-","value":{
   "id":"<uuid>","name":"Clients","description":"","type":"Value",
   "sourceCollectionId":"customers","aggregateFieldName":null,"aggregator":"Count","filter":null,
   "displaySettings":{"x":0,"y":0,"width":7,"height":5}}},
 {"op":"add","path":"/dashboards/<dashId>/charts/-","value":{
   "id":"<uuid>","name":"Commandes par mois","description":"","type":"Line",
   "sourceCollectionId":"orders","groupByFieldName":"created_at","aggregateFieldName":null,
   "aggregator":"Count","timeRange":"Month","filter":null,
   "displaySettings":{"x":0,"y":5,"width":28,"height":9}}}]
```
Modification / suppression :
```
replace /dashboards/<dashId>/charts/<chartId>            (chart entier)
replace /dashboards/<dashId>/charts/<chartId>/<prop>
remove  /dashboards/<dashId>/charts/<chartId>            ou …/<prop> (retire une prop)
replace /dashboards/<dashId>/charts/<chartId>/displaySettings(/x|/y|/width|/height)
```
`<prop>` ∈ : `name`, `description`, `type`*, `aggregator`, `aggregateFieldName`, `sourceCollectionId`*,
`groupByFieldName`, `fieldName`, `labelFieldName`, `relationshipFieldName`, `filter`, `timeRange`,
`limit`, `objective`, `numeratorChartId`, `denominatorChartId`, `query`, `connectionName`,
`apiRoute`, `smartRoute`, `allowJavascript`, `s3Versions`, `displaySettings`.

\* **Changer `type` ou `sourceCollectionId` requiert une op `test`** dans le même lot pour
affirmer la valeur courante :
```json
[{"op":"test","path":".../charts/<id>/type","value":"Value"},
 {"op":"replace","path":".../charts/<id>/type","value":"Pie"},
 {"op":"replace","path":".../charts/<id>/groupByFieldName","value":"product"}]
```

---

## 5. Domaine `layout` — dashboards

```
add     /dashboards/-                       ⚠️ premium multipleDashboards
        { "id":"<uuid>", "name":"KPIs", "icon":null, "position":1, "charts":[…] }
remove  /dashboards/<id>
replace /dashboards/<id>/(name|icon|position)
```
💡 **Gratuit** : enrichir le dashboard par défaut existant (récupérer son uuid via `layout pull`
ou l'API rendering) en ajoutant des charts (§4).

---

## 6. Domaine `layout` — workspaces (vérifié en réel)

```
add     /workspaces/-
remove  /workspaces/<id>
replace /workspaces/<id>/(name|icon|position)
add     /workspaces/<id>/components/-
remove  /workspaces/<id>/components/<id>
replace /workspaces/<id>/components/<id>/(name|displaySettings|visibility)
```

### Options de composant : préférer les chemins FINS
Le `replace …/components/<id>/options` en bloc existe dans la whitelist mais a été **refusé en
pratique** (422, probablement lié au discriminant polymorphe / ops `test`). Deux solutions sûres :
**(a)** les chemins fins ci-dessous, **(b)** `remove` + `add` du composant entier.

```
# composant `collection` (tableau de données)
replace …/components/<id>/options/(onRowClick|filter|segmentId|viewId)
replace …/components/<id>/options/(sortingFieldName|sortingOrder|recordsPerPage)
replace …/components/<id>/options/(showSearchbar|showFilters|showCreate|showActions|showWorkflows|enableSegments)
add     …/components/<id>/options/visibleColumns/-          { "name":"email", "position":0 }
remove  …/components/<id>/options/visibleColumns/<field>
replace …/components/<id>/options/visibleColumns/<field>/position

# composant `smart`
replace …/components/<id>/options/(componentUrl|styleUrl|templateUrl)

# composants `tabs` / `section` (regroupement d'autres composants)
add/remove …/components/<id>/options/componentIds/-  |  …/componentIds/<id>
add/remove …/components/<id>/options/tabs/-          |  …/tabs/<id>
add/remove …/components/<id>/options/tabs/<id>/componentIds/- | …/<cid>
```

⚠️ Changer la **collection source** d'un composant requiert une op `test` préalable :
```json
[{"op":"test","path":"…/components/<id>/options/collectionId","value":"orders"},
 {"op":"replace","path":"…/components/<id>/options/filter","value":null}]
```
(idem `options/relatedDataFieldName` pour le mode related-data). Les options des composants
`text`/`divider`/etc. n'ont **pas** de chemins fins → `remove` + `add` du composant.

**Workspace** : `{ id: uuid, name, icon (string|null), position (≥0), components: […] }`
**Composant** : `{ id: uuid, name, type, displaySettings: {x,y,width,height}, visibility: {"type":"always"}, options }`
- `name` de composant : `[a-zA-Z0-9-_]` uniquement (pas d'espaces), ≠ `currentUser`.
- `visibility.type` ∈ `always` | `whenItsContextIsSet` | `whenAnotherComponentIsVisible` (+`componentId`).
- La grille est large (~28 unités). Prévoir grand : un KPI ≈ 9×7, un tableau ≈ 28×16.

**18 types** : `text`, `divider`, `chart`, `collection`, `field`, `link`, `dropdown`, `date-picker`,
`search`, `action`, `metabase`, `tabs`, `section`, `toggle`, `input`, `inbox`*, `smart`, `workflow`.
(*inbox = premium)

`options` par type (vérifiés) :
```jsonc
// text
{ "displayedText":"Titre", "tooltip":"", "fontSize":24, "textAlign":"center",
  "fontWeight":"bold", "fontStyle":"normal", "color":"#1F2937" }
// divider
{ "direction":"horizontal", "color":"#E5E7EB", "style":"solid" }
// chart → mêmes champs qu'un chart (§4) SANS id/displaySettings (portés par le composant)
{ "name":"Clients", "description":"", "type":"Value", "sourceCollectionId":"customers",
  "aggregateFieldName":null, "aggregator":"Count", "filter":null }
// collection (tableau de données live)
{ "collectionId":"orders", "segmentId":null, "onRowClick":"redirectToRecord", // ou selectARecord
  "sortingFieldName":"created_at", "sortingOrder":"descending", "recordsPerPage":10,
  "showSearchbar":true, "showFilters":true }
```
Pour les autres types (`tabs`, `dropdown`, `metabase`…) : créer un exemplaire dans l'app,
puis `layout pull` / GET rendering pour copier le moule.

---

## 7. Domaines `folders` et `workflows`

### `--domain folders` (arborescence du menu Data)
```
add     /folders/-                          { "name":"Ventes", "icon":null, "children":[…] }
remove  /folders/<uuid|int>                 ⚠️ le dossier principal (isMain) est insupprimable
replace /folders/<id>/(name|icon)
add     /folders/<id>/children/-            { "id":"<collection>", "type":"collection", "position":0, "isVisible":true }
remove  /folders/<id>/children/<itemId>
replace /folders/<id>/children/<itemId>/(position|isVisible)
        (+ même chose un niveau plus bas : …/children/<id>/subChildren/…)
```
⚠️ Un même item ne peut pas apparaître dans deux dossiers.

### `--domain workflows`
```
add     /workflows/-      { "id":"<uuid>", "name":"…", "collectionId":"customers",
                            "segmentIds":[], "isVisible":true, "position":0 }
remove  /workflows/<uuid>
replace /workflows/<uuid>/(name|position|isVisible|segmentIds|bpmnAwsS3Identifier)
```
⚠️ Crée une **coquille** : la logique (BPMN) passe par un upload S3 séparé
(`POST /api/workflows/:id/generate-presigned-request`), hors périmètre du patch.

---

## 7 bis. Domaine `layout` — inboxes (*premium `inbox`*)

```
add     /inboxes/-
remove  /inboxes/<id>
replace /inboxes/<id>/(name|icon|position|folder|dispatchRule|sortingFields|tasksLimit|unassignAfter|canUsersReassign)
```

## 8. Packs premium (sinon `403`)

| Fonctionnalité | Pack requis |
|---|---|
| Segments & scope de collection | `scopes` |
| Créer un dashboard supplémentaire (`add /dashboards/-`) | `multipleDashboards` |
| Inboxes (et composant workspace `inbox`) | `inbox` |

---

## 9. Anti-sèche des pièges (appris en conditions réelles)

1. `GET /api/layout/...` renvoie **toujours `[]`** — lire l'état via `layout pull` (qui reconstruit
   depuis `GET /api/renderings/:project/:env/:team`).
2. Le rendering est en **snake_case** (`is_hidden`, `display_name`) ; les patchs en **camelCase**
   (`isVisible`, `displayName`) — et `isVisible = !is_hidden`.
3. Patch **atomique** : une op invalide → tout le lot rejeté. Pour expérimenter, envoyer les ops
   risquées **séparément**.
4. `replace …/components/<id>/options` en bloc → 422 : utiliser les chemins fins `options/<prop>`
   (§6) ou recréer le composant. Changer `type`/`sourceCollectionId` d'un chart ou
   `collectionId` d'un composant exige une op `test` préalable dans le même lot.
5. Toujours générer les `id` (uuid v4) soi-même pour les `add` (charts, composants, workspaces, workflows).
6. `restrictedToSegments: true` sans segment, suppression de la viewList par défaut, item dupliqué
   dans deux dossiers, suppression du dossier principal → refusés par des règles métier dédiées.
