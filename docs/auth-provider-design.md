# SuperPoE 多登录提供商设计

> 状态：认证后端 Phase A 与 Electron 用户名/密码登录 UI 已实现；微信/QQ OAuth 和业务云同步待后续接入
> 更新日期：2026-09-03
> 适用项目：`D:\sources\superpoe`

## 1. 目标与边界

SuperPoE 后续支持用户名/密码、微信和 QQ 登录。用户名/密码是 SuperPoE 自己的本地凭据，微信和 QQ 是外部身份提供商；三者都登录同一个 SuperPoE 账号，后续可为云同步、跨设备构筑和用户收藏提供身份基础。

本方案不替换当前的 PoE 交易站登录。两类登录的用途和凭据完全不同：

| 登录类型 | 用途 | 凭据归属 |
| --- | --- | --- |
| SuperPoE 账号登录 | 账号、云同步、跨设备数据 | SuperPoE 认证后端会话 |
| 交易中心登录 | 官方集市、Search/Fetch、国服交易请求 | PoE 官方站的 `POESESSID` |

微信或 QQ 登录不能生成、替代或刷新 `POESESSID`，也不能绕过国服 QQ/WeGame 或国际服官方站登录。

当前 Electron 桌面版启动时要求先完成 SuperPoE 账号登录；登录只负责账号会话，构筑、Lua 计算、装备仓库和其他业务数据仍保存在本机，不会自动上传。

## 2. 官方依据

- [微信网站应用登录开发指南](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)
- [微信网站应用审核规范](https://developers.weixin.qq.com/doc/oplatform/Website_App/operation.html)
- [微信网站应用申请流程](https://developers.weixin.qq.com/doc/oplatform/Website_App/guide/apply.html)
- [QQ 互联网站应用接入流程](https://wiki.connect.qq.com/%e7%bd%91%e7%ab%99%e5%ba%94%e7%94%a8%e6%8e%a5%e5%85%a5%e6%b5%81%e7%a8%8b)

官方平台、应用审核条件和接口细节可能变化。正式上线前必须以微信开放平台和 QQ 互联控制台当前要求为准，不能把历史文档中的主体、类目或接口限制当成永久规则。

## 3. 共同 OAuth 模型

微信网站应用和 QQ 互联网站应用都采用授权码模式，核心流程统一为：

```text
Electron 主进程
    -> SuperPoE 认证后端创建登录尝试
    <- 授权地址和短期 attempt 标识
系统浏览器 / 微信客户端 / QQ 客户端
    -> provider 授权
provider
    -> SuperPoE HTTPS callback，携带 code 和 state
认证后端
    -> 使用服务端密钥兑换 provider token
    -> 获取 provider subject 和可选用户资料
    -> 建立或查找 SuperPoE 用户
Electron 主进程
    -> 轮询一次性结果
    -> 交换 SuperPoE 应用会话
Renderer
    -> 只读取登录状态和用户摘要
```

`code` 只能使用一次并且短期有效。后端必须验证 `state`、attempt 归属、有效期和一次性消费状态，不能只凭回调中的 `code` 登录。

### 3.1 微信

- 授权范围使用网站应用要求的 `snsapi_login`。
- 需要审核通过的网站应用、`AppID`、`AppSecret`、授权域名和 HTTPS 回调地址。
- 后端使用 `AppSecret + code` 换取微信 access token，再取得 `openid`、可用时的 `unionid` 和用户资料。

### 3.2 QQ

- 需要在 QQ 互联创建并审核网站应用，获得 `App ID` 和应用密钥。
- 授权、换 token、获取 `openid` 和用户资料由 QQ 互联接口完成。
- QQ 身份模型不能假设一定存在微信意义上的 `unionid`，第一身份键应使用 QQ 应用范围内的 `openid`。
- 历史 QQ 接口的用户标识响应可能带有 JSONP 外壳；后端必须按固定格式解析，禁止执行返回内容。

用户名/密码、微信和 QQ 的身份解析逻辑只应存在于认证后端，不能散落到 Electron renderer 或业务模块。

### 3.3 用户名/密码

用户名/密码不经过微信或 QQ，直接由 SuperPoE 认证后端校验：

```text
Electron 主进程 -> HTTPS /api/auth/password/login
认证后端       -> 查询规范化用户名
认证后端       -> 使用 Argon2id 校验密码哈希
认证后端       -> 创建 SuperPoE 应用会话
```

密码登录和 OAuth 登录最终都只产生 `user_id` 和 SuperPoE 会话。密码凭据必须与 `oauth_identities` 分表保存，以便以后绑定或解绑 QQ/微信而不改变密码账号。

## 4. 部署架构

现有服务器可以承载认证后端，不需要新增 Web 服务器：

```text
Nginx :80/:443
    |- 官网静态文件
    `- /api/auth/* -> 127.0.0.1:8787 superpoe-server (Go/Gin)
                              |
                              `-> MySQL 8.0+
```

- 80 端口继续重定向到 HTTPS。
- Go 认证服务只监听 `127.0.0.1:8787`，不直接暴露公网；HTTP API 使用 Gin，底层仍基于标准 `net/http`。
- 微信和 QQ 的回调都使用同一个 HTTPS 认证域名下的 provider-specific 路径。
- MySQL 使用 InnoDB、`utf8mb4` 和 UTC 时间；数据库迁移必须纳入 Go 服务的发布流程。
- 2C2G 服务器第一阶段可以运行 Nginx、一个 Go 进程和 MySQL；不引入 Redis。并发增加后再考虑托管 MySQL 或增加 Redis 做短期状态和限流。
- `AppSecret`、QQ 应用密钥、数据库密码和会话签名密钥通过服务器环境变量或密钥管理服务注入，绝不进入仓库、前端包或 Electron 安装包。

建议的 Go 服务边界如下，具体路由库不影响协议：

```text
backend/superpoe-server/
├─ go.mod
├─ cmd/superpoe-server/main.go
├─ migrations/              # MySQL schema migrations
└─ internal/
   ├─ auth/                 # 注册、登录、会话、账号绑定
   ├─ provider/             # wechat.go、qq.go、provider.go
   ├─ store/                # MySQL queries、事务和迁移
   └─ httpapi/              # Gin Handler、校验、错误处理
```

`superpoe-server` 与现有 TypeScript `server/` 计算/对照路径分开部署；不要为了加账号登录把本地 PoB 计算服务改成公网 API。

迁移定义随 `superpoe-server` 一起版本化，并通过 Go `embed.FS` 编译进二进制。部署人员不需要在服务器手工维护 SQL：

```text
superpoe-server migrate
superpoe-server serve
```

生产启动前只执行一次待处理迁移，并使用 MySQL migration lock 防止并发执行；已执行的迁移不可修改，危险删除必须先备份。

## 5. 后端接口

建议统一接口，provider 只作为参数：

```text
POST /api/auth/{provider}/start
GET  /api/auth/{provider}/callback
POST /api/auth/register
POST /api/auth/password/login
POST /api/auth/password/change
POST /api/auth/password/reset/request
POST /api/auth/password/reset/confirm
POST /api/auth/session/poll
POST /api/auth/session/exchange
POST /api/auth/session/refresh
POST /api/auth/logout
GET  /api/auth/me
```

`provider` 初期允许值为 `wechat` 和 `qq`，未知值必须返回稳定错误，不得拼接任意 URL。密码登录使用独立接口，不把密码伪装成 OAuth provider。

### 5.1 用户名/密码注册与登录

认证后端 Phase A 当前已提供以下路由：

```text
POST /api/auth/register
POST /api/auth/password/login
POST /api/auth/email/verify                 # legacy optional
POST /api/auth/email/verification/resend   # legacy optional
POST /api/auth/password/reset/request
POST /api/auth/password/reset/confirm
POST /api/auth/session/refresh
GET  /api/auth/me
POST /api/auth/password/change
POST /api/auth/logout
POST /api/auth/logout-all
```

Electron 主窗口已接入注册、密码登录、`/api/auth/me`、会话刷新、修改密码和退出登录；未恢复到有效会话前不会挂载构筑工作区。

密码找回由应用内完成：请求接口只返回统一的 `202` 响应，并向注册邮箱发送
一次性 6 位验证码；确认接口接收 `email`、`code` 和 `new_password`。验证码默认
20 分钟有效，最多允许 5 次错误尝试，重新发送会使之前的验证码失效。旧版本的
邮件链接确认接口仅作为兼容路径保留。

- 用户名使用单独的规范化字段；建议首版只允许 3-32 个 ASCII 字母、数字、下划线和短横线，比较时统一小写。
- 密码长度至少 12 个字符，后端拒绝常见密码和明显重复输入；不限制复杂度到容易被绕过的固定字符组合。
- 密码只通过 HTTPS 提交到 Go 后端，服务端不记录请求体、密码或完整认证错误。
- 登录失败统一返回“用户名或密码错误”，不暴露用户是否存在；按 IP、用户名和设备维度做渐进式限流。
- 新用户可先设置用户名/密码，再在已登录状态下显式绑定微信或 QQ；OAuth 新用户也可以登录后补设用户名/密码。

密码找回使用注册时填写的恢复邮箱；验证码本身证明用户当前可以访问该邮箱。
如果用户注册时填写了错误地址，将无法通过自助流程找回密码，不能用客服手工改库作为默认流程。

### 5.2 start

Electron 主进程请求 start，后端生成：

- 高熵随机 `attemptId`；
- 只保存在服务端或以哈希保存的 `state`；
- 过期时间，例如 5 分钟；
- provider 授权 URL。

返回值不得包含 `AppSecret`、provider access token 或长期应用 token。

### 5.3 callback

callback 只由后端接收：

1. 校验 provider、`state`、attempt 状态和过期时间；
2. 使用对应 provider 的服务端密钥兑换 code；
3. 获取稳定的 provider subject；
4. 创建或读取 `oauth_identities`；
5. 生成一次性短票据；
6. 标记 attempt 已消费。

短票据只能被发起该 attempt 的 Electron 客户端消费，不能把长期 access/refresh token 放在回调 URL 或网页标题中。

### 5.4 poll / exchange

Electron 主进程使用一次性 attempt 凭据轮询。成功后通过 exchange 获取 SuperPoE 应用会话，服务端立即使一次性票据失效。

轮询应有固定间隔、超时和限流；失败状态需要区分用户拒绝、provider 错误、超时和服务端错误。

## 6. 数据库模型

正式环境使用 MySQL 8.0+。初期不需要 Redis，登录尝试、密码重置和会话可以直接使用带索引和过期时间的表。

```text
users
- id
- username_normalized       # nullable，注册密码账号时唯一
- display_name
- created_at
- updated_at

password_credentials
- user_id                   # primary key / foreign key users.id
- password_hash             # Argon2id PHC string，不保存明文
- password_changed_at
- failed_attempts
- locked_until              # nullable，短期渐进限制
- created_at
- updated_at

oauth_identities
- id
- user_id
- provider                 # wechat / qq
- app_id
- provider_subject         # 微信 openid 或 QQ openid
- union_id                 # nullable，不能假设 QQ 一定有
- nickname
- avatar_url
- created_at
- updated_at

auth_attempts
- id
- provider
- state_hash
- client_nonce_hash
- status                   # pending / completed / expired / consumed / failed
- result_ticket_hash
- expires_at
- consumed_at
- created_at

auth_sessions
- id
- user_id
- refresh_token_hash
- device_id
- created_at
- expires_at
- revoked_at
- last_used_at

auth_session_refresh_tokens
- session_id
- token_hash              # each issued refresh hash, consumed_at is set on rotation
- issued_at
- expires_at
- consumed_at

password_reset_tokens
- id
- user_id
- token_hash                 # 6 位验证码的 SHA-256 哈希，不保存明文
- expires_at
- consumed_at
- attempt_count              # 错误次数，达到 5 次后失效
- created_at
```

约束：

- `users.username_normalized` 在非空时唯一；
- `oauth_identities` 唯一键为 `(provider, app_id, provider_subject)`；
- `users` 与 provider 身份是一对多关系，一个 SuperPoE 用户以后可以显式绑定微信和 QQ；
- `password_credentials.user_id` 与 `users.id` 一对一；没有密码的 OAuth 用户可以后续主动设置密码；
- 不使用昵称、头像、QQ 号码或猜测出的手机号自动合并账号；
- 账号绑定必须要求当前已登录用户再次确认并完成新 provider 授权；
- refresh token 只保存哈希，access token 尽量只存在内存或短生命周期会话中。
- refresh token 每次轮换都会把旧哈希标记为已消费；再次提交已消费哈希会撤销对应会话，防止被窃取令牌静默继续使用。

### 6.1 密码存储与抗攻击

- 使用 Argon2id（PHC 字符串格式，随机 salt）；禁止明文、可逆加密、MD5、SHA-1、SHA-256 直存或低成本快速哈希。
- 可从 `memory=64 MiB`、`iterations=3`、`parallelism=2`、`salt=16 bytes`、`key=32 bytes` 起步，在 2C2G 服务器上基准测试后固定，并在 PHC 字符串中保留算法参数。
- 2C2G 服务器应限制 Argon2id 校验并发，避免攻击者通过大量登录请求耗尽内存；参数升级时只在用户下一次成功登录后重新哈希。
- 登录接口由 Nginx 和 Go 服务共同限流；短期失败可以渐进延迟或暂时锁定，不做永久账号锁死。
- 密码重置验证码只保存哈希、短期有效且只能消费一次；每个用户只保留最新的未消费验证码，错误 5 次后失效；密码修改和重置后撤销该用户的其他 refresh sessions。
- Go 数据库访问统一使用参数化查询或经过验证的 query builder，禁止拼接用户名和 provider 参数。
- refresh token 采用高熵随机不透明值、轮换和重放检测；数据库只保存哈希，旧 token 使用后立即失效。
- MySQL 用户名唯一性使用 `username_normalized`，首版限制为 ASCII 规则并使用二进制比较，避免大小写和 Unicode 同形字符造成重复账号。

## 7. Electron 安全边界

认证边界由 renderer 的页面/API 客户端与 Electron 主进程的安全存储桥接共同负责：

- renderer 发起用户名/密码登录和注册 HTTPS 请求；
- 发起微信/QQ 登录；
- 打开系统浏览器或受限认证窗口；
- 轮询 attempt；
- 交换、刷新和撤销 SuperPoE 会话；
- 主进程使用 Electron `safeStorage` 保存完整会话摘要的加密副本（访问令牌、刷新令牌、过期时间和用户概要）；Linux 无系统密钥环时只保留本次运行的内存会话。

密码仅在登录/注册请求的短生命周期内经过主进程内存，不写入日志、崩溃报告或本地配置。Renderer 不保存密码，也不直接调用 MySQL 或 provider 接口。

Renderer 只能通过认证客户端得到当前会话状态和用户概要；密码不会保存。令牌只存在于运行时内存或 Electron `safeStorage` 加密文件中：

- `anonymous`、`pending`、`authenticated`、`expired` 等状态；
- 用户 ID、用户名、显示名称和邮箱验证状态；
- 登录、刷新、修改密码、退出等受限操作。

以下内容禁止进入 renderer、`localStorage`、构筑文件、装备仓库、备份文件或普通日志：

- 微信 `AppSecret`；
- QQ 应用密钥；
- 微信/QQ provider access token；
- SuperPoE refresh token 原文；
- OAuth `code` 和完整回调参数。
- 用户密码和密码重置验证码（明文）。

认证数据应使用独立的 `app-auth` 存储域，不复用 `trade/credentials.v1.json`。交易站 `POESESSID` 继续由现有 `TradeCredentialStore` 按区服独立管理。

## 8. UI 入口

顶部全局区域增加独立的“SuperPoE 账号”入口：

```text
未登录       用户名登录 / 微信登录 / QQ登录
登录中       等待授权确认
已登录       头像 + 昵称 + 账号菜单
会话过期     重新登录
```

账号菜单至少包含退出登录。交易中心的“登录/退出”仍只表示当前 PoE 交易站 realm 的会话，不应使用相同文案或状态灯混淆两种登录。

## 9. 实施批次

### Phase A：认证基础

- 确认 SuperPoE 后端域名、HTTPS、Go 运行方式和 MySQL；
- 建立 provider-neutral 的用户、密码凭据、身份、attempt 和 session 表；
- [x] 实现用户名/密码注册、登录、退出和会话刷新；
- [x] 实现邮箱验证、验证邮件重发、邮件验证码密码找回和密码修改；
- [x] 使用 Argon2id、令牌哈希、刷新令牌轮换/重放撤销、认证限流和自动迁移；
- [x] 将 Electron 登录 UI 接入认证后端；主窗口启动时强制登录，右上角提供账号状态、修改密码和退出登录；
- 下一阶段再接入一个 OAuth provider 做端到端验收。

### Phase B：微信登录

- 完成网站应用审核和授权域名配置；
- 实现微信授权、callback、身份解析和错误映射；
- Windows/macOS 系统浏览器登录和 Electron 轮询验收。

### Phase C：QQ 登录

- 完成 QQ 互联网站应用审核和回调配置；
- 新增 QQ provider adapter；
- 验证 openid 稳定性、资料缺失和用户拒绝授权场景；
- 验证显式绑定微信/QQ，不发生错误自动合并。

### Phase D：业务同步

- 账号登录稳定后，再设计构筑、装备仓库和监控配置的云同步；
- 同步必须由用户主动开启，并保留本地数据优先级、冲突和删除策略；
- 未登录状态不能阻塞本地工作流。

## 10. 验收标准

- 微信和 QQ 可以分别完成授权码登录，provider token 不经过 renderer；
- 回调重放、错误 state、过期 attempt 和重复消费都会被拒绝；
- 同一 provider 身份不会重复创建用户；
- 同一用户可以在显式确认后绑定第二个 provider；
- SuperPoE 登录不会改变国服/国际服交易 session；
- 退出 SuperPoE 账号不会清理 `POESESSID`，退出交易站也不会注销 SuperPoE 账号；
- 应用重启后只恢复加密的 SuperPoE 会话摘要，不记录明文 token；
- 微信或 QQ 服务不可用时，本地构筑、计算、装备仓库和离线功能仍可用。
- 用户名/密码使用 Argon2id 保存，数据库和日志中不存在明文密码；重放、限流、重置和会话撤销测试通过。

## 11. 当前待确认事项

正式实施前需要确认：

1. 是否已有可部署的 SuperPoE 后端域名和 HTTPS 证书；
2. 微信网站应用和 QQ 互联网站应用是否已申请、审核，以及主体信息是否与官网一致；
3. 第一阶段是否只显示账号状态，不立即做云同步；
4. 登录后需要保存哪些业务数据，默认是否全部保持本地；
5. 用户名是否只允许 ASCII 规范化格式，以及首版是否提供邮箱找回密码；
6. 是否使用系统浏览器回调轮询作为首版，后续再增加 `superpoe://auth/callback` 深链。
