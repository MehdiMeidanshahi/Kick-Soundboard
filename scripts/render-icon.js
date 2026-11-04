const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const svgPath = path.join(root, 'src', 'icon.svg');
const svg = fs.readFileSync(svgPath, 'utf8');

// Ensure build directory exists
const buildDir = path.join(root, 'build');
if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });

// Copy SVG to build/icon.svg
fs.writeFileSync(path.join(buildDir, 'icon.svg'), svg, 'utf8');

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngBuffers = [];

console.log('Rendering Kick Soundboard icon at multiple resolutions...');

for (const s of sizes) {
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: ${s}px;
      height: ${s}px;
      background: transparent !important;
      overflow: hidden;
    }
    svg {
      width: ${s}px;
      height: ${s}px;
      display: block;
    }
  </style>
</head>
<body>
  ${svg}
</body>
</html>`;

  const tempHtml = path.join(buildDir, `icon-render-${s}.html`);
  const outPng = path.join(buildDir, `icon-${s}.png`);
  fs.writeFileSync(tempHtml, htmlContent, 'utf8');

  try {
    execFileSync(edgePath, [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      `--window-size=${s},${s}`,
      '--default-background-color=00000000',
      `--screenshot=${outPng}`,
      `file:///${tempHtml.replace(/\\/g, '/')}`,
    ], { stdio: 'ignore' });

    if (fs.existsSync(outPng)) {
      const buf = fs.readFileSync(outPng);
      pngBuffers.push({ size: s, buffer: buf });
      console.log(`Rendered ${s}x${s} PNG (${buf.length} bytes)`);

      // If this is 256x256, save as primary icon.png in build/ and src/
      if (s === 256) {
        fs.copyFileSync(outPng, path.join(buildDir, 'icon.png'));
        fs.copyFileSync(outPng, path.join(root, 'src', 'icon.png'));
      }
      fs.unlinkSync(outPng);
    }
  } catch (err) {
    console.error(`Failed to render ${s}x${s}:`, err.message);
  } finally {
    try { fs.unlinkSync(tempHtml); } catch {}
  }
}

// Build standard multi-resolution ICO file
function createIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = ICO
  header.writeUInt16LE(count, 4); // count of images

  let dataOffset = 6 + count * 16;
  const dirEntries = [];

  for (const item of entries) {
    const dir = Buffer.alloc(16);
    const dim = item.size >= 256 ? 0 : item.size;
    dir.writeUInt8(dim, 0); // width
    dir.writeUInt8(dim, 1); // height
    dir.writeUInt8(0, 2); // color palette count
    dir.writeUInt8(0, 3); // reserved
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // bits per pixel
    dir.writeUInt32LE(item.buffer.length, 8); // size of image data
    dir.writeUInt32LE(dataOffset, 12); // offset of image data
    dirEntries.push(dir);
    dataOffset += item.buffer.length;
  }

  return Buffer.concat([
    header,
    ...dirEntries,
    ...entries.map(e => e.buffer),
  ]);
}

if (pngBuffers.length > 0) {
  const icoBuffer = createIco(pngBuffers);
  const buildIco = path.join(buildDir, 'icon.ico');
  const srcIco = path.join(root, 'src', 'icon.ico');
  const faviconIco = path.join(root, 'src', 'favicon.ico');

  fs.writeFileSync(buildIco, icoBuffer);
  fs.writeFileSync(srcIco, icoBuffer);
  fs.writeFileSync(faviconIco, icoBuffer);

  console.log(`Successfully generated ICO files (${icoBuffer.length} bytes) with ${pngBuffers.length} resolutions:`);
  console.log(' - build/icon.ico');
  console.log(' - src/icon.ico');
  console.log(' - src/favicon.ico');
}
