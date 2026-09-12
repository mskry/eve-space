import { readEsiCallRateReport } from '../esi-gateway/status-interface.js'

const measurement = await readEsiCallRateReport(process.argv.includes('--current') ? 0 : 1)
process.stdout.write(`${JSON.stringify(measurement, null, 2)}\n`)
