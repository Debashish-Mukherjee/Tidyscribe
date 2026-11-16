import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResizeHandle } from "../../components/resizable";

const setup = (props: Partial<Parameters<typeof ResizeHandle>[0]> = {}) => {
  const onChange = vi.fn();
  const onReset = vi.fn();
  render(<ResizeHandle label="Resize panes" value={300} min={100} max={500} onChange={onChange} onReset={onReset} {...props} />);
  return { handle: screen.getByRole("separator", { name: "Resize panes" }), onChange, onReset };
};

const pointer = (type: string, clientX: number, init: MouseEventInit = {}) =>
  new MouseEvent(type, { bubbles: true, clientX, button: 0, ...init });

describe("ResizeHandle", () => {
  it("exposes accessible separator semantics", () => {
    const { handle } = setup();
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-valuenow", "300");
    expect(handle).toHaveAttribute("aria-valuemin", "100");
    expect(handle).toHaveAttribute("aria-valuemax", "500");
    expect(handle).toHaveAttribute("tabindex", "0");
  });

  it("resizes with arrow keys, larger steps with shift, and Home/End jump to the limits", () => {
    const { handle, onChange } = setup();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyDown(handle, { key: "End" });
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([316, 284, 364, 100, 500]);
  });

  it("clamps keyboard resizing to min and max and ignores other keys", () => {
    const { handle, onChange } = setup({ value: 495, max: 500 });
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(500);
    onChange.mockClear();
    fireEvent.keyDown(handle, { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("drags relative to where the drag started and clamps at the limits", () => {
    const { handle, onChange } = setup();
    handle.dispatchEvent(pointer("pointerdown", 400));
    handle.dispatchEvent(pointer("pointermove", 450));
    handle.dispatchEvent(pointer("pointermove", 1000));
    handle.dispatchEvent(pointer("pointermove", -500));
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([350, 500, 100]);
    expect(Element.prototype.setPointerCapture).toHaveBeenCalled();
  });

  it("stops tracking after pointerup and ignores non-primary buttons", () => {
    const { handle, onChange } = setup();
    handle.dispatchEvent(pointer("pointerdown", 400, { button: 2 }));
    handle.dispatchEvent(pointer("pointermove", 450));
    expect(onChange).not.toHaveBeenCalled();

    handle.dispatchEvent(pointer("pointerdown", 400));
    handle.dispatchEvent(pointer("pointerup", 400));
    handle.dispatchEvent(pointer("pointermove", 450));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("double-click resets", () => {
    const { handle, onReset } = setup();
    fireEvent.doubleClick(handle);
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("never reports values above min when max < min (container too narrow)", () => {
    const { handle, onChange } = setup({ min: 280, max: 100, value: 280 });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(280);
  });
});
