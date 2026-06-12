/** Real interactive prompts backed by @inquirer/prompts (hidden password input). */
import {confirm, input, password, select} from '@inquirer/prompts'

import {AuthPrompts} from './auth.js'

export const realPrompts: AuthPrompts = {
  input: (message: string) => input({message}),
  password: (message: string) => password({mask: true, message}),
}

/** Single-choice picker (used by the layout scope resolution). */
export function realSelect<T>(message: string, choices: Array<{name: string; value: T}>): Promise<T> {
  return select({choices, message})
}

/** Yes/no confirmation (defaults to no). */
export function realConfirm(message: string): Promise<boolean> {
  return confirm({default: false, message})
}
