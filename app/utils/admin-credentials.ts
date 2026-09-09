const ownerEmailPattern = /^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]+$/

export function isOwnerEmail(value: string) {
  return ownerEmailPattern.test(value.trim())
}
