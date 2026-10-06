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
