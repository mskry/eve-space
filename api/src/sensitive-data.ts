const sensitiveTextPatterns = [
  /\b(?:access|refresh)[_ -]?token\s*[:=]\s*\S+/i,
  /\bsession[-_ ]?(?:bearer|token)\s*[:=]\s*\S+/i,
  /\b(?:authorization|credential|password|secret)\s*[:=]\s*\S+/i,
  /\b(?:token[_ -]?)?encryption[_ -]?key\s*[:=]\s*\S+/i,
  /\bprivate[_ -]?key\s*[:=]\s*\S+/i,
  /\bbearer\s+[\w.~+/=-]{8,}/i,
  /\bpostgres(?:ql)?:\/\/[^\s/]+@/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
] as const

export function containsSensitiveText(value: string) {
  return sensitiveTextPatterns.some((pattern) => pattern.test(value))
}
