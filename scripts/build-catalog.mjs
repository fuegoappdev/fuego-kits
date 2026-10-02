// Builds catalog/v1/catalog.json from catalog/sources.json.
//
//   node scripts/build-catalog.mjs          write the catalog
//   node scripts/build-catalog.mjs --check  fail when the committed catalog is stale
//
// For every kit that is not "announced", the exact package version is installed
// in a throwaway directory (install scripts disabled) and its deploy manifest is
// read through firebase-functions' own discovery loader (lib/discover-kit.cjs,
// one child process per kit). Params, functions, roles, APIs and lifecycle hooks
// therefore always match what `firebase deploy` will ask for and create.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeFunctions, SCHEMA_VERSION, validateCatalog } from './lib/catalog.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = join(ROOT, 'catalog/sources.json');
const OUTPUT_DIR = join(ROOT, 'catalog/v1');
const OUTPUT = join(OUTPUT_DIR, 'catalog.json');
const README_DIR = join(OUTPUT_DIR, 'readme');
const DISCOVER = join(ROOT, 'scripts/lib/discover-kit.cjs');

function npm(args, cwd) {
    return execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function httpsRepository(pkg) {
    const repo = pkg.repository;
    let url = typeof repo === 'string' ? repo : repo?.url;
    if (!url) return undefined;
    if (/^[\w-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
    url = url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '');
    if (!url.startsWith('https://')) return undefined;
    const directory = typeof repo === 'object' ? repo.directory : undefined;
    return directory && url.startsWith('https://github.com/') ? `${url}/tree/HEAD/${directory}` : url;
}

function describeInstalled(source) {
    const dir = mkdtempSync(join(tmpdir(), 'fuego-kit-'));
    try {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'kit-probe', private: true }));
        npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', `${source.package}@${source.version}`], dir);
        const kitDir = join(dir, 'node_modules', ...source.package.split('/'));
        const pkg = JSON.parse(readFileSync(join(kitDir, 'package.json'), 'utf8'));
        if (pkg.version !== source.version) {
            throw new Error(`${source.package}: installed ${pkg.version}, expected ${source.version}`);
        }
        const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
        const integrity = lock.packages?.[`node_modules/${source.package}`]?.integrity;
        const out = execFileSync(process.execPath, [DISCOVER, kitDir], {
            cwd: dir,
            encoding: 'utf8',
            // Discovery runs third-party code: hand it nothing but what it needs.
            env: { PATH: process.env.PATH, HOME: dir },
            stdio: ['ignore', 'pipe', 'inherit']
        });
        const { firebaseFunctions, manifest } = JSON.parse(out);
        const readmePath = join(kitDir, 'README.md');
        return {
            pkg,
            integrity,
            readme: existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : undefined,
            firebaseFunctions,
            manifest
        };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function describeAnnounced(source) {
    const view = JSON.parse(npm(['view', `${source.package}@${source.version}`, '--json'], ROOT));
    return { pkg: view, integrity: view.dist?.integrity };
}

function buildKit(source) {
    const announced = source.status === 'announced';
    const info = announced ? describeAnnounced(source) : describeInstalled(source);
    const { pkg, manifest } = info;
    const kit = {
        id: source.id,
        name: source.name,
        summary: source.summary ?? pkg.description,
        publisher: source.publisher,
        package: source.package,
        version: source.version,
        status: source.status,
        integrity: info.integrity,
        license: pkg.license,
        repository: httpsRepository(pkg),
        homepage: pkg.homepage?.startsWith('https://') ? pkg.homepage : undefined,
        npmUrl: `https://www.npmjs.com/package/${source.package}/v/${source.version}`,
        // Relative to catalog.json: the app fetches it from wherever the
        // catalog came from, so catalog and READMEs share one origin.
        readme: info.readme !== undefined ? `readme/${source.id}.md` : undefined,
        categories: source.categories ?? [],
        icon: source.icon,
        replaces: source.replaces ?? [],
        node: pkg.engines?.node
    };
    if (manifest) {
        kit.firebaseFunctions = info.firebaseFunctions;
        kit.functions = describeFunctions(manifest.endpoints);
        kit.params = manifest.params ?? [];
        kit.roles = manifest.requiredRoles ?? [];
        kit.apis = manifest.requiredAPIs ?? [];
        kit.lifecycleHooks = Object.keys(manifest.lifecycleHooks ?? {});
    }
    return { kit: JSON.parse(JSON.stringify(kit)), readme: info.readme }; // stringify drops undefined fields
}

function main() {
    const check = process.argv.includes('--check');
    const sources = JSON.parse(readFileSync(SOURCES, 'utf8'));
    const files = new Map(); // path relative to catalog/v1 -> content
    const kits = sources.kits
        .map((s) => {
            console.error(`• ${s.id} (${s.package}@${s.version})`);
            const { kit, readme } = buildKit(s);
            if (readme !== undefined) files.set(kit.readme, readme);
            return kit;
        })
        .sort((a, b) => a.id.localeCompare(b.id));
    const catalog = { schemaVersion: SCHEMA_VERSION, updatedAt: sources.updatedAt, publishers: sources.publishers, kits };
    const errors = validateCatalog(catalog);
    if (errors.length) {
        console.error(errors.map((e) => `✗ ${e}`).join('\n'));
        process.exit(1);
    }
    files.set('catalog.json', `${JSON.stringify(catalog, null, 2)}\n`);

    const existing = existsSync(README_DIR) ? readdirSync(README_DIR).map((f) => `readme/${f}`) : [];
    const stale = existing.filter((f) => !files.has(f));
    if (check) {
        const changed = [...files].filter(([f, text]) => {
            const path = join(OUTPUT_DIR, f);
            return !existsSync(path) || readFileSync(path, 'utf8') !== text;
        });
        if (changed.length || stale.length) {
            console.error(`out of date: ${[...changed.map(([f]) => f), ...stale].join(', ')}`);
            console.error('run `npm run build:catalog` and commit catalog/v1');
            process.exit(1);
        }
        console.error('catalog is up to date');
        return;
    }
    mkdirSync(README_DIR, { recursive: true });
    for (const f of stale) rmSync(join(OUTPUT_DIR, f));
    for (const [f, text] of files) writeFileSync(join(OUTPUT_DIR, f), text);
    console.error(`wrote ${OUTPUT} (${catalog.kits.length} kits)`);
}

main();
