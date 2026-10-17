import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseReleaseVersion } from '../scripts/release-version.mjs'

test('release versions normalize the optional v prefix and share one tag and Android version', () => {
  const expected = { version: '1.2.3', tag: 'v1.2.3', androidVersionCode: 1_002_003 }
  assert.deepEqual(parseReleaseVersion('1.2.3'), expected)
  assert.deepEqual(parseReleaseVersion(' v1.2.3 '), expected)
  assert.deepEqual(parseReleaseVersion('0.1.0'), { version: '0.1.0', tag: 'v0.1.0', androidVersionCode: 1000 })
})

test('Android version codes increase across patch, minor and major releases', () => {
  const versions = ['0.0.1', '0.0.999', '0.1.0', '0.999.999', '1.0.0', '1.999.999', '2.0.0', '2099.999.999']
  const codes = versions.map((version) => parseReleaseVersion(version).androidVersionCode)
  for (let index = 1; index < codes.length; index++) assert.ok(codes[index] > codes[index - 1])
  assert.ok(codes.at(-1) <= 2_100_000_000)
})

test('release versions reject ambiguous, oversized, prerelease and shell input', () => {
  for (const input of [undefined, null, 123, '', '1', '1.2', '1.2.3.4', '01.2.3', '1.02.3', '1.2.03', '0.0.0', '2100.0.0', '1.1000.0', '1.0.1000', '99999999999999999999999.0.0', '1.2.3-beta.1', '1.2.3+build', '1.2.3\nTAG=other', '1.2.3; echo unsafe', '$(whoami)', '1.2.3`id`']) {
    assert.throws(() => parseReleaseVersion(input), undefined, String(input))
  }
})
