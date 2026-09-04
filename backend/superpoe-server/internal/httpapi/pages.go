package httpapi

import "github.com/gin-gonic/gin"

func renderAccountPage(c *gin.Context, body string) {
	c.Header("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'")
	c.Data(200, "text/html; charset=utf-8", []byte(body))
}

func verifyEmailPage(c *gin.Context) {
	renderAccountPage(c, verifyEmailHTML)
}

func resetPasswordPage(c *gin.Context) {
	renderAccountPage(c, resetPasswordHTML)
}

const accountPageStyle = `
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #101214; color: #edf0f2; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width: min(100%, 460px); border: 1px solid #3b4148; border-radius: 12px; padding: 32px; background: #191c20; box-shadow: 0 20px 60px #0008; }
h1 { margin: 0 0 12px; font-size: 25px; }
p { margin: 0 0 22px; color: #b8c0c8; }
label { display: block; margin: 16px 0 7px; color: #d8dde2; }
input { width: 100%; border: 1px solid #535b64; border-radius: 7px; padding: 11px 12px; background: #0f1113; color: #fff; font: inherit; }
button { width: 100%; margin-top: 22px; border: 0; border-radius: 7px; padding: 12px 16px; background: #d6a63d; color: #17130a; cursor: pointer; font: 600 16px inherit; }
button:disabled { cursor: wait; opacity: .65; }
.status { min-height: 28px; margin-top: 20px; color: #d8dde2; }
.status.success { color: #70d39b; }
.status.error { color: #ff9292; }
`

const verifyEmailHTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>验证邮箱 - SuperPoE</title><style>` + accountPageStyle + `</style></head>
<body><main><h1>验证邮箱</h1><p>正在验证你的 SuperPoE 邮箱地址。</p><div id="status" class="status">请稍候...</div></main>
<script>
(() => {
  const status = document.getElementById('status');
  const token = new URLSearchParams(location.search).get('token') || '';
  if (history.replaceState) history.replaceState(null, '', '/verify-email');
  if (!token) { status.textContent = '验证链接无效或缺少 Token。'; status.className = 'status error'; return; }
  fetch('/api/auth/email/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
    .then(async response => { const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error?.message || '验证链接无效或已过期。'); return data; })
    .then(() => { status.textContent = '邮箱验证成功，可以返回 SuperPoE 登录。'; status.className = 'status success'; })
    .catch(error => { status.textContent = error.message || '验证失败，请重新发送验证邮件。'; status.className = 'status error'; });
})();
</script></body></html>`

const resetPasswordHTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>重置密码 - SuperPoE</title><style>` + accountPageStyle + `</style></head>
<body><main><h1>重置密码</h1><p>设置一个至少 12 位的新密码。</p><form id="form"><label for="password">新密码</label><input id="password" name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required><label for="confirm">确认密码</label><input id="confirm" name="confirm" type="password" minlength="12" maxlength="128" autocomplete="new-password" required><button id="submit" type="submit">重置密码</button></form><div id="status" class="status"></div></main>
<script>
(() => {
  const form = document.getElementById('form');
  const submit = document.getElementById('submit');
  const status = document.getElementById('status');
  const token = new URLSearchParams(location.search).get('token') || '';
  if (history.replaceState) history.replaceState(null, '', '/reset-password');
  if (!token) { form.hidden = true; status.textContent = '重置链接无效或缺少 Token。'; status.className = 'status error'; return; }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const password = document.getElementById('password').value;
    const confirm = document.getElementById('confirm').value;
    if (password !== confirm) { status.textContent = '两次输入的密码不一致。'; status.className = 'status error'; return; }
    submit.disabled = true;
    status.textContent = '正在提交...'; status.className = 'status';
    try {
      const response = await fetch('/api/auth/password/reset/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, new_password: password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || '重置链接无效或已过期。');
      form.hidden = true;
      status.textContent = '密码已重置，请返回 SuperPoE 登录。'; status.className = 'status success';
    } catch (error) {
      status.textContent = error.message || '重置失败，请重新申请密码找回邮件。'; status.className = 'status error';
      submit.disabled = false;
    }
  });
})();
</script></body></html>`
