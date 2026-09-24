#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  runPlatformModuleConformance,
  formatPlatformModuleConformanceReport,
} from '../dist/conformance.js'

const cliArguments = process.argv.slice(2)
const json = cliArguments.includes('--json')
const configArgument = cliArguments.find((value) => value !== '--json')

if (!configArgument) {
  process.stderr.write('Usage: eve-space-module-conformance [--json] <config.json>\n')
  process.exitCode = 2
} else {
  try {
    const configPath = resolve(configArgument)
    const input = JSON.parse(await readFile(configPath, 'utf8'))
    const report = await runPlatformModuleConformance(input, { baseDirectory: dirname(configPath) })
    process.stdout.write(
      json
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${formatPlatformModuleConformanceReport(report)}\n`,
    )
    process.exitCode = report.ok ? 0 : 1
  } catch {
    const report = {
      checks: { artifact: false, source: false },
      issues: [
        {
          code: 'CONFORMANCE_CONFIG_INVALID',
          scope: 'input',
          path: 'config.json',
          message: 'Configuration could not be read or parsed.',
        },
      ],
      ok: false,
      version: 1,
    }
    process.stdout.write(
      json
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${formatPlatformModuleConformanceReport(report)}\n`,
    )
    process.exitCode = 2
  }
}
