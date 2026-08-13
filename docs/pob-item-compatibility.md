# PoB Item 兼容规则

> 状态：已实施，按真实 WeGame 导入样本维护
> 更新日期：2026-08-13

本文记录国服 WeGame 构筑导出中已经确认、且会影响 PoB2 解析或计算的 7 类装备词条。它是装备兼容层的维护清单，不是新的装备数据源，也不替代 PoB2 上游定义。

## 1. 规则清单

| 编号 | WeGame 原始格式 | 导入规范化格式 | PoB 语义 | 处理方式 |
| --- | --- | --- | --- | --- |
| 1 | `Fire Resistance is +X%` | `+X% to Fire Resistance` | `FireResist / BASE` | Item Raw 规范化 |
| 2 | `Cold Resistance is +X%` | `+X% to Cold Resistance` | `ColdResist / BASE` | Item Raw 规范化 |
| 3 | `Lightning Resistance is +X%` | `+X% to Lightning Resistance` | `LightningResist / BASE` | Item Raw 规范化 |
| 4 | `Chaos Resistance is +X%` | `+X% to Chaos Resistance` | `ChaosResist / BASE` | Item Raw 规范化 |
| 5 | `+X to maximum Runic Ward` | `+X to maximum Ward` | `Ward / BASE` | Item Raw 规范化 |
| 6 | `X% increased Runic Ward` | `X% increased Ward` | `Ward / INC` | Item Raw 规范化 |
| 7 | `X% increased Effect of Prefixes` | 保留原文 | `LocalPrefixEffect / INC` | 项目自有 Lua bridge 解析 |

其中 `X` 可以是整数、小数或带正负号的数值；已有的 `{crafted}`、`{rune}`、`{enchant}`、`{fractured}`、`{desecrated}` 等 marker 必须原样保留。第 7 条不能改写成一个新的用户可见词条，必须由 bridge 生成 PoB modifier，才能参与前缀效果计算。

## 2. 来源和问题背景

PoB2 的 Item Raw 通常使用标准 modifier 文本。部分国服 WeGame 导出把四种抗性写成 `Resistance is` 句式，并把 Runic Ward 写成不被当前解析入口稳定识别的旧句式。`Effect of Prefixes` 在数据目录中有贸易和描述定义，但通用 Item modifier parser 没有直接的泛化入口。

兼容层只处理已确认的 WeGame 输入差异：

- PoB Code、WeGame 转换结果和原生构筑打开最终都进入同一个 Item 兼容入口。
- 兼容层属于 SuperPoE2 自有代码，不修改 `upstreams/PathOfBuilding-PoE2/`，也不直接修改生成的 `public/pob-lua/` 上游资源。
- PoB Lua 仍负责最终 Item、人物属性和技能计算；TypeScript 不根据最终数值反推词条。

## 3. 处理边界

### 3.1 只处理 Item Raw

`normalizePobBuildXml()` 只扫描 `<Item>` 元素的文本。Build 属性、Tree、Skills、Config、描述文本和其它 XML 节点中的相同字符串不得被替换。Item 原始换行和 marker 也必须保留，避免导入后产生与兼容规则无关的 Code 差异。

### 3.2 计算和显示共用同一边界

构筑加载时先把规范化后的 Item Raw 放入 `PobBuildObject`。装备显示、保存、导出和 Lua 计算都从这个对象的最新 XML snapshot 读取。第 7 条由浏览器 Wasmoon bridge 和 LuaJIT sidecar bridge 使用相同的 `LocalPrefixEffect / INC` 语义解析。

### 3.3 幂等和无损

规范化必须幂等：同一份输入重复处理不能继续改变文本。只允许改变表中的 6 类文本格式；第 7 条保持 Raw 原文。未触及的 XML 属性、节点顺序、Item ID、ItemSet 引用和其它未知字段必须原样保留。

## 4. 历史 BD 和 Provider 更新

已导入的旧 BD 不会被后台静默改写。用户执行 WeGame 或 `poe.ninja` Provider 更新时，比较器会先按兼容规则比较；如果远程 Code 业务内容没有变化，但本地旧 Code 仍包含可迁移的 7 类输入，更新对话框会把“兼容迁移”作为待确认变更。用户确认后才保存规范化后的构筑。

PoB Code 静态来源没有在线 Provider 更新能力。用户重新导入或明确保存时，会经过同一规范化入口。

## 5. 维护和验证

新增规则前必须提供：

1. 游戏或 WeGame 的完整 Item Raw 样本。
2. PoB2 原版可识别的目标语义或 Lua modifier 名称。
3. 说明该规则影响显示、计算还是两者。
4. 至少一个正例、一个带 marker 的正例和一个不应匹配的相似文本。

当前自动验证位于 `src/engine/pobItemCompatibility.test.ts`，覆盖 7 条规则、marker、换行、只改 Item、幂等和 PoB Code 往返。涉及 Lua 语义的变更还必须运行 `pobLuaRuntime` 测试和 native sidecar smoke test。

### 规则记录模板

```text
ID：
来源：WeGame / PoB Code / 其它
原始 Item Raw：
规范化 Item Raw：
PoB modifier：
是否保留原文：
marker/多行/范围值注意事项：
验证样本和结果：
```

## 6. 相关文档

- [`pob-build-object-design.md`](./pob-build-object-design.md)：对象生命周期、XML authority 和 Lua 边界。
- [`pob-lua-runtime.md`](./pob-lua-runtime.md)：浏览器 fallback、LuaJIT sidecar 和上游资源约束。
- [`TASKS.md`](./TASKS.md)：当前任务和兼容规则维护入口。
