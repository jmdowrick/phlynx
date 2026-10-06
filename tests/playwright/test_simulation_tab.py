import os
import unittest

from playwright.sync_api import expect, sync_playwright

try:
    from .config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
except ImportError:
    from config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH


# Automated browsers skip the isolation service worker unless they opt in (see index.html).
OPT_IN_TO_ISOLATION = "localStorage.setItem('phlynx.isolateUnderAutomation', 'true')"
# A short simulation, so the test doesn't wait on the default 10 s of model time.
SHORTEN_SIMULATION = (
    "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
    ".get('simulationSettings').setSimulationSettings({ endingPoint: 1, pointInterval: 0.01 })"
)
APP_MOUNT_TIMEOUT = 60000
RESULTS_STORE = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulationResults')"
FINAL_SOMA_V = (
    f"(() => {{ const store = {RESULTS_STORE}; const name = store.mapping.get('dndnode_0::V');"
    " return store.results.variables.get(name).values.at(-1) })()"
)


class TestSimulationTab(unittest.TestCase):

    def test_simulate_a_selected_instance_and_plot_a_variable(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            soma = page.get_by_text("SN_somacell_modules.cellmlsoma_SN")
            soma.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            soma.click(button="right")
            expect(page.get_by_text("Simulate Instance")).to_be_visible()
            page.keyboard.press("Escape")
            soma.click()

            page.locator(".resizable-context-panel .aside-collapse-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            page.get_by_role("button", name="Simulate selection").click()

            expect(page.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=120000)
            page.get_by_role("checkbox", name="Plot V", exact=True).check()
            expect(page.locator(".simulation-plot canvas")).to_have_count(1)
            expect(page.locator(".simulation-plot .plot-title")).to_have_text("V")
            expect(page.locator(".simulation-plot .u-legend")).to_contain_text("V")
            expect(page.locator(".instance-node--simulated")).to_have_count(1)

            # A variable in another unit gets its own chart, which the tab scrolls to.
            page.get_by_role("checkbox", name="Plot m", exact=True).check()
            expect(page.locator(".simulation-plot")).to_have_count(2)
            second_chart = page.locator(".simulation-plot").nth(1)
            second_chart.scroll_into_view_if_needed()
            expect(second_chart).to_be_in_viewport()
            # ----------- END ------------

            context.close()
            browser.close()


    def test_slider_tries_a_parameter_value_and_applies_it(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            soma = page.get_by_text("SN_somacell_modules.cellmlsoma_SN")
            soma.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            soma.click()
            page.locator(".resizable-context-panel .aside-collapse-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            page.get_by_role("button", name="Simulate selection").click()
            expect(page.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=120000)
            before = page.evaluate(FINAL_SOMA_V)

            page.get_by_role("combobox", name="Add a slider").click()
            page.get_by_role("option", name="g_Na", exact=True).click()
            page.get_by_role("slider", name="g_Na value").focus()
            for _ in range(300):
                page.keyboard.press("ArrowRight")
            expect(page.locator(".slider-value--changed")).to_have_text("2.438 microS")
            # The slider asks for a run, which gives a different end value.
            page.wait_for_function(
                f"{RESULTS_STORE}.status === 'done' && {FINAL_SOMA_V} !== {before!r}",
                timeout=120000,
            )

            page.get_by_role("button", name="Apply g_Na to the model").click()
            expect(page.locator(".slider-value--changed")).to_have_count(0)
            expect(page.locator(".slider-value")).to_have_text("2.438 microS")
            expect(page.get_by_text("The model or settings have changed since this run.")).to_have_count(0)
            # ----------- END ------------

            context.close()
            browser.close()


if __name__ == '__main__':
    unittest.main()
