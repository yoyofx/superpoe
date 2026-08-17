import { useEffect, useState } from 'react'
import { Activity, Info, LoaderCircle, Minus, Plus, TriangleAlert } from 'lucide-react'
import { requestEquipmentDifference } from '@/equipmentDifference'
import type {
  BuildContextSnapshot,
  EquipmentDiffStat,
  EquipmentDifferenceResult,
  EquipmentDifferenceCandidateSource,
  EquipmentDifferenceRequest,
  EquipmentSlotDiff,
} from '@/equipmentDifference'
import type { EquipmentItem } from '@/types/equipment'
import { translateEquipmentItemName } from '@/components/equipment/EquipmentItemInspector'
import { translateCalculationLabel } from '@/i18n/calculationTranslations'
import { translateGameText, type Language } from '@/i18n/translationLoader'
import { formatUiNumber, uiText } from '@/i18n/uiLocale'

interface EquipmentDifferenceTooltipProps {
  context: BuildContextSnapshot | null
  item?: EquipmentItem
  candidate?: {
    raw: string
    buildItemId?: string
    source?: EquipmentDifferenceCandidateSource
  }
  language: Language
  sourceSlotName?: string
  slotOnlyTooltips?: boolean
}

const SLOT_LABELS: Record<string, readonly [string, string, string, string]> = {
  'Weapon 1': ['Main Hand', '主手', '主手', '주 무기'],
  'Weapon 2': ['Off Hand', '副手', '副手', '보조 무기'],
  'Weapon 1 Swap': ['Main Hand', '主手', '主手', '주 무기'],
  'Weapon 2 Swap': ['Off Hand', '副手', '副手', '보조 무기'],
  Helmet: ['Helmet', '头盔', '頭盔', '투구'],
  Gloves: ['Gloves', '手套', '手套', '장갑'],
  'Body Armour': ['Body Armour', '胸甲', '胸甲', '갑옷'],
  Boots: ['Boots', '鞋子', '鞋子', '장화'],
  'Ring 1': ['Ring 1', '戒指 1', '戒指 1', '반지 1'],
  'Ring 2': ['Ring 2', '戒指 2', '戒指 2', '반지 2'],
  Amulet: ['Amulet', '项链', '項鍊', '목걸이'],
  Belt: ['Belt', '腰带', '腰帶', '허리띠'],
  'Charm 1': ['Charm 1', '护符 1', '護符 1', '부적 1'],
  'Charm 2': ['Charm 2', '护符 2', '護符 2', '부적 2'],
  'Charm 3': ['Charm 3', '护符 3', '護符 3', '부적 3'],
  'Flask 1': ['Life Flask', '生命药剂', '生命藥劑', '생명력 플라스크'],
  'Flask 2': ['Mana Flask', '魔力药剂', '魔力藥劑', '마나 플라스크'],
}

function localizeSlotLabel(value: string, language: Language): string {
  const normalized = value.trim()
  const direct = SLOT_LABELS[normalized]
  if (direct) return uiText(language, ...direct)
  return translateGameText(normalized, language)
}

function formatNumber(value: number, format: string | undefined, language: Language): string {
  // Match PoB2's compact comparison formatting, including units and signs.
  const normalizedFormat = (format || '.1f').replace(/^[+ -]/, '')
  const decimals = normalizedFormat.match(/\.(\d+)f/)?.[1]
  const precision = decimals ? Number(decimals) : normalizedFormat.includes('d') ? 0 : 1
  const suffix = normalizedFormat
    .replace(/d|f|\.\d+f/, '')
    .replace(/%%/g, '%')
  const normalized = Number.isFinite(value) ? value : 0
  const sign = normalized >= 0 ? '+' : '-'
  return sign + formatUiNumber(Math.abs(normalized), language, {
    minimumFractionDigits: 0,
    maximumFractionDigits: precision,
  }) + suffix
}

function formatStat(stat: EquipmentDiffStat, language: Language): string {
  const value = formatNumber(stat.displayDelta, stat.format, language)
  const percent = stat.percent == null ? '' : ' (' + formatNumber(stat.percent, '.1f', language) + '%)'
  return value + ' ' + translateCalculationLabel(stat.label, language) + percent
}

function localizeDifferenceError(result: EquipmentDifferenceResult, language: Language): string {
  const code = result.error?.code
  const fallback = uiText(language, 'Equipment comparison failed.', '装备差异计算失败。', '裝備差異計算失敗。', '장비 비교에 실패했습니다.')
  const messages: Record<string, string> = {
    'invalid-build': uiText(language, 'The build data is invalid or missing.', '构筑数据无效或缺失。', '構築資料無效或缺失。', '빌드 데이터가 없거나 유효하지 않습니다.'),
    'invalid-item': uiText(language, 'The candidate equipment is invalid or missing.', '候选装备无效或缺失。', '候選裝備無效或缺失。', '비교할 장비가 없거나 유효하지 않습니다.'),
    'no-valid-slot': uiText(language, 'This equipment cannot be used in any active slot.', '这件装备无法用于当前启用的装备槽位。', '這件裝備無法用於目前啟用的裝備插槽。', '이 장비를 사용할 수 있는 활성 슬롯이 없습니다.'),
    'calculation-failed': fallback,
    'runtime-unavailable': uiText(language, 'The PoB calculation engine is unavailable.', 'PoB 计算引擎不可用。', 'PoB 計算引擎無法使用。', 'PoB 계산 엔진을 사용할 수 없습니다.'),
    'stale-context': uiText(language, 'The build changed. Reopen this item to calculate the difference again.', '构筑已发生变化，请重新打开装备详情计算差异。', '構築已發生變化，請重新開啟裝備詳情計算差異。', '빌드가 변경되었습니다. 장비 상세를 다시 열어 차이를 계산하세요.'),
  }
  if (code && messages[code]) return messages[code]
  const rawMessage = result.error?.message?.trim()
  return rawMessage ? translateGameText(rawMessage, language) : fallback
}

function operationLabel(group: EquipmentSlotDiff, language: Language): string {
  const slot = localizeSlotLabel(group.slotLabel || group.slotName, language)
  if (group.operation === 'remove') {
    return uiText(language, 'Removing this item from ' + slot + ' will give you:', '从' + slot + '移除该装备后会获得：', '從' + slot + '移除該裝備後會獲得：', '이 아이템을 ' + slot + '에서 제거하면:')
  }
  if (group.operation === 'toggle-on') {
    return uiText(language, 'Activating this item will give you:', '启用该装备后会获得：', '啟用該裝備後會獲得：', '이 아이템을 활성화하면:')
  }
  if (group.operation === 'toggle-off') {
    return uiText(language, 'Deactivating this item will give you:', '停用该装备后会获得：', '停用該裝備後會獲得：', '이 아이템을 비활성화하면:')
  }
  const replacedItem = group.replacedItemName ? translateEquipmentItemName(group.replacedItemName, 'RARE', language) : ''
  const replaced = replacedItem ? ' (replacing ' + replacedItem + ')' : ''
  const replacedZh = replacedItem ? '（替换 ' + replacedItem + '）' : ''
  const replacedTw = replacedItem ? '（替換 ' + replacedItem + '）' : ''
  return uiText(language, 'Equipping this item in ' + slot + ' will give you:' + replaced, '装备到' + slot + '后会获得：' + replacedZh, '裝備到' + slot + '後會獲得：' + replacedTw, slot + '에 장착하면:' + replaced)
}

function DifferenceGroup({ group, language }: { group: EquipmentSlotDiff; language: Language }) {
  return (
    <section className="equipment-difference-group">
      <h4>{operationLabel(group, language)}</h4>
      <div className="equipment-difference-stats">
        {group.changedStats.map((stat, index) => (
          <p key={stat.actor + '-' + stat.key + '-' + index} className={'equipment-difference-stat ' + stat.color}>
            {stat.positive ? <Plus aria-hidden="true" /> : <Minus aria-hidden="true" />}
            <span>{formatStat(stat, language)}</span>
          </p>
        ))}
      </div>
    </section>
  )
}

export function EquipmentDifferenceTooltip({
  context,
  item,
  candidate,
  language,
  sourceSlotName,
  slotOnlyTooltips = true,
}: EquipmentDifferenceTooltipProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle')
  const [result, setResult] = useState<EquipmentDifferenceResult | null>(null)
  const candidateRaw = candidate?.raw || item?.raw || ''
  const candidateBuildItemId = candidate?.buildItemId || item?.id
  const candidateSource = candidate?.source || 'equipment-slot'

  useEffect(() => {
    let disposed = false
    if (!context || !candidateRaw) {
      setState('idle')
      setResult(null)
      return
    }
    setState('loading')
    setResult(null)
    const timer = window.setTimeout(() => {
      const request: EquipmentDifferenceRequest = {
        context,
        candidate: {
          raw: candidateRaw,
          ...(candidateBuildItemId ? { buildItemId: candidateBuildItemId } : {}),
          source: candidateSource,
        },
        sourceSlotName,
        slotOnlyTooltips,
      }
      void requestEquipmentDifference(request).then((nextResult) => {
        if (disposed) return
        setResult(nextResult)
        const hasDisplayedStats = nextResult.groups?.some((group) => group.changedStats.length > 0) === true
        setState(nextResult.success && hasDisplayedStats ? 'ready' : nextResult.success ? 'empty' : 'error')
      }).catch((error: unknown) => {
        if (disposed) return
        setResult({
          success: false,
          error: {
            code: 'calculation-failed',
            message: error instanceof Error ? error.message : String(error),
          },
        })
        setState('error')
      })
    }, 180)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [candidateBuildItemId, candidateRaw, candidateSource, context, slotOnlyTooltips, sourceSlotName])

  if (state === 'idle') return null
  const title = uiText(language, 'Equipment Difference', '装备差异', '裝備差異', '장비 차이')
  const dpsHint = uiText(
    language,
    'DPS differences use the current main skill group. To compare another skill, set its group as the main skill on the Skills page, then reopen this item.',
    'DPS 差异按当前主技能组计算。要比较其他技能，请先在“技能”页面将对应技能组设为主技能，再重新打开装备详情。',
    'DPS 差異按目前主技能組計算。要比較其他技能，請先在「技能」頁面將對應技能組設為主技能，再重新開啟裝備詳情。',
    'DPS 차이는 현재 주 스킬 그룹을 기준으로 계산됩니다. 다른 스킬을 비교하려면 스킬 페이지에서 해당 그룹을 주 스킬로 설정한 뒤 장비 상세를 다시 여세요.',
  )
  const hasDpsDifference = result?.groups?.some((group) => group.changedStats.some((stat) => stat.key === 'FullDPS')) === true
  return (
    <section className="equipment-difference-panel" aria-label={title}>
      <div className="equipment-difference-title">
        <Activity aria-hidden="true" />
        <span>{title}</span>
        <span className="equipment-difference-help" tabIndex={0} title={dpsHint} aria-label={dpsHint}>
          <Info aria-hidden="true" />
        </span>
      </div>
      {state === 'loading' && <div className="equipment-difference-state"><LoaderCircle className="spin" aria-hidden="true" />{uiText(language, 'Calculating...', '正在计算...', '正在計算...', '계산 중...')}</div>}
      {state === 'error' && <div className="equipment-difference-state error"><TriangleAlert aria-hidden="true" />{result ? localizeDifferenceError(result, language) : uiText(language, 'Comparison failed', '差异计算失败', '差異計算失敗', '비교 실패')}</div>}
      {state === 'empty' && <div className="equipment-difference-state">{uiText(language, 'No displayed differences', '没有可显示的差异', '沒有可顯示的差異', '표시할 차이가 없습니다')}</div>}
      {state === 'ready' && result?.groups?.map((group) => <DifferenceGroup key={group.slotName + '-' + group.operation} group={group} language={language} />)}
      {state === 'ready' && !hasDpsDifference && <div className="equipment-difference-hint"><Info aria-hidden="true" /><span>{dpsHint}</span></div>}
      {state === 'empty' && <div className="equipment-difference-hint"><Info aria-hidden="true" /><span>{dpsHint}</span></div>}
    </section>
  )
}
