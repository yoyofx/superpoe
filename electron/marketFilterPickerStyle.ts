export const MARKET_FILTER_PICKER_STYLE = `
  /* Reset page-owned button chrome before applying the dialog's own styles. */
  dialog.sp-market-picker .sp-market-control, .sp-market-unified-toolbar .sp-market-control {
    appearance: none; position: relative; inset: auto; float: none; height: auto; min-width: 0;
    text-shadow: none; filter: none;
  }
  dialog.sp-market-picker .sp-market-control::before, dialog.sp-market-picker .sp-market-control::after,
  .sp-market-unified-toolbar .sp-market-control::before, .sp-market-unified-toolbar .sp-market-control::after {
    content: none; display: none;
  }
  .sp-market-unified[data-superpoe-filter-loading] > .sp-market-picker-body { visibility: hidden; }
  .sp-market-unified-loading { position: absolute; inset: 45% 20px auto; text-align: center; color: #d7c08d; }
  .sp-market-unified-collapsed { display: none !important; }
  .search-advanced-items.sp-market-unified-layout { display: block !important; }
  .search-advanced-items.sp-market-unified-layout > .search-advanced-pane.brown { width: 100% !important; float: none !important; }
  .sp-market-unified-toolbar { --sp-market-entry-width: 132px; --sp-market-entry-height: 42px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; width: 100%; padding: 10px 0; }
  .sp-market-unified-toolbar-copy { min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 7px; padding: 0 4px; color: #aaa39a; }
  .sp-market-unified-toolbar-copy strong { color: #e0c98e; font-size: 13px; font-weight: 600; }
  .sp-market-unified-toolbar-copy span { color: #898478; font-size: 12px; }
  .sp-market-unified-entry-group { flex: 0 1 auto; min-width: 0; max-width: 100%; display: flex; align-items: stretch; overflow-x: auto; border: 1px solid #62563f; border-left: 3px solid #b18a4c; border-radius: 4px;
    background: linear-gradient(180deg, rgba(31, 26, 18, .88), rgba(9, 11, 10, .94)); box-shadow: inset 0 1px rgba(255, 230, 166, .08);
    animation: sp-market-entry-group-breathe 4.6s ease-in-out infinite; }
  .sp-market-unified-toolbar button { box-sizing: border-box; font-family: inherit; font-size: 14px; line-height: 1.5; padding: 8px 16px; cursor: pointer; color: #ffe0a1;
    background: linear-gradient(110deg, #49391f, #10120f); border: 1px solid #a38d6d; border-radius: 3px; }
  .sp-market-unified-toolbar .sp-market-unified-open,
  .sp-market-unified-toolbar .sp-market-unified-shortcut { width: var(--sp-market-entry-width); min-width: var(--sp-market-entry-width); height: var(--sp-market-entry-height); min-height: var(--sp-market-entry-height); }
  .sp-market-unified-entry-group > .sp-market-unified-open { flex: 0 0 var(--sp-market-entry-width); border: 0; border-radius: 0; }
  .sp-market-unified-entry-group > .sp-market-unified-open:hover:not(:disabled),
  .sp-market-unified-entry-group > .sp-market-unified-open:active:not(:disabled) { transform: none; }
  .sp-market-unified-entry-group > .sp-market-unified-shortcuts { flex: 0 0 auto; min-width: 0; display: grid; grid-template-columns: repeat(3, var(--sp-market-entry-width)); gap: 0; border-left: 1px solid #62563f; }
  .sp-market-unified-toolbar .sp-market-unified-shortcut { padding: 8px 16px; border: 0; border-left: 1px solid rgba(98, 86, 63, .72); border-radius: 0; background-color: rgba(13, 15, 13, .58);
    background-image: linear-gradient(105deg, transparent 30%, rgba(255, 226, 150, .42) 49%, transparent 68%), linear-gradient(180deg, rgba(35, 31, 22, .8), rgba(13, 15, 13, .58));
    background-size: 230% 100%, 100% 100%; background-position: 115% 0, 0 0; background-repeat: no-repeat; color: #aaa39a; font-size: 14px; white-space: nowrap; }
  .sp-market-unified-toolbar .sp-market-unified-shortcut:first-child { border-left: 0; }
  .sp-market-unified-entry-group > .sp-market-unified-shortcuts > .sp-market-unified-shortcut { animation: sp-market-entry-segment-glow 4.8s ease-in-out infinite, sp-market-entry-segment-sheen 4.8s ease-in-out infinite; }
  .sp-market-unified-entry-group > .sp-market-unified-shortcuts > .sp-market-unified-shortcut:nth-child(2) { animation-delay: .8s; }
  .sp-market-unified-entry-group > .sp-market-unified-shortcuts > .sp-market-unified-shortcut:nth-child(3) { animation-delay: 1.6s; }
  .sp-market-unified-toolbar .sp-market-unified-shortcut:hover { border-color: #806843; background-color: rgba(190, 158, 87, .1); color: #f0d0a0; }
  .sp-market-unified-toolbar .sp-market-unified-shortcut[aria-current="page"] { border-color: #806843; background-color: rgba(72, 56, 31, .62);
    background-image: linear-gradient(105deg, transparent 30%, rgba(255, 239, 184, .5) 49%, transparent 68%), linear-gradient(180deg, rgba(72, 56, 31, .62), rgba(24, 19, 13, .56));
    background-size: 230% 100%, 100% 100%; background-position: 115% 0, 0 0; background-repeat: no-repeat; color: #e0c98e;
    box-shadow: inset 0 -2px #c39b4d, 0 0 10px rgba(195, 155, 77, .08); }
  .sp-market-unified-toolbar .sp-market-unified-open { isolation: isolate; overflow: hidden; border-color: #c39b4d;
    background-image: linear-gradient(105deg, transparent 34%, rgba(255, 226, 150, .34) 48%, transparent 62%), linear-gradient(110deg, #49391f, #10120f);
    background-size: 220% 100%, 100% 100%; background-position: 100% 0, 0 0; background-repeat: no-repeat;
    box-shadow: 0 0 0 rgba(211, 164, 74, 0), inset 0 1px rgba(255, 235, 178, .12);
    animation: sp-market-filter-breathe 3.8s ease-in-out infinite, sp-market-filter-sheen 4.8s ease-in-out infinite; }
  .sp-market-unified-toolbar .sp-market-unified-open:hover:not(:disabled) { color: #fff0bf; border-color: #f0c96c;
    box-shadow: 0 0 18px rgba(211, 164, 74, .28), inset 0 1px rgba(255, 239, 184, .22); transform: none; }
  .sp-market-unified-toolbar .sp-market-unified-open:active:not(:disabled) { transform: none; box-shadow: 0 0 8px rgba(211, 164, 74, .2); }
  .sp-market-unified-toolbar .sp-market-unified-open:disabled { animation: none; }
  .sp-market-unified-toolbar .sp-market-filter-native { color: #aaa39a; font-size: 11px; border-color: transparent; background: transparent; }
  .sp-market-unified-toolbar button:focus-visible { outline: 2px solid #ffe0a1; outline-offset: 2px; }
  @keyframes sp-market-entry-group-breathe {
    0%, 100% { box-shadow: inset 0 1px rgba(255, 230, 166, .08), 0 0 0 rgba(211, 164, 74, 0); }
    50% { box-shadow: inset 0 1px rgba(255, 230, 166, .16), 0 0 16px rgba(211, 164, 74, .2); }
  }
  @keyframes sp-market-entry-segment-glow {
    0%, 100% { filter: brightness(1); }
    50% { filter: brightness(1.08); }
  }
  @keyframes sp-market-entry-segment-sheen {
    0%, 28% { background-position: 115% 0, 0 0; }
    52% { background-position: 0 0, 0 0; }
    76%, 100% { background-position: -115% 0, 0 0; }
  }
  dialog.sp-market-picker.sp-market-unified { width: min(1160px, calc(100vw - 32px)); height: min(900px, 90vh); max-height: 90vh; }
  .sp-market-unified .sp-market-form-enhanced, .sp-market-unified .sp-market-form-enhanced *,
  .sp-market-unified .sp-market-form-enhanced *::before, .sp-market-unified .sp-market-form-enhanced *::after { box-sizing: border-box; }
  .sp-market-unified > .sp-market-picker-header .sp-market-picker-title > h2 { flex: none; margin: 0; }
  .sp-market-unified > .sp-market-picker-header { padding-bottom: 0; }
  .sp-market-unified-subnav { margin: 10px 14px 0; padding: 5px; border: 1px solid #62563f; border-top: 2px solid #b18a4c; border-radius: 4px;
    background: linear-gradient(180deg, rgba(31, 26, 18, .92), rgba(9, 11, 10, .96)); box-shadow: inset 0 1px rgba(255, 230, 166, .08), 0 3px 12px rgba(0, 0, 0, .2); }
  .sp-market-unified-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; gap: 4px; margin: 0; border: 0; background: transparent; }
  /* Keep the three child sections flat inside the parent navigation surface. */
  .sp-market-picker .sp-market-unified-tabs > button { min-width: 0; height: 42px; display: flex; align-items: center; justify-content: center; gap: 7px;
    padding: 0 10px; border: 1px solid transparent; border-radius: 3px; background: rgba(13, 15, 13, .58); color: #898478; font-size: 14px; box-shadow: none; isolation: isolate;
    transition: color .18s ease, background .18s ease, box-shadow .18s ease; }
  .sp-market-picker .sp-market-unified-tabs > button:hover { color: #d3c9b3; background: rgba(190, 158, 87, .07); box-shadow: none; }
  .sp-market-picker .sp-market-unified-tabs > button[aria-selected="true"] {
    color: #e0c98e; border-color: #806843; background: linear-gradient(180deg, rgba(72, 56, 31, .62), rgba(24, 19, 13, .56)); box-shadow: inset 0 -2px #c39b4d, 0 0 10px rgba(195, 155, 77, .08); }
  .sp-market-picker .sp-market-unified-tabs > button::before {
    content: ''; display: block; position: absolute; z-index: -1; inset: 1px; pointer-events: none; border: 0; border-radius: 0;
    background: radial-gradient(115px 72px at var(--button-pointer-x, 50%) var(--button-pointer-y, 50%), rgba(255, 232, 182, .2) 0%, rgba(255, 232, 182, .075) 27%, transparent 72%);
    opacity: 0; transition: opacity .18s ease;
  }
  .sp-market-picker .sp-market-unified-tabs > button:hover::before { opacity: 1; }
  .sp-market-tab-count { min-width: 20px; padding: 1px 4px; border: 1px solid #3e3b33; border-radius: 0; background: transparent; color: #746f65; font-size: 10px; line-height: 1.3; font-variant-numeric: tabular-nums; }
  .sp-market-unified-tabs > button[aria-selected="true"] .sp-market-tab-count { border-color: #5b503a; color: #c5a96f; }
  .sp-market-unified .sp-market-unified-panel[hidden] { display: none !important; }
  .sp-market-unified-panel { min-width: 0; }
  .sp-market-condition-nav { flex: none; display: flex; flex-wrap: wrap; gap: 6px; max-height: min(25vh, 132px); overflow-y: auto;
    padding: 10px 22px; border-bottom: 1px solid #62563f; background: #0e100f; scrollbar-width: thin; }
  .sp-market-condition-nav[hidden] { display: none; }
  .sp-market-picker .sp-market-condition-link { border-color: #3e3b33; border-radius: 2px; color: #aaa39a; background: transparent; font-size: 12px; }
  .sp-market-picker .sp-market-condition-link:hover { border-color: #a38d6d; color: #e0c98e; background: rgba(190, 158, 87, .07); }
  .sp-market-picker .sp-market-condition-link[aria-current="location"] { border-color: #a38d6d; color: #e0c98e;
    background: linear-gradient(180deg, rgba(52, 42, 28, .48), rgba(24, 19, 13, .3)); box-shadow: inset 0 -2px #c39b4d; }
  .sp-market-unified [data-filter-tab="conditions"] .filter-group > .filter-group-body { display: block !important; height: auto !important; max-height: none !important; visibility: visible !important; }
  .sp-market-unified [data-filter-tab="conditions"] .filter-group-header,
  .sp-market-unified [data-filter-tab="conditions"] .filter-group-header .filter-title { cursor: default; }
  .sp-market-unified > .sp-market-picker-header .sp-market-picker-title > button { flex: none; }
  .sp-market-unified .sp-market-picker-body { scroll-behavior: auto; }
  .sp-market-unified > .sp-market-picker-body:has(> [data-filter-tab="items"]:not([hidden])),
  .sp-market-unified [data-filter-tab="items"] { display: flex; flex-direction: column; }
  .sp-market-unified [data-filter-tab="items"] { flex: 1; }
  .sp-market-unified .sp-market-unified-basics { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
  .sp-market-unified [data-filter-tab="items"] > .sp-market-unified-basics { flex: 1; margin-bottom: 0; }
  .sp-market-unified .sp-market-unified-basics > .filter-group { margin: 0 !important; }
  .sp-market-unified .search-left { display: flex !important; flex-direction: column; flex: 1; min-width: 0; width: 100% !important; float: none !important; }
  .sp-market-unified-item-search { display: flex; flex-direction: column; flex: 1; gap: 10px; padding: 10px; border: 1px solid #62563f; border-radius: 3px; background: #10120f; }
  .sp-market-unified-item-search > .search-left, .sp-market-unified-item-filters { width: 100%; }
  .sp-market-unified .search-left > .sp-market-item-search { display: flex; flex-direction: column; flex: 1; }
  .sp-market-item-search > :not(.sp-market-item-results) { flex-shrink: 0; }
  .sp-market-item-results { flex: 1 1 100px; height: 100px; min-height: 100px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; padding: 8px 3px 3px; }
  .sp-market-item-selected { color: #ffe0a1; font-size: 12px; margin-top: 8px; overflow-wrap: anywhere; }
  .sp-market-item-selected:empty { display: none; }
  .sp-market-item-search .sp-market-picker-scope { display: none; }
  .sp-market-item-search .sp-market-picker-grid { grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr)); }
  .sp-market-unified .sp-market-unified-item-search .sp-market-filter-trigger { min-height: 48px; padding: 12px 14px; font-size: 14px; }
  .sp-market-unified .sp-market-unified-item-search .sp-market-unified-price .sp-market-filter-trigger { min-height: 34px; padding: 5px 10px; font-size: 13px; }
  .sp-market-unified .search-right { display: none !important; }
  .sp-market-unified .sp-market-form-enhanced .search-advanced-pane { width: 100% !important; float: none !important; padding: 0 !important; background: none !important; }
  /* Keep the official stat pane's ancestor selectors and native row styling. */
  .sp-market-unified [data-filter-tab="stats"].search-advanced-items { width: 100%; min-width: 0; margin: 0; padding: 0; }
  .sp-market-unified [data-filter-tab="stats"] > .search-advanced-pane.brown { width: 100% !important; float: none !important; }
  .sp-market-unified [data-filter-tab="stats"] .filter-group-body .filter-title-clickable { cursor: default !important; }
  .sp-market-unified [data-filter-tab="stats"] .filter-group-body .edit-btn,
  .sp-market-unified [data-filter-tab="stats"] .filter-group-body :is(.multiselect, select)[data-superpoe-stat-readonly] { display: none !important; }
  .sp-market-unified [data-filter-tab="stats"] .sp-market-stat-locked-label { cursor: default; white-space: normal; overflow-wrap: anywhere; }
  .sp-market-stat-context { padding: 12px 14px; margin-bottom: 12px; border: 1px solid #62563f; border-left: 3px solid #c39b4d;
    background: linear-gradient(110deg, #211d13, #10120f 65%); color: #c4b99f; font-family: inherit; font-size: 13px; line-height: 1.6; }
  .sp-market-stat-context-line, .sp-market-stat-candidate-context { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
  .sp-market-stat-context-line > strong, .sp-market-stat-candidate-context > span { flex: 1; min-width: min(220px, 100%); overflow-wrap: anywhere; color: #e0c98e; font-size: 14px; font-weight: 500; }
  .sp-market-stat-context-hint { margin-top: 6px; color: #aaa39a; font-size: 12px; }
  .sp-market-stat-context-warning { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 8px; padding-top: 8px; border-top: 1px solid #62563f; color: #e5b77f; }
  .sp-market-stat-context-warning > span { flex: 1; min-width: min(220px, 100%); }
  .sp-market-picker .sp-market-stat-context button, .sp-market-picker .sp-market-stat-candidate-context button { font-size: 12px; padding: 5px 10px; border-color: #806843; color: #e0c98e; background: #211d13; }
  .sp-market-picker .sp-market-stat-context button:hover, .sp-market-picker .sp-market-stat-candidate-context button:hover { border-color: #e0c98e; background: #302719; }
  .sp-market-stat-candidate-context { margin: 8px 0 12px; padding: 8px 10px; border-left: 2px solid #c39b4d; background: #211d13; }
  .sp-market-stat-outside { box-shadow: inset 2px 0 #b58d50; }
  .sp-market-stat-outside-note { display: inline-block; margin-left: 8px; color: #e5b77f; font-size: 11px; font-weight: 400; }
  .sp-market-unified [data-filter-tab="stats"] .filter-property:has(> .sp-market-stat-tier) {
    grid-template-columns: minmax(0, 1fr) 96px 68px 68px 20px auto;
  }
  .sp-market-unified [data-filter-tab="stats"] .filter:has(> .filter-body .sp-market-stat-tier) {
    display: grid !important; grid-template-columns: 42px minmax(0, 1fr) 43px; align-items: start;
  }
  .sp-market-unified [data-filter-tab="stats"] .filter:has(.sp-market-stat-tier) > .filter-body {
    display: grid !important; grid-template-columns: minmax(0, 1fr) 96px 64px 64px; align-items: center; gap: 3px;
    width: 100%; min-width: 0;
  }
  .sp-market-unified [data-filter-tab="stats"] .filter:has(.sp-market-stat-tier) > .input-group-btn { width: auto; min-height: 30px; }
  .sp-market-unified [data-filter-tab="stats"] .filter:has(.sp-market-stat-tier) > .filter-body > .sep { display: none; }
  .sp-market-unified [data-filter-tab="stats"] .filter:has(.sp-market-stat-tier) > .filter-body > .filter-title {
    display: block; width: auto; min-width: 0; white-space: normal; overflow-wrap: anywhere;
  }
  .sp-market-unified [data-filter-tab="stats"] .filter:has(.sp-market-stat-tier) > .filter-body > input.minmax {
    box-sizing: border-box; width: 100% !important; min-width: 0; float: none;
  }
  .sp-market-unified [data-filter-tab="stats"] .sp-market-stat-tier { display: contents; }
  .sp-market-unified [data-filter-tab="stats"] .sp-market-stat-tier button { width: auto; height: auto; min-height: 28px; padding: 4px 10px;
    border: 1px solid #806843; border-radius: 3px; color: #e0c98e; background: #211d13; font: inherit; font-size: 12px; line-height: 1.5; cursor: pointer; }
  .sp-market-unified [data-filter-tab="stats"] button.sp-market-stat-tier-trigger { box-sizing: border-box; width: 100%; height: 30px; min-width: 0; padding: 3px 6px; white-space: nowrap; }
  .sp-market-unified [data-filter-tab="stats"] .sp-market-stat-tier button:hover:not(:disabled),
  .sp-market-unified [data-filter-tab="stats"] .sp-market-stat-tier button[aria-pressed="true"] { border-color: #e0c98e; background: #302719; box-shadow: inset 0 0 10px #c39b4d18; }
  .sp-market-unified [data-filter-tab="stats"] .sp-market-stat-tier button:focus-visible { outline: 2px solid #ffe0a1; outline-offset: 2px; }
  .sp-market-unified [data-filter-tab="stats"] .sp-market-stat-tier button:disabled { opacity: .5; cursor: default; }
  .sp-market-stat-tier-options:not([hidden]) { display: grid; grid-column: 1 / -1; grid-row: 2; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 6px; margin-top: 7px; padding: 10px;
    border: 1px solid #62563f; background: linear-gradient(110deg, #1d1c15, #090b0c); border-radius: 3px; }
  .sp-market-stat-tier-hint { grid-column: 1 / -1; color: #aaa39a; font-size: 11px; }
  .sp-market-stat-tier-series { grid-column: 1 / -1; color: #d7c08d; border-top: 1px solid #62563f; padding-top: 8px; font-size: 12px; overflow-wrap: anywhere; }
  .sp-market-unified [data-filter-tab="stats"] button.sp-market-stat-tier-option { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; text-align: left; padding: 8px 10px; }
  .sp-market-stat-tier-option strong { color: #ffe0a1; font-size: 14px; font-variant-numeric: tabular-nums; }
  .sp-market-stat-tier-option > span { justify-self: end; font-variant-numeric: tabular-nums; }
  .sp-market-stat-tier-option small { grid-column: 1 / -1; font-size: 11px; color: #aaa39a; white-space: normal; overflow-wrap: anywhere; }
  .sp-market-unified .sp-market-form-enhanced .filter-group { margin: 0 0 12px !important; border: 1px solid #62563f !important; border-radius: 3px; background: #10120f !important; }
  .sp-market-unified [data-filter-tab="conditions"] > .search-advanced-pane.blue {
    display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 1px; column-gap: 12px; row-gap: 0; align-items: start;
  }
  .sp-market-unified [data-filter-tab="conditions"] > .search-advanced-pane.blue > .filter-group {
    grid-column: auto; grid-row-end: span var(--sp-market-condition-span, 1); min-width: 0; margin: 0 !important;
  }
  .sp-market-unified [data-filter-tab="conditions"] .filter-group:not(:has(.filter-property)) { display: none !important; }
  .sp-market-unified .sp-market-form-enhanced .filter-group-header { padding: 7px 10px; border-bottom: 1px solid #62563f; background: #211d13 !important; }
  .sp-market-unified .sp-market-form-enhanced .filter-group-header .toggle-btn { display: none !important; }
  .sp-market-unified .sp-market-form-enhanced .filter-group-header .filter-title { color: #ffe0a1 !important; }
  .sp-market-unified .sp-market-form-enhanced .filter-group > .filter-group-header {
    display: flex !important; align-items: center; position: relative; height: auto !important; min-height: 36px;
  }
  .sp-market-unified .sp-market-form-enhanced .filter-group > .filter-group-header > .filter-title {
    display: block !important; float: none !important; position: static !important; transform: none !important;
    flex: 1; width: auto !important; height: auto !important; margin: 0 !important; padding: 0 !important;
    line-height: 1.5 !important; text-align: left !important;
  }
  .sp-market-unified .sp-market-form-enhanced .filter-group-body { padding: 10px !important; }
  .sp-market-unified .sp-market-form-enhanced .filter-group-body:not([style*="display: none"]) { display: block !important; }
  .sp-market-unified .sp-market-form-enhanced .filter-property { display: flex; align-items: center; width: 100% !important; min-width: 0 !important; margin: 0 !important; padding: 5px 0 !important; float: none !important; }
  .sp-market-unified .sp-market-form-enhanced .filter-property > .filter-body { width: 100% !important; min-width: 0; display: flex !important; align-items: center; gap: 6px; }
  .sp-market-unified .sp-market-form-enhanced .filter-property .filter-title { flex: 0 0 145px; width: 145px !important; margin: 0; padding: 0 8px 0 0 !important; text-align: left !important; white-space: normal !important; font-size: 14px; line-height: 1.5; color: #c4b99f; }
  .sp-market-unified .sp-market-form-enhanced .filter-property .sep { display: none !important; }
  .sp-market-unified .sp-market-form-enhanced .filter-property .multiselect, .sp-market-unified .sp-market-form-enhanced .filter-property .sp-market-filter-host { width: auto !important; min-width: 0; flex: 1; }
  .sp-market-unified .sp-market-unified-price .filter-property .multiselect,
  .sp-market-unified .sp-market-unified-price .filter-property .sp-market-filter-host { width: 200px !important; max-width: 100%; flex: 0 1 200px; }
  .sp-market-unified .sp-market-form-enhanced .filter-property input.minmax { width: 90px !important; min-width: 0; flex: 0 1 90px; }
  .sp-market-unified .sp-market-form-enhanced .filter-property input.text { width: auto !important; min-width: 0; flex: 1; }
  .sp-market-unified-item-filters { display: flex; flex-direction: column; flex-shrink: 0; }
  .sp-market-unified-item-filters > .sp-market-unified-price { order: 2; width: 100%; }
  .sp-market-unified-item-details { display: flex; flex-wrap: wrap; align-items: center; gap: 0 16px; order: 1; }
  .sp-market-unified .sp-market-unified-item-details > .filter-property { width: auto !important; flex: 1 1 210px; }
  .sp-market-unified .sp-market-unified-item-details > .filter-property:has(.sp-market-filter-host) { flex: 2 1 460px; }
  .sp-market-unified .sp-market-unified-item-details > .filter-property:has(input.minmax) .filter-title { flex: 0 0 70px; width: 70px !important; }
  .sp-market-unified .sp-market-unified-item-details input.minmax { width: 60px !important; flex: 1 1 60px; }
  .sp-market-unified .sp-market-form-enhanced input.form-control { box-sizing: border-box; border: 1px solid #62563f; color: #e7dfca; background: #090b0c; border-radius: 3px; min-height: 34px; }
  .sp-market-unified .sp-market-form-enhanced .multiselect__content-wrapper { z-index: 30; }
  @media (max-width: 960px) {
    .sp-market-unified [data-filter-tab="conditions"] > .search-advanced-pane.blue { grid-template-columns: minmax(0, 1fr); grid-auto-rows: auto; row-gap: 12px; }
    .sp-market-unified [data-filter-tab="conditions"] > .search-advanced-pane.blue > .filter-group { grid-row-end: auto; }
  }
  @media (max-width: 700px) {
    .sp-market-unified .sp-market-form-enhanced .filter-property { flex-wrap: wrap; gap: 6px; }
    .sp-market-unified .sp-market-form-enhanced .filter-property > .filter-body { flex-wrap: wrap; }
    .sp-market-unified .sp-market-form-enhanced .filter-property .filter-title { flex-basis: 100%; width: 100% !important; }
    .sp-market-unified .sp-market-form-enhanced .filter-group > .filter-group-header { flex-wrap: wrap; gap: 6px; }
    .sp-market-unified-toolbar > span { display: none; }
  }
  .sp-market-unified [data-superpoe-picker-managed="true"],
  .sp-market-unified [data-superpoe-picker-pending="true"],
  .sp-market-unified .multiselect:has(+ .sp-market-filter-host),
  .sp-market-unified .sp-market-filter-managed { display: none !important; pointer-events: none !important; }
  .sp-market-filter-host { display: none; box-sizing: border-box; width: 100%; min-width: 0; }
  .sp-market-unified .sp-market-filter-host { display: block; }
  .sp-market-filter-host button, .sp-market-picker button:where(.sp-market-control), .sp-market-picker-search, .sp-market-item-query {
    box-sizing: border-box; font-family: inherit; text-transform: none; letter-spacing: normal;
  }
  .sp-market-filter-host button, .sp-market-picker button:where(.sp-market-control) {
    color: #d7c08d; border: 1px solid #62563f; border-radius: 3px;
    background: linear-gradient(180deg, #20211b, #10120f); cursor: pointer;
    font-size: 13px; line-height: 1.4; min-height: 30px; margin: 0; padding: 5px 10px;
  }
  .sp-market-filter-host button:hover, .sp-market-picker button:where(.sp-market-control):hover { border-color: #d0a85d; color: #ffe0a1; }
  .sp-market-filter-host button:focus-visible, .sp-market-picker button:where(.sp-market-control):focus-visible, .sp-market-picker-search:focus-visible, .sp-market-item-query:focus-visible {
    outline: 2px solid #ffe0a1; outline-offset: 2px;
  }
  .sp-market-filter-host button:disabled, .sp-market-picker button:where(.sp-market-control):disabled { cursor: default; opacity: .55; }
  .sp-market-filter-options { display: flex; flex-wrap: wrap; gap: 4px; padding: 3px 0; }
  .sp-market-filter-options button[aria-checked="true"], .sp-market-picker button:where(.sp-market-control)[aria-pressed="true"] {
    color: #ffe0a1; border-color: #d0a85d; background: linear-gradient(110deg, #49391f, #211d13);
    box-shadow: inset 0 -2px #d0a85d;
  }
  .sp-market-filter-host .sp-market-filter-trigger { width: 100%; display: flex; gap: 8px; justify-content: space-between; text-align: left; }
  .sp-market-filter-trigger span { white-space: normal; overflow-wrap: anywhere; }
  .sp-market-filter-host .sp-market-filter-native, .sp-market-picker .sp-market-filter-native {
    min-height: 22px; padding: 2px 5px; font-size: 11px; color: #aaa39a; background: transparent; border-color: transparent;
  }
  .sp-market-filter-error { display: block; color: #e7a596; font: 12px/1.5 inherit; margin-top: 4px; }
  @keyframes sp-market-filter-breathe {
    0%, 100% { box-shadow: 0 0 0 rgba(211, 164, 74, 0), inset 0 1px rgba(255, 235, 178, .12); }
    50% { box-shadow: 0 0 14px rgba(211, 164, 74, .2), inset 0 1px rgba(255, 235, 178, .2); }
  }
  @keyframes sp-market-filter-sheen {
    0%, 38% { background-position: 100% 0, 0 0; }
    52% { background-position: 0 0, 0 0; }
    68%, 100% { background-position: -100% 0, 0 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .sp-market-unified-entry-group,
    .sp-market-unified-entry-group > .sp-market-unified-shortcuts > .sp-market-unified-shortcut { animation: none; }
    .sp-market-unified-toolbar .sp-market-unified-open { animation: none; }
  }
  dialog.sp-market-picker {
    position: fixed; inset: 0;
    box-sizing: border-box; width: min(1040px, calc(100vw - 32px)); max-width: calc(100vw - 32px);
    height: min(760px, 84vh); max-height: 84vh; padding: 0; margin: auto;
    border: 1px solid #a38d6d; border-top: 2px solid #d0a85d; border-radius: 5px;
    color: #e7dfca; background: linear-gradient(160deg, #1d1c15, #090b0c 60%);
    font: 14px/1.5 Arial, 'Microsoft YaHei', sans-serif;
    box-shadow: 0 20px 90px #000b, 0 0 28px #d0a85d22; overflow: hidden;
  }
  dialog.sp-market-picker[open] { display: flex; flex-direction: column; }
  dialog.sp-market-picker::backdrop { background: #030504cc; }
  .sp-market-picker-header { flex: none; padding: 18px 22px 12px; border-bottom: 1px solid #62563f; }
  .sp-market-picker-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .sp-market-picker-title h2 { font: 600 20px/1.4 Georgia, 'Microsoft YaHei', serif; color: #ffe0a1; margin: 0 0 10px; }
  .sp-market-picker-search, .sp-market-item-query { display: block; width: 100%; min-height: 40px; padding: 8px 12px; margin: 0;
    border: 1px solid #62563f; border-radius: 3px; color: #e7dfca; background: #090b0c; font-size: 14px; }
  .sp-market-item-query-field {
    position: relative; isolation: isolate; overflow: hidden; border: 1px solid #c59b50; border-radius: 5px;
    background: linear-gradient(110deg, #302719, #121511 65%);
    box-shadow: inset 0 1px #ffe0a11a, 0 0 14px #d0a85d1c;
    transition: border-color .2s ease, box-shadow .25s ease;
    animation: sp-market-search-glow 3s ease-in-out infinite;
  }
  .sp-market-item-query-field::before {
    content: ''; position: absolute; pointer-events: none; z-index: -1; inset: 0 auto 0 0; width: 40%;
    background: linear-gradient(105deg, transparent 5%, #d0a85d18 30%, #ffe0a14d 50%, #d0a85d18 70%, transparent 95%);
    animation: sp-market-search-shimmer 3s ease-in-out infinite;
  }
  .sp-market-item-query-field::after {
    content: ''; position: absolute; pointer-events: none; left: 0; bottom: 0; width: 40%; height: 3px;
    background: linear-gradient(90deg, transparent, #fff0cb, #e4b85d, transparent);
    filter: drop-shadow(0 0 5px #ffd47a);
    animation: sp-market-search-shimmer 3s ease-in-out infinite;
  }
  .sp-market-picker .sp-market-item-query {
    min-height: 56px; padding: 15px 16px 15px 48px; border: 0; border-radius: 4px;
    background: transparent; color: #fff0cb; font-size: 15px; caret-color: #ffe0a1;
  }
  .sp-market-item-query::placeholder { color: #d5c39c; opacity: 1; }
  .sp-market-item-query-field:hover { border-color: #ffe0a1; box-shadow: inset 0 1px #ffe0a126, 0 0 18px #d0a85d30; }
  .sp-market-item-query-field:focus-within {
    animation: none; border-color: #ffe0a1; box-shadow: 0 0 0 2px #d0a85d40, 0 0 24px #d0a85d38, inset 0 0 16px #d0a85d0d;
  }
  .sp-market-picker .sp-market-item-query:focus-visible { outline: none; }
  .sp-market-item-query-field:focus-within::before { animation: none; opacity: 0; }
  .sp-market-item-query-field:focus-within::after { animation: none; width: 100%; opacity: .65; }
  .sp-market-item-query-icon { position: absolute; pointer-events: none; left: 18px; top: 50%; width: 18px; height: 18px; transform: translateY(-50%); color: #d0a85d; transition: color .2s ease; }
  .sp-market-item-query-icon::before { content: ''; position: absolute; left: 0; top: 0; width: 12px; height: 12px; border: 2px solid currentColor; border-radius: 50%; }
  .sp-market-item-query-icon::after { content: ''; position: absolute; left: 11px; top: 13px; width: 7px; height: 2px; background: currentColor; transform: rotate(45deg); border-radius: 1px; }
  .sp-market-item-query-field:focus-within .sp-market-item-query-icon { color: #ffe0a1; }
  @keyframes sp-market-search-shimmer {
    0% { transform: translateX(-110%); opacity: 0; }
    12%, 68% { opacity: 1; }
    85%, 100% { transform: translateX(275%); opacity: 0; }
  }
  @keyframes sp-market-search-glow {
    0%, 100% { border-color: #bc9149; box-shadow: inset 0 1px #ffe0a126, 0 0 12px #d0a85d26; }
    50% { border-color: #ffe0a1; box-shadow: inset 0 0 18px #d0a85d24, 0 0 0 1px #d0a85d55, 0 0 25px #d0a85d66; }
  }
  @media (prefers-reduced-motion: reduce) {
    .sp-market-picker .sp-market-unified-tabs > button, .sp-market-picker .sp-market-unified-tabs > button::before { transition: none; }
    .sp-market-item-query-field, .sp-market-item-query-field::before { animation: none; }
    .sp-market-item-query-field::before { opacity: 0; }
    .sp-market-item-query-field::after { animation: none; width: 100%; opacity: .4; }
    .sp-market-item-query-field, .sp-market-item-query-icon { transition: none; }
  }
  .sp-market-picker-groups { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; max-height: 90px; overflow: auto; }
  .sp-market-picker-body { flex: 1; min-height: 0; padding: 16px 22px; overflow-y: auto; overscroll-behavior: contain; }
  .sp-market-picker-count { color: #aaa39a; font-size: 12px; margin-bottom: 10px; }
  .sp-market-item-count { margin: 10px 0 0; padding-bottom: 6px; border-bottom: 1px solid #62563f; }
  .sp-market-item-count:empty { display: none; }
  .sp-market-picker-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(250px, 100%), 1fr)); gap: 9px; }
  .sp-market-stat-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
  .sp-market-stat-section { min-width: 0; }
  .sp-market-stat-section > h3 { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; padding: 9px 0;
    border-top: 1px solid #62563f; border-bottom: 1px solid #3e3b33; color: #e0c98e; font-family: inherit; font-size: 15px; font-weight: 500; line-height: 1.5; }
  .sp-market-stat-section-count { margin-left: auto; color: #aaa39a; font-size: 12px; font-variant-numeric: tabular-nums; }
  .sp-market-stat-section[data-affix="other"] { grid-column: 1 / -1; }
  .sp-market-stat-section:not([data-affix="other"]) > .sp-market-picker-grid { grid-template-columns: minmax(0, 1fr); }
  .sp-market-picker-grid :is(.sp-market-picker-option, .sp-market-item-option) { position: relative; text-align: left; padding: 12px 13px; min-height: 74px;
    white-space: normal; overflow-wrap: anywhere; display: flex; flex-direction: column; align-items: stretch; justify-content: center; gap: 5px; }
  .sp-market-picker-grid .sp-market-item-option {
    isolation: isolate; overflow: hidden; border-color: #8c7144;
    background: linear-gradient(120deg, #362b1b, #171914 48%, #10120f);
    box-shadow: inset 0 1px #ffe0a126, inset 0 -1px #b98c3626;
    transition: border-color .2s ease, box-shadow .2s ease, transform .2s ease;
  }
  dialog.sp-market-picker .sp-market-control.sp-market-item-option::before {
    display: block;
    content: ''; position: absolute; z-index: -1; pointer-events: none; inset: 0 auto 0 0; width: 55%;
    background: linear-gradient(110deg, transparent, #d0a85d22 30%, #ffe0a14d 50%, #d0a85d22 70%, transparent);
    transform: translateX(-110%); opacity: 0;
  }
  .sp-market-picker-grid .sp-market-item-option:not(:disabled):is(:hover, :focus-visible) {
    border-color: #ffe0a1; transform: translateY(-2px);
    box-shadow: inset 0 1px #fff0cb66, inset 0 0 22px #d0a85d20, 0 3px 12px #0008, 0 0 12px #d0a85d44;
  }
  .sp-market-item-option:not(:disabled):is(:hover, :focus-visible)::before { animation: sp-market-item-gild .75s ease-out both; }
  .sp-market-picker-grid .sp-market-item-option[aria-pressed="true"] {
    border-color: #e4b85d; background: linear-gradient(110deg, #514020, #282216 55%, #151710);
    box-shadow: inset 3px 0 #e4b85d, inset 0 0 20px #d0a85d16, 0 0 10px #d0a85d22;
  }
  .sp-market-picker-grid .sp-market-item-option:not(:disabled):active {
    transform: translateY(0) scale(.99); border-color: #fff0cb; box-shadow: inset 0 0 24px #d0a85d40;
  }
  @keyframes sp-market-item-gild {
    0% { transform: translateX(-110%); opacity: 0; }
    18%, 70% { opacity: 1; }
    100% { transform: translateX(200%); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .sp-market-picker-grid .sp-market-item-option { transition: none; }
    .sp-market-item-option:not(:disabled):is(:hover, :focus-visible)::before { animation: none; }
    .sp-market-picker-grid .sp-market-item-option:not(:disabled):is(:hover, :focus-visible, :active) { transform: none; }
  }
  :is(.sp-market-picker-option, .sp-market-item-option) strong { font-size: 14px; font-weight: 500; color: inherit; }
  :is(.sp-market-picker-option, .sp-market-item-option)[data-rarity="base"] strong, :is(.sp-market-picker-option, .sp-market-item-option)[data-rarity="normal"] strong { color: #e8e5de; }
  :is(.sp-market-picker-option, .sp-market-item-option)[data-rarity="magic"] strong { color: #8888ff; }
  :is(.sp-market-picker-option, .sp-market-item-option)[data-rarity="rare"] strong { color: #ffff77; }
  :is(.sp-market-picker-option, .sp-market-item-option)[data-rarity="unique"] strong { color: #d98b45; }
  .sp-market-picker-scope { color: #c4b99f; font-size: 12px; margin-top: 10px; }
  :is(.sp-market-picker-option, .sp-market-item-option) small { color: #aaa39a; font-size: 11px; white-space: normal; }
  :is(.sp-market-picker-option, .sp-market-item-option)[aria-pressed="true"] small { color: #d0a85d; }
  .sp-market-picker-option[aria-pressed="true"]:disabled { opacity: 1; }
  .sp-market-picker-more, .sp-market-item-more { display: block; width: 100%; margin-top: 14px !important; }
  .sp-market-picker-footer { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
    padding: 12px 22px; border-top: 1px solid #62563f; background: #10120f; }
  .sp-market-picker-footer .sp-market-picker-status { flex: 1; color: #aaa39a; min-width: 120px; }
  .sp-market-picker-footer .sp-market-picker-done { border-color: #d0a85d; padding: 7px 24px; color: #ffe0a1; }
  .sp-market-picker-notice { color: #e7a596; padding: 10px 0; }
  .sp-market-picker-grid:empty { display: none; }
  @media (max-width: 540px) {
    .sp-market-unified-toolbar { --sp-market-entry-width: 112px; --sp-market-entry-height: 40px; }
    .sp-market-unified-entry-group > .sp-market-unified-shortcuts { grid-template-columns: repeat(3, minmax(0, var(--sp-market-entry-width))); }
    .sp-market-unified-toolbar .sp-market-unified-shortcut { padding-left: 8px; padding-right: 8px; }
    .sp-market-stat-columns { grid-template-columns: minmax(0, 1fr); }
    .sp-market-picker .sp-market-unified-tabs > button { flex: 1; min-width: 0; gap: 4px; padding: 0 6px; font-size: 13px; }
    .sp-market-picker-header, .sp-market-picker-body, .sp-market-picker-footer, .sp-market-condition-nav { padding-left: 12px; padding-right: 12px; }
    dialog.sp-market-picker { width: calc(100vw - 16px); max-width: calc(100vw - 16px); max-height: 92vh; height: 92vh; }
    .sp-market-picker-grid { grid-template-columns: 1fr; }
  }
`
