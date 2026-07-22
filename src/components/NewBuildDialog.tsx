import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { FALLBACK_TREE_VERSIONS, loadTreeVersions, useTreeStore } from '@/store/treeStore'
import { translateGameText } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
import type { BuildRealm } from '@/types/tree'
import { getTreeAssetUrl, loadTreeAssetIndex } from '@/engine/treeAssetIndex'
import type { SpriteIndex } from '@/engine/spriteLoader'

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
  const zh = lang === 'zh-rCN'
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
        <header className="dialog-header"><div><span>{zh ? '新建构筑' : 'New build'}</span><h2 id="new-build-title">{step === 1 ? (zh ? '选择职业' : 'Choose a class') : step === 2 ? (zh ? '选择升华' : 'Choose an ascendancy') : (zh ? '基础信息' : 'Build details')}</h2></div><button className="icon-command" onClick={onClose} aria-label={zh ? '关闭' : 'Close'}><X /></button></header>
        <ol className="dialog-steps">{[zh ? '职业' : 'Class', zh ? '升华' : 'Ascendancy', zh ? '基础信息' : 'Details'].map((label, index) => <li key={label} className={step === index + 1 ? 'active' : step > index + 1 ? 'complete' : ''}><span>{step > index + 1 ? <Check /> : index + 1}</span>{label}</li>)}</ol>

        <div className="dialog-body">
          {step === 1 && <div className="class-choice-grid">{classes.map(([id, cls]) => {
            const label = translateGameText(cls.displayName || cls.name, lang)
            const imageUrl = getTreeAssetUrl(assetIndex, cls.background?.image)
            return <button key={id} className={classId === id ? 'active' : ''} onClick={() => { setClassId(id); setAscendancyId('') }}><span className="choice-art">{imageUrl ? <img src={imageUrl} alt="" decoding="async" /> : label.slice(0, 1)}</span><span className="choice-copy"><strong>{label}</strong><small>{cls.ascendancies.length} {zh ? '个升华' : 'ascendancies'}</small></span>{classId === id && <Check />}</button>
          })}</div>}

          {step === 2 && <div className="ascendancy-choice-list">
            {selectedClass?.ascendancies.map((asc) => {
              const id = asc.id || asc.name
              const label = translateGameText(asc.displayName || asc.name, lang)
              const imageUrl = getTreeAssetUrl(assetIndex, asc.background?.image)
              return <button key={id} className={ascendancyId === id ? 'active' : ''} onClick={() => setAscendancyId(id)}><span className="choice-art">{imageUrl ? <img src={imageUrl} alt="" decoding="async" /> : label.slice(0, 1)}</span><span className="choice-copy"><strong>{label}</strong><small>{classLabel}</small></span>{ascendancyId === id && <Check />}</button>
            })}
          </div>}

          {step === 3 && <div className="build-details-form">
            <label><span>{zh ? '构筑名称' : 'Build name'}</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={zh ? `${classLabel} 构筑` : `${classLabel} build`} /></label>
            <fieldset className="realm-field"><legend>{zh ? '游戏区域' : 'Game realm'}</legend><div className="realm-selector">
              <button type="button" className={realm === 'cn' ? 'active cn' : ''} onClick={() => setRealm('cn')}>{zh ? '腾讯服（国服）' : 'Tencent CN'}</button>
              <button type="button" className={realm === 'global' ? 'active global' : ''} onClick={() => setRealm('global')}>{zh ? '国际服' : 'Global'}</button>
            </div><small>{zh ? '区域会随构筑永久保存，创建后不再根据名称推断。' : 'The realm is stored permanently with this build.'}</small></fieldset>
            <label><span>{zh ? '天赋树版本' : 'Passive tree version'}</span><select value={treeVersion} onChange={(event) => setTreeVersion(event.target.value)}>{versions.map((version) => <option key={version} value={version}>{version.replace('_', '.')}</option>)}</select></label>
            <label className="check-row"><input type="checkbox" defaultChecked /><span><strong>{zh ? '从空白天赋盘开始' : 'Start with an empty passive tree'}</strong><small>{zh ? '职业和升华起点不会消耗天赋点' : 'Class and ascendancy roots do not consume passive points'}</small></span></label>
          </div>}
        </div>

        <footer className="dialog-footer"><button className="secondary-command" onClick={step === 1 ? onClose : () => setStep(step - 1)}>{step > 1 && <ArrowLeft />}{step === 1 ? (zh ? '取消' : 'Cancel') : (zh ? '上一步' : 'Back')}</button><button className="primary-command" disabled={!canContinue} onClick={() => step < 3 ? setStep(step + 1) : onCreate({ name: name.trim(), classId, ascendancyId, treeVersion, realm })}>{step === 3 ? (zh ? '创建构筑' : 'Create build') : (zh ? '下一步' : 'Next')}{step < 3 && <ArrowRight />}</button></footer>
      </section>
    </div>
  )
}
