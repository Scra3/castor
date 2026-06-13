import {Command} from '@oclif/core'

import {ensureLoggedIn} from '../services/auth.js'
import {applyInsecure, commonFlags, makeClient} from '../services/cli-helpers.js'
import {realPrompts} from '../services/prompts.js'

export default class Login extends Command {
  static description = 'Log in to Forest Admin and store the session token.'

  static flags = {...commonFlags}

  async run(): Promise<void> {
    const {flags} = await this.parse(Login)

    applyInsecure(flags.insecure, message => this.warn(message))
    const {client, serverUrl} = makeClient(flags, message => this.log(message))

    await ensureLoggedIn({
      client,
      interactive: true,
      log: message => this.log(message),
      oauth: flags.oauth,
      prompts: realPrompts,
      serverUrl,
    })

    this.log(`✓ Connected to ${serverUrl}.`)
  }
}
