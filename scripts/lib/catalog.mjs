// Catalog format v1: the shared rules of the generator. The Fuego app applies
// the same rules (internal/functions/catalog/validate.go) before trusting a
// downloaded catalog, so a change here must land there too.

export const SCHEMA_VERSION = 1;
export const STATUSES = ['available', 'preview', 'announced'];
export const PARAM_TYPES = ['string', 'int', 'float', 'boolean', 'list', 'secret'];

const KIT_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const PARAM_NAME = /^[A-Z][A-Z0-9_]*$/;
const EXTENSION_REF = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const README_PATH = /^readme\/[a-z0-9_-]+\.md$/;

/** Trigger kind of a manifest endpoint (same kinds as the Fuego app). */
export function triggerKind(endpoint) {
    if (endpoint.httpsTrigger) return 'https';
    if (endpoint.callableTrigger) return 'callable';
    if (endpoint.taskQueueTrigger) return 'taskQueue';
    if (endpoint.scheduleTrigger) return 'scheduled';
    if (endpoint.blockingTrigger) return 'blocking';
    const type = endpoint.eventTrigger?.eventType ?? '';
    const kinds = [
        ['google.cloud.firestore.', 'firestore'],
        ['google.cloud.datastore.', 'datastore'],
        ['google.cloud.storage.', 'storage'],
        ['google.cloud.pubsub.', 'pubsub'],
        ['google.firebase.database.', 'database'],
        ['google.firebase.auth.', 'auth'],
        ['google.firebase.remoteconfig.', 'remoteConfig'],
        ['google.firebase.testlab.', 'testLab'],
        ['google.firebase.firebasealerts.', 'alerts']
    ];
    for (const [prefix, kind] of kinds) {
        if (type.startsWith(prefix)) return kind;
    }
    return type ? 'eventarc' : 'other';
}

/** One catalog function per manifest endpoint, sorted by name. */
export function describeFunctions(endpoints = {}) {
    return Object.entries(endpoints)
        .map(([name, ep]) => {
            const fn = { name, trigger: triggerKind(ep) };
            const et = ep.eventTrigger;
            if (et) {
                fn.eventType = et.eventType;
                const resource =
                    et.eventFilterPathPatterns?.document ??
                    et.eventFilters?.document ??
                    et.eventFilterPathPatterns?.ref ??
                    et.eventFilters?.bucket ??
                    et.eventFilters?.topic;
                if (typeof resource === 'string') fn.resource = resource;
            }
            if (ep.blockingTrigger?.eventType) fn.eventType = ep.blockingTrigger.eventType;
            if (typeof ep.scheduleTrigger?.schedule === 'string') fn.schedule = ep.scheduleTrigger.schedule;
            return fn;
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** Errors of a catalog document; empty when it is valid. */
export function validateCatalog(catalog) {
    const errors = [];
    const err = (msg) => errors.push(msg);
    if (catalog?.schemaVersion !== SCHEMA_VERSION) err(`schemaVersion must be ${SCHEMA_VERSION}`);
    if (typeof catalog?.updatedAt !== 'string' || !catalog.updatedAt) err('updatedAt is required');
    const publishers = catalog?.publishers ?? {};
    if (!Array.isArray(catalog?.kits)) {
        err('kits must be an array');
        return errors;
    }
    const ids = new Set();
    for (const kit of catalog.kits) {
        const where = `kit ${kit?.id ?? '?'}`;
        if (!KIT_ID.test(kit?.id ?? '')) err(`${where}: invalid id`);
        if (ids.has(kit.id)) err(`${where}: duplicate id`);
        ids.add(kit.id);
        if (!kit.name) err(`${where}: name is required`);
        if (!publishers[kit.publisher]) err(`${where}: unknown publisher ${kit.publisher}`);
        if (!NPM_NAME.test(kit.package ?? '')) err(`${where}: invalid package`);
        if (!EXACT_VERSION.test(kit.version ?? '')) err(`${where}: version must be exact`);
        if (!STATUSES.includes(kit.status)) err(`${where}: invalid status`);
        if (kit.status !== 'announced' && !/^sha512-/.test(kit.integrity ?? '')) err(`${where}: sha512 integrity is required`);
        if (kit.readme !== undefined && !README_PATH.test(kit.readme)) err(`${where}: readme must be readme/<file>.md`);
        for (const key of ['repository', 'homepage', 'npmUrl']) {
            if (kit[key] !== undefined && !String(kit[key]).startsWith('https://')) err(`${where}: ${key} must be https`);
        }
        for (const ref of kit.replaces ?? []) {
            if (!EXTENSION_REF.test(ref)) err(`${where}: invalid extension reference ${ref}`);
        }
        const names = new Set();
        for (const p of kit.params ?? []) {
            if (!PARAM_NAME.test(p?.name ?? '')) err(`${where}: invalid param name ${p?.name}`);
            if (names.has(p.name)) err(`${where}: duplicate param ${p.name}`);
            names.add(p.name);
            if (!PARAM_TYPES.includes(p.type)) err(`${where}: param ${p.name} has invalid type ${p.type}`);
        }
    }
    return errors;
}
