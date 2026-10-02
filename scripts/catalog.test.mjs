import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { describeFunctions, triggerKind, validateCatalog } from './lib/catalog.mjs';

const valid = () => ({
    schemaVersion: 1,
    updatedAt: '2026-10-01',
    publishers: { fuego: { name: 'Fuego', verified: true } },
    kits: [
        {
            id: 'demo-kit',
            name: 'Demo',
            publisher: 'fuego',
            package: '@fuegoapp/kit-demo',
            version: '1.2.3',
            status: 'available',
            integrity: 'sha512-abc',
            readme: 'readme/demo-kit.md',
            replaces: ['firebase/firestore-send-email'],
            params: [{ name: 'COLLECTION', type: 'string' }]
        }
    ]
});

test('the committed catalog is valid', () => {
    const catalog = JSON.parse(readFileSync(new URL('../catalog/v1/catalog.json', import.meta.url)));
    assert.deepEqual(validateCatalog(catalog), []);
});

test('a valid catalog has no errors', () => {
    assert.deepEqual(validateCatalog(valid()), []);
});

test('invalid entries are reported', () => {
    const c = valid();
    c.kits.push({ ...c.kits[0] });
    c.kits[0].version = '^1.2.3';
    c.kits[0].integrity = 'sha1-x';
    c.kits[0].readme = 'https://evil.example/readme.md';
    c.kits[0].params.push({ name: 'lower', type: 'string' }, { name: 'COLLECTION', type: 'json' });
    const errors = validateCatalog(c).join('\n');
    for (const want of ['duplicate id', 'version must be exact', 'sha512 integrity', 'readme must be', 'invalid param name lower', 'duplicate param COLLECTION', 'invalid type json']) {
        assert.match(errors, new RegExp(want));
    }
});

test('announced kits need no integrity', () => {
    const c = valid();
    c.kits[0].status = 'announced';
    delete c.kits[0].integrity;
    assert.deepEqual(validateCatalog(c), []);
});

test('functions are summarised from the manifest endpoints', () => {
    const fns = describeFunctions({
        z: { taskQueueTrigger: {} },
        a: {
            eventTrigger: {
                eventType: 'google.cloud.firestore.document.v1.written',
                eventFilterPathPatterns: { document: '{{ params.COLLECTION }}/{id}' }
            }
        },
        s: { scheduleTrigger: { schedule: 'every 5 minutes' } }
    });
    assert.deepEqual(fns, [
        { name: 'a', trigger: 'firestore', eventType: 'google.cloud.firestore.document.v1.written', resource: '{{ params.COLLECTION }}/{id}' },
        { name: 's', trigger: 'scheduled', schedule: 'every 5 minutes' },
        { name: 'z', trigger: 'taskQueue' }
    ]);
    assert.equal(triggerKind({ eventTrigger: { eventType: 'custom.event.v1' } }), 'eventarc');
});
