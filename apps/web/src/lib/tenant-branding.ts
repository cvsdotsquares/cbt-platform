/** Convert #RRGGBB to shadcn-style HSL channels: "H S% L%" */
export function hexToHslChannels(hex: string): string | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match) return null;

  const r = parseInt(match[1], 16) / 255;
  const g = parseInt(match[2], 16) / 255;
  const b = parseInt(match[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Apply tenant primary color to document CSS variables used by the UI. */
export function applyTenantPrimaryColor(hex?: string | null) {
  if (typeof document === 'undefined' || !hex) return;

  const channels = hexToHslChannels(hex);
  if (!channels) return;

  const root = document.documentElement;
  root.style.setProperty('--primary', channels);
  root.style.setProperty('--ring', channels);
  root.style.setProperty('--sidebar-accent', channels);
  root.style.setProperty('--gradient-start', channels);
  root.style.setProperty('--accent-foreground', channels);
}
