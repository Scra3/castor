/** Real interactive prompts backed by @inquirer/prompts (hidden password input). */
import {input, password} from '@inquirer/prompts'

import {AuthPrompts} from './auth.js'

export const realPrompts: AuthPrompts = {
  input: (message: string) => input({message}),
  password: (message: string) => password({mask: true, message}),
}
