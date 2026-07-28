# UI Motion Audit

**Date:** 2026-05-29  
**Reference skill:** [emil-design-eng](../.cursor/skills/emil-design-eng/SKILL.md) ([Emil Kowalski](https://emilkowal.ski/skill))  
**Stack:** Next.js 16, Tailwind CSS v4, shadcn `base-nova` on `@base-ui/react`, `tw-animate-css`, Sonner  
**Scope:** Audit report only — no component/CSS refactors in this pass.

---

## Summary

The admin panel has a solid foundation: floating surfaces (popover, dropdown, select, tooltip) are **origin-aware**, modals scale from center, and Sonner is themed. The main gaps are **accessibility (no reduced-motion handling)**, **broad `transition-all` usage in shared primitives**, and **missing centralized easing tokens**. These are low-risk, high-leverage fixes that propagate everywhere once applied to primitives and `globals.css`.

| Severity | Count | Theme |
|----------|-------|-------|
| **High** | 2 | No `prefers-reduced-motion`; `transition-all` in 8+ shared components |
| **Medium** | 4 | No easing tokens; dialog/sheet easing; tooltip timing; hover not gated behind `(hover: hover)` |
| **Low** | 3 | Button press style (`translate-y-px` vs scale); theme-toggle `transition-all`; list row hover |
| **Compliant** | 5 | Origin-aware popovers; modal center origin; Sonner setup; zoom from 0.95; no framer-motion overhead |

---

## Already compliant (wins)

| Area | Status | Evidence |
|------|--------|----------|
| **Origin-aware floating UI** | Pass | `origin-(--transform-origin)` on dropdown, popover, tooltip, select — Base UI positioner variable |
| **Modal center origin** | Pass | Dialog/sheet use fixed center + `scale-95` — correct for viewport-centered modals |
| **Entry scale not from zero** | Pass | `zoom-in-95` / `data-starting-style:scale-95` — avoids `scale(0)` pop-in |
| **Sonner integration** | Pass | Themed wrapper + `richColors` + semantic CSS vars in layout |
| **No JS animation library** | Pass | No framer-motion; CSS + tw-animate-css keeps bundle lean and GPU-friendly |

---

## 1. Global tokens & CSS foundation

**Files:** [`src/app/globals.css`](../src/app/globals.css), [`src/app/themes.css`](../src/app/themes.css)

| Before | After | Why | Severity |
|--------|-------|-----|----------|
| No `--ease-out`, `--ease-in-out`, or `--ease-drawer` in `@theme inline` | Add to `@theme inline`: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1);` `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);` `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);` | Custom curves feel intentional; weak defaults make UI feel sluggish | **Medium** |
| No global `@media (prefers-reduced-motion: reduce)` block | Add block in `globals.css`: keep opacity/color transitions; disable transform-based motion (`animation-duration: 0.01ms`, `transition-duration: 0.01ms` for transform/translate/scale) | Motion can cause sickness; skill says "fewer and gentler, not zero" | **High** |
| Motion relies on tw-animate-css defaults only | Document token usage in DESIGN_SYSTEM; reference `ease-out` for enter, `ease-in-out` for on-screen movement | Consistent personality across admin surfaces | **Medium** |

---

## 2. Shared UI primitives (`src/components/ui/`)

### Button

**File:** [`src/components/ui/button.tsx`](../src/components/ui/button.tsx)

| Before | After | Why | Severity |
|--------|-------|-----|----------|
| `transition-all` on base variant | `transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out` | Avoid animating unrelated properties; specify exact properties | **High** |
| `active:not-aria-[haspopup]:translate-y-px` | Optional: `active:not-aria-[haspopup]:scale-[0.97]` with `transition-transform duration-100 ease-out` | Skill prefers scale press feedback; current translate-y is acceptable for dense admin UI — **optional**, not mandatory | **Low** |
| Hover/active not gated | Wrap hover transforms in `@media (hover: hover) and (pointer: fine)` if scale hover added | Touch devices trigger false hover states | **Medium** |

### Badge

**File:** [`src/components/ui/badge.tsx`](../src/components/ui/badge.tsx)

| Before | After | Why | Severity |
|--------|-------|-----|----------|
| `transition-all` | `transition-colors duration-150` | Badges only need color transitions | **High** |

### Tabs

**File:** [`src/components/ui/tabs.tsx`](../src/components/ui/tabs.tsx)

| Before | After | Why | Severity |
|--------|-------|-----|----------|
| `transition-all` on tab triggers | `transition-[color,box-shadow,opacity] duration-150` | Underline uses separate `after:transition-opacity` — root doesn't need `all` | **High** |

### Switch

**File:** [`src/components/ui/switch.tsx`](../src/components/ui/switch.tsx)

| Before | After | Why | Severity |
|--------|-------|-----|----------|
| Root: `transition-all`; thumb: `transition-transform` | Root: `transition-colors duration-150`; keep thumb `transition-transform duration-150 ease-out` | Root only toggles background; thumb handles motion | **High** |

### Dialog

**File:** [`src/components/ui/dialog.tsx`](../src/components/ui/dialog.tsx)

| Before | After | Why | Severity |
|--------|-------|-----|----------|
| `transition duration-200 ease-in-out` on content | `transition-[transform,opacity] duration-200 ease-out` on enter; exit can stay 150ms | `ease-in`/`ease-in-out` delays initial movement; enter should feel responsive | **Medium** |
| Overlay: `transition-opacity duration-150` | Keep; ensure reduced-motion zeros transform on content | Overlay fade is acceptable under reduced motion | **Medium** |

### Sheet (drawer)

**File:** [`src/components/ui/sheet.tsx`](../src/components/ui/sheet.tsx)

| Before | After | Why | Severity |
|--------|-------|-----|----------|
| `transition duration-200 ease-in-out` | `transition-[transform,opacity] duration-200 ease-[var(--ease-drawer)]` | Drawer curve (iOS-like) feels natural for slide panels | **Medium** |
| Side slide `translate-x/y-[2.5rem]` | Keep; consider `translateY(100%)` pattern for bottom sheets if added | Percentage-based transforms adapt to content height | **Low** |

### Dropdown menu, Popover, Select

**Files:** [`dropdown-menu.tsx`](../src/components/ui/dropdown-menu.tsx), [`popover.tsx`](../src/components/ui/popover.tsx), [`select.tsx`](../src/components/ui/select.tsx)

| Before | After | Why | Severity |
|--------|-------|-----|----------|
| `origin-(--transform-origin)` + `duration-100` + `zoom-in-95` | Keep origin; add explicit `ease-out` via token | Already origin-aware — add easing token for consistency | **Compliant** |
| Select: `data-[align-trigger=true]:animate-none` | Keep | Skips animation when aligned to trigger — good for rapid keyboard nav | **Compliant** |

### Tooltip

**File:** [`src/components/ui/tooltip.tsx`](../src/components/ui/tooltip.tsx)

| Before | After | Why | Severity |
|--------|-------|-----|----------|
| No explicit `duration-*` on content | Add `duration-125 ease-out` (125–200ms per skill) | Tooltips should feel snappy | **Medium** |
| No instant-on-subsequent pattern | Track open state; add `data-instant` class with `transition-duration: 0ms` when switching between adjacent tooltips | Toolbar tooltips feel faster after first open | **Medium** |

### Sidebar rail

**File:** [`src/components/ui/sidebar.tsx`](../src/components/ui/sidebar.tsx)

| Before | After | Why | Severity |
|--------|-------|-----|----------|
| `transition-all ease-linear` on resize rail | `transition-[width,left,right,opacity] duration-200 ease-out` | `ease-linear` feels mechanical; specify properties | **Medium** |

### Skeleton

**File:** [`src/components/ui/skeleton.tsx`](../src/components/ui/skeleton.tsx)

| Before | After | Why | Severity |
|--------|-------|-----|----------|
| `animate-pulse` | Under reduced-motion: static `bg-muted` or slower opacity pulse only | Pulse is decorative; respect user preference | **High** (via global block) |

---

## 3. App components & features

### Toggle chips

**File:** [`src/components/app/toggle-chip.tsx`](../src/components/app/toggle-chip.tsx)

| Before | After | Why | Severity |
|--------|-------|-----|----------|
| `transition-all` on chip and segment variants | `transition-[color,background-color,border-color,box-shadow] duration-150` | Chips toggle color/border only — no transform needed | **High** |

### Theme toggle

**File:** [`src/components/theme/theme-toggle.tsx`](../src/components/theme/theme-toggle.tsx)

| Before | After | Why | Severity |
|--------|-------|-----|----------|
| Sun/Moon icons: `transition-all` + scale/rotate | `transition-[transform,opacity] duration-200 ease-out` | Icon swap is occasional — 200ms ease-out is fine | **Low** |

### Live driver list rows

**File:** [`src/features/live-tracking/live-driver-list.tsx`](../src/features/live-tracking/live-driver-list.tsx)

| Before | After | Why | Severity |
|--------|-------|-----|----------|
| Row: `transition-all hover:bg-muted/40` | `transition-colors duration-150` | Background hover only | **Low** |

### Map marker pulse

**File:** [`src/features/locations/driver-marker-pulse-overlay.ts`](../src/features/locations/driver-marker-pulse-overlay.ts)

| Before | After | Why | Severity |
|--------|-------|-----|----------|
| Injected `@keyframes dpd-driver-pulse` with scale animation | Disable or replace with static ring under `prefers-reduced-motion` | Decorative map pulse should respect motion preference | **Medium** |

---

## 4. Toasts (Sonner)

**Files:** [`src/components/ui/sonner.tsx`](../src/components/ui/sonner.tsx), [`src/app/[locale]/layout.tsx`](../src/app/[locale]/layout.tsx)

| Before | After | Why | Severity |
|--------|-------|-----|----------|
| Themed wrapper + `richColors position="top-center"` | Keep; verify Sonner's built-in reduced-motion behavior on upgrade | Sonner handles stack transitions well (CSS transitions, not keyframes) | **Compliant** |
| Loading icon uses `animate-spin` | Keep; reduced-motion global block should slow or simplify spin | Spinners aid comprehension — skill allows under reduced motion | **Medium** |

---

## 5. Animation decision framework (admin-specific)

Per the skill, apply this lens before adding motion to new UI:

| Frequency | Admin examples | Decision |
|-----------|----------------|----------|
| **100+/day** | Sidebar nav, table row keyboard nav, SearchSelect typing | **No animation** |
| **Tens/day** | Dropdown filters, tab switches, hover on list rows | **Minimal** — color only, ≤150ms |
| **Occasional** | Modals, sheets, toasts, wizard step transitions | **Standard** — 150–250ms ease-out |
| **Rare/first-time** | Onboarding, empty-state illustrations | **Can add delight** — stagger optional |

**Never animate keyboard-initiated actions** (e.g. Cmd+K palette if added, arrow-key list nav).

---

## Fix checklist (ready for implementation pass)

When approved, execute in this order for maximum propagation with minimum churn:

- [ ] **1. Global foundation** — Add easing tokens + `prefers-reduced-motion` block to [`globals.css`](../src/app/globals.css)
- [ ] **2. Primitives batch** — Replace `transition-all` in button, badge, tabs, switch, toggle-chip
- [ ] **3. Overlay timing** — Update dialog/sheet easing; add tooltip duration + instant pattern
- [ ] **4. Sidebar rail** — Replace `ease-linear` + `transition-all`
- [ ] **5. Feature cleanup** — theme-toggle, live-driver-list row transitions
- [ ] **6. Map pulse** — Gate injected keyframes behind reduced-motion check
- [ ] **7. Verify** — Manual pass on 14" viewport: modal open, dropdown, tooltip toolbar, toast, sidebar collapse; test with OS "Reduce motion" enabled

**Estimated touch count:** ~12 files, mostly class string edits in shared primitives.

---

## Skill installation

| Item | Detail |
|------|--------|
| **Location** | [`.cursor/skills/emil-design-eng/SKILL.md`](../.cursor/skills/emil-design-eng/SKILL.md) |
| **Activation** | On-demand — invoke when reviewing animations, polish, or micro-interactions |
| **Not always-on** | No `alwaysApply` in frontmatter; use case-by-case per author recommendation |
| **Install method** | Fetched from [emilkowalski/skill](https://github.com/emilkowalski/skill) (`npx skills add` hung; manual install equivalent) |

---

## Related docs

- Motion conventions (codified): [DESIGN_SYSTEM.md § Motion & Animation](./DESIGN_SYSTEM.md#motion--animation)
- Enforceable rules: [`.cursor/rules/ui-system.mdc` §14](../.cursor/rules/ui-system.mdc)
