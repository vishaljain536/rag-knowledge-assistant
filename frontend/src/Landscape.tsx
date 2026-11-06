import { useEffect, useRef } from "react";

export function Landscape() {
  const image = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const art = image.current;
    const depth = layer.current;
    const stage = depth?.parentElement?.parentElement;
    if (!art || !depth || !stage) return;

    const motion = matchMedia("(any-pointer: fine) and (prefers-reduced-motion: no-preference)");
    let dispose: (() => void) | undefined;
    let started = false;
    let generation = 0;

    const start = (event: PointerEvent) => {
      if (started || !motion.matches || event.pointerType === "touch") return;
      started = true;
      const attempt = ++generation;
      void import("./landscapeMotion").then(({ mountLandscapeMotion }) => {
        if (attempt === generation && motion.matches) {
          dispose = mountLandscapeMotion(stage, art, depth);
        }
      }).catch(() => {
        // The CSS artwork stays visible if the optional renderer cannot load.
      });
    };

    function refreshPreference() {
      if (!motion.matches) {
        generation++;
        dispose?.();
        dispose = undefined;
        started = false;
      }
    }

    stage.addEventListener("pointermove", start, { passive: true });
    motion.addEventListener("change", refreshPreference);
    return () => {
      generation++;
      stage.removeEventListener("pointermove", start);
      motion.removeEventListener("change", refreshPreference);
      dispose?.();
    };
  }, []);

  return <div className="landscape" aria-hidden="true">
    <div ref={image} className="landscape-image" />
    <div ref={layer} className="landscape-depth" />
  </div>;
}
