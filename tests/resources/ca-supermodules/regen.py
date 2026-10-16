"""Regenerates expected.json: circulatory_autogen's own reading and expansion of the fixtures here.

The JS port (src/services/import/caModuleArray.js, caModuleConfig.js, caSupermodules.js) is tested against it in
tests/vitest/services/import/caSupermodules.golden.test.js. See README.md for the pinned commits.

Run with circulatory_autogen's src on the path, from anywhere:

    CA_COMMIT=<sha> PYTHONPATH=<circulatory_autogen>/src python tests/resources/ca-supermodules/regen.py

CA_COMMIT is recorded in expected.json; without it the commit of the CA checkout is used.

The fixtures in CASES, READER_CASES and CONFIG_CASES are those of circulatory_autogen
tests/test_json_module_arrays.py; LIBRARY_CASES are the two super-module system models of
circulatory-autogen-modules, copied under library/.
"""
import copy
import glob
import json
import os
import subprocess
import tempfile
import warnings

import numpy as np

from libcuflynx.parsers.ModelParsers import merge_default_parameters
from libcuflynx.utilities.config_schemas import (load_supermodule_registry, normalise_module_config_entry,
                                                 normalise_vessel_records, read_module_array_records,
                                                 record_to_style)
from libcuflynx.utilities.parameter_names import model_name
from libcuflynx.utilities.parameterisations import ConflictingGlobalWarning, read_parameter_rows
from libcuflynx.utilities.supermodules import expand_supermodules

HERE = os.path.dirname(os.path.abspath(__file__))
LIBRARY = os.path.join(HERE, 'library')
PARAMETER_HEADER = 'variable_name,units,value,data_reference\n'


def _rec(name, module_type, inp=(), out=(), subtype='nn', **extra):
    record = {'name': name, 'module_type': module_type, 'module_subtype': subtype,
              'inp_instances': list(inp), 'out_instances': list(out)}
    record.update(extra)
    return record


def _to_libcuflynx(record):
    keys = {'module_type': 'vessel_type', 'module_subtype': 'BC_type',
            'inp_instances': 'inp_vessels', 'out_instances': 'out_vessels'}
    return {keys.get(k, k): v for k, v in record.items()}


FLOWPAIR = {
    'module_type': 'flowpair', 'module_subtype': 'supermodule', 'module_format': 'supermodule',
    'description': 'a flow collector and a gain, for tests',
    'submodules': [_rec('coll', 'collector'), _rec('g', 'gain')],
    'default_parameters': 'flowpair_parameters.csv',
}
INNER = {
    'vessel_type': 'inner', 'BC_type': 'supermodule', 'module_format': 'supermodule',
    'submodules': [_rec('g', 'gain', out=['rd']), _rec('rd', 'reader', inp=['g'])],
}
OUTER = {
    'module_type': 'outer', 'module_subtype': 'supermodule', 'module_format': 'supermodule',
    'submodules': [
        _rec('src', 'flow_src', out=['coll']),
        _rec('coll', 'collector', inp=['src']),
        _rec('in', 'inner', subtype='supermodule'),
    ],
}
LOOP_A = {'module_type': 'loop_a', 'module_subtype': 'supermodule', 'module_format': 'supermodule',
          'submodules': [_rec('b', 'loop_b', subtype='supermodule')]}
LOOP_B = {'module_type': 'loop_b', 'module_subtype': 'supermodule', 'module_format': 'supermodule',
          'submodules': [_rec('a', 'loop_a', subtype='supermodule')]}
CHAIN = {
    'module_type': 'chain', 'module_subtype': 'supermodule', 'module_format': 'supermodule',
    'submodules': [
        _rec('src', 'flow_src', out=['p']),
        _rec('p', 'flowpair', subtype='supermodule', inp=['src'], out=['q'],
             per_submodule_inputs={'coll': ['src']}, per_submodule_outputs={'g': ['q']}),
        _rec('q', 'flowpair', subtype='supermodule', inp=['p'], out=['rd'],
             per_submodule_inputs={'coll': ['p']}, per_submodule_outputs={'g': ['rd']}),
        _rec('rd', 'reader', inp=['q']),
    ],
}
SUPERMODULES = [FLOWPAIR, INNER, OUTER, LOOP_A, LOOP_B]
FILES = {'flowpair_parameters.csv': PARAMETER_HEADER + ''.join(
    f'{name},{units},{value},flowpair_default\n' for name, units, value in (
        ('mean_g', 'm3_per_s', '1.5e-05'), ('amp_g', 'dimensionless', '0.25'),
        ('omega_g', 'per_s', '3.0'), ('some_global', 'dimensionless', '7.0')))}


def _flowpair_host(instance='pair', per_inputs=None, per_outputs=None):
    return [
        _rec('src_a', 'flow_src', out=[instance]),
        _rec('src_b', 'flow_src', out=[instance]),
        _rec(instance, 'flowpair', subtype='supermodule',
             per_submodule_inputs=per_inputs if per_inputs is not None else {'coll': ['src_a', 'src_b']},
             per_submodule_outputs=per_outputs if per_outputs is not None else {'g': ['rd']}),
        _rec('rd', 'reader', inp=[instance]),
    ]


def _changed(change, host=None):
    host = host or _flowpair_host()
    change(host)
    return host


def _two_flowpairs_in_a_row():
    return [
        _rec('src', 'flow_src', out=['S1']),
        _rec('S1', 'flowpair', subtype='supermodule', inp=['src'], out=['S2'],
             per_submodule_inputs={'coll': ['src']}, per_submodule_outputs={'g': ['S2']}),
        _rec('S2', 'flowpair', subtype='supermodule', inp=['S1'], out=['rd'],
             per_submodule_inputs={'coll': ['S1']}, per_submodule_outputs={'g': ['rd']}),
        _rec('rd', 'reader', inp=['S2']),
    ]


def _host_linked_twice():
    host = _flowpair_host()
    host[0]['out_instances'] = ['pair', 'pair']
    return host


# Each case expands `records` against SUPERMODULES, with `supermodules` replacing or adding entries (by type) and
# `files` added next to the config.
CASES = [
    dict(name='prefixes_and_links', records=_flowpair_host()),
    dict(name='libcuflynx_keys', records=[_to_libcuflynx(r) for r in _flowpair_host()]),
    dict(name='host_order_prepend_append',
         supermodules=[dict(FLOWPAIR, submodules=[_rec('coll', 'collector', inp=['g']),
                                                  _rec('g', 'gain', out=['coll'])])],
         records=[
             _rec('h1', 'flow_src', out=['x', 'pair', 'y']),
             _rec('pair', 'flowpair', subtype='supermodule',
                  per_submodule_inputs={'g': ['h1'], 'coll': ['h1']},
                  per_submodule_outputs={'g': ['h2']}),
             _rec('h2', 'reader', inp=['a', 'pair', 'b']),
             _rec('x', 'reader'), _rec('y', 'reader'), _rec('a', 'gain'), _rec('b', 'gain'),
         ]),
    dict(name='per_submodule_list_form',
         records=_flowpair_host(per_inputs=[{'coll': ['src_a', 'src_b']}], per_outputs=[{'g': ['rd']}])),
    dict(name='per_submodule_listed_twice',
         records=_flowpair_host(per_inputs=[{'coll': ['src_a']}, {'coll': ['src_b']}])),
    dict(name='parameters_renamed_globals_once', records=_flowpair_host('p1') + [
        _rec('src_c', 'flow_src', out=['p2']),
        _rec('p2', 'flowpair', subtype='supermodule', per_submodule_inputs={'coll': ['src_c']}),
    ]),
    dict(name='error_unknown_submodule',
         records=_changed(lambda h: h[2].update(per_submodule_inputs={'nope': ['src_a', 'src_b']}))),
    dict(name='error_out_host_not_linked',
         records=_changed(lambda h: h[2].update(per_submodule_inputs={'coll': ['src_a']}))),
    dict(name='error_inp_host_not_linked', records=_changed(lambda h: h[2].update(per_submodule_outputs={}))),
    dict(name='error_host_does_not_list_back_out', records=_changed(lambda h: h[0].update(out_instances=[]))),
    dict(name='error_host_does_not_list_back_inp', records=_changed(lambda h: h[3].update(inp_instances=[]))),
    dict(name='error_missing_host',
         records=_changed(lambda h: h[2]['per_submodule_outputs'].update(coll=['ghost']))),
    dict(name='error_name_clash', records=_changed(lambda h: h.append(_rec('pair_g', 'reader')))),
    dict(name='error_unknown_type', records=_changed(lambda h: h[2].update(module_type='nosuch'))),
    dict(name='error_unknown_subtype', records=_changed(lambda h: h[2].update(module_subtype='other'))),
    dict(name='error_host_listed_twice', records=_host_linked_twice()),
    dict(name='error_per_submodule_host_twice',
         records=_flowpair_host(per_inputs={'coll': ['src_a', 'src_a', 'src_b']})),
    dict(name='error_stray_instance_list',
         records=_changed(lambda h: h[2].update(inp_instances=['rd']))),
    dict(name='error_nested_instance_in_per_submodule',
         records=[_rec('h', 'flow_src', out=['o']),
                  _rec('o', 'outer', subtype='supermodule', per_submodule_inputs={'in': ['h']})]),
    dict(name='nested_recursive', records=[_rec('o', 'outer', subtype='supermodule')]),
    dict(name='nested_own_per_submodule',
         supermodules=[dict(OUTER, submodules=[
             _rec('src', 'flow_src', out=['in']),
             _rec('in', 'inner', subtype='supermodule', per_submodule_inputs={'rd': ['src']}),
         ])],
         records=[_rec('o', 'outer', subtype='supermodule')]),
    dict(name='error_cycle', records=[_rec('x', 'loop_a', subtype='supermodule')]),
    dict(name='defaults_reach_nested',
         supermodules=[dict(OUTER, default_parameters='outer_parameters.csv')],
         files={'outer_parameters.csv': PARAMETER_HEADER + 'mean_in_g,m3_per_s,2e-05,outer\n'
                'mean_coll,m3_per_s,1e-05,outer\nsome_global,dimensionless,3,outer\n'},
         records=[_rec('o', 'outer', subtype='supermodule')]),
    dict(name='path_parameters',
         supermodules=[dict(OUTER, default_parameters='outer_parameters.csv')],
         files={'outer_parameters.csv': PARAMETER_HEADER + 'in/g/mean,m3_per_s,2e-05,outer\n'
                'coll/mean,m3_per_s,1e-05,outer\nglobal/some_global,dimensionless,3,outer\nR,J_per_mol_K,8.3,outer\n'},
         records=[_rec('o', 'outer', subtype='supermodule')]),
    dict(name='error_path_parameter_not_a_submodule',
         supermodules=[dict(OUTER, default_parameters='outer_parameters.csv')],
         files={'outer_parameters.csv': PARAMETER_HEADER + 'nope/mean,m3_per_s,2e-05,outer\n'},
         records=[_rec('o', 'outer', subtype='supermodule')]),
    dict(name='two_flowpairs_in_order', records=_two_flowpairs_in_a_row()),
    dict(name='two_flowpairs_reversed', records=[_two_flowpairs_in_a_row()[i] for i in (0, 2, 1, 3)]),
    dict(name='sibling_instances_inside_a_supermodule', supermodules=[CHAIN],
         records=[_rec('c', 'chain', subtype='supermodule')]),
    # a record's parameterisation wins over the entry's default_parameters, and an outer supermodule's values over
    # a nested one's; a global set differently by two instances is a conflict, by an outer and its nested one not
    dict(name='parameterisation_before_default_parameters',
         supermodules=[dict(FLOWPAIR, default_parameterisation='missing')],
         files={'parameterisations/alt/alt_parameters.csv': PARAMETER_HEADER +
                'g/mean,m3_per_s,9e-05,alt\nsome_global,dimensionless,9.0,alt\ncoll/extra,m3,1,alt\n'},
         records=_flowpair_host('p1') + [
             _rec('src_c', 'flow_src', out=['p2']),
             _rec('p2', 'flowpair', subtype='supermodule', parameterisation='alt',
                  per_submodule_inputs={'coll': ['src_c']}),
         ]),
    dict(name='outer_before_nested',
         supermodules=[dict(OUTER, default_parameters='outer_parameters.csv'),
                       dict(INNER, default_parameters='inner_parameters.csv')],
         files={'outer_parameters.csv': PARAMETER_HEADER + 'in/g/mean,m3_per_s,2e-05,outer\n'
                'global/some_global,dimensionless,3,outer\n',
                'inner_parameters.csv': PARAMETER_HEADER + 'g/mean,m3_per_s,4e-05,inner\n'
                'rd/gain,dimensionless,0.5,inner\nsome_global,dimensionless,5,inner\n'},
         records=[_rec('o', 'outer', subtype='supermodule')]),
    dict(name='error_unknown_parameterisation',
         files={'parameterisations/alt/alt_parameters.csv': PARAMETER_HEADER + 'g/mean,m3_per_s,9e-05,alt\n'},
         records=_changed(lambda h: h[2].update(parameterisation='nosuch'))),
]

READER_CASES = [
    dict(name='space_separated_and_null', records=[
        {'name': 'a', 'module_type': 'x', 'module_subtype': 'nn', 'out_instances': 'b  c', 'inp_instances': None},
        _rec('b', 'flow_src', out=['b c']),
        {'name': 'c', 'vessel_type': 'x', 'BC_type': 'nn', 'inp_vessels': None, 'out_vessels': None},
    ]),
    dict(name='unknown_keys_kept', records=[
        {'name': 'a', 'module_type': 'x', 'module_subtype': 'nn', 'label': 'vessel 0', 'description': 'kept',
         'phlynx_layout': {'x': 1, 'y': [2, 3]}, 'parameterisation': ' healthy '},
    ]),
    dict(name='per_submodule_forms', records=[
        {'name': 'h', 'vessel_type': 'heart', 'BC_type': 'v1',
         'per_submodule_inputs': {'ra': 'svc ivc', 'la': ['pvn']},
         'per_submodule_outputs': [{'aov': ['aorta']}, {'puv': None}]},
    ]),
    dict(name='error_mixed_keys', records=[
        _rec('ok', 'flow_src'), {'name': 'a', 'module_type': 'x', 'module_subtype': 'nn', 'out_vessels': []}]),
    dict(name='error_mixed_keys_libcuflynx', records=[
        _rec('ok', 'flow_src'), {'name': 'a', 'vessel_type': 'x', 'BC_type': 'nn', 'module_subtype': 'nn'}]),
    dict(name='error_missing_subtype', records=[_rec('ok', 'flow_src'), {'name': 'a', 'module_type': 'x'}]),
    dict(name='error_missing_name', records=[_rec('ok', 'flow_src'), {'module_type': 'x', 'module_subtype': 'nn'}]),
    dict(name='error_bad_list', records=[
        _rec('ok', 'flow_src'), {'name': 'a', 'module_type': 'x', 'module_subtype': 'nn', 'inp_instances': [1]}]),
    dict(name='error_bad_per_submodule_item', records=[
        _rec('ok', 'flow_src'), {'name': 'a', 'module_type': 'x', 'module_subtype': 'nn',
                                 'per_submodule_inputs': [{'p': ['h'], 'q': ['h']}]}]),
    dict(name='error_not_a_record', records=[_rec('ok', 'flow_src'), 'not a record']),
    dict(name='error_whitespace_name', records=[{'name': 'a b', 'vessel_type': 'heart', 'BC_type': 'vp'}]),
    dict(name='error_whitespace_subtype', records=[{'name': 'a', 'module_type': 'heart', 'module_subtype': 'v p'}]),
    dict(name='error_parameterisation_path', records=[
        {'name': 'a', 'module_type': 'x', 'module_subtype': 'nn', 'parameterisation': 'a/b'}]),
]

CONFIG_CASES = [
    dict(name='supermodule_phlynx_keys', entry=FLOWPAIR),
    dict(name='supermodule_libcuflynx_keys', entry=INNER),
    dict(name='supermodule_default_instance', entry=dict(FLOWPAIR, default_instance='healthy')),
    dict(name='error_component_key', entry=dict(FLOWPAIR, component_file='x.cellml')),
    dict(name='error_mixed_keys', entry=dict(FLOWPAIR, BC_type='supermodule')),
    dict(name='error_no_submodules', entry=dict(FLOWPAIR, submodules=[])),
    dict(name='error_not_a_sibling', entry=dict(FLOWPAIR, submodules=[_rec('a', 'gain', out=['nowhere'])])),
    dict(name='error_repeated_submodule', entry=dict(FLOWPAIR, submodules=[_rec('a', 'gain'), _rec('a', 'reader')])),
    dict(name='error_bad_submodule_record', entry={
        'module_type': 'x', 'module_subtype': 's', 'module_format': 'supermodule',
        'submodules': [{'name': 'I_p', 'module_type': 'inertance'}]}),
    dict(name='error_module_format', entry=dict(FLOWPAIR, module_format='cellml')),
    dict(name='error_both_default_names', entry=dict(FLOWPAIR, default_parameterisation='a', default_instance='b')),
    dict(name='component_libcuflynx_keys', entry={
        'vessel_type': 'v', 'BC_type': 'nn', 'module_file': 'v.cellml', 'module_type': 'v_type',
        'entrance_ports': [{'port_type': 'p', 'variables': ['x']}], 'exit_ports': [],
        'variables_and_units': [['x', 'm', 'access', 'variable']], 'default_instance': 'healthy'}),
    dict(name='error_component_missing_file', entry={
        'vessel_type': 'v', 'BC_type': 'nn', 'module_type': 'v_type'}),
    dict(name='error_component_mixed', entry={
        'module_type': 'a', 'module_subtype': 'nn', 'component_file': 'f.cellml', 'component_type': 'a_type',
        'BC_type': 'nn'}),
    dict(name='error_component_phlynx_missing', entry={'module_type': 'a', 'module_subtype': 'nn'}),
    dict(name='error_component_neither', entry={'description': 'nothing'}),
]

LIBRARY_CASES = [
    dict(name='3compartment_supermodules',
         array='system_models/closed_loop_cvs/3compartment_supermodules/3compartment_supermodules_module_array.json',
         parameters='system_models/closed_loop_cvs/3compartment_supermodules/3compartment_supermodules_parameters.csv'),
    dict(name='SN_simple_supermodules',
         array='system_models/cellular/SN_simple_supermodules/SN_simple_supermodules_module_array.json',
         parameters='system_models/cellular/SN_simple_supermodules/SN_simple_supermodules_parameters.csv'),
]


def _outcome(run):
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        try:
            result = run()
        except ValueError as error:
            return {'error': str(error)}
    result['warnings'] = sorted({str(w.message) for w in caught if issubclass(w.category, FutureWarning)})
    result['conflicts'] = [str(w.message) for w in caught if issubclass(w.category, ConflictingGlobalWarning)]
    return result


def _expansion_case(case):
    by_type = {}
    for entry in SUPERMODULES + case.get('supermodules', []):
        by_type[(entry.get('module_type', entry.get('vessel_type')),
                 entry.get('module_subtype', entry.get('BC_type')))] = copy.deepcopy(entry)
    supermodules = list(by_type.values())
    files = dict(FILES, **case.get('files', {}))
    with tempfile.TemporaryDirectory() as directory:
        config = os.path.join(directory, 'super_modules_config.json')
        with open(config, 'w') as f:
            json.dump(supermodules, f)
        for name, text in files.items():
            os.makedirs(os.path.dirname(os.path.join(directory, name)), exist_ok=True)
            with open(os.path.join(directory, name), 'w') as f:
                f.write(text)
        registry = load_supermodule_registry([config])

        def run():
            records, rows = expand_supermodules(normalise_vessel_records(case['records'], 'test'), registry, 'test')
            return {'records': [record_to_style(r) for r in records], 'parameter_rows': rows}
        # file names relative to the config, as the JS test gives them
        outcome = json.loads(json.dumps(_outcome(run)).replace(directory + os.sep, ''))
    return dict(name=case['name'], supermodules=supermodules, files=files, records=case['records'], expected=outcome)


def _reader_case(case):
    def run():
        return {'records': [record_to_style(r) for r in normalise_vessel_records(case['records'], 'test.json')]}
    return dict(name=case['name'], records=case['records'], expected=_outcome(run))


def _config_case(case):
    def run():
        entry = normalise_module_config_entry(case['entry'], 'lib/x_modules_config.json')
        if 'submodules' in entry:
            entry['submodules'] = [record_to_style(r) for r in entry['submodules']]
        return {'entry': entry}
    return dict(name=case['name'], entry=case['entry'], expected=_outcome(run))


def _library_case(case):
    configs = sorted(glob.glob(os.path.join(LIBRARY, 'modules', '**', '*_modules_config.json'), recursive=True))
    registry = load_supermodule_registry(configs)
    array = os.path.join(LIBRARY, case['array'])

    def run():
        records, rows = expand_supermodules(read_module_array_records(array), registry, case['array'])
        host = read_parameter_rows(os.path.join(LIBRARY, case['parameters']), case['parameters'])
        columns = ('variable_name', 'units', 'value', 'data_reference')
        dtype = [(c, '<U1000') for c in columns]
        host_array = np.array([tuple(model_name(r[c]) if c == 'variable_name' else r[c] for c in columns)
                               for r in host], dtype=dtype)
        merged = merge_default_parameters(host_array, rows)
        return {'records': [record_to_style(r) for r in records], 'parameter_rows': rows,
                'merged_parameters': [dict(zip(columns, row)) for row in merged.tolist()]}
    # paths relative to library/, so expected.json does not depend on where it was written
    outcome = json.loads(json.dumps(_outcome(run)).replace(LIBRARY + os.sep, ''))
    return dict(name=case['name'], array=case['array'], parameters=case['parameters'], expected=outcome)


def _commit(path):
    try:
        return subprocess.run(['git', '-C', path, 'rev-parse', 'HEAD'], capture_output=True, text=True,
                              check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def main():
    import libcuflynx
    expected = {
        'generated_by': 'regen.py',
        'circulatory_autogen': os.environ.get('CA_COMMIT') or _commit(os.path.dirname(libcuflynx.__file__)),
        'expansion': [_expansion_case(case) for case in CASES],
        'reader': [_reader_case(case) for case in READER_CASES],
        'config': [_config_case(case) for case in CONFIG_CASES],
        'library': [_library_case(case) for case in LIBRARY_CASES],
    }
    with open(os.path.join(HERE, 'expected.json'), 'w') as f:
        json.dump(expected, f, indent=1)
        f.write('\n')


if __name__ == '__main__':
    main()
