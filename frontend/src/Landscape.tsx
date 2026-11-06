import { useEffect, useRef, useState } from "react";
import type { ThemeId } from "./ThemePicker";

type LandscapeProps = { theme: ThemeId; motionEnabled: boolean };

function LandscapeVideo({ theme }: { theme: ThemeId }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const clip = video.current;
    if (!clip) return;
    const motion = matchMedia("(prefers-reduced-motion: no-preference)");
    let inView = false;

    const refreshPlayback = () => {
      if (!motion.matches) setPlaying(false);
      if (inView && !document.hidden && motion.matches) {
        if (!clip.hasAttribute("src")) clip.src = `/${theme}-loop.mp4`;
        void clip.play().catch(() => { /* Autoplay may be unavailable; the poster stays visible. */ });
      } else {
        clip.pause();
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      refreshPlayback();
    });
    observer.observe(clip);
    motion.addEventListener("change", refreshPlayback);
    document.addEventListener("visibilitychange", refreshPlayback);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", refreshPlayback);
      document.removeEventListener("visibilitychange", refreshPlayback);
      clip.pause();
      if (clip.hasAttribute("src")) {
        clip.removeAttribute("src");
        clip.load();
      }
    };
  }, [theme]);

  return <video ref={video} muted loop playsInline preload="none"
    className={playing ? "landscape-video is-playing" : "landscape-video"}
    onPlaying={() => setPlaying(true)} onError={() => setPlaying(false)} />;
}

export function Landscape({ theme, motionEnabled }: LandscapeProps) {
  const image = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!motionEnabled) return;
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
  }, [motionEnabled]);

  return <div className="landscape" aria-hidden="true">
    <div ref={image} className="landscape-image">
      {motionEnabled && <LandscapeVideo key={theme} theme={theme} />}
    </div>
    <div ref={layer} className="landscape-depth" />
  </div>;
}
