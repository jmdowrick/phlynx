import { CVODE_KISAO_ID, CVODE_PARAMETERS, buildUniformTimeCourse } from '../simulation/sedParameters'

/**
 * Writes the SED-ML document for a model and its simulation settings.
 *
 * @param {Object} simData - Simulation settings (simulationSettingsStore.simulationSettings).
 * @param {string} [cellmlFileName='model.cellml']
 * @returns {string}
 */
export function generateSedmlData(simData, cellmlFileName = 'model.cellml') {
  const { initialTime, outputStartTime, outputEndTime, numberOfSteps } = buildUniformTimeCourse(simData)
  const parameters = CVODE_PARAMETERS.map(
    ({ kisaoId, value }) => `          <algorithmParameter kisaoID="${kisaoId}" value="${value}"/>`
  ).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<sedML xmlns="http://sed-ml.org/sed-ml/level1/version4" level="1" version="4">
  <listOfModels>
    <model id="model1" language="urn:sedml:language:cellml" source="${cellmlFileName}">
    </model>
  </listOfModels>
  <listOfSimulations>
    <uniformTimeCourse id="simulation1" initialTime="${initialTime}" outputStartTime="${outputStartTime}" outputEndTime="${outputEndTime}" numberOfSteps="${numberOfSteps}">
      <algorithm kisaoID="${CVODE_KISAO_ID}">
        <listOfAlgorithmParameters>
${parameters}
        </listOfAlgorithmParameters>
      </algorithm>
    </uniformTimeCourse>
  </listOfSimulations>
  <listOfTasks>
    <task id="task1" modelReference="model1" simulationReference="simulation1"/>
  </listOfTasks>
</sedML>`
}
