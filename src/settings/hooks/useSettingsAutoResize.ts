/**
 * Auto-sizes the Settings window to the active tab's content.
 *
 * Every change issues exactly **one** `setSize` IPC call with the clamped
 * target height. Animating the height frame by frame would mean a burst of
 * async OS window resizes and webview relayouts — each one re-running the
 * window's `backdrop-filter` blur — which is what made tab switches feel
 * laggy. The window snaps to the new height instead.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';

const MIN_HEIGHT = 280;
const MAX_HEIGHT = 700;
const SETTINGS_WIDTH = 580;
const NEGLIGIBLE_DELTA_PX = 4;

function clampHeight(h: number): number {
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, h));
}

export function useSettingsAutoResize(
  el: HTMLElement | null,
  chromeHeight: number,
  revision: unknown,
): boolean {
  const [isClamped, setIsClamped] = useState(false);
  const lastSentRef = useRef<number | null>(null);
  const chromeRef = useRef(chromeHeight);
  chromeRef.current = chromeHeight;

  const handleResizeRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!el) return;

    const handleResize = () => {
      const natural = el.scrollHeight + chromeRef.current;
      const target = clampHeight(natural);
      const shouldClamp = natural > MAX_HEIGHT;
      setIsClamped((prev) => (prev === shouldClamp ? prev : shouldClamp));
      if (
        lastSentRef.current !== null &&
        Math.abs(target - lastSentRef.current) < NEGLIGIBLE_DELTA_PX
      ) {
        return;
      }
      lastSentRef.current = target;
      void getCurrentWindow().setSize(new LogicalSize(SETTINGS_WIDTH, target));
    };

    handleResizeRef.current = handleResize;
    const observer = new ResizeObserver(handleResize);
    observer.observe(el);
    handleResize();

    return () => {
      observer.disconnect();
    };
  }, [el]);

  useLayoutEffect(() => {
    handleResizeRef.current();
  }, [revision, chromeHeight]);

  return isClamped;
}
