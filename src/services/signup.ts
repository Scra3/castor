/** Password policy mirrored from the server (PASSWORD_REGEX in regex-creator.ts). */

export const PASSWORD_HINT = 'At least 8 characters, with one uppercase letter, one lowercase letter and one digit.'

// >= 8 non-space chars, with at least one uppercase, one lowercase and one digit.
const PASSWORD_REGEX = /^(?=\S*?[A-Z])(?=\S*?[a-z])(?=\S*?\d)\S{8,}$/

/** True when the password satisfies the server's policy. */
export function isValidPassword(password: string): boolean {
  return PASSWORD_REGEX.test(password)
}
