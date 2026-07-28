# DPD Admin — Design System

**Visual base:** [shadcn/ui](https://ui.shadcn.com) (`base-nova`, neutral). Use components from `@/components/ui/*` and product shells from `@/components/app/*`.

**Structure reference:** [Shopify Polaris](https://polaris-react.shopify.com/) — page hierarchy, index tables, settings secondary nav, empty states. Do **not** copy Polaris colors, fonts, or deprecated React components.

---

## Tokens

- Use **semantic CSS variables** only: `background`, `foreground`, `card`, `muted`, `muted-foreground`, `border`, `primary`, `sidebar-*`, `success`, `warning`, `danger` (+ `-bg`).
- **Single locked theme** in [`src/app/themes.css`](../src/app/themes.css): flat neutral content, **navy sidebar** (light mode), **Shopify-green** primary/accent. No theme switcher — light/dark mode only.
- **Metric / KPI tones:** `primary`, `success`, `warning`, `danger`, `neutral` only (via `MetricTile`, `Pill`, `StatusDot`).
- **Status pills:** `StatusPill` + `resolveStatusVariant()` from `@/lib/ui/resolve-status-variant`.
- **Map colors:** `MAP_COLORS` from `@/lib/ui/map-colors.ts` (derived from theme tokens).
- **Forbidden in feature code:** raw Tailwind palette (`bg-emerald-*`, `text-blue-*`, etc.), hex colors (except map-colors.ts), extra theme presets, `shadow-md` on cards, Bodoni/cream palette.

## Spacing

- Dashboard main padding: `p-6` (layout).
- Page vertical rhythm: `AppPage` → `space-y-6`.
- Card radius: `rounded-xl`, border `border-border`, shadow `shadow-sm` max.

## Page recipes

### 1. Index (list) page

```
AppPage
  AppPageHeader (title, description, actions, optional tabs)
  optional KpiGrid
  AppListCard (toolbar + AppDataTable)
```

Canonical examples: Partners, Drivers. Placeholders: `ModuleIndexPage`.

### 2. Detail page

```
AppPage
  AppPageHeader (+ breadcrumbs / back)
  summary Card
  TabBar
  tab content (AppDataTable or AppEmptyState)
```

### 3. Create / edit form

```
AppPage (narrow optional)
  AppPageHeader
  AppFormSection × N
  footer: primary Button + outline cancel
```

### 4. Settings

```
AppSettingsLayout (secondary nav + content)
  page content in Cards / AppFormSection
```

Settings nav must keep `SETTINGS_SUB_ITEMS`, permissions, and `/settings` exact-match active rule.

## Tables

- Header cells: `TABLE_HEAD_CLASS` from `@/components/app/constants` (or `AppDataTable`).
- Row hover: `hover:bg-muted/40`.
- Empty state: `AppDataTableEmpty` + `AppEmptyState`.

## Components map

| Use | Import |
|-----|--------|
| Page shell | `@/components/app` → `AppPage`, `AppPageHeader` |
| List index | `AppListCard`, `AppListToolbar`, `AppDataTable` |
| Settings frame | `AppSettingsLayout` |
| Form sections | `AppFormSection` |
| Status | `StatusPill`, `Badge` |
| Tabs | `TabBar` from `@/components/dashboard/tab-bar` |

## Adding a page

1. Pick a recipe above.
2. Add i18n under `pages.<module>` in `en.json` / `ar.json`.
3. Do not add per-page color or shadow overrides.

## Motion & animation

**Reference skill:** [`.cursor/skills/emil-design-eng/SKILL.md`](../.cursor/skills/emil-design-eng/SKILL.md) (on-demand). **Audit:** [`UI_MOTION_AUDIT.md`](./UI_MOTION_AUDIT.md).

Admin UI is dense and fast — motion should feel crisp, not decorative. Match Linear / Stripe / Ramp: responsive, invisible when correct.

### Easing tokens (add to `globals.css` `@theme inline`)

| Token | Value | Use |
|-------|-------|-----|
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Enter animations, dropdowns, button press release |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | On-screen movement (sliding panels, repositioning) |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | Sheet/drawer slide (iOS-like) |

Use Tailwind arbitrary values: `ease-[var(--ease-out)]`, `ease-[var(--ease-drawer)]`.

### Duration guide

| Element | Duration |
|---------|----------|
| Button press feedback | 100–160ms |
| Tooltips, small popovers | 125–200ms |
| Dropdowns, selects | 150–250ms |
| Modals, sheets | 200–250ms |

Stay under **300ms** for all UI interactions.

### Rules

1. **No `transition-all`** — list exact properties (`transition-colors`, `transition-[transform,opacity]`, etc.).
2. **Origin-aware floating UI** — popover/dropdown/tooltip/select content uses `origin-(--transform-origin)` (Base UI positioner).
3. **Modals stay centered** — dialog/sheet content scales from viewport center with `scale-95`, not `scale(0)`.
4. **Enter on ease-out** — avoid `ease-in` on UI elements; it delays initial movement.
5. **GPU-only motion** — animate `transform` and `opacity` only; never width/height/margin/padding.
6. **Reduced motion** — global `@media (prefers-reduced-motion: reduce)` keeps opacity/color, disables transform motion.
7. **No keyboard-action animation** — sidebar nav, table keyboard nav, SearchSelect typing must not animate.
8. **Hover gating** — transform hover effects only under `@media (hover: hover) and (pointer: fine)`.

### When to animate

| How often users see it | Decision |
|------------------------|----------|
| 100+ times/day | No animation |
| Tens/day | Minimal — color/opacity, ≤150ms |
| Occasional (modals, toasts) | Standard enter/exit |
| Rare (onboarding) | Optional stagger (30–80ms between items) |

### Stack notes

- **tw-animate-css** provides enter/exit utilities (`animate-in`, `fade-in-0`, `zoom-in-95`) — prefer over custom keyframes.
- **Sonner** handles toast stack transitions; theme via [`src/components/ui/sonner.tsx`](../src/components/ui/sonner.tsx).
- **No framer-motion** — keep motion in CSS for performance under load.
