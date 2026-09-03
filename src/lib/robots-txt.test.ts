import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('public/robots.txt', () => {
  const body = readFileSync(join(process.cwd(), 'public/robots.txt'), 'utf8')

  it('permite todo por default', () => {
    expect(body).toContain('User-agent: *')
    expect(body).toContain('Allow: /')
  })

  it('disallowea los tres prefijos privados', () => {
    expect(body).toContain('Disallow: /g/')
    expect(body).toContain('Disallow: /join/')
    expect(body).toContain('Disallow: /crear-grupo')
  })
})
