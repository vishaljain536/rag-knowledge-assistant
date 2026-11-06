import { Icon } from "./Icons";

const themes = [
  { id: "archive-falls", name: "Archive Falls", description: "Teal waterfalls and a lantern-lit bridge", accent: "#9aead2" },
  { id: "moonlit-observatory", name: "Moonlit Observatory", description: "Indigo peaks and a silver alpine lake", accent: "#c9c6ff" },
  { id: "ember-canyon", name: "Ember Canyon", description: "Copper lanterns and a sandstone library", accent: "#ffc79c" },
] as const;

export type ThemeId = (typeof themes)[number]["id"];
const storageKey = "global-rag-theme";
const motionKey = "global-rag-background-motion";

export function readTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(storageKey);
    return themes.find(theme => theme.id === saved)?.id ?? themes[0].id;
  } catch {
    return themes[0].id;
  }
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  const pageColor = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", pageColor);
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    // The theme stays active for this visit when browser storage is unavailable.
  }
}

export function readBackgroundMotion() {
  try {
    return localStorage.getItem(motionKey) !== "off";
  } catch {
    return true;
  }
}

export function saveBackgroundMotion(enabled: boolean) {
  try {
    localStorage.setItem(motionKey, enabled ? "on" : "off");
  } catch {
    // The current visit still uses the selected motion setting.
  }
}

export function ThemePicker({ selected, onChange }: { selected: ThemeId; onChange: (theme: ThemeId) => void }) {
  return <fieldset className="theme-options">
    <legend className="visually-hidden">Available themes</legend>
    {themes.map(theme => <label className="theme-option" key={theme.id}>
      <input className="visually-hidden" type="radio" name="theme" value={theme.id}
        checked={selected === theme.id} onChange={() => onChange(theme.id)} />
      <span className="theme-card">
        <img src={`/${theme.id}-preview.webp`} width={160} height={90} alt="" />
        <span className="theme-card-copy"><strong>{theme.name}</strong><small>{theme.description}</small></span>
        {selected === theme.id ? <span className="theme-check" aria-hidden="true"><Icon name="check" size={15} /></span>
          : <span className="theme-swatch" aria-hidden="true" style={{ backgroundColor: theme.accent }} />}
      </span>
    </label>)}
  </fieldset>;
}
