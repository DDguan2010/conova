import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function parseReleaseVersion(input) {
  const match = typeof input === 'string' && /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(input.trim())
  if (!match) throw new Error('版本号必须为 MAJOR.MINOR.PATCH，例如 0.1.0 或 v1.2.3；不支持前导零或预发布后缀。')
  const [major, minor, patch] = match.slice(1).map(Number)
  if (major > 2099 || minor > 999 || patch > 999) throw new Error('版本号范围：主版本 0–2099，次版本和修订版本 0–999。')
  const androidVersionCode = major * 1_000_000 + minor * 1_000 + patch
  if (androidVersionCode < 1) throw new Error('发布版本必须大于 0.0.0。')
  const version = `${major}.${minor}.${patch}`
  return { version, tag: `v${version}`, androidVersionCode }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = parseReleaseVersion(process.argv[2] ?? process.env.RELEASE_VERSION)
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, `version=${result.version}\ntag=${result.tag}\nandroid_version_code=${result.androidVersionCode}\n`)
    }
    console.log(`Conova ${result.version}; tag ${result.tag}; Android versionCode ${result.androidVersionCode}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
