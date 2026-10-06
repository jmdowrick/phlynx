import math
import unittest

from playwright.sync_api import sync_playwright

try:
    from .config import BASE_URL, HEADLESS_MODE
except ImportError:
    from config import BASE_URL, HEADLESS_MODE


# Automated browsers skip the isolation service worker unless they opt in (see index.html).
OPT_IN_TO_ISOLATION = "localStorage.setItem('phlynx.isolateUnderAutomation', 'true')"
SIMULATOR_STATE = "({ ...document.querySelector('#app').__vue_app__._context.provides.$libopencor })"
SIMULATOR_STATUS = "document.querySelector('#app')?.__vue_app__?._context?.provides?.$libopencor?.status"
# A cold dev server compiles the app on its first request, which can take a while on CI.
APP_MOUNT_TIMEOUT = 60000

# Whether the page comes from Vite's dev server, which serves the app's source modules.
IS_DEV_SERVER = (
    "fetch('/@vite/client').then((response) => response.ok"
    " && /javascript/.test(response.headers.get('content-type') ?? ''), () => false)"
)

# A decay model, dx/dt = -k x, solved through the app's engine. It imports source modules, so it needs the
# dev server (as CI uses).
SOLVE_DECAY = """async () => {
  const engine = await import('/src/services/simulation/engine.js')
  const loader = await import('/src/services/simulation/libopencorLoader.js')
  const cellml = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
  <component name="decay">
    <variable name="t" units="second"/>
    <variable name="x" units="dimensionless" initial_value="1"/>
    <variable name="k" units="per_second" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply></apply>
    </math>
  </component>
</model>`
  const module = await loader.whenLibOpenCORReady()
  const settings = { initialPoint: 0, startingPoint: 0, endingPoint: 4, pointInterval: 0.1 }
  const result = await engine.startSimulation({ module, cellml, settings }).promise
  return { points: result.voi.values.length, tEnd: result.voi.values.at(-1), xEnd: result.variables.get('decay/x').values.at(-1) }
}"""


class TestSimulator(unittest.TestCase):

    def test_simulator_loads_in_the_background(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context()
            context.add_init_script(OPT_IN_TO_ISOLATION)
            page = context.new_page()
            page.goto(BASE_URL, wait_until="commit")

            # ---------- START -----------
            page.wait_for_function(
                f"['ready', 'error', 'unavailable'].includes({SIMULATOR_STATUS})",
                timeout=APP_MOUNT_TIMEOUT + 90000,
            )
            state = page.evaluate(SIMULATOR_STATE)
            self.assertEqual(state["status"], "ready", state["reason"])
            self.assertRegex(state["versionString"], r"^\d+\.\d+\.\d+$")
            self.assertTrue(page.evaluate("crossOriginIsolated"))
            # ----------- END ------------

            context.close()
            browser.close()

    def test_engine_solves_a_model(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context()
            context.add_init_script(OPT_IN_TO_ISOLATION)
            page = context.new_page()
            page.goto(BASE_URL, wait_until="commit")

            # ---------- START -----------
            page.wait_for_function("window.crossOriginIsolated === true", timeout=30000)
            if not page.evaluate(IS_DEV_SERVER):
                self.skipTest("The app's source modules aren't served here; run against the dev server.")
            result = page.evaluate(SOLVE_DECAY)
            self.assertEqual(result["points"], 41)
            self.assertAlmostEqual(result["tEnd"], 4)
            self.assertAlmostEqual(result["xEnd"], math.exp(-2), places=5)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_simulator_is_unavailable_without_isolation(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context()
            page = context.new_page()
            requests = []
            page.on("request", lambda request: "/libopencor/" in request.url and requests.append(request.url))
            page.goto(BASE_URL)

            # ---------- START -----------
            page.wait_for_function(f"{SIMULATOR_STATUS} === 'unavailable'", timeout=APP_MOUNT_TIMEOUT)
            self.assertEqual(requests, [])
            # ----------- END ------------

            context.close()
            browser.close()


if __name__ == '__main__':
    unittest.main()
