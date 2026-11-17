import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/store/useAppStore";

beforeEach(() => useAppStore.setState({ isCaptureMode: false, hiddenMessageIds: [], selectedMessageIds: [], selectionAnchor: null, isCapturing: false }));
describe("TR3 pre-model capture selection", () => {
  it("applies hidden rows only in capture mode and preserves them on exit", () => {
    const store = useAppStore.getState();
    store.hideMessage("b"); store.hideMessage("b");
    expect(useAppStore.getState().hiddenMessageIds).toEqual(["b"]);
    expect(store.isMessageHidden("b")).toBe(false);
    store.enterCaptureMode();
    expect(store.isMessageHidden("b")).toBe(true);
    store.handleSelectionClick("a", ["a", "b", "c"], { shift: false, cmdOrCtrl: false });
    store.setIsCapturing(true); store.exitCaptureMode();
    expect(useAppStore.getState()).toMatchObject({ hiddenMessageIds: ["b"], selectedMessageIds: [], selectionAnchor: null, isCapturing: false });
  });
  it("keeps range anchor, toggles individual selection and unions modifier ranges", () => {
    const click = useAppStore.getState().handleSelectionClick;
    const order = ["a", "b", "c", "d"];
    click("b", order, { shift: false, cmdOrCtrl: false });
    click("d", order, { shift: true, cmdOrCtrl: false });
    expect(useAppStore.getState()).toMatchObject({ selectedMessageIds: ["b", "c", "d"], selectionAnchor: "b" });
    click("c", order, { shift: false, cmdOrCtrl: true });
    expect(useAppStore.getState().selectedMessageIds).toEqual(["b", "d"]);
    click("a", order, { shift: true, cmdOrCtrl: true });
    expect(useAppStore.getState().selectedMessageIds).toEqual(["b", "d", "a", "c"]);
  });
});
