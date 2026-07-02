// Codegen for the ADR-0010 Q6 spike (app/scripts/spike-hyperdb-view.mjs).
// Generates a HyperDB definition — one collection ('@fs/files', a path→file record) plus a
// non-unique SECONDARY INDEX ('@fs/files-by-tag') — so the spike can test whether HyperDB's
// index maintenance survives Autobase re-running apply() on a reorg. THROWAWAY (generated
// output, not wired into the app). The spike runs this automatically if the def is absent.
//
// Must resolve hyperschema + hyperdb/builder from app/node_modules, so it lives under app/.
//   node scripts/build-hyperdb-def.cjs [SCHEMA_DIR] [DB_DIR]
const path = require('path')
const Hyperschema = require('hyperschema')
const HyperDB = require('hyperdb/builder')

const SPEC = path.join(__dirname, 'hyperdb-spec')
const SCHEMA_DIR = process.argv[2] || path.join(SPEC, 'schema')
const DB_DIR = process.argv[3] || path.join(SPEC, 'db')

const schema = Hyperschema.from(SCHEMA_DIR)
const fs = schema.namespace('fs')
fs.register({
  name: 'file',
  compact: true,
  fields: [
    { name: 'path', type: 'string', required: true },
    { name: 'body', type: 'string', required: false },
    { name: 'tag', type: 'string', required: false },
  ],
})
Hyperschema.toDisk(schema)

const db = HyperDB.from(SCHEMA_DIR, DB_DIR)
const fsdb = db.namespace('fs')
fsdb.collections.register({ name: 'files', schema: '@fs/file', key: ['path'] })
// Secondary index by tag (non-unique). Array key => indexed directly off collection fields,
// so no map-helper module is needed. Non-unique => the primary key is appended automatically.
fsdb.indexes.register({ name: 'files-by-tag', collection: '@fs/files', unique: false, key: ['tag'] })
HyperDB.toDisk(db)

console.log('hyperdb codegen OK ->', DB_DIR)
