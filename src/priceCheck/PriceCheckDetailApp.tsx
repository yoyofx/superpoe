import { useEffect, useMemo, useState } from 'react'
import { BookmarkPlus, Check, X } from 'lucide-react'
import { EquipmentItemInspector, equipmentItemBaseType, equipmentItemName } from '@/components/equipment/EquipmentItemInspector'
import type { PriceCheckContextState, PriceCheckListingView } from '@/types/market'
import { uiText } from '@/i18n/uiLocale'
import { loadTranslations } from '@/i18n/translationLoader'
import { loadAppSettings } from '@/engine/appSettings'
import './priceCheck.css'

export function PriceCheckDetailApp() {
  const bridge = window.superpoePriceCheck
  const [state, setState] = useState<PriceCheckContextState | null>(null)
  const [listingId, setListingId] = useState<string | null>(null)
  const [uiScalePercent, setUiScalePercent] = useState(() => loadAppSettings().uiScalePercent)
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [favoriteSaved, setFavoriteSaved] = useState(false)
  const [favoriteError, setFavoriteError] = useState<string | null>(null)
  const language = state?.language || 'en'
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)

  useEffect(() => {
    if (!bridge?.getDetailState) return
    void bridge.getDetailState().then((value) => {
      setState(value.state || null)
      setListingId(value.listingId || null)
    })
    return bridge.onDetailState?.((value) => {
      setState(value.state || null)
      setListingId(value.listingId || null)
    })
  }, [bridge])

  useEffect(() => {
    let active = true
    void loadTranslations(language).catch(() => undefined).finally(() => { if (active) window.dispatchEvent(new Event('resize')) })
    return () => { active = false }
  }, [language])

  useEffect(() => {
    const factor = uiScalePercent / 100
    if (bridge?.setUiScale) {
      document.documentElement.style.removeProperty('zoom')
      void bridge.setUiScale(factor).catch(() => {
        document.documentElement.style.setProperty('zoom', String(factor))
        window.dispatchEvent(new Event('resize'))
      })
      return
    }
    document.documentElement.style.setProperty('zoom', String(factor))
  }, [bridge, uiScalePercent])

  useEffect(() => {
    const syncScale = () => setUiScalePercent(loadAppSettings().uiScalePercent)
    window.addEventListener('storage', syncScale)
    return () => window.removeEventListener('storage', syncScale)
  }, [])

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') void bridge?.hide?.() }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [bridge])

  const listing = useMemo<PriceCheckListingView | undefined>(
    () => state?.listings.find((candidate) => candidate.id === listingId),
    [listingId, state?.listings],
  )

  useEffect(() => {
    setFavoriteSaved(false)
    setFavoriteError(null)
  }, [listingId])

  const saveToEquipmentLibrary = async () => {
    if (!listingId || !bridge?.favorite || favoriteBusy || favoriteSaved) return
    setFavoriteBusy(true)
    setFavoriteError(null)
    try {
      await bridge.favorite(listingId)
      setFavoriteSaved(true)
    } catch (error) {
      setFavoriteError(error instanceof Error ? error.message : String(error))
    } finally {
      setFavoriteBusy(false)
    }
  }

  return <main className="pc-detail-shell">
    <header className="pc-detail-titlebar">
      <div className="pc-title">
        <strong>{listing ? equipmentItemName(listing.item, language) : l('Item details', '商品详情', '商品詳情', '상품 상세')}</strong>
        <span>{listing ? equipmentItemBaseType(listing.item, language) : l('Waiting for a listing', '等待商品', '等待商品', '매물 대기 중')}</span>
      </div>
      <div className="pc-escape-hint"><kbd>ESC</kbd><span>{l('Close details', '关闭详情', '關閉詳情', '상세 닫기')}</span></div>
      <button className="pc-detail-close pc-cancel-button" title={l('Cancel price check', '取消查价', '取消查價', '가격 확인 취소')} onClick={() => void bridge?.hide?.()}><X /><span>{l('Cancel', '取消', '取消', '취소')}</span></button>
    </header>
    {listing ? <div className="pc-detail-content"><EquipmentItemInspector
      view={listing.item}
      language={language}
      sourceLabels={[l('Market listing', '集市商品', '市集商品', '거래소 매물')]}
      price={listing.price?.display}
    /><footer className="pc-detail-footer"><button className="pc-library-button" disabled={favoriteBusy || favoriteSaved} onClick={() => void saveToEquipmentLibrary()}><>{favoriteSaved ? <Check /> : <BookmarkPlus />}</>{favoriteBusy ? l('Saving...', '收藏中...', '收藏中...', '저장 중...') : favoriteSaved ? l('Saved to equipment library', '已收藏到装备仓库', '已收藏到裝備倉庫', '장비 라이브러리에 저장됨') : l('Save to equipment library', '收藏到装备仓库', '收藏到裝備倉庫', '장비 라이브러리에 저장')}</button>{favoriteError && <small className="pc-detail-action-error">{favoriteError}</small>}</footer></div> : <div className="pc-detail-empty">{l('Select a listing to view details.', '选择商品查看详情。', '選擇商品查看詳情。', '상품을 선택해 상세 정보를 확인하세요.')}</div>}
  </main>
}
