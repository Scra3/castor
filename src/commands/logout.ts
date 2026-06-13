import {Command} from '@oclif/core'

import {commonFlags} from '../services/cli-helpers.js'
import {resolveServerUrl} from '../services/config.js'
import {clearToken} from '../services/credentials.js'

export default class Logout extends Command {
  static description = 'Remove the locally stored Forest Admin session token.'

  static flags = {server: commonFlags.server}

  async run(): Promise<void> {
    const {flags} = await this.parse(Logout)
    const serverUrl = resolveServerUrl(flags.server)

    await clearToken(serverUrl)

    this.log(`✓ Logged out of ${serverUrl}.`)
  }
}
