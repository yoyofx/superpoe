import type { BuildRealm, SavedBuild } from '@/types/tree'

export const DEFAULT_BUILD_REALM: BuildRealm = 'global'

export function inferBuildRealm(build: Pick<SavedBuild, 'name' | 'source'> & { realm?: unknown }): BuildRealm {
  if (build.realm === 'cn' || build.realm === 'global') return build.realm
  if (build.source === 'wegame' || /^\s*\[(?:国服|CN)\]/i.test(build.name)) return 'cn'
  return DEFAULT_BUILD_REALM
}

export function buildRealmLabel(realm: BuildRealm, chinese: boolean): string {
  if (realm === 'cn') return chinese ? '腾讯服' : 'Tencent CN'
  return chinese ? '国际服' : 'Global'
}
