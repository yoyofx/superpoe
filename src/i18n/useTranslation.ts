import { useCallback } from 'react'
import { useTreeStore } from '@/store/treeStore'

// ---- Translation tables ----
type Lang = 'en' | 'zh'

interface Translations {
  'toolbar.search': string
  'toolbar.calc': string
  'toolbar.calculating': string
  'toolbar.class': string
  'toolbar.ascendancy': string
  'toolbar.version': string
  'toolbar.weaponSet': string
  'toolbar.zoomIn': string
  'toolbar.zoomOut': string
  'toolbar.zoomReset': string
  'import.title': string
  'import.placeholder': string
  'import.button': string
  'import.decoding': string
  'import.nodesLoaded': string
  'export.title': string
  'export.generate': string
  'export.encoding': string
  'export.copied': string
  'export.copy': string
  'export.download': string
  'export.hint': string
  'save.title': string
  'save.name': string
  'save.save': string
  'save.load': string
  'save.delete': string
  'save.export': string
  'save.import': string
  'save.share': string
  'save.shared': string
  'save.empty': string
  'stats.attributes': string
  'stats.offence': string
  'stats.defence': string
  'stats.charges': string
  'stats.skills': string
  'stats.calculating': string
  'stats.error': string
  'stats.empty': string
  'stats.str': string
  'stats.dex': string
  'stats.int': string
  'stats.life': string
  'stats.es': string
  'stats.mana': string
  'stats.level': string
  'stats.class': string
  'stats.ascendancy': string
  'node.type.normal': string
  'node.type.notable': string
  'node.type.keystone': string
  'node.type.jewel': string
  'node.type.ascendancy': string
  'node.type.classStart': string
  'node.type.mastery': string
  'sidebar.title': string
  'sidebar.noNode': string
  'sidebar.stats': string
  'sidebar.effects': string
  'sidebar.reminder': string
  'loading': string
  'error.prefix': string
}

const strings: Record<Lang, Translations> = {
  en: {
    'toolbar.search': 'Search nodes...',
    'toolbar.calc': 'Calc',
    'toolbar.calculating': '...',
    'toolbar.class': 'Select class',
    'toolbar.ascendancy': 'Select ascendancy',
    'toolbar.version': 'Tree version',
    'toolbar.weaponSet': 'Weapon Set',
    'toolbar.zoomIn': 'Zoom in',
    'toolbar.zoomOut': 'Zoom out',
    'toolbar.zoomReset': 'Reset zoom',
    'import.title': 'Import Build',
    'import.placeholder': 'Paste PoB2 export code...',
    'import.button': 'Import',
    'import.decoding': 'Decoding...',
    'import.nodesLoaded': 'nodes loaded',
    'export.title': 'Export Code',
    'export.generate': 'Generate Export Code',
    'export.encoding': 'Encoding...',
    'export.copied': 'Copied!',
    'export.copy': 'Copy',
    'export.download': 'Download',
    'export.hint': 'Generate PoB2 import code from allocated nodes',
    'save.title': 'Saved Builds',
    'save.name': 'Build name...',
    'save.save': 'Save',
    'save.load': 'Load',
    'save.delete': 'Del',
    'save.export': 'Export .json',
    'save.import': 'Import .json',
    'save.share': 'Share',
    'save.shared': 'Copied!',
    'save.empty': 'No saved builds yet. Save one above or import a .json file.',
    'stats.attributes': 'Attributes',
    'stats.offence': 'Offence',
    'stats.defence': 'Defence',
    'stats.charges': 'Charges',
    'stats.skills': 'Skills',
    'stats.calculating': 'Calculating...',
    'stats.error': 'Calculation Error',
    'stats.empty': 'No calculation yet',
    'stats.str': 'Strength',
    'stats.dex': 'Dexterity',
    'stats.int': 'Intelligence',
    'stats.life': 'Life',
    'stats.es': 'Energy Shield',
    'stats.mana': 'Mana',
    'stats.level': 'Level',
    'stats.class': 'Class',
    'stats.ascendancy': 'Ascendancy',
    'node.type.normal': 'Normal',
    'node.type.notable': 'Notable',
    'node.type.keystone': 'Keystone',
    'node.type.jewel': 'Jewel Socket',
    'node.type.ascendancy': 'Ascendancy',
    'node.type.classStart': 'Class Start',
    'node.type.mastery': 'Mastery',
    'sidebar.title': 'Node Details',
    'sidebar.noNode': 'Click a node to view details',
    'sidebar.stats': 'Stats',
    'sidebar.effects': 'Effects',
    'sidebar.reminder': 'Reminder',
    'loading': 'Loading passive tree...',
    'error.prefix': 'Error',
  },
  zh: {
    'toolbar.search': '搜索节点...',
    'toolbar.calc': '计算',
    'toolbar.calculating': '...',
    'toolbar.class': '选择职业',
    'toolbar.ascendancy': '选择升华',
    'toolbar.version': '天赋版本',
    'toolbar.weaponSet': '武器组',
    'toolbar.zoomIn': '放大',
    'toolbar.zoomOut': '缩小',
    'toolbar.zoomReset': '重置缩放',
    'import.title': '导入配装',
    'import.placeholder': '粘贴 PoB2 导出代码...',
    'import.button': '导入',
    'import.decoding': '解码中...',
    'import.nodesLoaded': '个节点已加载',
    'export.title': '导出代码',
    'export.generate': '生成导出代码',
    'export.encoding': '编码中...',
    'export.copied': '已复制!',
    'export.copy': '复制',
    'export.download': '下载',
    'export.hint': '从已分配节点生成 PoB2 导入代码',
    'save.title': '已保存配装',
    'save.name': '配装名称...',
    'save.save': '保存',
    'save.load': '加载',
    'save.delete': '删',
    'save.export': '导出 .json',
    'save.import': '导入 .json',
    'save.share': '分享',
    'save.shared': '已复制!',
    'save.empty': '暂无保存的配装。在上方保存或导入 .json 文件。',
    'stats.attributes': '属性',
    'stats.offence': '攻击',
    'stats.defence': '防御',
    'stats.charges': '充能球',
    'stats.skills': '技能',
    'stats.calculating': '计算中...',
    'stats.error': '计算错误',
    'stats.empty': '暂未计算',
    'stats.str': '力量',
    'stats.dex': '敏捷',
    'stats.int': '智慧',
    'stats.life': '生命',
    'stats.es': '能量护盾',
    'stats.mana': '魔力',
    'stats.level': '等级',
    'stats.class': '职业',
    'stats.ascendancy': '升华',
    'node.type.normal': '普通',
    'node.type.notable': '核心',
    'node.type.keystone': '基石',
    'node.type.jewel': '珠宝孔',
    'node.type.ascendancy': '升华',
    'node.type.classStart': '职业起点',
    'node.type.mastery': '精通',
    'sidebar.title': '节点详情',
    'sidebar.noNode': '点击节点查看详情',
    'sidebar.stats': '属性',
    'sidebar.effects': '效果',
    'sidebar.reminder': '提示',
    'loading': '加载天赋树中...',
    'error.prefix': '错误',
  },
}

// ---- Hook ----
export function useTranslation() {
  // Language stored in Zustand for reactivity (bonus: could be persisted)
  const lang = useTreeStore((s) => s as { language?: Lang })?.language || 'en'

  const t = useCallback(
    (key: keyof Translations, params?: Record<string, string | number>) => {
      let text = strings[lang]?.[key] ?? strings.en[key] ?? key
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(`{${k}}`, String(v))
        }
      }
      return text
    },
    [lang],
  )

  const setLanguage = useCallback(
    (l: Lang) => {
      useTreeStore.setState({ language: l } as Partial<ReturnType<typeof useTreeStore.getState>>)
    },
    [],
  )

  return { t, lang, setLanguage }
}

/** Standalone translate function (outside React) */
export function getTranslations(lang: Lang = 'en'): Translations {
  return strings[lang] ?? strings.en
}

export type { Lang, Translations }
