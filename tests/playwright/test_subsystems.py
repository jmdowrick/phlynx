import unittest

from playwright.sync_api import sync_playwright, expect

try:
    from .config import BASE_URL, HEADLESS_MODE
    from .test_workspace import (
        EDGE, FIXTURE_NODE_COUNT, NODE, centre, drag, node_by_name, read_resource, undo, wait_for_settled_transform,
    )
except ImportError:
    from config import BASE_URL, HEADLESS_MODE
    from test_workspace import (
        EDGE, FIXTURE_NODE_COUNT, NODE, centre, drag, node_by_name, read_resource, undo, wait_for_settled_transform,
    )


SUBSYSTEM = ".vue-flow__node:has(.subsystem-node)"
INTERFACE = ".vue-flow__node:has(.interface-node)"
BREADCRUMB = ".flow-breadcrumb"
CRUMB = ".flow-breadcrumb .crumb"
SUPERMODULE_CARD = ".mlc__card--supermodule"
EXPOSURE_LABEL = ".exposure-edge-label"

# An edge's couplings, read from the app's store (dev server only): each port's label, and the exposed port the
# source's port stands for, when the source is a subsystem.
EDGE_COUPLINGS = """async (edgeId) => {
  const vueFlowUrl = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('@vue-flow_core.js'))
  const { useVueFlow } = await import(vueFlowUrl)
  const edge = useVueFlow('main-flow-editor').findEdge(edgeId)
  return (edge?.data?.couplings ?? []).map(({ sourcePort, targetPort }) => ({
    source: sourcePort.label,
    target: targetPort.label,
    exposedPortId: sourcePort.exposedPortId ?? null,
  }))
}"""


def ghost_on(node, side):
    """The middle free (ghost) handle on one side of a node."""
    handles = node.locator(f".vue-flow__handle.handle--ghost.vue-flow__handle-{side}")
    return handles.nth(handles.count() // 2)


class TestSubsystems(unittest.TestCase):

    def setUp(self):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=HEADLESS_MODE)
        # A fixed, roomy viewport keeps the canvas layout identical between runs and machines.
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 900})
        self.page = self.context.new_page()

    def tearDown(self):
        self.context.close()
        self.browser.close()
        self.playwright.stop()

    # ---------- helpers -----------

    def open_workspace(self):
        """Load the three-instance fixture and wait for the canvas to render it."""
        page = self.page
        workspace_json = read_resource("workspace-json.base64").strip()
        page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}")
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT)
        expect(page.locator(EDGE)).to_have_count(2)
        return wait_for_settled_transform(page)

    def new_empty_subsystem(self, name):
        """Right-click an empty corner of the canvas and make a new, empty subsystem there."""
        page = self.page
        # The canvas runs under the library panel, so aim right of it.
        library = page.locator(".mlc").bounding_box()
        page.mouse.click(library["x"] + library["width"] + 120, library["y"] + 160, button="right")
        page.locator(".context-menu__item", has_text="New Empty Subsystem").click()

        dialog = page.get_by_role("dialog", name="New Empty Subsystem")
        dialog.locator("#new-subsystem-name").fill(name)
        dialog.get_by_role("button", name="Create").click()
        expect(dialog).to_be_hidden()

    # ---------- entering and leaving -----------

    def test_enter_exit_breadcrumb(self):
        page = self.page
        self.open_workspace()

        self.new_empty_subsystem("heart")
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT + 1)
        subsystem = page.locator(SUBSYSTEM)
        expect(subsystem).to_have_count(1)
        expect(subsystem.locator(".name-text")).to_have_text("heart")
        expect(subsystem.locator(".subsystem-count")).to_have_text("×1")
        # The palette lists the new super-module.
        card = page.locator(SUPERMODULE_CARD)
        expect(card.locator(".mlc__card-name")).to_have_text("heart")
        expect(card.locator(".mlc__badge")).to_have_text("1 subsystem")
        expect(page.locator(BREADCRUMB)).to_have_count(0)

        # Open shows the super-module's nodes, its interface node alone, and where the canvas is.
        subsystem.get_by_role("button", name="Open subsystem").click()
        expect(page.locator(INTERFACE)).to_have_count(1)
        expect(page.locator(NODE)).to_have_count(1)
        expect(page.locator(CRUMB)).to_have_text(["Model", "heart"])
        current = page.locator(CRUMB).last
        expect(current).to_have_attribute("aria-current", "location")
        self.assertEqual(current.evaluate("(crumb) => crumb.tagName"), "SPAN")
        # One copy only, so no shared super-module banner.
        expect(page.locator(".supermodule-banner")).to_have_count(0)

        # Escape goes back to the model.
        page.keyboard.press("Escape")
        expect(page.locator(BREADCRUMB)).to_have_count(0)
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT + 1)

        # A double-click enters too, and the Model crumb leaves.
        wait_for_settled_transform(page)
        page.locator(SUBSYSTEM).locator(".subsystem-card").dblclick(position={"x": 30, "y": 60})
        expect(page.locator(CRUMB)).to_have_text(["Model", "heart"])
        page.locator(CRUMB).first.click()
        expect(page.locator(BREADCRUMB)).to_have_count(0)
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT + 1)

        # Moving between levels is never an undo step: one undo removes the new subsystem and its super-module.
        undo(page)
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT)
        expect(page.locator(SUPERMODULE_CARD)).to_have_count(0)

    # ---------- deleting -----------

    def test_delete_asks_about_unused_supermodule(self):
        page = self.page
        self.open_workspace()
        self.new_empty_subsystem("heart")
        page.locator(SUBSYSTEM).get_by_role("button", name="Open subsystem").click()
        expect(page.locator(CRUMB)).to_have_text(["Model", "heart"])

        self.new_empty_subsystem("lv")
        lv = page.locator(SUBSYSTEM)
        expect(lv).to_have_count(1)

        # Its super-module has no other subsystem, so Delete asks whether it goes too.
        lv.click(button="right")
        page.locator(".context-menu__item", has_text="Delete").click()
        dialog = page.get_by_role("alertdialog")
        expect(dialog).to_contain_text("Delete Super-module Too?")

        # Escape closes the question, deleting nothing and staying at this level.
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(page.locator(CRUMB)).to_have_text(["Model", "heart"])
        expect(lv).to_have_count(1)

        lv.click(button="right")
        page.locator(".context-menu__item", has_text="Delete").click()
        dialog.get_by_role("button", name="Delete super-module").click()
        expect(lv).to_have_count(0)
        expect(page.locator(SUPERMODULE_CARD).locator(".mlc__card-name")).to_have_text(["heart"])
        expect(page.locator(CRUMB)).to_have_text(["Model", "heart"])


    # ---------- exposing ports -----------

    def test_expose_and_connect(self):
        page = self.page
        self.open_workspace()
        self.new_empty_subsystem("heart")
        page.locator(SUBSYSTEM).get_by_role("button", name="Open subsystem").click()
        interface = page.locator(INTERFACE)
        expect(interface).to_contain_text("No exposed ports yet")
        wait_for_settled_transform(page)

        # Two modules inside, connected to each other.
        canvas = page.locator(".vue-flow")
        page.get_by_role("button", name="Cell modules").click()
        cards = page.locator(".mlc .mlc__card--draggable")
        cards.filter(has_text="SN_soma").first.drag_to(canvas, target_position={"x": 650, "y": 230})
        cards.filter(has_text="SN_axon").first.drag_to(canvas, target_position={"x": 1150, "y": 230})
        expect(page.locator(NODE)).to_have_count(3)
        soma, axon = node_by_name(page, "soma_SN"), node_by_name(page, "axon_SN")
        drag(page, centre(ghost_on(soma, "right")), centre(ghost_on(axon, "left")))
        expect(page.locator(EDGE)).to_have_count(1)

        # Connecting one to the interface draws an exposure edge, exposing nothing until its ports are picked.
        drag(page, centre(ghost_on(axon, "bottom")), centre(ghost_on(interface, "top")))
        expect(page.locator(EDGE)).to_have_count(2)
        dialog = page.get_by_role("dialog", name="Expose ports of axon_SN")
        expect(dialog).to_be_visible()
        dialog.get_by_role("button", name="Cancel").click()
        expect(dialog).to_be_hidden()
        label = page.locator(EXPOSURE_LABEL)
        expect(label).to_have_text("Nothing exposed")

        # Double-clicking the exposure edge picks its ports: whole ports, a single-connection one used inside refused.
        page.mouse.dblclick(*centre(label))
        expect(dialog).to_be_visible()
        expect(dialog.get_by_label("Expose VI_port")).to_be_disabled()
        dialog.get_by_label("Expose membrane_voltage").check()
        dialog.get_by_role("button", name="Save").click()
        expect(dialog).to_be_hidden()
        expect(label).to_have_text("membrane_voltage")
        expect(interface.locator(".interface-port-list li")).to_have_count(1)
        expect(interface).to_contain_text("membrane_voltage")

        # Up a level, the subsystem has the port, and a new module connected to it couples to the exposed port.
        page.keyboard.press("Escape")
        expect(page.locator(BREADCRUMB)).to_have_count(0)
        wait_for_settled_transform(page)
        subsystem = page.locator(SUBSYSTEM)
        expect(subsystem).to_contain_text("1 port")
        cards.filter(has_text="SN_varicosity").first.drag_to(canvas, target_position={"x": 650, "y": 750})
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT + 2)
        varicosity = page.locator(NODE).last
        drag(page, centre(ghost_on(subsystem, "bottom")), centre(ghost_on(varicosity, "top")))
        expect(page.locator(EDGE)).to_have_count(3)
        edge = page.locator(f'{EDGE}[data-id*="{subsystem.get_attribute("data-id")}"]')
        expect(edge).to_have_count(1)
        couplings = page.evaluate(EDGE_COUPLINGS, edge.get_attribute("data-id"))
        self.assertEqual(len(couplings), 1)
        self.assertEqual(couplings[0]["source"], "membrane_voltage")
        self.assertTrue(couplings[0]["exposedPortId"].startswith("xp_"))


if __name__ == "__main__":
    unittest.main()
