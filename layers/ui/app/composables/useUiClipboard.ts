export const useUiClipboard = () => ({
  readText: () => globalThis.navigator.clipboard.readText(),
  writeText: (text: string) => globalThis.navigator.clipboard.writeText(text),
})
