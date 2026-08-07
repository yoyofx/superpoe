import type { BuildRealm, SavedBuild } from '@/types/tree'
import type { Language } from '@/i18n/translationLoader'
import { uiText } from '@/i18n/uiLocale'

export const DEFAULT_BUILD_REALM: BuildRealm = 'global'

export function inferBuildRealm(build: Pick<SavedBuild, 'name' | 'source'> & { realm?: unknown }): BuildRealm {
  if (build.realm === 'cn' || build.realm === 'global') return build.realm
  if (build.source === 'wegame' || /^\s*\[(?:国服|CN)\]/i.test(build.name)) return 'cn'
  return DEFAULT_BUILD_REALM
}

export function buildRealmLabel(realm: BuildRealm, language: Language): string {
  if (realm === 'cn') return uiText(language, 'Tencent CN', '腾讯服', '騰訊服', 'Tencent 중국')
  return uiText(language, 'Global', '国际服', '國際服', '글로벌')
}
