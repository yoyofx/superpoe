import { useEffect, useState } from 'react'
import { Shirt, X } from 'lucide-react'
import { EquipmentItemInspector } from '@/components/equipment/EquipmentItemInspector'
import { EquipmentDifferenceTooltip } from '@/equipmentDifference/components/EquipmentDifferenceTooltip'
import { loadTranslations } from '@/i18n/translationLoader'
import { uiText } from '@/i18n/uiLocale'
import type { EquipmentTryOnOpenRequest } from '@/types/tryOn'
import type { MarketFavoriteSource } from '@/types/market'

export function EquipmentTryOnWindow() {
  const [payload, setPayload] = useState<EquipmentTryOnOpenRequest | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [translationsReady, setTranslationsReady] = useState(false)

  useEffect(() => {
    const api = window.pob2TryOn
    if (!api) {
      setLoadError('Try-on window communication is unavailable. Please restart the application.')
      return
    }
    const timeout = window.setTimeout(() => {
      setLoadError('The try-on window did not receive the equipment data. Please close and try again.')
    }, 8000)
    const applyPayload = (nextPayload: EquipmentTryOnOpenRequest) => {
      window.clearTimeout(timeout)
      setLoadError(null)
      setPayload(nextPayload)
    }
    const unsubscribe = api.onPayload(applyPayload)
    void api.getPayload().then((nextPayload) => {
      if (nextPayload) applyPayload(nextPayload)
      else {
        window.clearTimeout(timeout)
        setLoadError('The try-on item could not be loaded. Please close and try again.')
      }
    }).catch((error: unknown) => {
      window.clearTimeout(timeout)
      setLoadError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      window.clearTimeout(timeout)
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!payload) {
      setTranslationsReady(false)
      return
    }
    let active = true
    setTranslationsReady(false)
    void loadTranslations(payload.language).catch(() => undefined).finally(() => {
      if (active) setTranslationsReady(true)
    })
    return () => {
      active = false
    }
  }, [payload])

  if (!payload) {
    return <div className={`equipment-try-on-window-loading${loadError ? ' error' : ''}`} role={loadError ? 'alert' : 'status'}>
      {loadError || 'Loading...'}
    </div>
  }

  const { entry, context, language } = payload
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)
  const close = () => void window.pob2TryOn?.close()
  const marketSource = entry.sources.find((source): source is MarketFavoriteSource => source.kind === 'market-favorite')
  const differenceContent = !translationsReady
    ? <div className="equipment-try-on-window-no-build">{l('Loading translations...', '正在加载翻译...', '正在載入翻譯...', '번역을 불러오는 중...')}</div>
    : context && entry.item.raw
      ? <EquipmentDifferenceTooltip
          context={context}
          candidate={{ raw: entry.item.raw, source: 'equipment-library' }}
          language={language}
          slotOnlyTooltips={false}
        />
      : <div className="equipment-try-on-window-no-build">{l('Open a build first to calculate equipment differences.', '请先打开一个构筑，才能计算装备差异。', '請先開啟一個構築，才能計算裝備差異。', '장비 차이를 계산하려면 먼저 빌드를 여세요.')}</div>

  return <main className="equipment-try-on-window">
    <header className="equipment-try-on-window-header">
      <div><span>{l('Market favorites', '集市收藏', '市集收藏', '거래소 즐겨찾기')}</span><h1><Shirt />{l('Try on equipment', '装备试穿', '裝備試穿', '장비 시험 착용')}</h1></div>
      <button className="icon-command equipment-try-on-window-no-drag" onClick={close} title={l('Close', '关闭', '關閉', '닫기')} aria-label={l('Close', '关闭', '關閉', '닫기')}><X /></button>
    </header>
    <section className="equipment-try-on-window-content">
      <EquipmentItemInspector
        view={entry.view}
        language={language}
        sourceLabels={entry.sources.map((source) => source.kind === 'market-favorite'
          ? l('Market', '集市', '市集', '거래소')
          : source.kind === 'price-check'
            ? l('Price check', '查价器', '查價器', '가격 확인')
            : source.kind === 'pob-import'
              ? 'PoB'
              : source.kind === 'equipment-favorite'
                ? l('Equipment', '装备', '裝備', '장비')
                : l('Custom', '自定义', '自訂', '사용자 지정'))}
        price={marketSource?.price?.display}
        tags={entry.tags}
        note={entry.note}
        showQuickNavigation
        footer={differenceContent}
      />
    </section>
    <footer className="equipment-try-on-window-footer"><span>{l('Preview only. Your current build is not changed.', '仅供预览，不会修改当前构筑。', '僅供預覽，不會修改目前構築。', '미리보기만 제공되며 현재 빌드는 변경되지 않습니다.')}</span><button className="primary-command equipment-try-on-window-no-drag" onClick={close}>{l('Close', '关闭', '關閉', '닫기')}</button></footer>
  </main>
}
