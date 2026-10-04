import { spawnSync } from 'node:child_process'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateInstallerSidebar } from './generate-installer-sidebar.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const icons = join(root, 'src/resources/build/icons')
const cli = join(root, 'node_modules/@tauri-apps/cli/tauri.js')
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
// Keep generated intermediate files inside the project; never touch OS temp.
const temporary = await mkdtemp(join(root, '.notyra-icons-'))

function generate(source, output, extra = []) {
  const result = spawnSync(
    process.execPath,
    [cli, 'icon', source, '--output', output, ...extra],
    { cwd: root, encoding: 'utf8' }
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Icon generation failed')
  }
}

try {
  for (const [theme, name] of [
    ['light', 'notyra-logo.svg'],
    ['dark', 'icon.svg'],
  ]) {
    const target = join(icons, theme)
    const source = join(target, name)
    const output = join(temporary, theme)
    generate(source, output)
    generate(
      source,
      join(output, 'png'),
      sizes.flatMap(size => ['--png', `${size}`])
    )
    for (const directory of ['png', 'win', 'mac']) {
      await mkdir(join(target, directory), { recursive: true })
    }
    for (const size of sizes) {
      await copyFile(
        join(output, 'png', `${size}x${size}.png`),
        join(target, 'png', `${size}x${size}.png`)
      )
    }
    await copyFile(join(output, 'icon.ico'), join(target, 'win/icon.ico'))
    await copyFile(join(output, 'icon.icns'), join(target, 'mac/icon.icns'))
    await copyFile(join(target, 'png/512x512.png'), join(target, 'icon.png'))
    console.log(`Updated ${theme} PNG, ICO and ICNS assets`)
  }
  const appIcon = join(icons, 'dark/icon.png')
  // Keep an optional circular background for layered authoring only;
  // desktop icons omit it, and the plain foreground omits lighting and shadows.
  const source = await readFile(join(icons, 'dark/icon.svg'), 'utf8')
  const surface = source.match(
    /<linearGradient\b[^>]*\bid="surface"[^>]*>[\s\S]*?<\/linearGradient>/
  )[0]
  const layers = join(icons, 'layers')
  await mkdir(layers, { recursive: true })
  const svg = (content, viewBox = '0 0 1024 1024') =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="${viewBox}" fill="none">\n${content}\n</svg>\n`
  await writeFile(
    join(layers, 'background.svg'),
    svg(
      `<defs>${surface}</defs>\n<circle cx="512" cy="512" r="432" fill="url(#surface)"/>`
    )
  )
  const page = source.match(/<path\b[^>]*\bid="page"[^>]*\/>/)[0]
  await writeFile(
    join(layers, 'foreground.svg'),
    svg(`<defs>${page}</defs>\n<use href="#page" fill="white"/>`)
  )
  for (const [theme, name] of [
    ['light', 'notyra-logo.svg'],
    ['dark', 'icon.svg'],
  ]) {
    const source = await readFile(join(icons, theme, name), 'utf8')
    await writeFile(
      join(icons, theme, 'mark.svg'),
      svg(
        `${source.match(/<defs>[\s\S]*?<\/defs>/)[0]}\n${source.match(/<g\b[^>]*\bid="foreground"[^>]*>[\s\S]*<\/g>/)[0]}`,
        '128 128 768 768'
      )
    )
    const markOutput = join(temporary, `${theme}-mark`)
    generate(join(icons, theme, 'mark.svg'), markOutput, ['--png', '256'])
    await copyFile(
      join(markOutput, '256x256.png'),
      join(icons, theme, 'mark.png')
    )
  }
  const publicDirectory = join(root, 'src/renderer/public')
  await copyFile(appIcon, join(publicDirectory, 'icon.png'))
  await copyFile(appIcon, join(root, 'docs/images/icon.png'))
  // Preserve the existing certutil-style base64 wrapper used by this asset.
  const base64 = (await readFile(appIcon)).toString('base64')
  await writeFile(
    join(publicDirectory, 'icon.b64'),
    `-----BEGIN CERTIFICATE-----\n${base64.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`
  )
  console.log('Updated public and README icons')
  const installer = join(root, 'src/resources/build/installer')
  await mkdir(installer, { recursive: true })
  await generateInstallerSidebar(
    join(icons, 'dark/png/128x128.png'),
    join(installer, 'sidebar.bmp')
  )
  console.log('Updated NSIS installer sidebar with the current app icon')
  // Keep generated SVG attributes consistent with the repository lint rules.
  const lintResult = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/@biomejs/biome/bin/biome'),
      'check',
      '--write',
      icons,
    ],
    { cwd: root, encoding: 'utf8' }
  )
  if (lintResult.error) throw lintResult.error
  if (lintResult.status !== 0) {
    throw new Error(lintResult.stderr || lintResult.stdout || 'SVG lint failed')
  }
} finally {
  const temporaryPath = relative(root, temporary)
  if (
    isAbsolute(temporaryPath) ||
    !temporaryPath.startsWith('.notyra-icons-') ||
    temporaryPath.includes('/') ||
    temporaryPath.includes('\\')
  ) {
    throw new Error(
      `Refusing to remove a directory outside the workspace: ${temporary}`
    )
  }
  await rm(temporary, { recursive: true, force: true })
}
