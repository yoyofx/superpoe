import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Bookmark, BookmarkPlus, ChevronDown, Gem, Link2, Replace, Unlink, X } from 'lucide-react'
import type { EquipmentLibraryEntry } from '@/types/market'
import { translateEquipmentItemName } from '@/components/equipment/EquipmentItemInspector'
import { EquipmentLibraryPicker } from '@/components/equipment/EquipmentLibraryPicker'
import { inspectJewelRadius } from '@/engine/pobLuaClient'
import { translateGameText, translateJewelRadiusLabel } from '@/i18n/translationLoader'
import { getSinisterJewelSocketIds } from '@/engine/sinisterJewelSockets'
import { uiText } from '@/i18n/uiLocale'
import { useTreeStore } from '@/store/treeStore'
import type { JewelRadiusSnapshot } from '@/types/jewelRadius'

function radiusLabel(label: string, language: Parameters<typeof uiText>[0]): string {
  const normalized = label.trim().toLowerCase()
  const variablePrefix = uiText(language, 'Variable range', '可变范围', '可變範圍', '가변 범위')
  const withVariablePrefix = (ringLabel: string) => `${variablePrefix} · ${ringLabel}`
  if (normalized === 'small') return uiText(language, 'Small', '小范围', '小範圍', '소형')
  if (normalized === 'medium') return uiText(language, 'Medium', '中范围', '中範圍', '중형')
  if (normalized === 'large') return uiText(language, 'Large', '大范围', '大範圍', '대형')
  if (normalized === 'variable') return uiText(language, 'Variable', '可变范围', '可變範圍', '가변')
  if (normalized.endsWith(' ring')) return withVariablePrefix(translateJewelRadiusLabel(label, language))
  if (normalized === 'very large') return uiText(language, 'Very Large', '极大范围', '極大範圍', '아주 넓은 범위')
  return label || uiText(language, 'Custom', '自定义', '自訂', '사용자 지정')
}

export function JewelSocketPanel() {
  const treeData = useTreeStore((state) => state.treeData)
  const selectedNodeId = useTreeStore((state) => state.selectedNodeId)
  const allocatedNodes = useTreeStore((state) => state.allocatedNodes)
  const getActivePobTreeJewelItems = useTreeStore((state) => state.getActivePobTreeJewelItems)
  const getActivePobTreeJewelRaw = useTreeStore((state) => state.getActivePobTreeJewelRaw)
  const getActivePobXml = useTreeStore((state) => state.getActivePobXml)
  const getActiveBuildLibraryId = useTreeStore((state) => state.getActiveBuildLibraryId)
  const bindTreeJewelRaw = useTreeStore((state) => state.bindTreeJewelRaw)
  const unbindTreeJewel = useTreeStore((state) => state.unbindTreeJewel)
  const setSelectedNode = useTreeStore((state) => state.setSelectedNode)
  const setJewelRadiusPreview = useTreeStore((state) => state.setJewelRadiusPreview)
  const clearJewelRadiusPreview = useTreeStore((state) => state.clearJewelRadiusPreview)
  const language = useTreeStore((state) => state.language)
  const pobBuildRevision = useTreeStore((state) => state.pobBuildRevision)
  const [open, setOpen] = useState(false)
  const [jewelRadiusSnapshot, setJewelRadiusSnapshot] = useState<JewelRadiusSnapshot | null>(null)
  const [radiusSelection, setRadiusSelection] = useState<number | null>(null)
  const [radiusHoverIndex, setRadiusHoverIndex] = useState<number | null>(null)
  const [radiusMenuOpen, setRadiusMenuOpen] = useState(false)
  const radiusPickerRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const node = selectedNodeId && treeData?.nodes[selectedNodeId]
  const isSocket = Boolean(node && (node.isJewelSocket || node.type === 'JewelSocket' || node.type === 'Socket'))
  const socketedJewel = selectedNodeId ? getActivePobTreeJewelItems()[selectedNodeId] : undefined
  const allocated = Boolean(selectedNodeId && (allocatedNodes.has(selectedNodeId)
    || getSinisterJewelSocketIds(treeData || undefined, getActivePobXml()).has(selectedNodeId)))
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)
  const activePobXml = getActivePobXml() || ''

  const showRadiusPreview = useCallback((radiusIndex: number | null) => {
    setJewelRadiusPreview(radiusIndex != null && selectedNodeId ? { nodeId: selectedNodeId, radiusIndex } : null)
  }, [selectedNodeId, setJewelRadiusPreview])

  const restoreRadiusSelection = useCallback(() => {
    setRadiusHoverIndex(null)
    showRadiusPreview(radiusSelection)
  }, [radiusSelection, showRadiusPreview])

  const hideRadiusPreview = () => {
    setRadiusSelection(null)
    setRadiusHoverIndex(null)
    setRadiusMenuOpen(false)
    clearJewelRadiusPreview()
  }

  useEffect(() => {
    let cancelled = false
    clearJewelRadiusPreview()
    setJewelRadiusSnapshot(null)
    setRadiusSelection(null)
    setRadiusHoverIndex(null)
    setRadiusMenuOpen(false)
    if (!selectedNodeId || !isSocket || !activePobXml) return () => { cancelled = true }

    void inspectJewelRadius(activePobXml).then((snapshot) => {
      if (cancelled || !snapshot.success) return
      setJewelRadiusSnapshot(snapshot)
      const currentEffect = snapshot.effects.find((effect) => effect.socketNodeId === selectedNodeId)
      const currentDefinition = currentEffect?.radiusIndex
        ? snapshot.definitions.find((definition) => definition.index === currentEffect.radiusIndex)
        : undefined
      const defaultDefinition = currentDefinition
        || snapshot.definitions.find((definition) => definition.label.trim().toLowerCase() === 'small')
        || snapshot.definitions[0]
      setRadiusSelection(defaultDefinition?.index ?? null)
      if (defaultDefinition) setJewelRadiusPreview({ nodeId: selectedNodeId, radiusIndex: defaultDefinition.index })
    })

    return () => {
      cancelled = true
      clearJewelRadiusPreview()
      setRadiusSelection(null)
      setRadiusHoverIndex(null)
      setRadiusMenuOpen(false)
    }
  }, [activePobXml, clearJewelRadiusPreview, isSocket, pobBuildRevision, selectedNodeId, setJewelRadiusPreview])

  useEffect(() => {
    setOpen(false)
    setError(null)
    setSaved(false)
    setRadiusMenuOpen(false)
    setRadiusHoverIndex(null)
  }, [selectedNodeId])

  useEffect(() => {
    if (!radiusMenuOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && radiusPickerRef.current?.contains(event.target)) return
      setRadiusMenuOpen(false)
      restoreRadiusSelection()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setRadiusMenuOpen(false)
      restoreRadiusSelection()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [radiusMenuOpen, restoreRadiusSelection])

  const choose = async (entry: EquipmentLibraryEntry) => {
    if (!selectedNodeId || !entry.item.raw) return
    setBusy(true)
    setError(null)
    try {
      bindTreeJewelRaw(selectedNodeId, entry.item.raw)
      setSaved(false)
      setOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const currentLines = useMemo(() => socketedJewel?.lines.filter((line) => !/^(Unique ID|Item Level|LevelReq|Quality|Implicits):/i.test(line)).slice(0, 6) || [], [socketedJewel])

  const saveJewel = async (unbindAfter: boolean) => {
    if (!selectedNodeId || !socketedJewel || !window.pob2Market) return
    const jewelRaw = getActivePobTreeJewelRaw(selectedNodeId)
    if (!jewelRaw?.raw) {
      setError(l('The jewel Raw data is unavailable.', '无法读取这个珠宝的 Raw 数据。', '無法讀取此珠寶的 Raw 資料。', '주얼 Raw 데이터를 읽을 수 없습니다.'))
      return
    }
    setCollecting(true)
    setError(null)
    try {
      const normalizedRaw = jewelRaw.raw.replace(/\r\n/g, '\n').trim()
      const library = await window.pob2Market.listLibrary({ collectionRoot: 'build', includeArchived: false })
      const alreadySaved = library.some((entry) => entry.item.raw.replace(/\r\n/g, '\n').trim() === normalizedRaw)
      if (!alreadySaved) {
        await window.pob2Market.saveEquipmentItem({
          raw: jewelRaw.raw,
          collectionRoot: 'build',
          source: {
            kind: 'pob-import',
            buildId: getActiveBuildLibraryId(),
            pobItemId: jewelRaw.itemId,
          },
        })
      }
      setSaved(true)
      if (unbindAfter) {
        unbindTreeJewel(selectedNodeId)
        hideRadiusPreview()
        setOpen(false)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setCollecting(false)
    }
  }

  const closePanel = () => {
    hideRadiusPreview()
    setSelectedNode(null)
  }

  const radiusDefinitions = jewelRadiusSnapshot?.success ? jewelRadiusSnapshot.definitions : []
  const activeRadiusIndex = radiusHoverIndex ?? radiusSelection
  const activeRadiusDefinition = activeRadiusIndex == null
    ? undefined
    : radiusDefinitions.find((definition) => definition.index === activeRadiusIndex)
  const commitRadiusSelection = (radiusIndex: number | null) => {
    setRadiusSelection(radiusIndex)
    setRadiusHoverIndex(null)
    setRadiusMenuOpen(false)
    showRadiusPreview(radiusIndex)
  }
  const hoverRadiusSelection = (radiusIndex: number | null) => {
    setRadiusHoverIndex(radiusIndex == null ? 0 : radiusIndex)
    showRadiusPreview(radiusIndex)
  }

  if (!isSocket || !selectedNodeId) return null
  return (
    <aside className="fixed bottom-4 right-4 z-40 w-[min(390px,calc(100vw-32px))] border border-[#806b4a] bg-[#090a09]/95 text-[#d7d2c5] shadow-2xl backdrop-blur-sm" aria-label={l('Jewel socket', '珠宝插槽', '珠寶插槽', '주얼 슬롯')}>
      <header className="flex items-center gap-2 border-b border-[#40382d] bg-[#151612] px-3 py-2">
        <Gem className="h-4 w-4 text-[#c87ada]" />
        <strong className="min-w-0 flex-1 truncate text-[13px] text-[#f4e6b8]">{l('Jewel socket', '珠宝插槽', '珠寶插槽', '주얼 슬롯')} · {selectedNodeId}</strong>
        <button type="button" className="grid h-6 w-6 place-items-center text-[#8e8779] hover:text-[#f0d69b]" onClick={closePanel} aria-label={l('Close', '关闭', '關閉', '닫기')}><X className="h-4 w-4" /></button>
      </header>
      <div className="space-y-2 px-3 py-3 text-[12px]">
        {!allocated ? <p className="text-[#c28b55]">{l('Allocate this socket before binding a jewel.', '请先分配这个珠宝孔，再绑定珠宝。', '請先分配這個珠寶孔，再鑲嵌珠寶。', '주얼을 장착하기 전에 슬롯을 할당하세요.')}</p> : socketedJewel ? (
          <div className="border border-[#493d2f] bg-[#11130f] px-2.5 py-2">
            <strong className="block text-[#f0d69b]">{translateEquipmentItemName(socketedJewel.name, socketedJewel.rarity, language)}</strong>
            {socketedJewel.baseType && <small className="block text-[#8fb0d8]">{translateGameText(socketedJewel.baseType, language)}</small>}
            {currentLines.length > 0 && <div className="mt-1 space-y-0.5 text-[#c8c4ba]">{currentLines.map((line, index) => <div key={`${line}-${index}`}>{translateGameText(line, language)}</div>)}</div>}
          </div>
        ) : <p className="text-[#c28b55]">{l('This allocated socket has no jewel.', '这个已分配的孔还没有绑定珠宝。', '這個已分配的插槽尚未鑲嵌珠寶。', '할당된 슬롯에 주얼이 없습니다.')}</p>}
        {radiusDefinitions.length > 0 && <div ref={radiusPickerRef} className="relative grid gap-1 text-[11px] text-[#aaa294]">
          <span>{l('Reference range', '参考范围', '參考範圍', '참조 범위')}</span>
          <button
            type="button"
            className="flex h-7 min-w-0 items-center gap-2 border border-[#4d463a] bg-[#0b0d0b] px-2 text-left text-[11px] text-[#d0c7b6] outline-none hover:border-[#806b4a]"
            aria-haspopup="listbox"
            aria-expanded={radiusMenuOpen}
            onClick={() => {
              setRadiusHoverIndex(null)
              setRadiusMenuOpen((value) => !value)
            }}
          >
            <span className="min-w-0 flex-1 truncate">{activeRadiusDefinition ? radiusLabel(activeRadiusDefinition.label, language) : l('Hidden', '不显示', '不顯示', '숨김')}</span>
            <ChevronDown className={`h-3.5 w-3.5 flex-none text-[#8f8066] transition-transform${radiusMenuOpen ? ' rotate-180' : ''}`} />
          </button>
          {radiusMenuOpen && <div
            role="listbox"
            aria-label={l('Reference range', '参考范围', '參考範圍', '참조 범위')}
            className="absolute bottom-full left-0 right-0 z-30 mb-1 max-h-56 overflow-y-auto border border-[#66563d] bg-[#0d100d] py-1 shadow-xl"
            onMouseLeave={restoreRadiusSelection}
          >
            <button
              type="button"
              role="option"
              aria-selected={radiusSelection == null}
              className={`flex w-full items-center px-2 py-1.5 text-left text-[11px] hover:bg-[#29251c]${activeRadiusIndex == null || activeRadiusIndex === 0 ? ' bg-[#242017] text-[#f0d69b]' : ' text-[#aaa294]'}`}
              onMouseEnter={() => hoverRadiusSelection(null)}
              onFocus={() => hoverRadiusSelection(null)}
              onClick={() => commitRadiusSelection(null)}
            >
              {l('Hidden', '不显示', '不顯示', '숨김')}
            </button>
            {radiusDefinitions.map((definition) => (
              <button
                key={definition.index}
                type="button"
                role="option"
                aria-selected={radiusSelection === definition.index}
                className={`flex w-full items-center px-2 py-1.5 text-left text-[11px] hover:bg-[#29251c]${activeRadiusIndex === definition.index ? ' bg-[#242017] text-[#f0d69b]' : ' text-[#aaa294]'}`}
                onMouseEnter={() => hoverRadiusSelection(definition.index)}
                onFocus={() => hoverRadiusSelection(definition.index)}
                onClick={() => commitRadiusSelection(definition.index)}
              >
                {radiusLabel(definition.label, language)}
              </button>
            ))}
          </div>}
        </div>}
        {error && <p className="text-[#d58b82]">{error}</p>}
        {allocated && <div className="flex flex-wrap gap-2">
          <button type="button" className="inline-flex items-center gap-1.5 border border-[#806b4a] bg-[#2a2418] px-2.5 py-1.5 text-[#f0d69b] hover:bg-[#3a2e1c] disabled:opacity-50" disabled={busy} onClick={() => setOpen(true)}>
            {socketedJewel ? <Replace className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
            {socketedJewel ? l('Replace jewel', '替换珠宝', '替換珠寶', '주얼 교체') : l('Bind jewel', '绑定珠宝', '綁定珠寶', '주얼 장착')}
          </button>
          {socketedJewel && <>
            <button type="button" className="inline-flex items-center gap-1.5 border border-[#685447] bg-[#211b17] px-2.5 py-1.5 text-[#e0b991] hover:bg-[#30231c] disabled:opacity-50" disabled={busy || collecting || saved} onClick={() => void saveJewel(false)}><Bookmark className="h-3.5 w-3.5" />{saved ? l('Saved', '已收藏', '已收藏', '저장됨') : collecting ? l('Saving…', '收藏中…', '收藏中…', '저장 중…') : l('Save jewel', '收藏珠宝', '收藏珠寶', '주얼 저장')}</button>
            <button type="button" className="inline-flex items-center gap-1.5 border border-[#685447] bg-[#211b17] px-2.5 py-1.5 text-[#e0b991] hover:bg-[#30231c] disabled:opacity-50" disabled={busy || collecting} onClick={() => void saveJewel(true)}><BookmarkPlus className="h-3.5 w-3.5" />{collecting ? l('Saving…', '收藏中…', '收藏中…', '저장 중…') : l('Save and unbind', '收藏并解除', '收藏並解除', '저장 후 해제')}</button>
            <button type="button" className="inline-flex items-center gap-1.5 border border-[#59413b] bg-[#211615] px-2.5 py-1.5 text-[#d59a8e] hover:bg-[#321d1b] disabled:opacity-50" disabled={busy || collecting} onClick={() => { unbindTreeJewel(selectedNodeId); hideRadiusPreview(); setOpen(false) }}><Unlink className="h-3.5 w-3.5" />{l('Unbind', '解除绑定', '解除綁定', '장착 해제')}</button>
          </>}
        </div>}
      </div>
      {open && <EquipmentLibraryPicker mode="jewel" title={{ en: 'Bind jewel', 'zh-rCN': '绑定珠宝', 'zh-rTW': '綁定珠寶', 'ko-KR': '주얼 장착' }} currentSlot={selectedNodeId} onClose={() => { hideRadiusPreview(); setOpen(false) }} onSelect={(entry) => void choose(entry)} />}
      <span className="hidden">{pobBuildRevision}</span>
    </aside>
  )
}
