# Launcher & EmployeeDesk canvas

Anil — cream chrome only. The Home launcher uses Montserrat (artifact `Main.dc.html`). Do not change font family, size, or weight on EmployeeDesk or the rest of the panel.

Source artifact: Claude `EDom7iSE5NFfWzExfNa84P` / `Main.dc.html` (A · Odoo Classic).

## Hex

| Token | Value | Use |
|---|---|---|
| Canvas | `#f9f1eb` | Home launcher + EmployeeDesk hub page fill (`LAUNCHER_BRAND.canvas`) |
| Top bar | `#29293f` | Launcher header (`LAUNCHER_BRAND.topBar`) |
| Tile fills | `LAUNCHER_TILE_HEX` / artifact `LIST` | Launcher tiles only |

Sidebar, Settings, and the rest of the panel stay on the Shopify shell (`themes.css`). Do not port cream there.

## Locked

- Panel fonts stay `appFontClassName`. Launcher only: `launcherFontClassName` (Montserrat 400/500/600/700)
- Launcher footer is the company name. Do not put a website credit back.
- `text-[14px]`, `font-semibold`, and existing heading sizes on the hub
- Tile / chip colours on EmployeeDesk (only the page canvas moved from `#fafafa` to `#f9f1eb`)
