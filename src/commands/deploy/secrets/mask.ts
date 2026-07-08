const MIN_REVEAL_LENGTH = 8

// Short values are fully masked with a fixed-width dot run so their real
// length is not leaked; longer ones show a 4-char prefix for recognition.
export const mask_value = (value: string): string => {
  if (value.length === 0) return '(empty)'
  if (value.length < MIN_REVEAL_LENGTH) return '••••••'
  return `${value.slice(0, 4)}…`
}
