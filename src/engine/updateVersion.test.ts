import { describe, expect, it } from 'vitest'
import { compareVersions, getLatestYmlFileName, parseLatestYml, pickInstallerFileName, shouldOfferUpdate } from '../../electron/updateVersion'

describe('compareVersions', () => {
  it('orders core semver numbers', () => {
    expect(compareVersions('0.5.1', '0.5.0')).toBeGreaterThan(0)
    expect(compareVersions('0.5.0', '0.5.1')).toBeLessThan(0)
    expect(compareVersions('0.5.0', '0.5.0')).toBe(0)
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0)
  })

  it('treats stable as newer than same-core prerelease', () => {
    expect(compareVersions('0.5.0', '0.5.0-dev.5.0eaac3d')).toBeGreaterThan(0)
    expect(compareVersions('0.5.0-dev.5.0eaac3d', '0.5.0')).toBeLessThan(0)
  })

  it('orders prerelease tags when core is equal', () => {
    expect(compareVersions('0.5.0-dev.6.abc', '0.5.0-dev.5.0eaac3d')).toBeGreaterThan(0)
    expect(compareVersions('0.5.0-beta.2', '0.5.0-beta.1')).toBeGreaterThan(0)
  })
})

describe('shouldOfferUpdate', () => {
  describe('release channel', () => {
    it('offers only strictly newer stable versions', () => {
      expect(shouldOfferUpdate('release', '0.5.1', '0.5.0')).toBe(true)
      expect(shouldOfferUpdate('release', '0.5.0', '0.5.0')).toBe(false)
      expect(shouldOfferUpdate('release', '0.4.9', '0.5.0')).toBe(false)
    })

    it('does not offer older prerelease over installed stable', () => {
      // Remote dev of same core is NOT newer than installed stable on release channel
      expect(shouldOfferUpdate('release', '0.5.0-dev.5.0eaac3d', '0.5.0')).toBe(false)
    })

    it('offers stable when current is an older prerelease of same core', () => {
      expect(shouldOfferUpdate('release', '0.5.0', '0.5.0-dev.5.0eaac3d')).toBe(true)
    })

    it('offers higher stable over installed prerelease', () => {
      expect(shouldOfferUpdate('release', '0.6.0', '0.5.0-dev.5.0eaac3d')).toBe(true)
    })
  })

  describe('dev channel', () => {
    it('offers any different rolling build version', () => {
      expect(shouldOfferUpdate('dev', '0.5.0-dev.5.0eaac3d', '0.5.0')).toBe(true)
      expect(shouldOfferUpdate('dev', '0.5.0-dev.6.deadbeef', '0.5.0-dev.5.0eaac3d')).toBe(true)
      expect(shouldOfferUpdate('dev', '0.5.0', '0.5.0-dev.5.0eaac3d')).toBe(true)
    })

    it('does not offer when remote equals current', () => {
      expect(shouldOfferUpdate('dev', '0.5.0-dev.5.0eaac3d', '0.5.0-dev.5.0eaac3d')).toBe(false)
      expect(shouldOfferUpdate('dev', '0.5.0', '0.5.0')).toBe(false)
    })
  })
})

describe('parseLatestYml', () => {
  it('parses electron-builder latest.yml', () => {
    const raw = `version: 0.5.0-dev.5.0eaac3d
files:
  - url: SuperPoE2-Setup-0.5.0-dev.5.0eaac3d.exe
    sha512: VAfBVVfOPIlzmpESPgww0TxRXt8Xi7UWZkB8oijQZDnMrjjMKujDCegTaFgXkyaKIe7YjapyHbVv3zLqnbPDIw==
    size: 260740485
path: SuperPoE2-Setup-0.5.0-dev.5.0eaac3d.exe
sha512: VAfBVVfOPIlzmpESPgww0TxRXt8Xi7UWZkB8oijQZDnMrjjMKujDCegTaFgXkyaKIe7YjapyHbVv3zLqnbPDIw==
releaseDate: '2026-07-23T07:42:31.486Z'
`
    const yml = parseLatestYml(raw)
    expect(yml).not.toBeNull()
    expect(yml!.version).toBe('0.5.0-dev.5.0eaac3d')
    expect(yml!.path).toBe('SuperPoE2-Setup-0.5.0-dev.5.0eaac3d.exe')
    expect(yml!.files[0]?.url).toBe('SuperPoE2-Setup-0.5.0-dev.5.0eaac3d.exe')
    expect(yml!.files[0]?.size).toBe(260740485)
  })

  it('returns null for incomplete yaml', () => {
    expect(parseLatestYml('version: 1.0.0\n')).toBeNull()
    expect(parseLatestYml('')).toBeNull()
  })
})

describe('manual check matrix (local scenarios)', () => {
  const remoteDev = '0.5.0-dev.5.0eaac3d'
  const remoteRelease = '0.5.0'

  it('current stable 0.5.0 checks both channels correctly', () => {
    // User on 0.5.0, remote dev newer rolling build
    expect(shouldOfferUpdate('dev', remoteDev, '0.5.0')).toBe(true)
    // User on 0.5.0, remote release same
    expect(shouldOfferUpdate('release', remoteRelease, '0.5.0')).toBe(false)
    // User on 0.5.0, remote release newer
    expect(shouldOfferUpdate('release', '0.5.1', '0.5.0')).toBe(true)
  })

  it('current dev build checks both channels correctly', () => {
    // Same rolling build → up to date on dev
    expect(shouldOfferUpdate('dev', remoteDev, remoteDev)).toBe(false)
    // Newer rolling build on dev
    expect(shouldOfferUpdate('dev', '0.5.0-dev.6.aaaaaaa', remoteDev)).toBe(true)
    // Stable of same core is newer on release channel
    expect(shouldOfferUpdate('release', remoteRelease, remoteDev)).toBe(true)
  })
})

describe('getLatestYmlFileName', () => {
  it('returns platform-specific electron-builder manifests', () => {
    expect(getLatestYmlFileName('win32')).toBe('latest.yml')
    expect(getLatestYmlFileName('darwin')).toBe('latest-mac.yml')
    expect(getLatestYmlFileName('linux')).toBe('latest-linux.yml')
  })
})

describe('pickInstallerFileName', () => {
  const macYml = parseLatestYml(`version: 0.5.0-dev.5.0eaac3d
files:
  - url: SuperPoE2-0.5.0-dev.5.0eaac3d-mac.zip
    sha512: a
    size: 1
  - url: SuperPoE2-0.5.0-dev.5.0eaac3d-arm64-mac.zip
    sha512: b
    size: 1
  - url: SuperPoE2-0.5.0-dev.5.0eaac3d.dmg
    sha512: c
    size: 1
  - url: SuperPoE2-0.5.0-dev.5.0eaac3d-arm64.dmg
    sha512: d
    size: 1
path: SuperPoE2-0.5.0-dev.5.0eaac3d-mac.zip
sha512: a
releaseDate: '2026-07-23T07:42:16.125Z'
`)!

  const winYml = parseLatestYml(`version: 0.5.0-dev.5.0eaac3d
files:
  - url: SuperPoE2-Setup-0.5.0-dev.5.0eaac3d.exe
    sha512: e
    size: 1
path: SuperPoE2-Setup-0.5.0-dev.5.0eaac3d.exe
sha512: e
releaseDate: '2026-07-23T07:42:31.486Z'
`)!

  it('picks windows exe from latest.yml', () => {
    expect(pickInstallerFileName(winYml, 'win32', 'x64')).toBe('SuperPoE2-Setup-0.5.0-dev.5.0eaac3d.exe')
  })

  it('prefers arch-matching dmg on mac arm64', () => {
    expect(pickInstallerFileName(macYml, 'darwin', 'arm64')).toBe('SuperPoE2-0.5.0-dev.5.0eaac3d-arm64.dmg')
  })

  it('prefers non-arm64 dmg on mac x64', () => {
    expect(pickInstallerFileName(macYml, 'darwin', 'x64')).toBe('SuperPoE2-0.5.0-dev.5.0eaac3d.dmg')
  })
})
