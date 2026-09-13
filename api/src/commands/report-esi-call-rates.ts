import { readEsiCallRateReport } from '../esi-gateway/status-interface.js'
import { recordDiagnostic } from '../logging.js'

try {
  const measurement = await readEsiCallRateReport(process.argv.includes('--current') ? 0 : 1)
  process.stdout.write(`${JSON.stringify(measurement, null, 2)}\n`)
} catch (error) {
  recordDiagnostic('command.esi-call-rate-report.failed', { error })
  process.exitCode = 1
}
