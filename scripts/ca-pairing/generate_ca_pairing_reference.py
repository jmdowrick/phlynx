"""
Writes ca-connections.json beside a CA export in tests/resources/ca/pairing* (tests/resources/ca/pairing by default):
the variable mappings circulatory autogen (CA) generates between the export's modules, which PhLynx wrote from a
workspace in tests/vitest/fixtures/ca/golden.js. tests/vitest/integration/caGolden.integration.test.js checks them
against the workspace's couplings. Run by hand, not in CI, with a Python that has libcuflynx's dependencies, and libcuflynx itself
or a CA checkout's src on PYTHONPATH (CA_COMMIT names that checkout's commit in the reference):

    CA_COMMIT=$(git -C ../circulatory_autogen rev-parse HEAD) PYTHONPATH=../circulatory_autogen/src \
        python scripts/ca-pairing/generate_ca_pairing_reference.py [export directory]
"""
import contextlib
import importlib.metadata
import io
import json
import os
import re
import shutil
import sys
import tempfile

from libcuflynx.scripts.script_generate_with_new_architecture import generate_with_new_architecture

HERE = os.path.dirname(os.path.abspath(__file__))
PAIRING = os.path.abspath(os.path.join(HERE, "..", "..", "tests", "resources", "ca", "pairing"))
PREFIX = "golden"
REFERENCE = "ca-connections.json"


def generate(export_dir):
    """Generates the export's model with CA and returns its CellML. CA writes the CellML before it validates the
    model, so a model that doesn't run still gives its connections."""
    work = tempfile.mkdtemp()
    resources = os.path.join(work, "resources")
    shutil.copytree(export_dir, resources, ignore=shutil.ignore_patterns(REFERENCE))
    config = {
        "file_prefix": PREFIX,
        "input_param_file": f"{PREFIX}_parameters.csv",
        "model_type": "cellml",
        "solver": "CVODE_myokit",
        "resources_dir": resources,
        "generated_models_dir": os.path.join(work, "generated_models"),
        "external_modules_dir": os.path.join(resources, "modules"),
        "DEBUG": False,
    }
    log = io.StringIO()
    with contextlib.redirect_stdout(log):
        try:
            generate_with_new_architecture(False, config)
        except SystemExit:
            pass
    path = os.path.join(work, "generated_models", PREFIX, f"{PREFIX}.cellml")
    if not os.path.exists(path):
        raise RuntimeError(f"CA generated no model:\n{log.getvalue()}")
    with open(path) as f:
        return f.read()


def module_mappings(cellml, names):
    """The variable mappings between two modules of the array, as `<component>.<variable> = ...`, ends sorted."""
    modules = {f"{name}_module" for name in names}
    mappings = set()
    for block in re.findall(r"<connection>(.*?)</connection>", cellml, re.S):
        first, second = re.search(r'component_1="([^"]+)"\s+component_2="([^"]+)"', block).groups()
        if first not in modules or second not in modules:
            continue
        for v1, v2 in re.findall(r'variable_1="([^"]+)"\s+variable_2="([^"]+)"', block):
            mappings.add(" = ".join(sorted([f"{first}.{v1}", f"{second}.{v2}"])))
    return sorted(mappings)


def source():
    """Which CA generated the reference: a checkout's commit (CA_COMMIT), else the installed libcuflynx's version."""
    import libcuflynx

    if os.environ.get("CA_COMMIT"):
        return {"circulatory_autogen": os.environ["CA_COMMIT"]}
    if "site-packages" not in libcuflynx.__file__:
        raise RuntimeError("libcuflynx comes from a checkout: name its commit in CA_COMMIT.")
    return {"libcuflynx": importlib.metadata.version("libcuflynx")}


def main():
    export_dir = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else PAIRING
    with open(os.path.join(export_dir, f"{PREFIX}_module_array.csv")) as f:
        names = [line.split(",")[0].strip() for line in f.read().splitlines()[1:] if line.strip()]
    reference = {"source": source(), "mappings": module_mappings(generate(export_dir), names)}
    with open(os.path.join(export_dir, REFERENCE), "w") as f:
        json.dump(reference, f, indent=1)
        f.write("\n")
    print(f"Wrote {len(reference['mappings'])} module mappings CA generated, from {reference['source']}.")


if __name__ == "__main__":
    main()
