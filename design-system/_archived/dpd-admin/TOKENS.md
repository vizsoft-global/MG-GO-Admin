# DPD Admin — Design Tokens

> **Source of truth** for colors, type, spacing, and shadows.  
> Overrides [`MASTER.md`](./MASTER.md) where values conflict.  
> Reference screens: [`../references/`](../references/)

---

## Color palette

| Token | Hex | OKLCH (shadcn) | Usage |
|-------|-----|----------------|-------|
| Background (cream shell) | `#FAF6F2` | `oklch(0.98 0.01 85)` | App outer shell |
| Card / panel | `#FFFFFF` | `oklch(1 0 0)` | Main content panel, sidebar |
| Foreground (ink) | `#1A1A1A` | `oklch(0.21 0 0)` | Headings, body |
| Muted foreground | `#8A8A8A` | `oklch(0.58 0 0)` | Labels, subtitles |
| Border | `#ECE6DE` | `oklch(0.92 0.02 85)` | Dividers, inputs |
| Primary (dark CTA) | `#1A1A1A` | `oklch(0.21 0 0)` | `+ Add Driver`, Create |
| Primary foreground | `#FFFFFF` | `oklch(1 0 0)` | Text on primary |
| Accent (coral) | `#EF5B4D` | `oklch(0.65 0.19 25)` | Active tab, links, table headers |
| Accent foreground | `#FFFFFF` | `oklch(1 0 0)` | Text on accent |
| Muted surface | `#F5F0EB` | `oklch(0.96 0.01 85)` | Hover rows, secondary bg |
| Success | `#10B981` | `oklch(0.65 0.17 155)` | Active, On Duty |
| Success bg | `#D7F5E5` | `oklch(0.94 0.04 155)` | Status pill |
| Warning | `#F59E0B` | `oklch(0.75 0.15 75)` | Pending |
| Warning bg | `#FEF1D6` | `oklch(0.96 0.04 85)` | Status pill |
| Danger | `#EF5B4D` | `oklch(0.65 0.19 25)` | Suspended, alerts |
| Danger bg | `#FCE0DC` | `oklch(0.94 0.04 25)` | Status pill |
| Sidebar | `#1E1E2D` | `oklch(0.24 0.02 280)` | Nav background (dark) |
| Sidebar foreground | `#F5F5F7` | `oklch(0.97 0 0)` | Nav labels |
| Sidebar accent | `#E8DFD4` | `oklch(0.9 0.03 75)` | Active nav item bg (tan) |
| Sidebar accent fg | `#1A1A1A` | `oklch(0.21 0 0)` | Active nav label |

### Chart palette (warm)

| Token | Hex |
|-------|-----|
| chart-1 | `#EF5B4D` (coral) |
| chart-2 | `#F59E0B` (amber) |
| chart-3 | `#14B8A6` (teal) |
| chart-4 | `#64748B` (slate) |
| chart-5 | `#A78BFA` (lilac) |

---

## Typography

| Role | Size | Weight | Line height |
|------|------|--------|-------------|
| Page title | 24px (`text-2xl`) | 600 | 1.2 |
| Section title | 20px (`text-xl`) | 600 | 1.3 |
| Body | 14px (`text-sm`) | 400 | 1.5 |
| Label / caption | 12px (`text-xs`) | 500 | 1.4 |
| KPI value | 24–32px (`text-2xl`–`text-3xl`) | 600–700 | 1.1, `tabular-nums` |
| Table header | 12px (`text-xs`) | 600 | 1.4, `text-muted-foreground` on `bg-muted/30` |

**Fonts:** Inter (sans), Fira Code (mono for IDs only).

---

## Spacing

| Token | Value |
|-------|-------|
| xs | 4px |
| sm | 8px |
| md | 12px |
| base | 16px |
| lg | 20px |
| xl | 24px |
| 2xl | 32px |
| 3xl | 48px |

**Page padding:** `p-6` (24px) inside main panel.  
**Shell gap:** `p-3` (12px) between cream shell and white panel.

---

## Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius` | `1rem` (16px) | Base (shadcn) |
| Container | `rounded-2xl` | Main panel |
| Card | `rounded-xl` | Inner cards |
| Input / button | `rounded-lg` | Form controls |
| Pill | `rounded-full` | Status badges |

---

## Shadows

| Level | Value | Usage |
|-------|-------|-------|
| Card | `0 1px 2px rgba(15,15,15,0.04)` | KPI cards, table container |
| Panel | `0 4px 24px rgba(15,15,15,0.06)` | Main inset panel |
| Modal | `0 24px 48px rgba(15,15,15,0.12)` | Dialogs |

---

## Layout

| Element | Spec |
|---------|------|
| Sidebar width | 220px (`--sidebar-width`) |
| Header height | 64px (`h-16`) |
| Max content width | fluid within panel |
| Right rail (detail pages) | 320px |

---

## Dark mode mapping

| Light | Dark |
|-------|------|
| `#FAF6F2` background | `#1C1917` warm graphite |
| `#FFFFFF` card | `#292524` |
| `#1A1A1A` foreground | `#FAFAF9` |
| `#EF5B4D` accent | `#F87171` (slightly lighter coral) |
