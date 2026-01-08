import Papa from 'papaparse'

import { IMPORT_KEYS } from './constants'

const parseVesselCsv = (file) => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      trimHeaders: true,
      transform: (v) => v.trim(),
      complete: (results) => {
        if (
          !(
            results.data?.length > 0 &&
            'name' in results.data[0] &&
            'BC_type' in results.data[0] &&
            'vessel_type' in results.data[0] &&
            'inp_vessels' in results.data[0] &&
            'out_vessels' in results.data[0]
          )
        ) {
          reject(new Error('Invalid vessel array file format.'))
        }
        resolve(results.data)
      },
      error: (err) => reject(err),
    })
  })
}

// Parser for JSON (Modules/Configs)
const parseModuleJson = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result)
        if (
          !(
            parsed.length > 0 &&
            'entrance_ports' in parsed[0] &&
            'exit_ports' in parsed[0] &&
            'general_ports' in parsed[0] &&
            'BC_type' in parsed[0] &&
            'vessel_type' in parsed[0] &&
            'module_format' in parsed[0] &&
            'module_file' in parsed[0] &&
            'module_type' in parsed[0]
          )
        ) {
          throw new Error('Invalid module configuration file format.')
        }
        resolve(parsed)
      } catch (err) {
        reject(err)
      }
    }
    reader.readAsText(file)
  })
}

const configs = {
  [IMPORT_KEYS.VESSEL]: {
    title: 'Import Vessel Array and Module Configuration',
    fields: [
      {
        key: 'vessels',
        label: 'Select Vessel Array (.csv)',
        accept: '.csv',
        parser: parseVesselCsv,
      },
      {
        key: 'module',
        label: 'Module JSON',
        accept: '.json',
        parser: parseModuleJson,
      },
    ],
  },
  [IMPORT_KEYS.MODULE]: {
    title: 'Import Module Configuration',
    fields: [
      {
        key: 'module',
        label: 'Select Module Config (.json)',
        accept: '.json',
        parser: parseModuleJson,
      },
    ],
  },
  vesselModuleConfig: {
    title: 'Import Vessels and Module Configuration',
    fields: [
      {
        key: 'vessels',
        label: 'Vessel CSV',
        accept: '.csv',
        parser: parseVesselCsv,
      },
      {
        key: 'module',
        label: 'Module JSON',
        accept: '.json',
        parser: parseModuleJson,
      },
    ],
  },
}

export function getImportConfig(type) {
  return configs[type] || null
}
