# Creating Icons for MyTube Downloader Extension

The extension requires icons in PNG format. You can create simple icons using any image editor or online tool.

## Icon Sizes Required

- `icon16.png` - 16x16 pixels (toolbar icon)
- `icon32.png` - 32x32 pixels (Windows)
- `icon48.png` - 48x48 pixels (Chrome Web Store)
- `icon128.png` - 128x128 pixels (Chrome Web Store)

## Quick Icon Creation Options

### Option 1: Online Icon Generator

1. Visit an online icon generator like:
   - https://www.favicon-generator.org/
   - https://realfavicongenerator.net/
   - https://favicon.io/

2. Upload or create a simple icon (download arrow + video icon)
3. Download the generated icons
4. Rename and place them in the `icons/` directory

### Option 2: Simple Icon Design

You can create simple icons using:
- A download arrow (⬇️) with a video icon (▶️)
- A gradient background (matching the extension's purple gradient: #667eea to #764ba2)
- White or contrasting foreground color

### Option 3: Use Placeholder Icons (For Testing)

For testing purposes, you can create simple colored squares with text:
- Use any image editor (Paint, GIMP, Photoshop, etc.)
- Create squares of the required sizes
- Fill with the gradient color (#667eea to #764ba2)
- Add a simple "M" or download arrow symbol

### Option 4: Copy from MyTube Frontend

You can use the MyTube favicon as a base:
- Copy `frontend/public/favicon.png` or `frontend/public/favicon.svg`
- Convert/Resize to the required PNG sizes
- Save in the `icons/` directory

## Icon File Structure

```
chrome-extension/
└── icons/
    ├── icon16.png   (16x16)
    ├── icon32.png   (32x32)
    ├── icon48.png   (48x48)
    └── icon128.png  (128x128)
```

## Testing Without Icons

If you don't have icons yet, the extension will still work but Chrome will show a default extension icon. The extension functionality is not dependent on custom icons.
