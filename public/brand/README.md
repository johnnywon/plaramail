# Brand assets

The PlaraMail mark is the Fold: three envelope flaps on a 48-unit grid, stroke 5, round caps and joins. The first two flaps are Ink `#141413` (Paper `#F6F5F2` on dark grounds), the last is Signal `#E46F2C`. A deployment's look comes from these files and `APP_NAME` in `wrangler.jsonc`; replace them to rebrand.

- `app-icon.svg`, `app-icon-192.png`, `app-icon-512.png`: Ink tile, Paper flaps, Signal last flap. Listed in `/site.webmanifest`.
- `app-icon-maskable-512.png`: full-bleed Ink with the mark inside Android's safe zone.
- `lockup-dark.png`, `lockup-light.png` (332 × 74): the README logos' horizontal lockup at 3x its 18px colophon size, with transparent room around the art so the round flap ends never touch the edge. Paper for dark grounds, Ink for light ones.
- `og-image.png` (1200 × 630): the horizontal lockup, Paper on Ink, for link previews.
- `/favicon.svg`: the mark alone, Ink flaps that turn Paper in a dark browser theme. `/favicon.ico` (16, 32, 48 px) and `/apple-touch-icon.png` (180 px) use the Ink tile.

The README logo is `docs/images/logo.png` (Paper, for dark themes) and `logo-light.png` (Ink).
