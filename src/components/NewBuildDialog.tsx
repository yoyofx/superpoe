import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { FALLBACK_TREE_VERSIONS, loadTreeVersions, useTreeStore } from '@/store/treeStore'
import { translateGameText } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
import type { BuildRealm } from '@/types/tree'
import { getTreeAssetUrl, loadTreeAssetIndex } from '@/engine/treeAssetIndex'
import type { SpriteIndex } from '@/engine/spriteLoader'
import { FallbackImage } from '@/components/FallbackImage'
import { uiText } from '@/i18n/uiLocale'

export interface NewBuildInput {
  name: string
  classId: string
  ascendancyId: string
  treeVersion: string
  realm: BuildRealm
}

interface NewBuildDialogProps {
  open: boolean
  defaultRealm: BuildRealm
  onClose: () => void
  onCreate: (input: NewBuildInput) => void
}

export function NewBuildDialog({ open, defaultRealm, onClose, onCreate }: NewBuildDialogProps) {
  const { lang } = useTranslation()
  const treeData = useTreeStore((state) => state.treeData)
  const currentVersion = useTreeStore((state) => state.treeVersion)
  const [step, setStep] = useState(1)
  const [classId, setClassId] = useState('')
  const [ascendancyId, setAscendancyId] = useState('')
  const [name, setName] = useState('')
  const [treeVersion, setTreeVersion] = useState(currentVersion)
  const [realm, setRealm] = useState<BuildRealm>('global')
  const [versions, setVersions] = useState(FALLBACK_TREE_VERSIONS)
  const [assetIndex, setAssetIndex] = useState<SpriteIndex>({})
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const classes = useMemo(() => Object.entries(treeData?.constants.classes || {}), [treeData])
  const selectedClass = treeData?.constants.classes[classId]

  useEffect(() => { loadTreeVersions().then(setVersions).catch(() => setVersions(FALLBACK_TREE_VERSIONS)) }, [])
  useEffect(() => {
    if (!open) return
    let active = true
    void loadTreeAssetIndex(currentVersion).then((index) => {
      if (active) setAssetIndex(index)
    })
    return () => { active = false }
  }, [open, currentVersion])
  useEffect(() => {
    if (!open) return
    const defaultClassId = classes[0]?.[0] || ''
    setStep(1)
    setClassId(defaultClassId)
    setAscendancyId('')
    setName('')
    setTreeVersion(currentVersion)
    setRealm(defaultRealm)
  }, [open, classes, currentVersion, defaultRealm])

  if (!open) return null
  const classLabel = selectedClass ? translateGameText(selectedClass.displayName || selectedClass.name, lang) : ''
  const canContinue = step === 1 ? Boolean(classId) : step === 2 ? Boolean(ascendancyId) : Boolean(name.trim())

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="workflow-dialog new-build-dialog" role="dialog" aria-modal="true" aria-labelledby="new-build-title">
        <header className="dialog-header"><div><span>{l('New build', '新建构筑', '新增構築', '새 빌드')}</span><h2 id="new-build-title">{step === 1 ? l('Choose a class', '选择职业', '選擇職業', '클래스 선택') : step === 2 ? l('Choose an ascendancy', '选择升华', '選擇昇華', '전직 선택') : l('Build details', '基础信息', '基本資訊', '빌드 정보')}</h2></div><button className="icon-command" onClick={onClose} aria-label={l('Close', '关闭', '關閉', '닫기')}><X /></button></header>
        <ol className="dialog-steps">{[l('Class', '职业', '職業', '클래스'), l('Ascendancy', '升华', '昇華', '전직'), l('Details', '基础信息', '基本資訊', '정보')].map((label, index) => <li key={label} className={step === index + 1 ? 'active' : step > index + 1 ? 'complete' : ''}><span>{step > index + 1 ? <Check /> : index + 1}</span>{label}</li>)}</ol>

        <div className="dialog-body">
          {step === 1 && <div className="class-choice-grid">{classes.map(([id, cls]) => {
            const label = translateGameText(cls.displayName || cls.name, lang)
            const imageUrl = getTreeAssetUrl(assetIndex, cls.background?.image)
            return <button key={id} className={classId === id ? 'active' : ''} onClick={() => { setClassId(id); setAscendancyId('') }}><span className="choice-art"><FallbackImage src={imageUrl || undefined} alt="" decoding="async" fallback={label.slice(0, 1)} /></span><span className="choice-copy"><strong>{label}</strong><small>{l(`${cls.ascendancies.length} ascendancies`, `${cls.ascendancies.length} 个升华`, `${cls.ascendancies.length} 個昇華`, `전직 ${cls.ascendancies.length}개`)}</small></span>{classId === id && <Check />}</button>
          })}</div>}

          {step === 2 && <div className="ascendancy-choice-list">
            {selectedClass?.ascendancies.map((asc) => {
              const id = asc.id || asc.name
              const label = translateGameText(asc.displayName || asc.name, lang)
              const imageUrl = getTreeAssetUrl(assetIndex, asc.background?.image)
              return <button key={id} className={ascendancyId === id ? 'active' : ''} onClick={() => setAscendancyId(id)}><span className="choice-art"><FallbackImage src={imageUrl || undefined} alt="" decoding="async" fallback={label.slice(0, 1)} /></span><span className="choice-copy"><strong>{label}</strong><small>{classLabel}</small></span>{ascendancyId === id && <Check />}</button>
            })}
          </div>}

          {step === 3 && <div className="build-details-form">
            <label><span>{l('Build name', '构筑名称', '構築名稱', '빌드 이름')}</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={l(`${classLabel} build`, `${classLabel} 构筑`, `${classLabel} 構築`, `${classLabel} 빌드`)} /></label>
            <fieldset className="realm-field"><legend>{l('Game realm', '游戏区域', '遊戲區域', '게임 리전')}</legend><div className="realm-selector">
              <button type="button" className={realm === 'cn' ? 'active cn' : ''} onClick={() => setRealm('cn')}>{l('Tencent CN', '腾讯服（国服）', '騰訊服（中國服）', 'Tencent 중국')}</button>
              <button type="button" className={realm === 'global' ? 'active global' : ''} onClick={() => setRealm('global')}>{l('Global', '国际服', '國際服', '글로벌')}</button>
            </div><small>{l('The realm is stored permanently with this build.', '区域会随构筑永久保存，创建后不再根据名称推断。', '區域會隨構築永久儲存，建立後不再依名稱推斷。', '리전은 빌드에 영구 저장되며 생성 후 이름으로 추정하지 않습니다.')}</small></fieldset>
            <label><span>{l('Passive tree version', '天赋树版本', '天賦樹版本', '패시브 트리 버전')}</span><select value={treeVersion} onChange={(event) => setTreeVersion(event.target.value)}>{versions.map((version) => <option key={version} value={version}>{version.replace('_', '.')}</option>)}</select></label>
            <label className="check-row"><input type="checkbox" defaultChecked /><span><strong>{l('Start with an empty passive tree', '从空白天赋盘开始', '從空白天賦盤開始', '빈 패시브 트리에서 시작')}</strong><small>{l('Class and ascendancy roots do not consume passive points', '职业和升华起点不会消耗天赋点', '職業與昇華起點不會消耗天賦點', '클래스 및 전직 시작점은 패시브 포인트를 소모하지 않습니다')}</small></span></label>
          </div>}
        </div>

        <footer className="dialog-footer"><button className="secondary-command" onClick={step === 1 ? onClose : () => setStep(step - 1)}>{step > 1 && <ArrowLeft />}{step === 1 ? l('Cancel', '取消', '取消', '취소') : l('Back', '上一步', '上一步', '이전')}</button><button className="primary-command" disabled={!canContinue} onClick={() => step < 3 ? setStep(step + 1) : onCreate({ name: name.trim(), classId, ascendancyId, treeVersion, realm })}>{step === 3 ? l('Create build', '创建构筑', '建立構築', '빌드 생성') : l('Next', '下一步', '下一步', '다음')}{step < 3 && <ArrowRight />}</button></footer>
      </section>
    </div>
  )
}
