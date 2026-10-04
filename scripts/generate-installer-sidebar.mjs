import { readFile, writeFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'

// Tauri renders icons as non-interlaced, 8-bit RGBA PNGs. Decode that format
// here so icon generation stays portable and needs no extra image tools.
function readRgbaPng(png) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (!png.subarray(0, 8).equals(signature)) {
    throw new Error('Installer logo must be a PNG')
  }
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0) {
    throw new Error('Installer logo must be a non-interlaced 8-bit RGBA PNG')
  }
  const chunks = []
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    if (type === 'IDAT') {
      chunks.push(png.subarray(offset + 8, offset + 8 + length))
    }
    offset += length + 12
  }
  const filtered = inflateSync(Buffer.concat(chunks))
  const stride = width * 4
  if (filtered.length !== (stride + 1) * height) {
    throw new Error('Unexpected installer logo pixel data length')
  }
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const row = y * stride
    const sourceRow = y * (stride + 1)
    const filter = filtered[sourceRow]
    if (filter > 4) throw new Error(`Unsupported PNG filter: ${filter}`)
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[row + x - 4] : 0
      const up = y > 0 ? pixels[row + x - stride] : 0
      const upperLeft = y > 0 && x >= 4 ? pixels[row + x - stride - 4] : 0
      let predictor = 0
      if (filter === 1) predictor = left
      if (filter === 2) predictor = up
      if (filter === 3) predictor = Math.floor((left + up) / 2)
      if (filter === 4) {
        const estimate = left + up - upperLeft
        const a = Math.abs(estimate - left)
        const b = Math.abs(estimate - up)
        const c = Math.abs(estimate - upperLeft)
        predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft
      }
      pixels[row + x] = (filtered[sourceRow + x + 1] + predictor) & 255
    }
  }
  return { width, height, pixels }
}

export async function generateInstallerSidebar(iconPath, sidebarPath) {
  const logo = readRgbaPng(await readFile(iconPath))
  if (logo.width !== 128 || logo.height !== 128) {
    throw new Error('Installer sidebar requires the generated 128px app icon')
  }
  // NSIS welcome/finish page bitmap: opaque, uncompressed 24-bit BGR.
  const width = 164
  const height = 314
  const stride = Math.ceil((width * 3) / 4) * 4
  const bitmap = Buffer.alloc(54 + stride * height)
  bitmap.write('BM')
  bitmap.writeUInt32LE(bitmap.length, 2)
  bitmap.writeUInt32LE(54, 10)
  bitmap.writeUInt32LE(40, 14)
  bitmap.writeInt32LE(width, 18)
  bitmap.writeInt32LE(height, 22)
  bitmap.writeUInt16LE(1, 26)
  bitmap.writeUInt16LE(24, 28)
  bitmap.writeUInt32LE(stride * height, 34)
  const top = [102, 125, 233]
  const bottom = [117, 75, 162]
  const logoX = (width - logo.width) / 2
  const logoY = (height - logo.height) / 2
  for (let y = 0; y < height; y++) {
    const background = top.map((value, channel) =>
      Math.round(value + ((bottom[channel] - value) * y) / (height - 1))
    )
    for (let x = 0; x < width; x++) {
      const offset = 54 + (height - y - 1) * stride + x * 3
      const inside =
        x >= logoX &&
        x < logoX + logo.width &&
        y >= logoY &&
        y < logoY + logo.height
      const source = ((y - logoY) * logo.width + x - logoX) * 4
      const alpha = inside ? logo.pixels[source + 3] / 255 : 0
      for (let channel = 0; channel < 3; channel++) {
        bitmap[offset + 2 - channel] = Math.round(
          background[channel] * (1 - alpha) +
            (inside ? logo.pixels[source + channel] : 0) * alpha
        )
      }
    }
  }
  await writeFile(sidebarPath, bitmap)
}
