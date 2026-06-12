import {expect} from 'chai'

import {isValidPassword} from '../../src/services/signup.js'

describe('signup.isValidPassword', () => {
  it('accepts a password with upper, lower, digit and length >= 8', () => {
    expect(isValidPassword('Password1')).to.equal(true)
  })

  it('rejects passwords that are too short', () => {
    expect(isValidPassword('Pass1')).to.equal(false)
  })

  it('rejects passwords missing an uppercase letter', () => {
    expect(isValidPassword('password1')).to.equal(false)
  })

  it('rejects passwords missing a digit', () => {
    expect(isValidPassword('Password')).to.equal(false)
  })

  it('rejects passwords containing spaces', () => {
    expect(isValidPassword('Pass word1')).to.equal(false)
  })
})
