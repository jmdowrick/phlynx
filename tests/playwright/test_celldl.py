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
# The enzyme cycle S + E <=> C -> P + E: its reaction r1 (ID-00000006) has kappa 10. bg2cellml declares Faraday's
# constant F, which no equation uses.
ENZYME = os.path.join(RESOURCE_PATH, "celldl", "enzyme.celldl")
ENZYME_MODULE = "enzyme"
REACTION_R1 = "ID-00000006"
# Its reaction r2, and its product P's store and 0-junction.
REACTION_R2 = "ID-00000011"
PRODUCT, PRODUCT_JUNCTION = "ID-00000014", "ID-00000013"

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
    # A tab may carry a "(beta)" suffix, as the CellDL tab does.
    return dialog.locator(".editor-tabs [role=tab]").filter(
        has_text=re.compile(rf"^\s*{re.escape(label)}(\s+\(beta\))?\s*$")
    )


def cellml_text(dialog):
    editor_tab(dialog, "CellML Text").click()
    content = dialog.locator(".cm-content").first
    content.wait_for()
    return content


def show_diagram(page, dialog):
    editor_tab(dialog, "CellDL").click()
    wait_for_diagram(page)


def relocate_resistor(page, location):
    """Sets the resistor's location in the editor's properties panel, which renames its variables."""
    click_element(page, RESISTOR)
    host = page.locator(".celldl-pane .celldl-host")
    page.locator("#properties-property-panel").click()
    field = host.locator("label", has_text="Location").locator("xpath=..").locator("input")
    field.fill(location)
    field.press("Tab")
    page.locator("#properties-property-panel").click()


def show_diagram_tab(page, dialog):
    """Shows the CellDL tab of a module that may have no diagram yet, waiting for the editor."""
    editor_tab(dialog, "CellDL").click()
    page.locator(DIAGRAM_SVG).wait_for(state="attached", timeout=DIAGRAM_TIMEOUT)
    expect(page.locator(".celldl-pane-pending")).to_have_count(0, timeout=DIAGRAM_TIMEOUT)


def add_component(page, component):
    """Drags a component from the bond graph palette onto the diagram, clear of the palette."""
    page.locator("#editor-bondgraph-tool").click()
    palette_item = page.locator(f'[id="bondgraph-components/{component}"]')
    palette_item.wait_for()
    box = page.locator(DIAGRAM_SVG).bounding_box()
    palette_item.drag_to(
        page.locator(DIAGRAM_SVG), target_position={"x": box["width"] * 0.65, "y": box["height"] * 0.5}
    )
    page.locator("#editor-select-tool").click()


def choose_template(page, template):
    """Chooses the selected element's template in the CellDL editor's Properties panel."""
    host = page.locator(".celldl-pane .celldl-host")
    template_select = host.locator(".p-select").first
    if not template_select.is_visible():
        page.locator("#properties-property-panel").click()
    template_select.click()
    page.locator(".p-select-option").filter(has_text=re.compile(rf"^\s*{re.escape(template)}\s*$")).click()
    expect(template_select).to_contain_text(template)


def selected_tabs(dialog):
    return dialog.locator("[role=tab][aria-selected=true]").all_inner_texts()


def set_property(page, element_id, label, value):
    """Sets a field of a diagram element in the editor's properties panel."""
    click_element(page, element_id)
    host = page.locator(".celldl-pane .celldl-host")
    page.locator("#properties-property-panel").click()
    field = host.locator("label", has_text=label).locator("xpath=..").locator("input")
    field.fill(value)
    field.press("Tab")
    page.locator("#properties-property-panel").click()


def draw_in_editor(page, path):
    """Opens a diagram in the CellDL editor as if drawn there, unsaved. Needs the dev server, which serves /src."""
    with open(path) as f:
        document = f.read()
    page.evaluate(
        """async (data) => {
            const { useCelldlEditorHost } = await import('/src/composables/useCelldlEditorHost.js')
            useCelldlEditorHost().command.value = { command: 'file', options: { action: 'open', data, name: 'drawn.celldl' } }
        }""",
        document,
    )
    page.locator(f"{DIAGRAM_SVG} #celldl-diagram-layer > g.celldl-Component").first.wait_for(timeout=DIAGRAM_TIMEOUT)


def parameter_value(dialog, name):
    """The field holding this instance's value of a diagram's variable, in the CellDL Parameters tab. A value still on
    the diagram's shows blank, with the diagram's as its placeholder."""
    dialog.get_by_role("tab", name=re.compile(r"Parameters \(")).click()
    return dialog.locator(f'.celldl-parameters [data-variable="{name}"] input')


def element_row(dialog, element_id):
    """A diagram element's row in the CellDL Parameters tab."""
    return dialog.locator(f'.celldl-parameters tr.element-row--main[data-element-id="{element_id}"]')


def set_element_field(dialog, element_id, label, value):
    """Sets an element's species or location from the CellDL Parameters tab."""
    field = element_row(dialog, element_id).get_by_label(re.compile(rf"^{label} of"))
    field.fill(value)
    field.press("Enter")


def choose_element_type(page, dialog, element_id, template):
    """Chooses an element's type from the CellDL Parameters tab."""
    element_row(dialog, element_id).locator(".p-select").click()
    page.locator(".p-select-option").filter(has_text=re.compile(rf"^\s*{re.escape(template)}\s*$")).click()
    expect(element_row(dialog, element_id).locator(".p-select")).to_contain_text(template)


def saved_math_has(page, text):
    """Whether any of the library's math, as saved, has some text."""
    return page.evaluate(
        """(text) => [...document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
            .get('library').availableMath.values()].some((math) => String(math).includes(text))""",
        text,
    )


def run_this_instance(page, dialog):
    """Runs the instance on its own from the Plot tab, as saved."""
    dialog.get_by_role("tab", name=re.compile(r"Plot \(")).click()
    dialog.get_by_role("switch", name="Simulate the whole model, not this instance").uncheck()
    dialog.get_by_role("button", name="Simulate this instance").click()
    expect(dialog.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=SIMULATION_TIMEOUT)


def final_value(page, name):
    """The last value of a variable in the latest run's results, by its name's ending."""
    return page.evaluate(
        """(name) => {
            const results = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
                .get('simulationResults').results
            const entry = [...(results?.variables ?? [])].find(([key]) => key === name || key.endsWith('/' + name))
            return entry ? entry[1].values[entry[1].values.length - 1] : null
        }""",
        name,
    )


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

            # Its Parameters tab lists the diagram's elements, not the math's rows: species and location edit the
            # diagram, and values this instance, the diagram's showing as their defaults.
            parameters = dialog.locator(".celldl-parameters")
            expect(dialog.locator(".parameters-table")).to_have_count(0)
            expect(parameters.locator("tr.element-row--main[data-element-id]")).to_have_count(3)
            show_diagram(page, dialog)
            expect(element_row(dialog, RESISTOR).get_by_label(re.compile("^Location of"))).to_be_editable()
            value = parameter_value(dialog, "R_R_i_R")
            expect(value).to_be_editable()
            expect(value).to_have_value("")
            expect(value).to_have_attribute("placeholder", re.compile(r"\S"))
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
            relocate_resistor(page, "X")
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
            self.assertTrue(saved_math_has(page, "R_R_i_X"))
            # ----------- END ------------

            browser.close()

    def test_shows_the_diagram_math_live_until_cancelled(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            dialog = import_and_open(page)
            expect(page.get_by_text("Live CellML")).to_have_count(0)

            # The CellML Text, and the Parameters tab's names, show the edited diagram's math before it is saved.
            relocate_resistor(page, "X")
            content = cellml_text(dialog)
            expect(content).to_contain_text("R_R_i_X", timeout=DIAGRAM_TIMEOUT)
            expect(content).not_to_contain_text("R_R_i_R")
            expect(content).to_have_attribute("contenteditable", "false")
            expect(element_row(dialog, RESISTOR).locator(".element-names")).to_contain_text("R_R_i_X")
            self.assertTrue(saved_math_has(page, "R_R_i_R"))

            # Cancelling discards the edit, so the math shows as saved again.
            dialog.get_by_role("button", name="Cancel").click()
            page.locator(".confirm-container").get_by_role("button", name="Discard & Close").click()
            expect(dialog).to_be_hidden()
            dialog = open_editor(page, MODULE)
            wait_for_diagram(page)
            content = cellml_text(dialog)
            expect(content).to_contain_text("R_R_i_R")
            expect(content).not_to_contain_text("R_R_i_X")
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
            expect(page.locator(f'{DIAGRAM_SVG} [id="{CAPACITOR}"].selected, {DIAGRAM_SVG} [id="{CAPACITOR}"] .selected')).not_to_have_count(0)
            expect(dialog.get_by_role("tab", name=re.compile(r"Parameters \("))).to_have_attribute("aria-selected", "true")
            dialog.get_by_role("tab", name=re.compile(r"Plot \(")).click()
            expect(dialog.locator(".simulation-plot .plot-title")).to_have_text(f"{MODULE}/u_i_C")
            # ----------- END ------------

            browser.close()

    def test_converts_a_composite_storage_node_drawn_in_the_template(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            place(page, "TEMPLATE MODULES", "new_module")
            dialog = open_editor(page, "new_module")
            show_diagram_tab(page, dialog)
            add_component(page, "ZeroStorageNode_q")
            storage = page.locator(f"{DIAGRAM_SVG} #celldl-diagram-layer > g.celldl-Component")
            expect(storage).to_have_count(1)

            # Making it chemical storage makes it a composite node, which the editor lists as a junction too.
            click_element(page, storage.get_attribute("id"))
            choose_template(page, "Chemical storage with Zero Node")

            # Live conversion takes it as a storage node: the template stores 1 for its K, which the math has, and
            # no junction type is asked for. The live status lists its issues in its tooltip.
            status = dialog.locator(".celldl-live-status")
            expect(status).to_have_attribute("title", re.compile("q_i_j"), timeout=DIAGRAM_TIMEOUT)
            self.assertNotIn("must be one, zero or transform nodes", status.get_attribute("title"))
            self.assertNotIn("Missing value for parameter K", status.get_attribute("title"))
            expect(cellml_text(dialog)).to_contain_text("K_q_i_j", timeout=DIAGRAM_TIMEOUT)
            # ----------- END ------------

            browser.close()

    def test_saves_every_generated_constant_from_the_template_so_the_whole_model_runs(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)
            page.evaluate(SHORT_SIMULATION)

            # ---------- START -----------
            place(page, "TEMPLATE MODULES", "new_module")
            dialog = open_editor(page, "new_module")
            show_diagram_tab(page, dialog)
            draw_in_editor(page, ENZYME)
            dialog.get_by_role("button", name="Apply").click()
            save_as = page.locator(".p-dialog").filter(has_text="Save As New Component")
            save_as.locator("input").fill(ENZYME_MODULE)
            save_as.get_by_role("button", name="Save").click()
            expect(page.get_by_text("CellML Updated")).to_be_visible(timeout=DIAGRAM_TIMEOUT)

            # F is a constant no equation uses, yet it keeps its value, so the whole model runs.
            expect(parameter_value(dialog, "F")).to_have_attribute("placeholder", "96485")
            expect(parameter_value(dialog, "kappa_Rx_r1_c")).to_have_attribute("placeholder", "10")
            dialog.get_by_role("tab", name=re.compile(r"Plot \(")).click()
            expect(dialog.get_by_role("switch", name="Simulate the whole model, not this instance")).to_be_checked()
            dialog.get_by_role("button", name="Simulate the whole model").click()
            expect(dialog.get_by_text("Simulated the whole model")).to_be_visible(timeout=SIMULATION_TIMEOUT)
            # ----------- END ------------

            browser.close()

    def test_runs_a_diagram_value_edited_after_the_first_save(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)
            page.evaluate(SHORT_SIMULATION)

            # ---------- START -----------
            import_diagram(page, ENZYME)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, "ENZYME", ENZYME_MODULE)
            dialog = open_editor(page, ENZYME_MODULE)
            wait_for_diagram(page)
            expect(parameter_value(dialog, "kappa_Rx_r1_c")).to_have_attribute("placeholder", "10")

            # Run this instance on its own, as saved.
            dialog.get_by_role("tab", name=re.compile(r"Plot \(")).click()
            dialog.get_by_role("switch", name="Simulate the whole model, not this instance").uncheck()
            dialog.get_by_role("button", name="Simulate this instance").click()
            expect(dialog.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=SIMULATION_TIMEOUT)
            before = final_value(page, "q_P_c")
            self.assertIsNotNone(before)

            # Slowing r1 in the diagram, and saving, gives the instance the new value, so the run changes.
            show_diagram(page, dialog)
            set_property(page, REACTION_R1, "kappa", "1")
            expect(page.locator(".celldl-live-status")).to_have_text("Converts, not yet saved", timeout=DIAGRAM_TIMEOUT)
            dialog.get_by_role("button", name="Apply").click()
            expect(page.get_by_text("CellML Updated")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            expect(parameter_value(dialog, "kappa_Rx_r1_c")).to_have_attribute("placeholder", "1")
            expect(parameter_value(dialog, "kappa_Rx_r1_c")).to_have_value("")

            dialog.get_by_role("tab", name=re.compile(r"Plot \(")).click()
            dialog.get_by_role("switch", name="Simulate the whole model, not this instance").uncheck()
            dialog.get_by_role("button", name="Simulate this instance").click()
            expect(dialog.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=SIMULATION_TIMEOUT)
            page.wait_for_function(
                """([name, before]) => {
                    const results = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
                        .get('simulationResults').results
                    const entry = [...(results?.variables ?? [])].find(([key]) => key === name || key.endsWith('/' + name))
                    return entry && entry[1].values[entry[1].values.length - 1] !== before
                }""",
                arg=["q_P_c", before],
                timeout=SIMULATION_TIMEOUT,
            )
            self.assertLess(final_value(page, "q_P_c"), before)
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

            # The typing may be undone in more than one step.
            content.click()
            for _ in range(3):
                page.keyboard.press("ControlOrMeta+z")
                try:
                    expect(locked).to_have_count(0, timeout=2000)
                    break
                except AssertionError:
                    pass
            expect(locked).to_have_count(0)
            expect(editor_tab(dialog, "CellDL")).to_be_enabled()
            # ----------- END ------------

            browser.close()

    def test_undoes_in_the_diagram_only_while_working_in_it(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)

            # ---------- START -----------
            dialog = import_and_open(page)
            components = page.locator(f"{DIAGRAM_SVG} #celldl-diagram-layer > g.celldl-Component")
            add_component(page, "ZeroStorageNode_q")
            expect(components).to_have_count(4)

            # Undo in the Parameters tab leaves the diagram alone.
            dialog.locator(".celldl-parameters .toolbar-note").click()
            page.keyboard.press("ControlOrMeta+z")
            page.wait_for_timeout(500)
            expect(components).to_have_count(4)

            # Back in the diagram, the keys undo and redo it, as do its toolbar's buttons.
            box = page.locator(DIAGRAM_SVG).bounding_box()
            page.mouse.click(box["x"] + box["width"] * 0.1, box["y"] + box["height"] * 0.1)
            page.keyboard.press("ControlOrMeta+z")
            expect(components).to_have_count(3)
            page.keyboard.press("ControlOrMeta+Shift+z")
            expect(components).to_have_count(4)
            page.locator("#editor-undo").click()
            expect(components).to_have_count(3)
            page.locator("#editor-redo").click()
            expect(components).to_have_count(4)
            # ----------- END ------------

            browser.close()

    def test_names_and_values_a_diagram_from_its_parameters_tab(self):
        with sync_playwright() as playwright:
            browser, page = open_app(playwright)
            page.evaluate(SHORT_SIMULATION)

            # ---------- START -----------
            import_diagram(page, ENZYME)
            expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            place(page, "ENZYME", ENZYME_MODULE, x=600, y=350)
            card = page.locator(".mlc__card--draggable").filter(has_text=ENZYME_MODULE).first
            card.drag_to(page.locator(".vue-flow__pane").first, target_position={"x": 900, "y": 600})
            instances = page.locator(".vue-flow__node").filter(has_text=ENZYME_MODULE)
            expect(instances).to_have_count(2)
            instances.first.dblclick()
            dialog = page.locator(".module-editor-dialog")
            wait_for_diagram(page)
            glyph = page.locator(f'{DIAGRAM_SVG} [id="{PRODUCT}"]')
            drawn = glyph.inner_html()

            # The product's species, from the table: its 0-junction follows, and the diagram's CellML is renamed.
            set_element_field(dialog, PRODUCT, "Species", "Prod")
            expect(element_row(dialog, PRODUCT_JUNCTION).get_by_label(re.compile("^Species of"))).to_have_value("Prod")
            expect(element_row(dialog, PRODUCT).locator(".element-names")).to_contain_text("q_Prod_c", timeout=DIAGRAM_TIMEOUT)
            # r1's location, and r2's type there and back.
            set_element_field(dialog, REACTION_R1, "Location", "cyt")
            expect(element_row(dialog, REACTION_R1).locator(".element-names")).to_contain_text("kappa_Rx_r1_cyt", timeout=DIAGRAM_TIMEOUT)
            choose_element_type(page, dialog, REACTION_R2, "NKETransporter")
            expect(dialog.locator(f'.celldl-parameters tr.element-row--values[data-element-id="{REACTION_R2}"]')).to_contain_text("k_NKE")
            choose_element_type(page, dialog, REACTION_R2, "Chemical reaction")
            expect(element_row(dialog, REACTION_R2).locator(".element-names")).to_contain_text("kappa_Rx_r2_c", timeout=DIAGRAM_TIMEOUT)
            content = cellml_text(dialog)
            expect(content).to_contain_text("q_Prod_c", timeout=DIAGRAM_TIMEOUT)
            expect(content).to_contain_text("kappa_Rx_r1_cyt")
            self.assertTrue(saved_math_has(page, "kappa_Rx_r1_c"))
            show_diagram(page, dialog)
            self.assertNotEqual(glyph.inner_html(), drawn)

            # A value for this instance alone: r1 slowed from the diagram's 10, set before its name is saved.
            kappa = parameter_value(dialog, "kappa_Rx_r1_cyt")
            expect(kappa).to_have_attribute("placeholder", "10")
            kappa.fill("1")
            kappa.press("Enter")
            dialog.get_by_role("button", name="Apply").click()
            expect(page.get_by_text("CellML Updated")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
            wait_for_diagram(page)
            kappa = parameter_value(dialog, "kappa_Rx_r1_cyt")
            expect(kappa).to_have_value("1")
            self.assertTrue(saved_math_has(page, "kappa_Rx_r1_cyt"))

            run_this_instance(page, dialog)
            slowed = final_value(page, "q_Prod_c")
            self.assertIsNotNone(slowed)
            dialog.get_by_role("button", name="Save").click()
            expect(dialog).to_be_hidden()

            # The other instance has the diagram's new names, and keeps its default, so its product forms faster.
            instances.nth(1).dblclick()
            wait_for_diagram(page)
            kappa = parameter_value(dialog, "kappa_Rx_r1_cyt")
            expect(kappa).to_have_value("")
            expect(kappa).to_have_attribute("placeholder", "10")
            run_this_instance(page, dialog)
            page.wait_for_function(
                """([name, before]) => {
                    const results = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s
                        .get('simulationResults').results
                    const entry = [...(results?.variables ?? [])].find(([key]) => key.endsWith('/' + name))
                    return entry && entry[1].values[entry[1].values.length - 1] !== before
                }""",
                arg=["q_Prod_c", slowed],
                timeout=SIMULATION_TIMEOUT,
            )
            self.assertGreater(final_value(page, "q_Prod_c"), slowed)
            # ----------- END ------------

            browser.close()


if __name__ == '__main__':
    unittest.main()
