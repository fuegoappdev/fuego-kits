# fuego-kits

Function kits for Firebase and the catalog behind the **Kit Store** of
[Fuego](https://fuegoapp.dev).

Google is shutting down Firebase Extensions on **2027-03-31** and replacing them
with *function kits*: npm packages of Cloud Functions you deploy with the
Firebase CLI. This repository holds:

| Path | What |
| --- | --- |
| `catalog/sources.json` | The curated list of kits: package, exact version, publisher, category, the extensions each one replaces, status. **The only file edited by hand.** |
| `catalog/v1/catalog.json` | The generated catalog Fuego downloads from `https://raw.githubusercontent.com/fuegoappdev/fuego-kits/main/catalog/v1/catalog.json` (the repository must stay public). Never edit it: run `npm run build:catalog`. |
| `catalog/v1/readme/<id>.md` | Each kit's README at the catalog version, generated. |
| `kits/` | Source of the kits maintained by Fuego (see `kits/README.md`). |
| `scripts/` | The catalog generator and its tests. |

## How the catalog is built

`npm run build:catalog` reads `catalog/sources.json` and, for each kit that is
not `announced`:

1. installs the exact `package@version` in a throwaway directory
   (`--ignore-scripts`) and records its npm `sha512` integrity;
2. loads it through **firebase-functions' own discovery loader** (the code path
   `firebase deploy` uses) in a separate process with an empty environment;
3. writes the resulting params, functions and triggers, required IAM roles,
   required APIs and lifecycle hooks into the catalog entry, and copies the
   package README next to it.

Nothing about a kit's configuration is transcribed by hand, so the store always
asks for exactly what `firebase deploy` will ask for.

CI (`.github/workflows/catalog.yml`) runs the tests and
`npm run check:catalog`, which fails when the committed catalog does not match
`sources.json`.

## Adding a kit

1. Add an entry to `catalog/sources.json` (`id` ≤ 40 chars of `a-z0-9_-`, exact
   `version`, `status` one of `available`, `preview`, `announced`).
2. Run `npm run build:catalog` and commit `catalog/`.
3. Open a pull request. Loading a kit runs its code: review the package before
   merging, and only list publishers you trust.

## Catalog format (v1)

```jsonc
{
  "schemaVersion": 1,
  "updatedAt": "2026-10-01",               // bump when editing sources.json
  "publishers": { "firebase": { "name": "Firebase", "url": "…", "verified": true } },
  "kits": [{
    "id": "firestore-bigquery-export",
    "name": "Stream Firestore to BigQuery",
    "summary": "…",
    "publisher": "firebase",
    "package": "@firebase-function-kits/firestore-bigquery-export",
    "version": "0.1.1",
    "status": "available",                  // available | preview | announced
    "integrity": "sha512-…",                // npm dist.integrity of that version
    "license": "Apache-2.0",
    "repository": "https://github.com/…",
    "npmUrl": "https://www.npmjs.com/package/…/v/0.1.1",
    "readme": "readme/firestore-bigquery-export.md",  // relative to catalog.json
    "categories": ["analytics"],
    "icon": "IconChartBar",                 // Tabler icon name
    "replaces": ["firebase/firestore-bigquery-export"],
    "node": ">=22",
    "firebaseFunctions": "7.4.0",
    "functions": [{ "name": "fsexportbigquery", "trigger": "firestore",
                    "eventType": "google.cloud.firestore.document.v1.written",
                    "resource": "{{ params.COLLECTION_PATH }}/{documentId}" }],
    "params": [ /* firebase-functions param specs, as `firebase deploy` reads them */ ],
    "roles": ["roles/bigquery.dataEditor"],
    "apis": [{ "api": "bigquery.googleapis.com", "reason": "…" }],
    "lifecycleHooks": ["afterFirstDeploy", "afterRedeploy"]
  }]
}
```

The rules in `scripts/lib/catalog.mjs` are also enforced by Fuego
(`internal/functions/catalog/validate.go`) before it trusts a downloaded
catalog: change both together. A format change that old Fuego versions cannot
read goes to a new `catalog/v2/` directory.

## License

Apache-2.0 (see `LICENSE`). Kits ported from
[firebase/extensions](https://github.com/firebase/extensions) keep their original
copyright notices.
