// Configures Monaco's JavaScript/TypeScript language service for the editor:
// compiler options (DOM + ESNext built-ins), diagnostics, and the ambient
// nomad.* + walled.garden schema type declarations.
//
// Call configureLanguageService(monaco) once, after vs/editor/editor.main has
// loaded and before creating the editor. Re-entry is a no-op.

import { NOMAD_DTS } from './types/nomad-dts.js';
import { SCHEMAS_DTS } from './types/schemas-dts.js';
import { WALLED_GARDEN_JSON_SCHEMA } from './types/schemas-json.js';

let configured = false;

export function configureLanguageService(monaco) {
  if (configured) return;
  configured = true;

  const ts = monaco.languages.typescript;

  // Built-in JS/DOM globals plus our ambient libs. Applied to both the
  // JavaScript and TypeScript defaults so .js and .ts models both benefit.
  //
  // `lib` gives the newest ECMAScript + browser-platform globals. Monaco's TS
  // worker (bundled TS 5.x since Monaco moved off the two-file lib blob of the
  // 0.20 era) serves the full lib map, so these names resolve and we get modern
  // globals — customElements, structuredClone, Array.prototype.flat,
  // Object.fromEntries, globalThis, AbortController, etc.
  const compilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: true,
    lib: ['esnext', 'dom', 'dom.iterable'],
    noEmit: true,
    skipLibCheck: true,
  };
  ts.javascriptDefaults.setCompilerOptions(compilerOptions);
  ts.typescriptDefaults.setCompilerOptions(compilerOptions);

  // Show real type-error squiggles. strict mode stays off (Monaco default) so
  // implicit any is tolerated and legitimate dynamic JS isn't over-flagged.
  const diagnosticsOptions = {
    noSemanticValidation: false,
    noSyntacticValidation: false,
    noSuggestionDiagnostics: false,
  };
  ts.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
  ts.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions);

  // Sync models to the worker eagerly so hover/completions work the instant a
  // model is created (the editor creates a fresh model per opened file).
  ts.javascriptDefaults.setEagerModelSync(true);
  ts.typescriptDefaults.setEagerModelSync(true);

  // Ambient type declarations. addExtraLib is global to the defaults object
  // (not per-model), so it persists across the editor's model disposal — add
  // once, never re-add.
  for (const defaults of [ts.javascriptDefaults, ts.typescriptDefaults]) {
    defaults.addExtraLib(NOMAD_DTS, 'ts:nomad.d.ts');
    defaults.addExtraLib(SCHEMAS_DTS, 'ts:walled-garden-schemas.d.ts');
  }

  // JSON files: register the walled.garden schemas so a .json file whose `type`
  // field matches a schema (e.g. index.json or any record) gets that schema's
  // autocomplete + hover + validation. The combined schema discriminates on
  // `type`, so files with any other/no type are left unconstrained.
  if (monaco.languages.json && monaco.languages.json.jsonDefaults) {
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      enableSchemaRequest: false,
      schemas: [
        {
          // walled.garden records (discriminated on `type`) + a manifest branch
          // for non-record .json files; see scripts/gen-schema-dts.mjs
          uri: 'nomad://editor/schemas/walled-garden.json',
          fileMatch: ['*.json'],
          schema: WALLED_GARDEN_JSON_SCHEMA,
        },
      ],
    });
  }
}
