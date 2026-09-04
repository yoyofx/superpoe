import type {
  XiletradeCatalog,
  XiletradeDataCatalog,
  XiletradeFilterEntry,
} from './xiletradeDataCatalog.js'
import type { UiLanguage } from './uiLocale.js'
import type {
  MarketPageTranslationPayload,
  MarketTranslationPair,
} from '../src/engine/marketPageTranslation.js'

type ChineseLanguage = Extract<UiLanguage, 'zh-rCN' | 'zh-rTW'>

export interface MarketPageTranslationOptions {
  /** Optional project translation index used when an Xiletrade locale has no stable base entry. */
  translateItem?: (source: string) => string | undefined
}

const STATIC_UI_PAIRS: ReadonlyArray<readonly [source: string, zhCN: string, zhTW: string]> = [
  ['Type Filters', '类型筛选', '類型篩選'],
  ['Stat Filters', '属性筛选', '屬性篩選'],
  ['Item Filters', '物品筛选', '物品篩選'],
  ['Map Filters', '地图筛选', '地圖篩選'],
  ['Weapon Filters', '武器筛选', '武器篩選'],
  ['Armour Filters', '护甲筛选', '護甲篩選'],
  ['Waystone Filters', '引路石筛选', '引路石篩選'],
  ['Tablet Filters', '碑牌筛选', '碑牌篩選'],
  ['Miscellaneous', '其他', '其他'],
  ['Other', '其他', '其他'],
  ['Item Category', '物品类别', '物品類別'],
  ['Base Type', '基底类型', '基底類型'],
  ['Rarity', '稀有度', '稀有度'],
  ['Select', '选择', '選擇'],
  ['All', '全部', '全部'],
  ['None', '无', '無'],
  ['Yes', '是', '是'],
  ['No', '否', '否'],
  ['Exact', '精确', '精確'],
  ['Fuzzy', '模糊', '模糊'],
  ['Add', '添加', '新增'],
  ['Remove', '移除', '移除'],
  ['Apply', '应用', '套用'],
  ['Cancel', '取消', '取消'],
  ['Edit', '编辑', '編輯'],
  ['Save', '保存', '儲存'],
  ['Delete', '删除', '刪除'],
  ['Expand', '展开', '展開'],
  ['Collapse', '折叠', '摺疊'],
  ['More', '更多', '更多'],
  ['Less', '更少', '更少'],
  ['Default', '默认', '預設'],
  ['Normal', '普通', '普通'],
  ['Magic', '魔法', '魔法'],
  ['Rare', '稀有', '稀有'],
  ['Unique', '传奇', '傳奇'],
  ['Search', '搜索', '搜尋'],
  ['Search items', '搜索物品', '搜尋物品'],
  ['Search listings', '搜索挂单', '搜尋掛單'],
  ['Filters', '筛选', '篩選'],
  ['Filter', '筛选', '篩選'],
  ['Clear', '清除', '清除'],
  ['Clear all', '全部清除', '全部清除'],
  ['Reset', '重置', '重設'],
  ['Reset filters', '重置筛选', '重設篩選'],
  ['Sort', '排序', '排序'],
  ['Sort by', '排序方式', '排序方式'],
  ['Price', '价格', '價格'],
  ['Currency', '通货', '通貨'],
  ['Amount', '数量', '數量'],
  ['Unit', '单位', '單位'],
  ['Time', '时间', '時間'],
  ['Listed', '上架时间', '上架時間'],
  ['Newest', '最新', '最新'],
  ['Oldest', '最早', '最早'],
  ['Ascending', '升序', '升冪'],
  ['Descending', '降序', '降冪'],
  ['Results', '结果', '結果'],
  ['Online', '在线', '在線'],
  ['Offline', '离线', '離線'],
  ['Any', '全部', '全部'],
  ['Any Item', '任意物品', '任意物品'],
  ['Any Weapon', '任意武器', '任意武器'],
  ['Any One-Handed Weapon', '任意单手武器', '任意單手武器'],
  ['Any Two-Handed Weapon', '任意双手武器', '任意雙手武器'],
  ['Any Melee Weapon', '任意近战武器', '任意近戰武器'],
  ['Any Ranged Weapon', '任意远程武器', '任意遠程武器'],
  ['Any One-Handed Melee Weapon', '任意单手近战武器', '任意單手近戰武器'],
  ['Any Two-Handed Melee Weapon', '任意双手近战武器', '任意雙手近戰武器'],
  ['Any One-Handed Ranged Weapon', '任意单手远程武器', '任意單手遠程武器'],
  ['Any Two-Handed Ranged Weapon', '任意双手远程武器', '任意雙手遠程武器'],
  ['Any Armour', '任意护甲', '任意護甲'],
  ['Any Body Armour', '任意胸甲', '任意胸甲'],
  ['Any Helmet', '任意头盔', '任意頭盔'],
  ['Any Gloves', '任意手套', '任意手套'],
  ['Any Boots', '任意鞋子', '任意鞋子'],
  ['Any Shield', '任意盾牌', '任意盾牌'],
  ['Any Buckler', '任意小盾', '任意小盾'],
  ['Any Focus', '任意法器', '任意法器'],
  ['Any Quiver', '任意箭袋', '任意箭袋'],
  ['Any Accessory', '任意饰品', '任意飾品'],
  ['Any Amulet', '任意项链', '任意項鍊'],
  ['Any Ring', '任意戒指', '任意戒指'],
  ['Any Belt', '任意腰带', '任意腰帶'],
  ['Any Jewel', '任意珠宝', '任意珠寶'],
  ['Any Flask', '任意药剂', '任意藥劑'],
  ['Any Charm', '任意咒符', '任意咒符'],
  ['Any Waystone', '任意引路石', '任意引路石'],
  ['Any Tablet', '任意碑牌', '任意碑牌'],
  ['Any Idol', '任意神像', '任意神像'],
  ['Any Tincture', '任意萃取物', '任意萃取物'],
  ['Unarmed', '空手', '空手'],
  ['Claw', '爪', '爪'],
  ['Dagger', '匕首', '匕首'],
  ['One-Handed Sword', '单手剑', '單手劍'],
  ['One-Handed Axe', '单手斧', '單手斧'],
  ['One-Handed Mace', '单手锤', '單手錘'],
  ['Spear', '矛', '矛'],
  ['Flail', '连枷', '連枷'],
  ['Sceptre', '权杖', '權杖'],
  ['Wand', '法杖', '法杖'],
  ['Staff', '长杖', '長杖'],
  ['Quarterstaff', '长杖', '長杖'],
  ['Two-Handed Sword', '双手剑', '雙手劍'],
  ['Two-Handed Axe', '双手斧', '雙手斧'],
  ['Two-Handed Mace', '双手锤', '雙手錘'],
  ['Bow', '弓', '弓'],
  ['Crossbow', '弩', '弩'],
  ['Body Armour', '胸甲', '胸甲'],
  ['Helmet', '头盔', '頭盔'],
  ['Gloves', '手套', '手套'],
  ['Boots', '鞋子', '鞋子'],
  ['Shield', '盾牌', '盾牌'],
  ['Buckler', '小盾', '小盾'],
  ['Quiver', '箭袋', '箭袋'],
  ['Amulet', '项链', '項鍊'],
  ['Ring', '戒指', '戒指'],
  ['Belt', '腰带', '腰帶'],
  ['Jewel', '珠宝', '珠寶'],
  ['Flask', '药剂', '藥劑'],
  ['Charm', '咒符', '咒符'],
  ['Waystone', '引路石', '引路石'],
  ['Buyout', '一口价', '直購'],
  ['Instant buyout', '一口价', '直購'],
  ['Negotiable', '可议价', '可議價'],
  ['In person', '当面交易', '當面交易'],
  ['Whisper', '密语', '密語'],
  ['Copy whisper', '复制密语', '複製密語'],
  ['Copied', '已复制', '已複製'],
  ['Copy', '复制', '複製'],
  ['Item', '物品', '物品'],
  ['Items', '物品', '物品'],
  ['Name', '名称', '名稱'],
  ['Type', '类型', '類型'],
  ['Level', '等级', '等級'],
  ['Item level', '物品等级', '物品等級'],
  ['Item Quality', '物品品质', '物品品質'],
  ['Quality', '品质', '品質'],
  ['Gem Level', '宝石等级', '寶石等級'],
  ['Gem Sockets', '宝石插槽', '寶石插槽'],
  ['Area Level', '区域等级', '區域等級'],
  ['Stack Size', '堆叠数量', '堆疊數量'],
  ['Sockets', '插槽', '插槽'],
  ['Links', '连线', '連線'],
  ['Prefix', '前缀', '前綴'],
  ['Suffix', '后缀', '後綴'],
  ['Implicit', '基底属性', '基底屬性'],
  ['Implicits', '基底属性', '基底屬性'],
  ['Explicit', '显式属性', '顯式屬性'],
  ['Explicits', '显式属性', '顯式屬性'],
  ['Pseudo', '伪属性', '偽屬性'],
  ['Enchant', '附魔', '附魔'],
  ['Crafted', '打造', '製作'],
  ['Fractured', '裂痕', '裂痕'],
  ['Synthesised', '合成', '合成'],
  ['Mirrored', '镜像', '鏡像'],
  ['Influenced', '受影响', '受影響'],
  ['Sanctified', '圣化', '聖化'],
  ['Twice Corrupted', '双重腐化', '雙重腐化'],
  ['Cultivated Vaal Orb', '培育瓦尔宝珠', '培育瓦爾寶珠'],
  ['Unrevealed', '未揭示', '未揭示'],
  ['Desecrated', '渎灵', '褻瀆'],
  ['Foreseeing', '预见', '預見'],
  ['Barya Sacred Water', '巴亚圣水', '巴亞聖水'],
  ['Unidentified Tier', '未鉴定阶级', '未鑑定階級'],
  ['Corrupted', '已污染', '已污染'],
  ['Identified', '已鉴定', '已鑑定'],
  ['Unidentified', '未鉴定', '未鑑定'],
  ['Requirements', '需求', '需求'],
  ['Level Requirement', '等级需求', '等級需求'],
  ['Strength', '力量', '力量'],
  ['Dexterity', '敏捷', '敏捷'],
  ['Intelligence', '智慧', '智慧'],
  ['League', '赛季', '賽季'],
  ['Min', '最小', '最小'],
  ['Max', '最大', '最大'],
  ['Minimum', '最小', '最小'],
  ['Maximum', '最大', '最大'],
  ['At least', '至少', '至少'],
  ['At most', '至多', '至多'],
  ['From', '从', '從'],
  ['To', '到', '到'],
  ['Fetch', '抓取', '擷取'],
  ['Fetch more', '抓取更多', '擷取更多'],
  ['Load more', '加载更多', '載入更多'],
  ['Next', '下一页', '下一頁'],
  ['Previous', '上一页', '上一頁'],
  ['Live search', '实时搜索', '即時搜尋'],
  ['Online only', '仅在线', '僅限在線'],
  ['Show filters', '显示筛选', '顯示篩選'],
  ['Hide filters', '隐藏筛选', '隱藏篩選'],
  ['Advanced', '高级', '進階'],
  ['Trade', '交易', '交易'],
  ['Equipment Filters', '装备筛选', '裝備篩選'],
  ['Damage', '伤害', '傷害'],
  ['Attacks per Second', '每秒攻击次数', '每秒攻擊次數'],
  ['Critical Chance', '暴击率', '暴擊率'],
  ['Damage per Second', '每秒伤害', '每秒傷害'],
  ['Physical DPS', '物理DPS', '物理DPS'],
  ['Elemental DPS', '元素DPS', '元素DPS'],
  ['Reload Time', '装填时间', '裝填時間'],
  ['Armour', '护甲', '護甲'],
  ['Evasion', '闪避', '閃避'],
  ['Energy Shield', '能量护盾', '能量護盾'],
  ['Runic Ward', '符文结界', '符文結界'],
  ['Block', '格挡', '格擋'],
  ['Spirit', '精神', '精神'],
  ['Augmentable Sockets', '可增幅插槽', '可增幅插槽'],
  ['Endgame Filters', '终局筛选', '終局篩選'],
  ['Waystone Tier', '引路石阶级', '引路石階級'],
  ['Waystone Packsize', '引路石怪物群大小', '引路石怪物群大小'],
  ['Waystone Pack Size', '引路石怪物群大小', '引路石怪物群大小'],
  ['Monster Effectiveness', '怪物效果', '怪物效果'],
  ['Waystone IIR', '引路石物品稀有度', '引路石物品稀有度'],
  ['Monster Rarity', '怪物稀有度', '怪物稀有度'],
  ['Waystone Revives', '引路石复苏次数', '引路石復甦次數'],
  ['Waystone Drop Chance', '引路石掉落几率', '引路石掉落機率'],
  ['Waystone Gold', '引路石金币', '引路石金幣'],
  ['Waystone Experience', '引路石经验', '引路石經驗'],
  ['Ultimatum Trial', '最后通牒试炼', '最後通牒試煉'],
  ['Tablet', '碑牌', '碑牌'],
  ['Ritual', '仪式', '儀式'],
  ['Breach', '裂隙', '裂痕'],
  ['Expedition', '先祖秘藏', '先祖秘藏'],
  ['Delirium', '惊悸迷雾', '譫妄'],
  ['Abyss', '深渊', '深淵'],
  ['Strongbox', '保险箱', '保險箱'],
  ['Ritual Encounter', '仪式遭遇战', '儀式遭遇戰'],
  ['Breach Encounter', '裂隙遭遇战', '裂痕遭遇戰'],
  ['Expedition Encounter', '先祖秘藏遭遇战', '先祖秘藏遭遇戰'],
  ['Delirium Encounter', '惊悸迷雾遭遇战', '譫妄遭遇戰'],
  ['Abyss Encounter', '深渊遭遇战', '深淵遭遇戰'],
  ['Strongbox Encounter', '保险箱遭遇战', '保險箱遭遇戰'],
  ['Stat Value', '属性值', '屬性值'],
  ['Count', '数量', '數量'],
  ['Listing', '挂单', '掛單'],
  ['Listings', '挂单', '掛單'],
  ['Trade Filters', '交易筛选', '交易篩選'],
  ['Seller Account', '卖家账号', '賣家帳號'],
  ['Enter account name...', '输入账号名称……', '輸入帳號名稱……'],
  ['Enter account name…', '输入账号名称……', '輸入帳號名稱……'],
  ['Collapse Listings By Account', '按账号折叠挂单', '按帳號摺疊掛單'],
  ['Seller', '卖家', '賣家'],
  ['Location', '位置', '位置'],
  ['Details', '详情', '詳情'],
  ['Close', '关闭', '關閉'],
  ['Back', '返回', '返回'],
  ['Forward', '前进', '前進'],
  ['Refresh', '刷新', '重新整理'],
  ['Reload', '刷新', '重新載入'],
  ['Any Time', '任意时间', '任意時間'],
  ['Sale Type', '出售类型', '出售類型'],
  ['Buyout or Fixed Price', '一口价或固定价格', '直購或固定價格'],
  ['Gold Fee', '金币费用', '金幣費用'],
  ['Buyout Price', '一口价', '直購'],
  ['Exalted Orb Equivalent', '崇高石等价', '崇高石等價'],
  ['Loading...', '加载中……', '載入中……'],
  ['No results', '没有结果', '沒有結果'],
  ['No matching results', '无匹配结果', '無符合結果'],
  ['Login', '登录', '登入'],
  ['Sign in', '登录', '登入'],
  ['Sign out', '退出登录', '登出'],
  ['Settings', '设置', '設定'],
  ['Options', '选项', '選項'],
  ['Visit hideout', '前往藏身处', '前往藏身處'],
  ['Contact', '联系', '聯絡'],
  ['Show all', '显示全部', '顯示全部'],
  ['Hide', '隐藏', '隱藏'],
  ['Show', '显示', '顯示'],
  ['Chaos Orb', '混沌石', '混沌石'],
  ['Divine Orb', '神圣石', '神聖石'],
  ['Exalted Orb', '崇高石', '崇高石'],
]

function addPair(target: Map<string, MarketTranslationPair>, source: unknown, localized: unknown): void {
  if (typeof source !== 'string' || typeof localized !== 'string') return
  const from = source.trim()
  const to = localized.trim()
  if (!from || !to || from === to || !/[A-Za-z]/.test(from)) return
  const key = from.toLocaleLowerCase()
  if (!target.has(key)) target.set(key, [from, to])
}

function addFilterPair(target: Map<string, MarketTranslationPair>, source: XiletradeFilterEntry, localized?: XiletradeFilterEntry): void {
  addPair(target, source.text, localized?.text)
  const sourceOptions = source.option?.options || []
  const localizedOptions = new Map((localized?.option?.options || []).map((option) => [String(option.id), option.text]))
  for (const option of sourceOptions) addPair(target, option.text, localizedOptions.get(String(option.id)))
}

function addCatalogFilterPairs(
  target: Map<string, MarketTranslationPair>,
  canonical: XiletradeCatalog,
  localized: XiletradeCatalog,
): void {
  const localizedEntries = new Map(localized.entries.map((entry) => [entry.id, entry]))
  for (const entry of canonical.entries) addFilterPair(target, entry, localizedEntries.get(entry.id))
}

function addCatalogItemPairs(
  target: Map<string, MarketTranslationPair>,
  canonical: XiletradeCatalog,
  localized: XiletradeCatalog,
  options: MarketPageTranslationOptions = {},
): void {
  // ItemsTwo stores ordinary base/category labels in `type`; unique entries
  // additionally expose `text` and `name`. Keep all three display surfaces in
  // the catalog so CN data (whose BasesTwo file is intentionally sparse) is
  // still able to translate the official trade category lists.
  const localizedItemGroups = new Map((localized.items || []).map((group) => [group.id, group]))
  for (const group of canonical.items || []) {
    const translatedGroup = localizedItemGroups.get(group.id)
    addPair(target, group.label, translatedGroup?.label)
    for (let index = 0; index < group.entries.length; index += 1) {
      const source = group.entries[index]
      const translated = translatedGroup?.entries[index]
      const translatedType = options.translateItem?.(source.type) || translated?.type
      const translatedName = options.translateItem?.(source.name || '') || translated?.name
      addPair(target, source.type, translatedType)
      addPair(target, source.name, translatedName)
      // ItemsTwo's full unique label is the name followed by its base type.
      // Some locale files omit that combined entry or have a different entry
      // order, while the project item catalog has authoritative translations
      // for both parts. Rebuild the display label from those parts first.
      const composedText = source.name && (translatedName || translatedType)
        ? [translatedName, translatedType].filter(Boolean).join(' ')
        : undefined
      const translatedText = options.translateItem?.(source.text || '')
        || composedText
        || translated?.text
      addPair(target, source.text, translatedText)
    }
  }

  const localizedBases = new Map((localized.bases || []).map((entry) => [entry.id, entry]))
  for (const entry of canonical.bases || []) {
    const translated = localizedBases.get(entry.id)
    addPair(target, entry.name_en, translated?.name || translated?.name_en)
    addPair(target, entry.name, translated?.name)
  }

  const localizedWords = new Map((localized.words || []).map((entry) => [String(entry.id), entry]))
  for (const entry of canonical.words || []) {
    const translated = localizedWords.get(String(entry.id))
    addPair(target, entry.name_en, translated?.name || translated?.name_en)
    addPair(target, entry.name, translated?.name)
  }

  const localizedCurrencies = new Map((localized.currencies || []).map((entry) => [String(entry.id || entry.name_en || entry.name || entry.text), entry]))
  for (const entry of canonical.currencies || []) {
    const translated = localizedCurrencies.get(String(entry.id || entry.name_en || entry.name || entry.text))
    for (const key of ['name_en', 'name', 'text', 'label']) addPair(target, entry[key], translated?.[key])
  }
}

function addCatalogPairs(
  target: Map<string, MarketTranslationPair>,
  canonical: XiletradeCatalog,
  localized: XiletradeCatalog,
  options: MarketPageTranslationOptions = {},
): void {
  addCatalogFilterPairs(target, canonical, localized)
  addCatalogItemPairs(target, canonical, localized, options)
}

function buildUiPairs(language: ChineseLanguage): MarketTranslationPair[] {
  return STATIC_UI_PAIRS.map(([source, zhCN, zhTW]) => [source, language === 'zh-rCN' ? zhCN : zhTW] as const)
}

export function buildMarketPageTranslation(
  catalog: XiletradeDataCatalog,
  language: UiLanguage,
  options: MarketPageTranslationOptions = {},
): MarketPageTranslationPayload {
  const disabled: MarketPageTranslationPayload = {
    schemaVersion: 1,
    language,
    enabled: false,
    source: 'disabled',
    uiPairs: [],
    gamePairs: [],
  }
  if (language !== 'zh-rCN' && language !== 'zh-rTW') return disabled

  const locale = language === 'zh-rCN' ? 'zh-CN' : 'zh-TW'
  const canonical = catalog.get('en-US')
  const localized = catalog.get(locale)
  const filterPairs = new Map<string, MarketTranslationPair>()
  addCatalogFilterPairs(filterPairs, canonical, localized)
  const itemPairs = new Map<string, MarketTranslationPair>()
  addCatalogItemPairs(itemPairs, canonical, localized, options)
  const gamePairs = new Map<string, MarketTranslationPair>()
  addCatalogPairs(gamePairs, canonical, localized, options)
  const uiPairs = buildUiPairs(language)
  return {
    schemaVersion: 1,
    language,
    enabled: true,
    source: `xiletrade:${localized.upstreamCommit}:${locale}`,
    uiPairs,
    gamePairs: [...gamePairs.values()],
    itemPairs: [...itemPairs.values()],
    filterPairs: [...filterPairs.values()],
  }
}
