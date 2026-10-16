# circulatory_autogen schemas (vendored)

`module_array.schema.json` and `module_config.schema.json` are copied unchanged from
[circulatory_autogen](https://github.com/physiomelinks/circulatory_autogen)
`src/libcuflynx/schemas/`, at commit `fceb3e3166944c954116b7460bc4a1f98239834f` (master, 2026-10-16).
circulatory_autogen is Apache-2.0 licensed (Copyright 2024–2026 Finbar J. Argus).

They are the reference for PhLynx's readers, which are not bundled with them: the app checks module arrays and
module configs with a hand-written port of CA's `utilities/config_schemas.py` (`../caModuleArray.js`,
`../caModuleConfig.js`), which gives CA's messages and checks what JSON Schema cannot. The vitest suite
(`tests/vitest/services/import/caSchemas.test.js`) validates the same examples against these files, so the two stay
in step. The super-module expansion (`../caSupermodules.js`) ports `utilities/supermodules.py` at the same commit.

To refresh, at a new commit `<sha>`:

```sh
for f in module_array module_config; do
  git -C <circulatory_autogen> show <sha>:src/libcuflynx/schemas/$f.schema.json > src/services/import/ca-schemas/$f.schema.json
done
```

then update the commit here and in `tests/resources/ca-supermodules/README.md`, rerun
`tests/resources/ca-supermodules/regen.py` against that commit, and run the tests.
