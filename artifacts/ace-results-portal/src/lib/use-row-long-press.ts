import { useRef, type PointerEvent, type SyntheticEvent } from "react";

const HOLD_MS = 550;
const MOVE_PX = 10;

/** Touch/pen hold on a row. Mouse clicks and movement past a few pixels do not fire. */
export function useRowLongPress(onLongPress: (id: number) => void) {
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);
  const suppressClick = useRef(false);

  const clear = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = undefined;
    origin.current = null;
  };

  const bind = (id: number) => ({
    onPointerDown(event: PointerEvent) {
      if (event.pointerType === "mouse") return;
      clear();
      origin.current = { x: event.clientX, y: event.clientY, id };
      timer.current = window.setTimeout(() => {
        const held = origin.current?.id;
        origin.current = null;
        timer.current = undefined;
        if (held == null) return;
        suppressClick.current = true;
        onLongPressRef.current(held);
      }, HOLD_MS);
    },
    onPointerMove(event: PointerEvent) {
      if (!origin.current) return;
      const dx = Math.abs(event.clientX - origin.current.x);
      const dy = Math.abs(event.clientY - origin.current.y);
      if (dx > MOVE_PX || dy > MOVE_PX) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu(event: SyntheticEvent) {
      event.preventDefault();
    },
  });

  const consumeSuppressedClick = () => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  };

  return { bind, consumeSuppressedClick };
}
