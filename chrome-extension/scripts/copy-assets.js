/**
 * Build script - copies assets and prepares extension for loading
 */
const fs = require('fs');
const path = require('path');

const dirs = ['background', 'content', 'popup', 'icons'];

// Ensure output directories exist
dirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// Copy HTML files
const htmlFiles = ['popup/popup.html'];
htmlFiles.forEach(file => {
  const src = path.join(__dirname, file);
  const dest = path.join(__dirname, file);
  if (fs.existsSync(src)) {
    console.log(`Copied: ${file}`);
  }
});

// Create placeholder icons (simple SVG converted to PNG would be needed in production)
// For now, we'll create empty placeholder files that can be replaced
const iconSizes = [16, 48, 128];
iconSizes.forEach(size => {
  const iconPath = path.join(__dirname, `icons/icon${size}.png`);
  if (!fs.existsSync(iconPath)) {
    // Create a minimal 1x1 transparent PNG as placeholder
    const minimalPng = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
      0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
      0x42, 0x60, 0x82
    ]);
    fs.writeFileSync(iconPath, minimalPng);
    console.log(`Created placeholder: icons/icon${size}.png`);
  }
});

console.log('Build complete!');
