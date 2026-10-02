# Fuego kits

Each directory here is one function kit published to npm, ported from a
deprecated Firebase Extension or written from scratch. A kit follows the same
contract as Google's `@firebase-function-kits/*` packages, so it deploys with the
plain Firebase CLI as well as from Fuego:

- an npm package whose entry point **exports** its Cloud Functions (2nd gen,
  `firebase-functions` 7+, Node.js 22+);
- configuration read with `firebase-functions/params` (`defineString`,
  `defineInt`, `select`, …), never from `process.env` at the top level, so the
  CLI and the catalog generator can discover the params;
- IAM roles and APIs declared in code with `requiresRole` / `requiresAPI`;
- optional `./default-options` subpath with the recommended `setGlobalOptions`;
- a `README.md` (copied into the catalog) documenting install, settings and
  the resources the kit creates.

A kit ported from `firebase/extensions` keeps its Apache-2.0 license and a
NOTICE crediting the original authors.

After publishing a version, add or bump its entry in `catalog/sources.json` and
run `npm run build:catalog`.
