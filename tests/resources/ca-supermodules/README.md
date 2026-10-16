# circulatory_autogen super-module goldens

Expected outputs of circulatory_autogen (CA) for the JS port of its module-array readers and super-module expansion
(`src/services/import/caModuleArray.js`, `caModuleConfig.js`, `caSupermodules.js`), compared in
`tests/vitest/services/import/caSupermodules.golden.test.js` and `caSchemas.test.js`.

- **circulatory_autogen** commit `fceb3e3166944c954116b7460bc4a1f98239834f` (master, 2026-10-16), Apache-2.0
  (`LICENSE-circulatory_autogen`, Copyright 2024–2026 Finbar J. Argus). The fixtures in `regen.py` are those of its
  `tests/test_json_module_arrays.py`.
- **circulatory-autogen-modules** commit `3c49ab0e48c01e37e7def333d72245533961bac3` (main, 2026-10-14), Apache-2.0
  (`LICENSE-circulatory-autogen-modules`); the module configs are marked CC0-1.0. `library/` holds, unchanged and at
  their paths in that repository, the `3compartment_supermodules` and `SN_simple_supermodules` system models (module
  array and parameters) and the super-module configs they use (heart `Argus2026_v01`; neuron, soma and varicosity
  `sympathetic`) with their default parameterisations, and the component module versions those use (CellML, units,
  config and the parameterisations the super-modules name), which
  `tests/vitest/integration/caSupermoduleImport.integration.test.js` imports.

`expected.json` is written by `regen.py`, which runs CA's own `normalise_vessel_records`,
`normalise_module_config_entry`, `expand_supermodules` and `merge_default_parameters` on every fixture. CA joins
levels with `_` (`heart_ra`) until CA#582; the golden test also expands the system models with PhLynx's `__` and
maps the names back by path.

To regenerate, against a checkout (or `git archive`) of CA at the pinned commit:

```sh
CA_COMMIT=<sha> PYTHONPATH=<circulatory_autogen>/src python tests/resources/ca-supermodules/regen.py
```

CA needs its Python dependencies (numpy, pandas...). After moving to a new CA or modules commit, update the commits
here and in `src/services/import/ca-schemas/README.md`, copy the files under `library/` again, and rerun the tests.
