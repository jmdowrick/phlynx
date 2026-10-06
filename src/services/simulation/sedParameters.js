/**
 * How simulation settings become SED values, shared by the in-app engine and the SED-ML export so that
 * PhLynx and web OpenCOR run the same simulation.
 */

/**
 * The CVODE settings every simulation uses, as written in SED-ML: their KiSAO ids, libOpenCOR's names for
 * them, and their values as text. The solver isn't configurable yet.
 */
export const CVODE_PARAMETERS = [
  { kisaoId: 'KISAO:0000209', name: 'relativeTolerance', value: '1e-07' },
  { kisaoId: 'KISAO:0000211', name: 'absoluteTolerance', value: '1e-07' },
  { kisaoId: 'KISAO:0000415', name: 'maximumNumberOfSteps', value: '500' },
  { kisaoId: 'KISAO:0000467', name: 'maximumStep', value: '0' },
  { kisaoId: 'KISAO:0000475', name: 'integrationMethod', value: 'BDF' },
  { kisaoId: 'KISAO:0000476', name: 'iterationType', value: 'Newton' },
  { kisaoId: 'KISAO:0000477', name: 'linearSolver', value: 'Dense' },
  { kisaoId: 'KISAO:0000478', name: 'preconditioner', value: 'Banded' },
  { kisaoId: 'KISAO:0000479', name: 'upperHalfBandwidth', value: '0' },
  { kisaoId: 'KISAO:0000480', name: 'lowerHalfBandwidth', value: '0' },
  { kisaoId: 'KISAO:0000481', name: 'interpolateSolution', value: 'true' },
]

/** The KiSAO id of CVODE. */
export const CVODE_KISAO_ID = 'KISAO:0000019'

/**
 * Builds a uniform time course from the simulation settings. The times are passed on as given, as the
 * SED-ML export has always written them.
 *
 * @param {{initialPoint: number, startingPoint: number, endingPoint: number, pointInterval: number}} settings
 * @returns {{initialTime: number, outputStartTime: number, outputEndTime: number, numberOfSteps: number}}
 */
export function buildUniformTimeCourse(settings) {
  return {
    initialTime: settings.initialPoint,
    outputStartTime: settings.startingPoint,
    outputEndTime: settings.endingPoint,
    // Web OpenCOR counts steps this way too, so the two give the same points.
    numberOfSteps: Math.floor((settings.endingPoint - settings.startingPoint) / settings.pointInterval),
  }
}
