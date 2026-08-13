import { useEffect, useMemo, useState } from 'react'
import { Bookmark, BookmarkPlus, Gem, Link2, Replace, Unlink, X } from 'lucide-react'
import type { EquipmentLibraryEntry } from '@/types/market'
import { translateEquipmentItemName } from '@/components/equipment/EquipmentItemInspector'
import { EquipmentLibraryPicker } from '@/components/equipment/EquipmentLibraryPicker'
import { translateGameText } from '@/i18n/translationLoader'
import { uiText } from '@/i18n/uiLocale'
import { useTreeStore } from '@/store/treeStore'

export function JewelSocketPanel() {
  const treeData = useTreeStore((state) => state.treeData)
  const selectedNodeId = useTreeStore((state) => state.selectedNodeId)
  const allocatedNodes = useTreeStore((state) => state.allocatedNodes)
  const getActivePobTreeJewelItems = useTreeStore((state) => state.getActivePobTreeJewelItems)
  const getActivePobTreeJewelRaw = useTreeStore((state) => state.getActivePobTreeJewelRaw)
  const getActiveBuildLibraryId = useTreeStore((state) => state.getActiveBuildLibraryId)
  const bindTreeJewelRaw = useTreeStore((state) => state.bindTreeJewelRaw)
  const unbindTreeJewel = useTreeStore((state) => state.unbindTreeJewel)
  const language = useTreeStore((state) => state.language)
  const pobBuildRevision = useTreeStore((state) => state.pobBuildRevision)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const node = selectedNodeId && treeData?.nodes[selectedNodeId]
  const isSocket = Boolean(node && (node.isJewelSocket || node.type === 'JewelSocket' || node.type === 'Socket'))
  const socketedJewel = selectedNodeId ? getActivePobTreeJewelItems()[selectedNodeId] : undefined
  const allocated = Boolean(selectedNodeId && allocatedNodes.has(selectedNodeId))
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)

  useEffect(() => {
    setOpen(false)
    setError(null)
    setSaved(false)
  }, [selectedNodeId])

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
        setOpen(false)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setCollecting(false)
    }
  }

  if (!isSocket || !selectedNodeId) return null
  return (
    <aside className="fixed bottom-4 right-4 z-40 w-[min(390px,calc(100vw-32px))] border border-[#806b4a] bg-[#090a09]/95 text-[#d7d2c5] shadow-2xl backdrop-blur-sm" aria-label={l('Jewel socket', '珠宝插槽', '珠寶插槽', '주얼 슬롯')}>
      <header className="flex items-center gap-2 border-b border-[#40382d] bg-[#151612] px-3 py-2">
        <Gem className="h-4 w-4 text-[#c87ada]" />
        <strong className="min-w-0 flex-1 truncate text-[13px] text-[#f4e6b8]">{l('Jewel socket', '珠宝插槽', '珠寶插槽', '주얼 슬롯')} · {selectedNodeId}</strong>
        <button type="button" className="grid h-6 w-6 place-items-center text-[#8e8779] hover:text-[#f0d69b]" onClick={() => useTreeStore.getState().setSelectedNode(null)} aria-label={l('Close', '关闭', '關閉', '닫기')}><X className="h-4 w-4" /></button>
      </header>
      <div className="space-y-2 px-3 py-3 text-[12px]">
        {!allocated ? <p className="text-[#c28b55]">{l('Allocate this socket before binding a jewel.', '请先分配这个珠宝孔，再绑定珠宝。', '請先分配這個珠寶孔，再鑲嵌珠寶。', '주얼을 장착하기 전에 슬롯을 할당하세요.')}</p> : socketedJewel ? (
          <div className="border border-[#493d2f] bg-[#11130f] px-2.5 py-2">
            <strong className="block text-[#f0d69b]">{translateEquipmentItemName(socketedJewel.name, socketedJewel.rarity, language)}</strong>
            {socketedJewel.baseType && <small className="block text-[#8fb0d8]">{translateGameText(socketedJewel.baseType, language)}</small>}
            {currentLines.length > 0 && <div className="mt-1 space-y-0.5 text-[#c8c4ba]">{currentLines.map((line, index) => <div key={`${line}-${index}`}>{translateGameText(line, language)}</div>)}</div>}
          </div>
        ) : <p className="text-[#c28b55]">{l('This allocated socket has no jewel.', '这个已分配的孔还没有绑定珠宝。', '這個已分配的插槽尚未鑲嵌珠寶。', '할당된 슬롯에 주얼이 없습니다.')}</p>}
        {error && <p className="text-[#d58b82]">{error}</p>}
        {allocated && <div className="flex flex-wrap gap-2">
          <button type="button" className="inline-flex items-center gap-1.5 border border-[#806b4a] bg-[#2a2418] px-2.5 py-1.5 text-[#f0d69b] hover:bg-[#3a2e1c] disabled:opacity-50" disabled={busy} onClick={() => setOpen(true)}>
            {socketedJewel ? <Replace className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
            {socketedJewel ? l('Replace jewel', '替换珠宝', '替換珠寶', '주얼 교체') : l('Bind jewel', '绑定珠宝', '綁定珠寶', '주얼 장착')}
          </button>
          {socketedJewel && <>
            <button type="button" className="inline-flex items-center gap-1.5 border border-[#685447] bg-[#211b17] px-2.5 py-1.5 text-[#e0b991] hover:bg-[#30231c] disabled:opacity-50" disabled={busy || collecting || saved} onClick={() => void saveJewel(false)}><Bookmark className="h-3.5 w-3.5" />{saved ? l('Saved', '已收藏', '已收藏', '저장됨') : collecting ? l('Saving…', '收藏中…', '收藏中…', '저장 중…') : l('Save jewel', '收藏珠宝', '收藏珠寶', '주얼 저장')}</button>
            <button type="button" className="inline-flex items-center gap-1.5 border border-[#685447] bg-[#211b17] px-2.5 py-1.5 text-[#e0b991] hover:bg-[#30231c] disabled:opacity-50" disabled={busy || collecting} onClick={() => void saveJewel(true)}><BookmarkPlus className="h-3.5 w-3.5" />{collecting ? l('Saving…', '收藏中…', '收藏中…', '저장 중…') : l('Save and unbind', '收藏并解除', '收藏並解除', '저장 후 해제')}</button>
            <button type="button" className="inline-flex items-center gap-1.5 border border-[#59413b] bg-[#211615] px-2.5 py-1.5 text-[#d59a8e] hover:bg-[#321d1b] disabled:opacity-50" disabled={busy || collecting} onClick={() => { unbindTreeJewel(selectedNodeId); setOpen(false) }}><Unlink className="h-3.5 w-3.5" />{l('Unbind', '解除绑定', '解除綁定', '장착 해제')}</button>
          </>}
        </div>}
      </div>
      {open && <EquipmentLibraryPicker mode="jewel" title={{ en: 'Bind jewel', 'zh-rCN': '绑定珠宝', 'zh-rTW': '綁定珠寶', 'ko-KR': '주얼 장착' }} currentSlot={selectedNodeId} onClose={() => setOpen(false)} onSelect={(entry) => void choose(entry)} />}
      <span className="hidden">{pobBuildRevision}</span>
    </aside>
  )
}
