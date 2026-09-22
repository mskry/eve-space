import { spawn, execFile } from 'node:child_process'
import { appendFile, mkdir } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const executeFile = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const logDirectory = resolve(root, '.quality-logs')
const maximumWorkers = process.env.QUALITY_MAX_WORKERS ?? String(defaultMaximumWorkers())
const sampleIntervalMs = Number(process.env.QUALITY_SAMPLE_INTERVAL_MS ?? 10_000)
const commandArguments = process.argv.slice(2).filter((argument) => argument !== '--')
const dryRun = commandArguments[0] === '--dry-run'
const qualityProcess = /(?:nuxt|vitest|sonar|pnpm)/i

const steps = [
  { name: 'frontend-coverage', arguments: ['test:frontend:coverage'] },
  { name: 'api-coverage', arguments: ['test:api:coverage'] },
  {
    name: 'postgres-coverage',
    arguments: ['--filter', '@eve-space/api', 'test:postgres:coverage'],
  },
  { name: 'module-coverage', arguments: ['test:modules:coverage'] },
  { name: 'registry-coverage', arguments: ['test:registry:coverage'] },
  { name: 'redis-tests', arguments: ['test:redis'] },
  { name: 'sonar-analysis', arguments: ['sonar'] },
] as const

if (commandArguments.length > (dryRun ? 1 : 0))
  throw new Error('Usage: run-sonar-quality.ts [--dry-run]')
if (!Number.isFinite(sampleIntervalMs) || sampleIntervalMs < 1_000)
  throw new Error('QUALITY_SAMPLE_INTERVAL_MS must be at least 1000')

const logPath = resolve(logDirectory, `sonar-${fileTimestamp(new Date())}.jsonl`)
let checkpointWrites = Promise.resolve()
await mkdir(logDirectory, { recursive: true })

console.log(`Quality telemetry: ${logPath}`)
console.log(`Vitest worker cap: ${maximumWorkers}`)
await recordCheckpoint('run-start')

const exitCode = await runQualitySteps()
await recordCheckpoint('run-end', undefined, { status: exitCode })
process.exitCode = exitCode

async function runQualitySteps(index = 0): Promise<number> {
  const step = steps[index]
  if (!step) return 0
  const startedAt = Date.now()
  console.log(`\n[quality:sonar] ${step.name}`)
  await recordCheckpoint('step-start', step.name)
  const status = dryRun ? 0 : await runPnpmStep(step.arguments, step.name)
  await recordCheckpoint('step-end', step.name, {
    durationMs: Date.now() - startedAt,
    status,
  })
  if (status !== 0) return status
  return runQualitySteps(index + 1)
}

async function runPnpmStep(arguments_: readonly string[], step: string) {
  const command = pnpmCommand(arguments_)
  const child = spawn(command.executable, command.arguments, {
    cwd: root,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS ?? maximumWorkers,
    },
    stdio: 'inherit',
  })
  const stopSampling = sampleProcesses(step)
  const stopSignals = forwardSignals(child.pid)

  try {
    return await new Promise<number>((resolveStatus, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => {
        resolveStatus(code ?? signalExitCode(signal))
      })
    })
  } finally {
    stopSampling()
    stopSignals()
  }
}

function sampleProcesses(step: string) {
  const timer = setInterval(() => void recordCheckpoint('sample', step), sampleIntervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

function forwardSignals(pid: number | undefined) {
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
  const handlers = signals.map((signal) => {
    const handler = () => terminateProcessGroup(pid, signal)
    process.on(signal, handler)
    return { signal, handler }
  })
  return () => {
    for (const { signal, handler } of handlers) process.off(signal, handler)
  }
}

function terminateProcessGroup(pid: number | undefined, signal: NodeJS.Signals) {
  if (!pid) return
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

function recordCheckpoint(
  event: 'run-start' | 'step-start' | 'sample' | 'step-end' | 'run-end',
  step?: string,
  details: Readonly<Record<string, number>> = {},
) {
  checkpointWrites = checkpointWrites.then(async () => {
    const record = {
      at: new Date().toISOString(),
      event,
      ...(step ? { step } : {}),
      ...details,
      processes: await qualityProcesses(),
    }
    await appendFile(logPath, `${JSON.stringify(record)}\n`)
  })
  return checkpointWrites
}

async function qualityProcesses() {
  if (process.platform === 'win32') return []
  try {
    const { stdout } = await executeFile('ps', ['-Ao', 'pid=,ppid=,%cpu=,%mem=,etime=,command='])
    return stdout
      .split('\n')
      .map(parseProcess)
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
      .filter(
        (candidate) => candidate.command.includes(root) && qualityProcess.test(candidate.command),
      )
  } catch (error) {
    return [{ error: error instanceof Error ? error.message : String(error) }]
  }
}

function parseProcess(line: string) {
  const match = /^(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(\S.*)$/.exec(line.trim())
  if (!match) return null
  return {
    pid: Number(match[1]),
    parentPid: Number(match[2]),
    cpuPercent: Number(match[3]),
    memoryPercent: Number(match[4]),
    elapsed: match[5],
    command: match[6],
  }
}

function pnpmCommand(arguments_: readonly string[]) {
  const pnpmPath = process.env.npm_execpath
  if (!pnpmPath) throw new Error('This command must run through pnpm')
  if (['.js', '.cjs', '.mjs'].includes(extname(pnpmPath))) {
    return { executable: process.execPath, arguments: [pnpmPath, ...arguments_] }
  }
  return { executable: pnpmPath, arguments: [...arguments_] }
}

function defaultMaximumWorkers() {
  return Math.max(1, Math.min(4, availableParallelism() - 1))
}

function signalExitCode(signal: NodeJS.Signals | null) {
  if (signal === 'SIGINT') return 130
  if (signal === 'SIGTERM') return 143
  if (signal === 'SIGHUP') return 129
  return 1
}

function fileTimestamp(date: Date) {
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-')
}
