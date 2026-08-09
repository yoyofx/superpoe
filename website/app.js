const translations = {
  zh: {
    nav: { capabilities: '能力', workflow: '工作流', download: '下载' },
    hero: { eyebrow: 'PATH OF EXILE 2 · BUILD WORKBENCH', title: '把每一次构筑<br /><em>变成可验证的决定。</em>', lede: 'SuperPoE2 把 PoB2 计算、装备分析、技能 DPS 与集市工作流放在同一个安静、快速的桌面工作台里。', primary: '获取 SuperPoE2 <span>↓</span>', secondary: '查看能力 <span>→</span>', status: '本地运行已就绪', platforms: 'Windows · macOS' },
    signals: { one: '同一份构筑事实', two: '本地 PoB2 语义计算', three: '面向重复操作优化', four: '不把数据交给云端' },
    capabilities: { title: '从构筑想法，到<br /><span>知道为什么。</span>', copy: '装备、技能、天赋和配置不再是分散的页面。每一次调整都能回到同一个构筑对象，给出可追溯的计算结果。', link: '了解完整工作流 <span>→</span>' },
    feature: { build: { title: '构筑中心与导入构筑', copy: '目录化管理本地构筑。导入 PoB Code、WeGame 分享或 poe.ninja 角色，保留来源，随时回到上一次决定。', point1: '最近打开与我的构筑', point2: '导入预览，确认后替换或新建', point3: '武器组、天赋与配置同步' }, calc: { title: '装备页面与技能计算', copy: '从人物面板、装备槽和武器组，到基底、点伤、increased、gain 与 more，所有结果都回到当前构筑和实际技能。', link: '查看计算路径 <span>→</span>' }, skill: { title: '技能与伤害计算', copy: '按武器组查看技能，支持有效 DPS 排序，并展开点伤、提高、额外获得、总增益和等级成长等详细来源。', link: '查看计算细节 <span>→</span>' }, market: { title: '集市查价与收藏', copy: '复制游戏内装备，快速形成查询条件。查看价格、收藏候选，保存搜索并跳转到交易中心继续寻找。', link: '查看集市工作流 <span>→</span>' }, passive: { title: '天赋树管理', copy: '用真实 PoB2 树数据规划路径，搜索节点、切换武器组、查看升华，并把分配结果带进计算。', link: '规划你的路径 <span>→</span>' }, monitor: { title: '价格实时监控', copy: '保存购买目标，实时获取挂单并在游戏窗口中提醒。发现目标后可直接查看装备并跳转购买。', link: '了解监控流程 <span>→</span>' }, currency: { title: '通货行情', copy: '按分类浏览通货价格，查看当前价、神圣石折算、时段参考、变化趋势和数据来源。', link: '查看行情数据 <span>→</span>' }, local: { title: '本地、可恢复、可追溯', copy: '核心数据保存在本地。PoB2 LuaJIT sidecar 优先常驻运行，构筑文件、设置和备份都能明确找到。', point1: '不把构筑上传到云端', point2: 'Windows 与 macOS 原生运行', point3: '上游 Lua 文件保持只读来源' } },
    visual: { equipment: { panel: '人物面板', tabs: '攻击 / 防御 / 人物', weapon: '武器组 I / II', status: '汇总已同步' }, build: { center: '构筑中心', import: '统一导入' }, skill: { dps: '技能 DPS', sources: '伤害来源可追溯' }, market: { search: '搜索与价格', favorites: '装备收藏' }, passive: { search: '节点搜索', weapon: '武器组路径' }, monitor: { targets: '购买目标', alerts: '实时提醒', purchase: '游戏内跳转购买' }, currency: { price: '当前价格', history: '时段参考' } },
    workflow: { title: '四步，把猜测<br /><span>变成依据。</span>', copy: 'SuperPoE2 把重复的核对工作交给计算，把关键的选择留给你。', step1: { title: '导入', copy: 'PoB Code、WeGame 分享或本地构筑文件。' }, step2: { title: '拆解', copy: '装备、天赋、技能与配置进入同一对象。' }, step3: { title: '计算', copy: 'PoB2 LuaJIT 运行时给出可复核结果。' }, step4: { title: '行动', copy: '比较升级方向，或直接去集市寻找它。' } },
    shot: { title: '所有数字，<br /><span>回到你的构筑。</span>', copy: '真实运行界面，不是营销模型。每一处数据都来自当前构筑和对应的 PoB2 计算语义。' },
    download: { title: '下一套构筑，<br /><span>从这里开始。</span>', copy: 'Windows 与 macOS 持续构建。安装后即可离线使用核心计算与构筑管理。', primary: '查看全部能力 <span>↓</span>', secondary: '查看运行流程 <span>↓</span>' },
    footer: { tagline: '为 Path of Exile 2 构筑玩家制作。', platforms: 'Windows · macOS' }
  },
  en: {
    nav: { capabilities: 'Capabilities', workflow: 'Workflow', download: 'Download' },
    hero: { eyebrow: 'PATH OF EXILE 2 · BUILD WORKBENCH', title: 'Turn every build<br /><em>into a decision you can prove.</em>', lede: 'SuperPoE2 brings PoB2 calculations, item analysis, skill DPS and market workflows into one calm, fast desktop workbench.', primary: 'Get SuperPoE2 <span>↓</span>', secondary: 'Explore capabilities <span>→</span>', status: 'Local runtime ready', platforms: 'Windows · macOS' },
    signals: { one: 'One build source of truth', two: 'Local PoB2 semantic calculation', three: 'Built for repeated decisions', four: 'Your data stays local' },
    capabilities: { title: 'From build ideas to<br /><span>knowing why.</span>', copy: 'Items, skills, passives and configuration no longer live in separate silos. Every change returns to one build object and one traceable result.', link: 'Explore the workflow <span>→</span>' },
    feature: { build: { title: 'Build center & import', copy: 'Organize local builds by directory. Import a PoB Code, WeGame share or poe.ninja character, keep its source, and return to your last decision.', point1: 'Recent builds and your library', point2: 'Preview before replacing or creating', point3: 'Weapons, passives and config in sync' }, calc: { title: 'Equipment workspace & skill calculation', copy: 'From the character panel, equipment slots and weapon sets to base stats, flat damage, increased, gain and more, every result returns to the active build and skill.', link: 'Follow the calculation <span>→</span>' }, skill: { title: 'Skills & damage calculation', copy: 'Inspect skills by weapon set, sort by effective DPS, and expand flat damage, increased, gain, more and level-growth sources.', link: 'See the calculation detail <span>→</span>' }, market: { title: 'Market search & favorites', copy: 'Copy an item from the game to form a query, inspect prices, save candidates and continue the search in the trade center.', link: 'Explore the market workflow <span>→</span>' }, passive: { title: 'Passive tree management', copy: 'Plan on real PoB2 tree data, search nodes, switch weapon sets and carry the allocation into calculation.', link: 'Plan your route <span>→</span>' }, monitor: { title: 'Live price monitoring', copy: 'Save purchase targets, receive listings in real time and get alerts while the game is open. Open the item in-game and jump straight to purchase when a target appears.', link: 'See monitoring in action <span>→</span>' }, currency: { title: 'Currency market', copy: 'Browse prices by category and inspect current value, Divine Orb conversion, time-window references, changes and data source.', link: 'Explore market data <span>→</span>' }, local: { title: 'Local, recoverable, traceable', copy: 'Core data stays on your machine. The PoB2 LuaJIT sidecar runs resident first, with build files, settings and backups in clear locations.', point1: 'Your builds stay off the cloud', point2: 'Native Windows and macOS runtime', point3: 'Upstream Lua remains read-only' } },
    visual: { equipment: { panel: 'Character panel', tabs: 'Attack / Defense / Character', weapon: 'Weapon set I / II', status: 'Summary synced' }, build: { center: 'Build center', import: 'Unified import' }, skill: { dps: 'Skill DPS', sources: 'Traceable damage sources' }, market: { search: 'Search & pricing', favorites: 'Item favorites' }, passive: { search: 'Node search', weapon: 'Weapon set path' }, monitor: { targets: 'Purchase targets', alerts: 'Live alerts', purchase: 'Jump to purchase in game' }, currency: { price: 'Current price', history: 'Time-window reference' } },
    workflow: { title: 'Four steps from guessing<br /><span>to evidence.</span>', copy: 'SuperPoE2 gives repeated checks to the calculator, so you can keep the decisions that matter.', step1: { title: 'Import', copy: 'PoB Code, WeGame share or a local build file.' }, step2: { title: 'Break down', copy: 'Items, passives, skills and config share one object.' }, step3: { title: 'Calculate', copy: 'PoB2 LuaJIT runtime returns a traceable result.' }, step4: { title: 'Act', copy: 'Compare upgrades, then find them in the market.' } },
    shot: { title: 'Every number<br /><span>returns to your build.</span>', copy: 'A real running interface, not a marketing mockup. Every value comes from the active build and PoB2 semantics.' },
    download: { title: 'Your next build<br /><span>starts here.</span>', copy: 'Windows and macOS builds continue to evolve. Install and keep core calculation and build management offline.', primary: 'Explore all capabilities <span>↓</span>', secondary: 'View the workflow <span>↓</span>' },
    footer: { tagline: 'Made for Path of Exile 2 build crafters.', platforms: 'Windows · macOS' }
  }
};

let language = 'zh';
const languageButton = document.querySelector('[data-language-toggle]');
const nav = document.querySelector('[data-nav]');
const menuToggle = document.querySelector('[data-menu-toggle]');

function resolve(dictionary, path) {
  return path.split('.').reduce((value, key) => value?.[key], dictionary);
}

function applyLanguage(next) {
  language = next;
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const value = resolve(translations[next], node.dataset.i18n);
    if (value) node.innerHTML = value;
  });
  languageButton.textContent = next === 'zh' ? 'EN' : '中';
  languageButton.setAttribute('aria-label', next === 'zh' ? 'Switch to English' : '切换到中文');
}

languageButton.addEventListener('click', () => applyLanguage(language === 'zh' ? 'en' : 'zh'));
menuToggle.addEventListener('click', () => {
  const open = nav.classList.toggle('is-open');
  menuToggle.setAttribute('aria-expanded', String(open));
});
nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => nav.classList.remove('is-open')));
document.querySelector('[data-year]').textContent = new Date().getFullYear();

const lightbox = document.querySelector('[data-lightbox]');
const lightboxShell = document.querySelector('[data-lightbox-shell]');
const lightboxImage = document.querySelector('[data-lightbox-image]');
const lightboxCaption = document.querySelector('[data-lightbox-caption]');
const lightboxClose = document.querySelector('[data-lightbox-close]');
let lightboxReturnTarget = null;

function closeLightbox() {
  if (!lightbox || lightbox.hidden) return;
  lightbox.classList.remove('is-open');
  window.setTimeout(() => { lightbox.hidden = true; lightbox.setAttribute('aria-hidden', 'true'); }, 220);
  lightboxReturnTarget?.focus();
}

function openLightbox(frame) {
  const image = frame.querySelector('img');
  if (!lightbox || !image) return;
  lightboxReturnTarget = frame;
  lightboxImage.src = image.currentSrc || image.src;
  lightboxImage.alt = image.alt;
  lightboxCaption.textContent = image.alt;
  lightbox.hidden = false;
  lightbox.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => lightbox.classList.add('is-open'));
  lightboxClose.focus();
}

document.querySelectorAll('.screen-frame, .equipment-frame, .shot-frame').forEach((frame) => {
  const image = frame.querySelector('img');
  if (!image) return;
  frame.setAttribute('role', 'button');
  frame.setAttribute('tabindex', '0');
  frame.setAttribute('aria-label', `放大图片：${image.alt}`);
  frame.addEventListener('click', () => openLightbox(frame));
  frame.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openLightbox(frame); }
  });
});
lightboxClose?.addEventListener('click', closeLightbox);
lightbox?.addEventListener('click', (event) => { if (event.target === lightbox) closeLightbox(); });
lightboxShell?.addEventListener('click', (event) => event.stopPropagation());
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeLightbox(); });

const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
  if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
}), { threshold: .12 });
document.querySelectorAll('.reveal').forEach((node) => observer.observe(node));
