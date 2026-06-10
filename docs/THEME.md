# Theme & Color System

The entire UI is driven by two brand colors. Everything else is derived from these via CSS variables defined in `src/index.css`.

## Brand Colors

| Role    | Hex       | HSL                  | Use                                |
| ------- | --------- | -------------------- | ---------------------------------- |
| Primary | `#003C28` | `hsl(161 100% 12%)`  | Deep green — backgrounds, sidebar, primary buttons, headers |
| Accent  | `#C9A84C` | `hsl(43 55% 54%)`    | Gold — active states, focus rings, highlights, CTAs |

## Token Reference

All tokens live in `src/index.css` under `:root` (light) and `.dark` (dark). **Never** hardcode colors in components — always use tokens via Tailwind classes (`bg-primary`, `text-accent`, `border-input`, etc.) defined in `tailwind.config.ts`.

### Surface
- `--background` / `--foreground` — page base
- `--card` / `--card-foreground` — card surfaces
- `--popover` / `--popover-foreground` — overlays, dropdowns
- `--muted` / `--muted-foreground` — secondary text, disabled fills

### Action
- `--primary` / `--primary-foreground` — primary CTA (deep green light · gold dark)
- `--secondary` / `--secondary-foreground` — secondary CTA
- `--accent` / `--accent-foreground` — gold highlight (active, selected, hover focus)
- `--destructive` / `--destructive-foreground` — delete / danger
- `--success`, `--warning` — status feedback

### Form & Focus
- `--border`, `--input` — outlines
- `--ring` — focus ring (uses **accent** so focus is always gold)

### Sidebar
- `--sidebar-background` — deep green strip
- `--sidebar-foreground` — light gold-cream text
- `--sidebar-primary` — gold pill for active route
- `--sidebar-accent` — subtle green hover background

### Gradients & Shadows
- `--gradient-primary`, `--gradient-accent`, `--gradient-subtle`
- `--shadow-card`, `--shadow-elevated`, `--shadow-overlay`, `--shadow-glow`

## State Rules

Every interactive element MUST visibly distinguish all four states:

| State    | Convention                                                      |
| -------- | --------------------------------------------------------------- |
| Default  | `bg-primary` / `bg-background` / `border-input`                 |
| Hover    | `hover:bg-primary/90` (solid) · `hover:bg-accent/10` (subtle) · `hover:border-accent/60` (inputs) |
| Focus    | `focus-visible:ring-2 focus-visible:ring-accent` (always gold)  |
| Selected / Active | `bg-accent/20 text-accent-foreground` · sidebar uses `bg-sidebar-primary` |
| Disabled | `disabled:opacity-50 disabled:bg-muted disabled:text-muted-foreground disabled:pointer-events-none` |

## Dark Mode

`.dark` swaps the role of the two brand colors so the palette stays cohesive:

- Primary becomes **gold** (`hsl(43 55% 54%)`) on a deep-green background.
- Accent remains gold; ring/focus stays gold for consistency.
- Sidebar deepens to near-black green with gold active pills.

Toggle via `ThemeProvider` (`src/contexts/ThemeContext.tsx`). The `.dark` class is added on `<html>`.

## Adding New Colors

1. Add the HSL triple (no `hsl()` wrapper) to BOTH `:root` and `.dark` in `src/index.css`.
2. Register it in `tailwind.config.ts` under `theme.extend.colors` as `"hsl(var(--your-token))"`.
3. Use as a Tailwind class — never inline hex.

## Do / Don't

- ✅ `className="bg-primary text-primary-foreground"`
- ✅ `className="hover:bg-accent/10 focus-visible:ring-accent"`
- ❌ `className="bg-[#003C28] text-white"` — bypasses dark mode and breaks rebrand.
- ❌ `style={{ color: "#C9A84C" }}` — same problem.
