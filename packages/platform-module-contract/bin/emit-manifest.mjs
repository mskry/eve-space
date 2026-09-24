#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalizePlatformModuleManifest } from '../dist/publisher.js'

const [inputPath, outputPath, ...extra] = process.argv.slice(2)
if (!inputPath || !outputPath || extra.length > 0) {
  throw new Error('Usage: eve-space-module-manifest <declaration-module> <output-json>')
}

const imported = await import(pathToFileURL(resolve(inputPath)).href)
const canonical = canonicalizePlatformModuleManifest(imported.default)
await mkdir(dirname(resolve(outputPath)), { recursive: true })
await writeFile(resolve(outputPath), canonical, 'utf8')
