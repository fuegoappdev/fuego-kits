// Prints the deploy manifest of an installed kit as JSON on stdout: the same
// document the Firebase CLI reads at deploy (params, endpoints with their
// triggers, required roles and APIs, lifecycle hooks).
//
// Usage: node discover-kit.cjs <kit package directory>
//
// It loads the kit with the firebase-functions copy the kit itself resolves,
// through the discovery loader the CLI uses, so nothing is transcribed by hand.
// Loading a kit runs its module code: only run it on kits reviewed in a pull
// request, never with secrets in the environment.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function firebaseFunctionsRoot(kitDir) {
    let dir = path.dirname(require.resolve('firebase-functions', { paths: [kitDir] }));
    for (;;) {
        const pkg = path.join(dir, 'package.json');
        if (fs.existsSync(pkg) && JSON.parse(fs.readFileSync(pkg, 'utf8')).name === 'firebase-functions') {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error(`firebase-functions not found from ${kitDir}`);
        }
        dir = parent;
    }
}

async function main() {
    const kitDir = path.resolve(process.argv[2] || '');
    if (!fs.existsSync(path.join(kitDir, 'package.json'))) {
        throw new Error(`not a package directory: ${kitDir}`);
    }
    // Discovery never talks to Google: a placeholder project id is enough
    // for the code that reads it at load time.
    process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-fuego-kits';
    process.env.FUNCTIONS_CONTROL_API = 'true';

    const root = firebaseFunctionsRoot(kitDir);
    const { loadStack } = require(path.join(root, 'lib/runtime/loader.js'));
    const { stackToWire } = require(path.join(root, 'lib/runtime/manifest.js'));
    const stack = await loadStack(kitDir);
    const wire = stackToWire(stack);
    const ffVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    process.stdout.write(JSON.stringify({ firebaseFunctions: ffVersion, manifest: wire }));
}

main().catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
});
