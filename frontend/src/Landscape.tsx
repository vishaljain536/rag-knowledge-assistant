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
  return <div className="landscape" aria-hidden="true">
    <div className="landscape-image">
      {motionEnabled && <LandscapeVideo key={theme} theme={theme} />}
    </div>
  </div>;
}
