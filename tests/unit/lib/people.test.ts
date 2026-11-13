import { describe, expect, it } from 'vitest'

import { lastName, sortName } from '@/lib/people'

/**
 * A–Z by last name (Jason, 2026-11-13). CSI gives one name field, so the last name is its last
 * word — suffixes skipped, "Last, First" honored — and the district sets a sort name for anyone
 * that gets wrong ("de la Cruz").
 */

describe('lastName', () => {
  it('is the last word', () => {
    expect(lastName('Jane Smith')).toBe('Smith')
    expect(lastName('Mary Ann Lopez')).toBe('Lopez')
  })

  it('skips a suffix', () => {
    expect(lastName('Robert Jones Jr.')).toBe('Jones')
    expect(lastName('Robert Jones Jr')).toBe('Jones')
    expect(lastName('Henry Ford III')).toBe('Ford')
    expect(lastName('Ann Lee, Sr.')).toBe('Lee')
  })

  it('takes "Last, First" as written', () => {
    expect(lastName('Smith, Jane')).toBe('Smith')
    expect(lastName('de la Cruz, Maria')).toBe('de la Cruz')
  })

  it('copes with one word, extra spaces, and nothing', () => {
    expect(lastName('Cher')).toBe('Cher')
    expect(lastName('  Jane   Smith  ')).toBe('Smith')
    expect(lastName('')).toBe('')
  })
})

describe('sortName', () => {
  it('last name first, then the rest — so two Smiths sort by first name', () => {
    expect(sortName('Jane Smith')).toBe('smith jane')
    expect(sortName('Adam Smith')).toBe('smith adam')
    expect(sortName('Robert Jones Jr.')).toBe('jones robert jr.')
    expect(sortName('Smith, Jane')).toBe('smith jane')
  })

  it('the district’s override wins, as typed', () => {
    expect(sortName('Maria de la Cruz', 'Cruz, Maria de la')).toBe('cruz, maria de la')
    expect(sortName('Maria de la Cruz', '  ')).toBe('cruz maria de la')
  })

  it('ignores accents and case, so É sorts with E', () => {
    expect(sortName('José Álvarez')).toBe('alvarez jose')
  })
})
