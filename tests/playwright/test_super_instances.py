import unittest

from playwright.sync_api import sync_playwright, expect

try:
    from .config import BASE_URL, HEADLESS_MODE
    from .test_workspace import (
        EDGE, FIXTURE_NODE_COUNT, NODE, centre, drag, node_by_name, read_resource, shift_drag_select, undo,
        wait_for_settled_transform,
    )
except ImportError:
    from config import BASE_URL, HEADLESS_MODE
    from test_workspace import (
        EDGE, FIXTURE_NODE_COUNT, NODE, centre, drag, node_by_name, read_resource, shift_drag_select, undo,
        wait_for_settled_transform,
    )


SUPER_INSTANCE = ".vue-flow__node:has(.super-instance-node)"
INTERFACE = ".vue-flow__node:has(.interface-node)"
BREADCRUMB = ".flow-breadcrumb"
CRUMB = ".flow-breadcrumb .crumb"
# A workspace super-module's library card; the Empty super-module entry and CA templates are listed apart.
SUPERMODULE_CARD = ".mlc__card--supermodule[data-supermodule]"
EMPTY_SUPERMODULE = "[data-empty-supermodule]"
BANNER = ".supermodule-banner"
EXPOSURE_LABEL = ".exposure-edge-label"

# An edge's couplings, read from the app's store (dev server only): each port's label, and the exposed port the
# source's port stands for, when the source is a super instance.
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


class TestSuperInstances(unittest.TestCase):

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

    def new_empty_supermodule(self, name):
        """Right-click an empty corner of the canvas and make a new, empty super-module and its super instance there."""
        page = self.page
        # The canvas runs under the library panel, so aim right of it.
        library = page.locator(".mlc").bounding_box()
        page.mouse.click(library["x"] + library["width"] + 120, library["y"] + 160, button="right")
        page.locator(".context-menu__item", has_text="New Empty Super-module").click()

        dialog = page.get_by_role("dialog", name="New Empty Super-module")
        dialog.locator("#new-supermodule-name").fill(name)
        dialog.get_by_role("button", name="Create").click()
        expect(dialog).to_be_hidden()

    # ---------- entering and leaving -----------

    def test_enter_exit_breadcrumb(self):
        page = self.page
        self.open_workspace()

        self.new_empty_supermodule("heart")
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT + 1)
        super_instance = page.locator(SUPER_INSTANCE)
        expect(super_instance).to_have_count(1)
        expect(super_instance.locator(".name-text")).to_have_text("heart")
        expect(super_instance.locator(".super-instance-count")).to_have_text("×1")
        # The palette lists the new super-module.
        card = page.locator(SUPERMODULE_CARD)
        expect(card.locator(".mlc__card-name")).to_have_text("heart")
        expect(card.locator(".mlc__badge")).to_have_text("1 super instance")
        expect(page.locator(BREADCRUMB)).to_have_count(0)

        # Open shows the super-module's nodes, its interface node alone, and where the canvas is.
        super_instance.get_by_role("button", name="Open super instance").click()
        expect(page.locator(INTERFACE)).to_have_count(1)
        expect(page.locator(NODE)).to_have_count(1)
        expect(page.locator(CRUMB)).to_have_text(["Model", "heart"])
        current = page.locator(CRUMB).last
        expect(current).to_have_attribute("aria-current", "location")
        self.assertEqual(current.evaluate("(crumb) => crumb.tagName"), "SPAN")
        # One copy only: the banner still names the library entry, with nothing to make unique.
        expect(page.locator(BANNER)).to_have_text(
            "Editing super-module 'heart' in the library — changes apply to its one super instance"
        )
        expect(page.locator(BANNER).get_by_role("button", name="Make unique")).to_have_count(0)

        # Escape goes back to the model.
        page.keyboard.press("Escape")
        expect(page.locator(BREADCRUMB)).to_have_count(0)
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT + 1)

        # A double-click enters too, and the Model crumb leaves.
        wait_for_settled_transform(page)
        page.locator(SUPER_INSTANCE).locator(".super-instance-card").dblclick(position={"x": 30, "y": 60})
        expect(page.locator(CRUMB)).to_have_text(["Model", "heart"])
        page.locator(CRUMB).first.click()
        expect(page.locator(BREADCRUMB)).to_have_count(0)
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT + 1)

        # Moving between levels is never an undo step: one undo removes the new super instance and its super-module.
        undo(page)
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT)
        expect(page.locator(SUPERMODULE_CARD)).to_have_count(0)

    # ---------- deleting -----------

    def test_delete_asks_about_unused_supermodule(self):
        page = self.page
        self.open_workspace()
        self.new_empty_supermodule("heart")
        page.locator(SUPER_INSTANCE).get_by_role("button", name="Open super instance").click()
        expect(page.locator(CRUMB)).to_have_text(["Model", "heart"])

        self.new_empty_supermodule("lv")
        lv = page.locator(SUPER_INSTANCE)
        expect(lv).to_have_count(1)

        # Its super-module has no other super instance, so Delete asks whether it goes too.
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
        self.new_empty_supermodule("heart")
        page.locator(SUPER_INSTANCE).get_by_role("button", name="Open super instance").click()
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

        # Up a level, the super instance has the port, and a new module connected to it couples to the exposed port.
        page.keyboard.press("Escape")
        expect(page.locator(BREADCRUMB)).to_have_count(0)
        wait_for_settled_transform(page)
        super_instance = page.locator(SUPER_INSTANCE)
        expect(super_instance).to_contain_text("1 port")
        cards.filter(has_text="SN_varicosity").first.drag_to(canvas, target_position={"x": 650, "y": 750})
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT + 2)
        varicosity = page.locator(NODE).last
        drag(page, centre(ghost_on(super_instance, "bottom")), centre(ghost_on(varicosity, "top")))
        expect(page.locator(EDGE)).to_have_count(3)
        edge = page.locator(f'{EDGE}[data-id*="{super_instance.get_attribute("data-id")}"]')
        expect(edge).to_have_count(1)
        couplings = page.evaluate(EDGE_COUPLINGS, edge.get_attribute("data-id"))
        self.assertEqual(len(couplings), 1)
        self.assertEqual(couplings[0]["source"], "membrane_voltage")
        self.assertTrue(couplings[0]["exposedPortId"].startswith("xp_"))


    # ---------- nesting and un-nesting -----------

    def test_nest_unnest_undo(self):
        page = self.page
        self.open_workspace()

        # Two connected modules, nested into one super instance in their place.
        shift_drag_select(page, ["var_SN", "axon_SN"])
        expect(page.locator(f"{NODE}.selected")).to_have_count(2)
        # A box selection is right-clicked over the rectangle drawn around it.
        page.locator(".vue-flow__nodesselection-rect").click(button="right")
        page.locator(".context-menu__item", has_text="Nest Selection (2)").click()
        dialog = page.get_by_role("dialog", name="Nest Selection")
        dialog.locator("#new-supermodule-name").fill("nerve")
        dialog.get_by_role("button", name="Nest").click()
        expect(dialog).to_be_hidden()

        super_instance = page.locator(SUPER_INSTANCE)
        expect(super_instance).to_have_count(1)
        expect(super_instance.locator(".name-text")).to_have_text("nerve")
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT - 1)
        expect(page.locator(SUPERMODULE_CARD).locator(".mlc__card-name")).to_have_text(["nerve"])
        # The edge cut by the selection now joins soma_SN and the super instance.
        expect(page.locator(EDGE)).to_have_count(1)

        # Inside are the two modules, joined as they were, and the interface they are exposed on.
        super_instance.get_by_role("button", name="Open super instance").click()
        expect(page.locator(CRUMB)).to_have_text(["Model", "nerve"])
        expect(page.locator(INTERFACE)).to_have_count(1)
        expect(page.locator(NODE)).to_have_count(3)
        expect(node_by_name(page, "var_SN")).to_have_count(1)
        expect(node_by_name(page, "axon_SN")).to_have_count(1)
        page.keyboard.press("Escape")
        expect(page.locator(BREADCRUMB)).to_have_count(0)

        # Un-nest puts the modules back, named by their place, and the super-module goes.
        wait_for_settled_transform(page)
        page.locator(SUPER_INSTANCE).click(button="right")
        page.locator(".context-menu__item", has_text="Un-nest").click()
        expect(page.locator(SUPER_INSTANCE)).to_have_count(0)
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT)
        expect(node_by_name(page, "nerve__var_SN")).to_have_count(1)
        expect(node_by_name(page, "nerve__axon_SN")).to_have_count(1)
        expect(page.locator(EDGE)).to_have_count(2)
        expect(page.locator(SUPERMODULE_CARD)).to_have_count(0)

        # Each is one undo step: the super instance comes back, then the modules as they were.
        undo(page)
        expect(page.locator(SUPER_INSTANCE)).to_have_count(1)
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT - 1)
        undo(page)
        expect(page.locator(SUPER_INSTANCE)).to_have_count(0)
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT)
        expect(node_by_name(page, "var_SN")).to_have_count(1)
        expect(page.locator(EDGE)).to_have_count(2)
        expect(page.locator(SUPERMODULE_CARD)).to_have_count(0)


    # ---------- dragging from the library -----------

    def test_drag_empty_supermodule_and_ask_on_shared_edit(self):
        page = self.page
        self.open_workspace()
        canvas = page.locator(".vue-flow")
        library = page.locator(".mlc").bounding_box()
        x = library["x"] + library["width"]

        # The Empty super-module entry makes a super-module and one super instance of it where it is dropped.
        empty = page.locator(EMPTY_SUPERMODULE)
        expect(empty.locator(".mlc__card-name")).to_have_text("Empty super-module")
        empty.drag_to(canvas, target_position={"x": x + 200, "y": 600})
        super_instance = page.locator(SUPER_INSTANCE)
        expect(super_instance).to_have_count(1)
        expect(super_instance.locator(".name-text")).to_have_text("supermodule")
        expect(page.locator(SUPERMODULE_CARD).locator(".mlc__card-name")).to_have_text(["supermodule"])
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT + 1)

        # One undo step takes both away; redo, and a second super instance from its card.
        undo(page)
        expect(super_instance).to_have_count(0)
        expect(page.locator(SUPERMODULE_CARD)).to_have_count(0)
        empty.drag_to(canvas, target_position={"x": x + 200, "y": 600})
        expect(super_instance).to_have_count(1)
        page.locator(SUPERMODULE_CARD).drag_to(canvas, target_position={"x": x + 600, "y": 600})
        expect(super_instance).to_have_count(2)
        expect(page.locator(SUPERMODULE_CARD).locator(".mlc__badge")).to_have_text("2 super instances")

        # Inside one, the banner names the library entry, and the first structural edit asks.
        wait_for_settled_transform(page)
        super_instance.first.get_by_role("button", name="Open super instance").click()
        expect(page.locator(BANNER)).to_contain_text(
            "Editing super-module 'supermodule' in the library — changes apply to 2 super instances"
        )
        wait_for_settled_transform(page)
        page.get_by_role("button", name="Cell modules").click()
        soma = page.locator(".mlc .mlc__card--draggable").filter(has_text="SN_soma").first
        soma.drag_to(canvas, target_position={"x": x + 300, "y": 300})
        question = page.get_by_role("dialog", name="Change Super-module?")
        expect(question).to_contain_text("This changes super-module 'supermodule' in the library, used by 2 super instances.")

        # Escape cancels: the module isn't added, and nothing is left to undo inside.
        page.keyboard.press("Escape")
        expect(question).to_be_hidden()
        expect(page.locator(NODE)).to_have_count(1)
        expect(page.locator(SUPERMODULE_CARD).locator(".mlc__modified")).to_have_count(0)

        # Change all keeps it, for both super instances, and asks no more here.
        soma.drag_to(canvas, target_position={"x": x + 300, "y": 300})
        question.get_by_role("button", name="Change all 2").click()
        expect(question).to_be_hidden()
        expect(page.locator(NODE)).to_have_count(2)
        expect(page.locator(SUPERMODULE_CARD).locator(".mlc__modified")).to_have_text("modified")
        page.locator(".mlc .mlc__card--draggable").filter(has_text="SN_axon").first.drag_to(
            canvas, target_position={"x": x + 700, "y": 300}
        )
        expect(page.locator(NODE)).to_have_count(3)
        expect(question).to_be_hidden()

        # Make this one a new super-module, asked again once the canvas has left.
        page.keyboard.press("Escape")
        expect(page.locator(BREADCRUMB)).to_have_count(0)
        wait_for_settled_transform(page)
        super_instance.first.get_by_role("button", name="Open super instance").click()
        expect(page.locator(NODE)).to_have_count(3)
        wait_for_settled_transform(page)
        node_by_name(page, "axon_SN").locator(".card-header-actions").click()
        page.keyboard.press("Delete")
        question.get_by_role("button", name="Make this one a new super-module").click()
        expect(question).to_be_hidden()
        expect(page.locator(NODE)).to_have_count(2)
        expect(page.locator(BANNER)).to_contain_text("'supermodule_2' in the library — changes apply to its one super instance")
        expect(page.locator(SUPERMODULE_CARD).locator(".mlc__card-name")).to_have_text(["supermodule_2", "supermodule"])


if __name__ == "__main__":
    unittest.main()
