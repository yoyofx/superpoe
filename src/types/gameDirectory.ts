export type GameDirectoryRealm = 'cn' | 'global'

export type GameDirectoryDetectionStatus = 'found' | 'not-found' | 'unsupported'

export type GameDirectoryDetectionSource = 'running-client' | 'registry' | 'steam-library' | 'known-location' | 'manual'

export interface GameDirectoryDetectionResult {
  realm: GameDirectoryRealm
  status: GameDirectoryDetectionStatus
  checkedAt: string
  canceled?: boolean
  directory?: string
  executablePath?: string
  source?: GameDirectoryDetectionSource
}
