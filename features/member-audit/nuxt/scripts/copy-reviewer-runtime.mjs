import { cp, mkdir } from 'node:fs/promises'

await mkdir(new URL('../dist/reviewer/', import.meta.url), { recursive: true })
await cp(
  new URL('../src/runtime/app/reviewer/', import.meta.url),
  new URL('../dist/reviewer/', import.meta.url),
  { recursive: true },
)
