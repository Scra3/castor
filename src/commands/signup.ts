import {input, password as passwordPrompt} from '@inquirer/prompts'
import {Command} from '@oclif/core'

import {ForestApiError} from '../services/api-client.js'
import {ensureLoggedIn} from '../services/auth.js'
import {applyInsecure, commonFlags, makeClient} from '../services/cli-helpers.js'
import {realPrompts} from '../services/prompts.js'
import {PASSWORD_HINT, isValidPassword} from '../services/signup.js'

const MAX_PASSWORD_ATTEMPTS = 3

export default class Signup extends Command {
  static description = 'Create a new Forest Admin account (email/password, or --oauth for Google/SSO).'

  static flags = {
    insecure: commonFlags.insecure,
    oauth: commonFlags.oauth,
    server: commonFlags.server,
    verbose: commonFlags.verbose,
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Signup)

    applyInsecure(flags.insecure, message => this.warn(message))
    const {client, serverUrl} = makeClient(flags, message => this.log(message))

    // Google/SSO accounts are created in the browser on first sign-in: the OAuth
    // device flow doubles as signup, so we just run it and store the token.
    if (flags.oauth) {
      await ensureLoggedIn({
        client,
        interactive: true,
        log: message => this.log(message),
        oauth: true,
        prompts: realPrompts,
        serverUrl,
      })
      this.log(`✓ Account ready and connected on ${serverUrl} (OAuth).`)

      return
    }

    const email = await input({message: 'Email'})
    const firstName = await input({message: 'First name'})
    const lastName = await input({message: 'Last name'})
    const password = await this.promptPassword()

    try {
      await client.signup({email, firstName, lastName, password})
    } catch (error) {
      if (error instanceof ForestApiError) {
        this.error(error.detail)
      }

      throw error
    }

    this.log(`✓ Account created for ${email} on ${serverUrl}.`)
    this.log('Log in with: castor login')
  }

  /** Prompt for a policy-compliant password, then confirm it. */
  private async promptPassword(): Promise<string> {
    this.log(PASSWORD_HINT)

    for (let attempt = 1; attempt <= MAX_PASSWORD_ATTEMPTS; attempt++) {
      // eslint-disable-next-line no-await-in-loop
      const password = await passwordPrompt({mask: true, message: 'Password'})

      if (!isValidPassword(password)) {
        this.log(`Password too weak. ${PASSWORD_HINT}`)

        continue
      }

      // eslint-disable-next-line no-await-in-loop
      const confirmation = await passwordPrompt({mask: true, message: 'Confirm the password'})
      if (password === confirmation) return password

      this.log('The passwords do not match.')
    }

    this.error('Unable to set the password after several attempts.')
  }
}
