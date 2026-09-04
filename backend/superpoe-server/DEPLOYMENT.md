# superpoe-server 部署记录

本文档记录单台 Ubuntu x86_64 服务器上的部署方式。认证服务使用 Go
二进制，MySQL 使用 Docker Compose，Nginx 负责公网反向代理。

## 当前环境

```text
服务器架构：x86_64
项目目录：/home/ubuntu/superpoe/
Docker Compose：v2.32.4
MySQL：8.4
后端监听：当前服务器为 `0.0.0.0:80`（由另一台机器上的 Nginx 反向代理）
MySQL 监听：127.0.0.1:3306
```

`x86_64` 对应 Go 构建目标 `linux/amd64`。当前二进制应命名为
`superpoe-server`，并具有执行权限。

## 文件职责

```text
/home/ubuntu/superpoe/
├── superpoe-server       # Linux 后端二进制
├── docker-compose.yml    # MySQL 容器定义
├── .env.mysql            # MySQL 密码，服务器私有，不提交 Git
└── .env.mysql.example    # 不含真实密码的模板

/home/ubuntu/.config/superpoe/server.env
                         # 后端运行配置，服务器私有

/opt/superpoe-server/
└── superpoe-server       # systemd 实际运行的二进制

/etc/superpoe/
└── superpoe-server.env   # systemd 使用的后端配置
```

真实密码、`SUPERPOE_DATA_ENCRYPTION_KEY` 和 SMTP 密码不能放入项目、
Git、日志或安装包。

## MySQL 启动

```bash
cd /home/ubuntu/superpoe
chmod 600 .env.mysql
docker compose config -q
docker compose up -d
docker compose ps
```

确认容器健康：

```bash
docker inspect --format='{{.State.Health.Status}}' superpoe-mysql
```

预期结果为 `healthy`。

数据库用户密码是 `.env.mysql` 中的 `MYSQL_PASSWORD`，root 密码只用于
数据库管理，不写入后端 DSN。

不要执行 `docker compose down -v`，它会删除 `superpoe_mysql_data` 数据卷。

## 后端配置

手动测试时使用：

```text
/home/ubuntu/.config/superpoe/server.env
```

文件内容格式：

```env
SUPERPOE_SERVER_ADDR='127.0.0.1:8787'
SUPERPOE_MYSQL_DSN='superpoe_auth:MYSQL_PASSWORD@tcp(127.0.0.1:3306)/superpoe_auth'
SUPERPOE_PUBLIC_BASE_URL='http://127.0.0.1:8787'
# Electron origins: packaged app + Vite dev renderer. Add the website origin
# after a comma if the website also calls this API.
SUPERPOE_ALLOWED_ORIGIN='app://localhost,http://127.0.0.1:3000'
SUPERPOE_DATA_ENCRYPTION_KEY='32字节密钥的十六进制值'
SUPERPOE_PASSWORD_HASH_CONCURRENCY='2'
SUPERPOE_AUTH_RATE_LIMIT='60'
SUPERPOE_AUTH_RATE_WINDOW='1m'
SUPERPOE_AUTH_RATE_MAX_KEYS='10000'
SUPERPOE_SMTP_HOST=''
SUPERPOE_SMTP_PORT='587'
SUPERPOE_SMTP_USER=''
SUPERPOE_SMTP_PASSWORD=''
SUPERPOE_SMTP_FROM=''
SUPERPOE_SECURE_COOKIES='1'
```

`MYSQL_PASSWORD` 要替换为 `.env.mysql` 中的实际值。DSN 必须使用单引号，
因为 Bash 会解析其中的 `@tcp(...)` 括号。

保护配置：

```bash
chmod 600 /home/ubuntu/.config/superpoe/server.env
bash -n /home/ubuntu/.config/superpoe/server.env
```

`SUPERPOE_DATA_ENCRYPTION_KEY` 一旦投入使用就不能更换，否则已加密保存的
邮箱无法解密。

## SMTP 验证（Windows）

后端目录提供了一个不会保存密码的 PowerShell 验证脚本：

```text
scripts/test-smtp.ps1
```

在 Windows PowerShell 中从 `backend/superpoe-server` 目录运行。脚本默认使用
Outlook 的 `smtp-mail.outlook.com:587`，会先检查 TCP 端口，再使用 STARTTLS
实际发送一封测试邮件。运行时输入邮箱应用密码，不要输入普通登录密码：

```powershell
.\scripts\test-smtp.ps1 -From '你的Hotmail邮箱' -To '收件邮箱'
```

如果 SMTP 登录用户名与发件地址不同：

```powershell
.\scripts\test-smtp.ps1 -From '发件地址' -To '收件邮箱' -Username 'SMTP登录用户名'
```

看到 `SMTP test message sent successfully.` 后，说明当前 Windows 机器的
SMTP 配置可用。该脚本只验证运行它的 Windows 网络环境；服务器上的后端仍需
配置 `server.env` 并重启后，再调用验证邮件接口做一次端到端检查。

旧版本邮箱验证仍保留邮件链接页面：

```text
GET /verify-email?token=...
```

注册后无需验证邮箱。密码找回不再发送重置链接。`POST /api/auth/password/reset/request`
会向注册邮箱发送一次性 6 位验证码，Electron 前端再调用
`POST /api/auth/password/reset/confirm`，提交 `email`、`code` 和 `new_password`。
验证码默认 20 分钟有效、最多输错 5 次，重新申请会使旧验证码失效。

`GET /reset-password?token=...` 和 confirm 接口的 `token` 字段仍保留为旧版本
邮件链接兼容路径；新版本不再生成或依赖它。修改页面或后端代码后，必须重新构建
并替换服务器上的 `superpoe-server` 二进制，单独重启旧二进制不会带来新路由。

## 手动迁移和验证

### 当前服务器（80 端口）

当前服务器的配置文件是 `/home/ubuntu/.config/superpoe/server.env`。其中
`SUPERPOE_SERVER_ADDR` 设置为 `0.0.0.0:80` 时，必须在 root shell 中启动，
否则 Linux 会拒绝普通用户绑定特权端口。`sudo` 命令本身不会自动保留当前用户
的环境变量，因此每条命令都要显式加载配置文件：

```bash
cd /home/ubuntu/superpoe
sudo bash -c 'set -a; source /home/ubuntu/.config/superpoe/server.env; set +a; exec /home/ubuntu/superpoe/superpoe-server migrate'
```

后台启动（适用于当前临时部署）：

```bash
cd /home/ubuntu/superpoe
sudo bash -c 'set -a; source /home/ubuntu/.config/superpoe/server.env; set +a; nohup /home/ubuntu/superpoe/superpoe-server serve >> /home/ubuntu/superpoe/superpoe-server.log 2>&1 & echo $! > /home/ubuntu/superpoe/superpoe-server.pid'
```

查看进程、日志和健康状态：

```bash
cat /home/ubuntu/superpoe/superpoe-server.pid
sudo ps -fp "$(cat /home/ubuntu/superpoe/superpoe-server.pid)"
sudo tail -n 50 /home/ubuntu/superpoe/superpoe-server.log
curl -i http://127.0.0.1/api/health
```

停止该后台进程：

```bash
if [ -s /home/ubuntu/superpoe/superpoe-server.pid ]; then
  sudo kill "$(cat /home/ubuntu/superpoe/superpoe-server.pid)" || true
  sudo rm -f /home/ubuntu/superpoe/superpoe-server.pid
fi
```

日志使用追加模式，旧的 `bind: permission denied` 记录可能仍会保留在文件中；
只要 `ps` 中的进程存在且健康检查返回 `{"ok":true}`，就表示当前服务已成功
启动。生产环境应改用下面的 systemd 方式，不建议长期使用 root + `nohup`。

### 8787 端口本机测试

如果不需要绑定 80 端口，可将 `server.env` 中的地址改为
`127.0.0.1:8787`，然后用普通用户前台运行：

```bash
cd /home/ubuntu/superpoe
set -a
source /home/ubuntu/.config/superpoe/server.env
set +a
./superpoe-server migrate
printf 'exit code: %s\n' "$?"
```

迁移成功时程序目前不会输出成功提示，但退出码应为 `0`。

前台启动：

```bash
./superpoe-server serve
```

另开 SSH 窗口验证：

```bash
curl -i http://127.0.0.1:8787/api/health
```

预期返回 `HTTP/1.1 200 OK` 和：

```json
{"ok":true}
```

## systemd 运行

生产环境建议将二进制安装到 `/opt/superpoe-server/`，配置放到
`/etc/superpoe/superpoe-server.env`，并使用专用的 `superpoe` 系统用户。

服务单元模板位于：

```text
deploy/systemd/superpoe-server.service
```

启动和查看日志：

```bash
sudo systemctl daemon-reload
sudo systemctl enable superpoe-server
sudo systemctl start superpoe-server
sudo systemctl status superpoe-server
sudo journalctl -u superpoe-server -n 100 --no-pager
```

该服务的 `ExecStartPre` 会自动执行数据库迁移，已经应用的迁移会被跳过。

## Nginx

反向代理配置模板位于：

```text
deploy/nginx/superpoe-server.conf
```

Nginx 公网配置完成后，应使用实际 HTTPS 域名更新：

```env
SUPERPOE_PUBLIC_BASE_URL=https://你的认证域名
SUPERPOE_ALLOWED_ORIGIN=app://localhost,http://127.0.0.1:3000,https://你的官网来源
```

后端和 MySQL 都只监听本机地址，不应直接开放到公网。

## 故障排查

配置错误：

```text
SUPERPOE_DATA_ENCRYPTION_KEY: value is required
```

检查 `SUPERPOE_DATA_ENCRYPTION_KEY` 是否为 64 位十六进制字符串。

数据库连接失败：

```text
connection refused
```

检查：

```bash
docker compose ps
docker compose logs mysql --tail 100
```

如果 `migrate` 没有返回提示符超过约 45 秒，按 `Ctrl + C`，不要删除数据卷，
然后检查 MySQL 容器日志和端口占用。

## 备份

MySQL 数据保存在 Docker volume `superpoe_mysql_data` 中。必须定期将逻辑备份
复制到服务器之外，例如：

```bash
docker compose exec -T mysql mysqldump -u superpoe_auth -p superpoe_auth > superpoe_auth.sql
```

执行时会提示输入 `MYSQL_PASSWORD`。备份文件同样包含敏感数据，必须限制权限
并加密保存。
