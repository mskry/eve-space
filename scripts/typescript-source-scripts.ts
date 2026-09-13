import { parse } from 'vue/compiler-sfc'

export function typescriptSourceScripts(path: string, source: string) {
  if (!path.endsWith('.vue')) return [source]
  const { descriptor } = parse(source)
  return [descriptor.script, descriptor.scriptSetup].flatMap((script) =>
    script ? [script.content] : [],
  )
}
