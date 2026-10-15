# Brand assets

Source images for the Omnilogue app icon (tree-ring cross-section — a *log*, as in omni-**log**-ue).

| File | Use |
|---|---|
| `omnilogue-icon-fullbleed-1024.png` | Squircle tile fills the canvas, transparent corners. Source for every platform icon except macOS. |
| `omnilogue-icon-macos-1024.png` | Same tile at 824 px with a 100 px transparent margin (Apple macOS icon grid). Source for `icon.icns` only. |

Palette: graphite tile `#26272B` → `#151619`, indigo `#5E6AD2`, light indigo `#9AA0F0`, deep indigo `#3B3E58`, off-white `#EDEDF0`.

## Regenerating the icons

```bash
# 1. All platform icons from the full-bleed source
pnpm tauri icon brand/omnilogue-icon-fullbleed-1024.png

# 2. macOS .icns from the Apple-grid source
pnpm tauri icon brand/omnilogue-icon-macos-1024.png -o "$TMPDIR/omnilogue-mac"
cp "$TMPDIR/omnilogue-mac/icon.icns" src-tauri/icons/icon.icns

# 3. Android adaptive-icon XMLs are not tracked (no mobile target)
rm -rf src-tauri/icons/android/mipmap-anydpi-v26 src-tauri/icons/android/values

# 4. 128 px web / in-app icon
uv run --with pillow python -c "from PIL import Image; Image.open('brand/omnilogue-icon-fullbleed-1024.png').resize((128,128), Image.LANCZOS).save('public/app-icon.png')"
cp public/app-icon.png docs/assets/app-icon.png
```
