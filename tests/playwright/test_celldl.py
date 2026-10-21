import os
import re
import unittest

from playwright.sync_api import expect, sync_playwright

try:
    from .config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
except ImportError:
    from config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH


# Automated browsers skip the isolation service worker unless they opt in (see index.html).
OPT_IN_TO_ISOLATION = "localStorage.setItem('phlynx.isolateUnderAutomation', 'true')"
APP_MOUNT_TIMEOUT = 60000
DIAGRAM_TIMEOUT = 90000
SIMULATION_TIMEOUT = 120000

# An RC circuit's discharge drawn in the CellDL editor: a 0-junction (ID-00000001) bonded to a capacitor
# (ID-00000002) and a resistor (ID-00000003).
RC_DISCHARGE = os.path.join(RESOURCE_PATH, "celldl", "rc_discharge.celldl")
MODULE = "rc_discharge"
JUNCTION, CAPACITOR, RESISTOR = "ID-00000001", "ID-00000002", "ID-00000003"
# An RC circuit's BG-RDF with an empty group for each element: bg2cellml converts it, but the CellDL editor can't
# open it.
UNDRAWN_RC = os.path.join(RESOURCE_PATH, "..", "vitest", "fixtures", "celldl", "rc.celldl")

DIAGRAM_SVG = ".celldl-pane .celldl-host #svg-container > svg"
SHORT_SIMULATION = (
    "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
    ".get('simulationSettings').setSimulationSettings({ endingPoint: 1, pointInterval: 0.01 })"
)


def open_app(playwright):
    """Opens an empty workspace, isolated so it can simulate."""
    browser = playwright.chromium.launch(headless=HEADLESS_MODE)
    context = browser.new_context(viewport={"width": 1600, "height": 1000})
    context.add_init_script(OPT_IN_TO_ISOLATION)
    page = context.new_page()
    page.goto(BASE_URL, wait_until="commit")
    page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
    page.locator(".file-io-buttons .p-splitbutton").first.wait_for(timeout=APP_MOUNT_TIMEOUT)
    return browser, page


def import_diagram(page, files):
    """Imports CellDL diagrams from the Import menu: paths, or Playwright file payloads."""
    page.locator(".file-io-buttons .p-splitbutton").first.locator(".p-splitbutton-dropdown").click()
    page.get_by_role("menuitem", name="CellDL Diagram").click()
    dialog = page.locator(".p-dialog").filter(has_text="Import CellDL Diagram")
    dialog.locator("input[type=file]").set_input_files(files)
    dialog.get_by_role("button", name="Import", exact=True).click()


def place(page, group, name, x=700, y=450):
    """Drags a library module, from its group, onto the canvas."""
    page.locator(".mlc__group-header").filter(has_text=re.compile(rf"^\s*{group}\s*\d+\s*$", re.IGNORECASE)).first.click()
    card = page.locator(".mlc__card--draggable").filter(has_text=name).first
    card.drag_to(page.locator(".vue-flow__pane").first, target_position={"x": x, "y": y})
    expect(page.locator(".vue-flow__node").filter(has_text=name)).to_have_count(1)


def open_editor(page, name):
    """Opens an instance's editor, waiting for its diagram if it opens on the CellDL tab."""
    page.locator(".vue-flow__node").filter(has_text=name).first.dblclick()
    dialog = page.locator(".module-editor-dialog")
    dialog.wait_for()
    return dialog


def import_and_open(page):
    """Imports the RC discharge diagram, places it and opens its editor on its diagram."""
    import_diagram(page, RC_DISCHARGE)
    expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
    place(page, "RC DISCHARGE", MODULE)
    dialog = open_editor(page, MODULE)
    wait_for_diagram(page)
    return dialog


def wait_for_diagram(page):
    """Waits for the CellDL tab to show its diagram's elements."""
    page.locator(f"{DIAGRAM_SVG} #celldl-diagram-layer > g.celldl-Component").first.wait_for(timeout=DIAGRAM_TIMEOUT)
    expect(page.locator(".celldl-pane-pending")).to_have_count(0, timeout=DIAGRAM_TIMEOUT)


def element_centre(page, element_id):
    """The centre of a diagram element, on the page."""
    box = page.locator(f'{DIAGRAM_SVG} #celldl-diagram-layer [id="{element_id}"]').bounding_box()
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def click_element(page, element_id):
    x, y = element_centre(page, element_id)
    page.mouse.move(x, y, steps=4)
    page.mouse.click(x, y)


def editor_tab(dialog, label):
    return dialog.locator(".editor-tabs [role=tab]").filter(has_text=re.compile(rf"^\s*{label}\s*$"))


def cellml_text(dialog):
    editor_tab(dialog, "CellML Text").click()
    content = dialog.locator(".cm-content").first
    content.wait_for()
    return content


def show_diagram(page, dialog):
    editor_tab(dialog, "CellDL").click()
    wait_for_diagram(page)


def selected_tabs(dialog):
    return dialog.locator("[role=tab][aria-selected=true]").all_inner_texts()


class TestCelldl(unittest.TestCase):

    def test_imports_a_diagram_whose_math_is_read_only_and_values_editable(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            dialog = import_and_open(page)

            # It opens on its diagram, which the editor draws.
            self.assertIn("CellDL", " ".join(selected_tabs(dialog)))
            expect(page.locator(f"{DIAGRAM_SVG} #celldl-diagram-layer > g.celldl-Component")).to_have_count(3)

            # Its CellML is generated from the diagram, so it can't be typed in.
            content = cellml_text(dialog)
            expect(content).to_contain_text("ode(q_e_C, t)")
            expect(content).to_have_attribute("contenteditable", "false")

            # Only its values can be edited in Parameters: no row selection, no types to change.
            parameters = dialog.locator(".parameters-table")
            expect(parameters.locator(".p-datatable-tbody tr")).not_to_have_count(0)
            expect(parameters.locator(".p-checkbox")).to_have_count(0)
            types = parameters.locator(".p-select")
            for index in range(types.count()):
                expect(types.nth(index)).to_have_class(re.compile(r"\bp-disabled\b"))
            value = parameters.locator("tr").filter(has_text="R_R_i_R").locator("input").first
            expect(value).to_be_editable()
            # ----------- END ------------

            browser.close()

    def test_rejects_a_diagram_the_editor_cannot_open(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            with open(UNDRAWN_RC) as f:
                drawn = f.read()
            undrawn = re.sub(r'<g id="([^"]+)"><rect[^>]*/></g>', r'<g id="\1"/>', drawn)
            self.assertNotEqual(undrawn, drawn)
            import_diagram(page, {"name": "undrawn.celldl", "mimeType": "image/svg+xml", "buffer": undrawn.encode()})

            expect(page.get_by_text("undrawn.celldl can't be imported:")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            expect(page.get_by_text(re.compile(r"The diagram has no drawing of .*, so the CellDL editor can't open it"))).to_be_visible()
            expect(page.locator(".mlc__group-header").filter(has_text=re.compile(r"undrawn", re.IGNORECASE))).to_have_count(0)
            # ----------- END ------------

            browser.close()

    def test_saves_a_diagram_edit_as_the_module_math_unless_it_cannot_convert(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            dialog = import_and_open(page)
            expect(cellml_text(dialog)).to_contain_text("R_R_i_R")
            show_diagram(page, dialog)

            # Moving the resistor to another location renames its variables.
            click_element(page, RESISTOR)
            host = page.locator(".celldl-pane .celldl-host")
            page.locator("#properties-property-panel").click()
            location = host.locator("label", has_text="Location").locator("xpath=..").locator("input")
            location.fill("X")
            location.press("Tab")
            page.locator("#properties-property-panel").click()
            dialog.get_by_role("button", name="Apply").click()
            expect(page.get_by_text("CellML Updated")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            content = cellml_text(dialog)
            expect(content).to_contain_text("R_R_i_X")
            expect(content).not_to_contain_text("R_R_i_R")

            # Without the resistor, the circuit has nothing to discharge through, so it can't convert and nothing saves.
            show_diagram(page, dialog)
            click_element(page, RESISTOR)
            page.keyboard.press("Backspace")
            expect(page.locator(f'{DIAGRAM_SVG} [id="{RESISTOR}"]')).to_have_count(0)
            dialog.get_by_role("button", name="Apply").click()
            error = page.locator(".confirm-container").filter(has_text="Diagram Has Errors")
            expect(error).to_contain_text("The diagram can't be converted, so nothing was saved:")
            error.get_by_role("button").last.click()
            expect(cellml_text(dialog)).to_contain_text("R_R_i_X")
            # ----------- END ------------

            browser.close()

    def test_plots_a_clicked_element_only_from_the_plot_tab(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)
            page.evaluate(SHORT_SIMULATION)

            # ---------- START -----------
            dialog = import_and_open(page)

            # Hovering an element names its variables.
            x, y = element_centre(page, JUNCTION)
            page.mouse.move(x, y, steps=4)
            expect(page.locator(".tooltip-info .tippy-box")).to_contain_text("u_i_C")

            # With the Plot tab shown and Auto-update on, clicking the junction plots its potential, and the tab stays.
            dialog.get_by_role("tab", name=re.compile(r"Plot \(")).click()
            dialog.get_by_role("switch", name="Simulate the whole model, not this instance").uncheck()
            expect(dialog.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=SIMULATION_TIMEOUT)
            expect(dialog.get_by_role("switch", name="Auto-update: plot a variable clicked in the math")).to_be_checked()
            click_element(page, JUNCTION)
            expect(dialog.locator(".simulation-plot .plot-title")).to_have_text(f"{MODULE}/u_i_C")
            expect(dialog.get_by_role("tab", name="Plot (1)")).to_have_attribute("aria-selected", "true")
            self.assertIn("CellDL", " ".join(selected_tabs(dialog)))

            # With Parameters shown, clicking the capacitor plots nothing and keeps the tab.
            dialog.get_by_role("tab", name=re.compile(r"Parameters \(")).click()
            click_element(page, CAPACITOR)
            page.wait_for_timeout(500)
            expect(dialog.get_by_role("tab", name=re.compile(r"Parameters \("))).to_have_attribute("aria-selected", "true")
            dialog.get_by_role("tab", name=re.compile(r"Plot \(")).click()
            expect(dialog.locator(".simulation-plot .plot-title")).to_have_text(f"{MODULE}/u_i_C")
            # ----------- END ------------

            browser.close()

    def test_typing_cellml_in_the_template_locks_its_diagram_until_undone(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            place(page, "TEMPLATE MODULES", "new_module")
            dialog = open_editor(page, "new_module")
            locked = dialog.locator(".editor-tab-locked")
            expect(editor_tab(dialog, "CellDL")).to_be_enabled()

            content = cellml_text(dialog)
            content.click()
            page.keyboard.press("ControlOrMeta+End")
            page.keyboard.type("\nvar k: per_second;")
            expect(locked).to_have_count(1)
            expect(locked).to_contain_text("CellDL")

            content.click()
            for _ in range(3):
                if locked.count() == 0:
                    break
                page.keyboard.press("ControlOrMeta+z")
                page.wait_for_timeout(500)
            expect(locked).to_have_count(0)
            expect(editor_tab(dialog, "CellDL")).to_be_enabled()
            # ----------- END ------------

            browser.close()


if __name__ == '__main__':
    unittest.main()
