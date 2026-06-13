import {expect} from 'chai'

import {csvCell, csvColumns, toCsv} from '../../../src/services/agent/csv.js'

describe('agent/csv.csvCell', () => {
  it('renders scalars and blanks for null/undefined', () => {
    expect(csvCell('hi')).to.equal('hi')
    expect(csvCell(42)).to.equal('42')
    expect(csvCell(null)).to.equal('')
    expect(csvCell()).to.equal('')
  })

  it('quotes values containing commas, quotes or newlines', () => {
    expect(csvCell('a,b')).to.equal('"a,b"')
    expect(csvCell('say "hi"')).to.equal('"say ""hi"""')
    expect(csvCell('line1\nline2')).to.equal('"line1\nline2"')
  })

  it('serializes objects as JSON', () => {
    expect(csvCell({id: 1})).to.equal('"{""id"":1}"')
  })
})

describe('agent/csv.csvColumns', () => {
  it('uses explicit fields when provided', () => {
    expect(csvColumns([{a: 1, b: 2}], ['b', 'a'])).to.deep.equal(['b', 'a'])
  })

  it('falls back to the union of keys across rows', () => {
    expect(csvColumns([{a: 1}, {b: 2}, {a: 3, c: 4}])).to.deep.equal(['a', 'b', 'c'])
  })
})

describe('agent/csv.toCsv', () => {
  it('builds a header row and one line per record', () => {
    const csv = toCsv([{email: 'a@b.com', id: 1}, {email: 'c@d.com', id: 2}], ['id', 'email'])
    expect(csv).to.equal('id,email\n1,a@b.com\n2,c@d.com\n')
  })
})
