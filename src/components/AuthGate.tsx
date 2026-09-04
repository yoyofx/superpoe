import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, KeyRound, LoaderCircle, LogIn, LogOut, Mail, ShieldCheck, User, UserPlus, X } from 'lucide-react'
import { useTranslation } from '@/i18n/useTranslation'
import { uiText } from '@/i18n/uiLocale'
import { AuthApiError, type AuthSession, type AuthUser, changePassword as apiChangePassword, confirmPasswordReset, login, logout, refreshSession, register, requestPasswordReset, restoreSession } from '@/engine/authClient'
import { trackAnalytics } from '@/engine/analytics'

interface AuthContextValue {
  session: AuthSession | null
  user: AuthUser | null
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  requestLogin: (afterLogin?: () => void) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/

function looksLikeEmail(value: string): boolean {
  const normalized = value.trim()
  if (normalized.length < 3 || normalized.length > 254 || /[\r\n\s]/.test(normalized)) return false
  const at = normalized.indexOf('@')
  return at > 0 && at < normalized.length - 1 && normalized.indexOf('@', at + 1) === -1
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthGate')
  return value
}

function errorText(error: unknown, language: ReturnType<typeof useTranslation>['lang']): string {
  const code = error instanceof AuthApiError ? error.code : ''
  if (code === 'network_error') return uiText(language, 'The authentication service is unreachable.', '暂时无法连接登录服务。', '暫時無法連線到登入服務。', '인증 서비스에 연결할 수 없습니다.')
  if (code === 'invalid_credentials') return uiText(language, 'Username or password is incorrect.', '用户名或密码不正确。', '使用者名稱或密碼不正確。', '사용자 이름 또는 비밀번호가 올바르지 않습니다.')
  if (code === 'session_invalid') return uiText(language, 'Your session has expired. Sign in again.', '登录状态已过期，请重新登录。', '登入狀態已過期，請重新登入。', '세션이 만료되었습니다. 다시 로그인하세요.')
  if (code === 'rate_limited') return uiText(language, 'Too many attempts. Try again later.', '尝试次数过多，请稍后再试。', '嘗試次數過多，請稍後再試。', '시도 횟수가 너무 많습니다. 나중에 다시 시도하세요.')
  if (code === 'invalid_input') return uiText(language, 'Please check the information you entered.', '请检查填写的信息。', '請檢查填寫的資訊。', '입력한 정보를 확인하세요.')
  if (code === 'account_unavailable') return uiText(language, 'This account is not available.', '此账号当前不可用。', '此帳號目前無法使用。', '이 계정은 사용할 수 없습니다.')
  if (code === 'token_invalid') return uiText(language, 'The verification code or link is invalid or expired.', '验证码或验证链接无效，或已过期。', '驗證碼或驗證連結無效，或已過期。', '인증 코드 또는 링크가 유효하지 않거나 만료되었습니다.')
  if (code === 'email_unavailable') return uiText(language, 'Email delivery is temporarily unavailable. Try again later.', '邮件服务暂时不可用，请稍后再试。', '郵件服務暫時無法使用，請稍後再試。', '이메일 서비스를 일시적으로 사용할 수 없습니다. 나중에 다시 시도하세요.')
  return error instanceof Error ? error.message : uiText(language, 'Request failed. Try again.', '操作失败，请重试。', '操作失敗，請重試。', '요청에 실패했습니다. 다시 시도하세요.')
}

function AuthLoading() {
  const { lang } = useTranslation()
  return <main className="auth-gate auth-loading"><div className="auth-loading-mark"><LoaderCircle /></div><strong>{uiText(lang, 'Checking your session', '正在检查登录状态', '正在檢查登入狀態', '세션 확인 중')}</strong></main>
}

function AuthScreen({ onAuthenticated, onCancel }: { onAuthenticated: (session: AuthSession) => void; onCancel?: () => void }) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetEmail, setResetEmail] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [resetConfirmPassword, setResetConfirmPassword] = useState('')
  const [resetRequested, setResetRequested] = useState(false)
  const [resetComplete, setResetComplete] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetFeedback, setResetFeedback] = useState<{ kind: 'notice' | 'error'; message: string } | null>(null)
  const [resendSeconds, setResendSeconds] = useState(0)

  useEffect(() => {
    if (resendSeconds <= 0) return
    const timer = window.setInterval(() => setResendSeconds((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [resendSeconds])

  const switchMode = (next: 'login' | 'register') => {
    setMode(next)
    setError(null)
    setPassword('')
    setConfirmPassword('')
  }

  const openReset = () => {
    setMode('reset')
    setError(null)
    setResetFeedback(null)
    setResetRequested(false)
    setResetComplete(false)
    setResetCode('')
    setResetPassword('')
    setResetConfirmPassword('')
  }

  const backToLogin = () => {
    setMode('login')
    setError(null)
    setResetFeedback(null)
    setResetRequested(false)
    setResetComplete(false)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (mode === 'register') {
      if (!USERNAME_PATTERN.test(username.trim())) {
        setError(l('Username must be 3-32 letters, numbers, underscores, or hyphens.', '用户名需为 3-32 位英文、数字、下划线或短横线。', '使用者名稱需為 3-32 位英文、數字、底線或連字號。', '사용자 이름은 영문, 숫자, 밑줄 또는 하이픈 3-32자여야 합니다.'))
        return
      }
      if (!looksLikeEmail(email)) {
        setError(l('Enter a valid email address.', '请输入有效的邮箱地址。', '請輸入有效的電子郵件地址。', '유효한 이메일 주소를 입력하세요.'))
        return
      }
      if (displayName.length > 64 || /[\r\n]/.test(displayName)) {
        setError(l('Display name must be at most 64 characters.', '显示名称最多 64 个字符。', '顯示名稱最多 64 個字元。', '표시 이름은 64자 이하여야 합니다.'))
        return
      }
      if (password !== confirmPassword) {
        setError(l('Passwords do not match.', '两次输入的密码不一致。', '兩次輸入的密碼不一致。', '비밀번호가 일치하지 않습니다.'))
        return
      }
    }
    if (password.length < 12) {
      setError(l('Password must be at least 12 characters.', '密码至少需要 12 个字符。', '密碼至少需要 12 個字元。', '비밀번호는 12자 이상이어야 합니다.'))
      return
    }
    setBusy(true)
    try {
      const session = mode === 'login'
        ? await login(username.trim(), password)
        : await register(username.trim(), email.trim(), password, displayName.trim())
      trackAnalytics(mode === 'login' ? 'auth_login_success' : 'auth_register_success')
      onAuthenticated(session)
    } catch (reason) {
      trackAnalytics(mode === 'login' ? 'auth_login_failure' : 'auth_register_failure')
      setError(errorText(reason, lang))
    } finally {
      setBusy(false)
    }
  }

  const submitReset = async (event: FormEvent) => {
    event.preventDefault()
    setResetFeedback(null)
    if (!resetRequested) {
      if (!resetEmail.trim()) {
        setResetFeedback({ kind: 'error', message: l('Enter your account email.', '请输入账号邮箱。', '請輸入帳號電子郵件。', '계정 이메일을 입력하세요.') })
        return
      }
      if (!looksLikeEmail(resetEmail)) {
        setResetFeedback({ kind: 'error', message: l('Enter a valid email address.', '请输入有效的邮箱地址。', '請輸入有效的電子郵件地址。', '유효한 이메일 주소를 입력하세요.') })
        return
      }
      setResetBusy(true)
      try {
        await requestPasswordReset(resetEmail.trim())
        trackAnalytics('auth_password_reset_request')
        setResetRequested(true)
        setResendSeconds(60)
        setResetFeedback({ kind: 'notice', message: l('If this email can be recovered, a verification code has been sent.', '如果该邮箱可以找回账号，验证码已发送。', '如果此電子郵件可以找回帳號，驗證碼已寄出。', '복구 가능한 이메일이면 인증 코드가 전송되었습니다.') })
      } catch (reason) {
        setResetFeedback({ kind: 'error', message: errorText(reason, lang) })
      } finally {
        setResetBusy(false)
      }
      return
    }
    if (resetComplete) return
    if (!/^\d{6}$/.test(resetCode)) {
      setResetFeedback({ kind: 'error', message: l('Enter the 6-digit verification code.', '请输入 6 位验证码。', '請輸入 6 位驗證碼。', '6자리 인증 코드를 입력하세요.') })
      return
    }
    if (resetPassword.length < 12) {
      setResetFeedback({ kind: 'error', message: l('Password must be at least 12 characters.', '密码至少需要 12 个字符。', '密碼至少需要 12 個字元。', '비밀번호는 12자 이상이어야 합니다.') })
      return
    }
    if (resetPassword !== resetConfirmPassword) {
      setResetFeedback({ kind: 'error', message: l('Passwords do not match.', '两次输入的密码不一致。', '兩次輸入的密碼不一致。', '비밀번호가 일치하지 않습니다.') })
      return
    }
    setResetBusy(true)
    try {
      await confirmPasswordReset(resetEmail.trim(), resetCode, resetPassword)
      trackAnalytics('auth_password_reset_success')
      setResetComplete(true)
      setResetFeedback({ kind: 'notice', message: l('Password reset. You can sign in with the new password.', '密码已重置，可以使用新密码登录。', '密碼已重設，可以使用新密碼登入。', '비밀번호가 재설정되었습니다. 새 비밀번호로 로그인하세요.') })
    } catch (reason) {
      setResetFeedback({ kind: 'error', message: errorText(reason, lang) })
    } finally {
      setResetBusy(false)
    }
  }

  const resendResetCode = async () => {
    if (resendSeconds > 0 || resetBusy || !resetEmail.trim()) return
    setResetFeedback(null)
    setResetBusy(true)
    try {
      await requestPasswordReset(resetEmail.trim())
      trackAnalytics('auth_password_reset_request')
      setResendSeconds(60)
      setResetFeedback({ kind: 'notice', message: l('A new verification code has been sent.', '新的验证码已发送。', '新的驗證碼已寄出。', '새 인증 코드가 전송되었습니다.') })
    } catch (reason) {
      setResetFeedback({ kind: 'error', message: errorText(reason, lang) })
    } finally {
      setResetBusy(false)
    }
  }

  return <main className="auth-gate">
    <div className="auth-gate-ornament" aria-hidden="true" />
    <div className="auth-gate-backdrop" aria-hidden="true" />
    <section className="auth-shell" aria-labelledby="auth-title">
      {onCancel && <button type="button" className="icon-command auth-dismiss-command" onClick={onCancel} aria-label={l('Close sign-in', '关闭登录', '關閉登入', '로그인 닫기')} title={l('Continue without signing in', '暂不登录', '暫不登入', '로그인하지 않고 계속')}><X /></button>}
      <div className="auth-shell-intro">
        <div className="auth-intro-brand"><img src="/assets/ui/superpoe2-logo.png?v=20260903" alt="SuperPoE2" /><div><span>{l('Build analysis workspace', '构筑分析工作台', '構築分析工作台', '빌드 분석 작업 공간')}</span></div></div>
      </div>
      <div className="auth-panel">
        {mode === 'reset' ? <>
          <div className="auth-reset-header"><button type="button" className="auth-back-command" onClick={backToLogin}><ArrowLeft />{l('Back to sign in', '返回登录', '返回登入', '로그인으로 돌아가기')}</button><h1 id="auth-title">{l('Reset password', '找回密码', '找回密碼', '비밀번호 재설정')}</h1></div>
          <form className="auth-form auth-reset-form" onSubmit={(event) => void submitReset(event)}>
            <label><span>{l('Account email', '账号邮箱', '帳號電子郵件', '계정 이메일')}</span><div className="auth-input-with-icon"><Mail /><input type="email" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} autoComplete="email" required disabled={resetRequested} /></div></label>
            {resetRequested && <>
              <label><span>{l('Verification code', '验证码', '驗證碼', '인증 코드')}</span><input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={resetCode} onChange={(event) => setResetCode(event.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" disabled={resetComplete} /></label>
              <label><span>{l('New password', '新密码', '新密碼', '새 비밀번호')}</span><div className="auth-input-with-icon"><KeyRound /><input type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} disabled={resetComplete} /></div></label>
              <label><span>{l('Confirm new password', '确认新密码', '確認新密碼', '새 비밀번호 확인')}</span><input type="password" value={resetConfirmPassword} onChange={(event) => setResetConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} disabled={resetComplete} /></label>
            </>}
            {resetFeedback && <div className={`auth-feedback ${resetFeedback.kind}`} role={resetFeedback.kind === 'error' ? 'alert' : 'status'}>{resetFeedback.kind === 'notice' ? <CheckCircle2 /> : <AlertCircle />}{resetFeedback.message}</div>}
            {!resetRequested && <button className="primary-command auth-submit" type="submit" disabled={resetBusy}>{resetBusy ? <LoaderCircle className="auth-spin" /> : <Mail />}{resetBusy ? l('Sending...', '正在发送...', '正在寄送...', '전송 중...') : l('Send verification code', '发送验证码', '寄送驗證碼', '인증 코드 보내기')}</button>}
            {resetRequested && !resetComplete && <>
              <button className="primary-command auth-submit" type="submit" disabled={resetBusy}>{resetBusy ? <LoaderCircle className="auth-spin" /> : <ArrowRight />}{resetBusy ? l('Resetting...', '正在重置...', '正在重設...', '재설정 중...') : l('Reset password', '重置密码', '重設密碼', '비밀번호 재설정')}</button>
              <button className="auth-link-command" type="button" onClick={() => void resendResetCode()} disabled={resetBusy || resendSeconds > 0}>{resendSeconds > 0 ? l(`Resend in ${resendSeconds}s`, `${resendSeconds} 秒后重发`, `${resendSeconds} 秒後重寄`, `${resendSeconds}초 후 재전송`) : l('Resend code', '重新发送验证码', '重新寄送驗證碼', '코드 재전송')}</button>
            </>}
            {resetComplete && <button className="primary-command auth-submit" type="button" onClick={backToLogin}><LogIn />{l('Back to sign in', '返回登录', '返回登入', '로그인으로 돌아가기')}</button>}
          </form>
        </> : <>
          <div className="auth-mode-tabs" role="tablist"><button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}><LogIn />{l('Sign in', '登录', '登入', '로그인')}</button><button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}><UserPlus />{l('Register', '注册', '註冊', '가입')}</button></div>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
              <label><span>{l('Username', '用户名', '使用者名稱', '사용자 이름')}</span><div className="auth-input-with-icon"><User /><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required minLength={3} maxLength={32} /></div></label>
            {mode === 'register' && <>
              <label><span>{l('Email', '邮箱', '電子郵件', '이메일')}</span><div className="auth-input-with-icon"><Mail /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="you@example.com" /></div><small className="auth-field-hint">{l('Use an email address you can access. It is needed to recover your password.', '请填写可以正常收信的邮箱，密码找回需要使用它。', '請填寫可以正常收信的電子郵件，找回密碼時需要使用它。', '접근 가능한 이메일을 입력하세요. 비밀번호 복구에 필요합니다.')}</small></label>
              <label><span>{l('Display name (optional)', '显示名称（可选）', '顯示名稱（選填）', '표시 이름(선택 사항)')}</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="nickname" maxLength={64} /></label>
            </>}
            <label><span>{l('Password', '密码', '密碼', '비밀번호')}</span><div className="auth-input-with-icon"><KeyRound /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={12} maxLength={128} /></div></label>
            {mode === 'register' && <label><span>{l('Confirm password', '确认密码', '確認密碼', '비밀번호 확인')}</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required minLength={12} maxLength={128} /></label>}
            {mode === 'login' && <button className="auth-link-command auth-forgot-command" type="button" onClick={openReset}>{l('Forgot password?', '忘记密码？', '忘記密碼？', '비밀번호를 잊으셨나요?')}</button>}
            {error && <div className="auth-feedback error" role="alert"><AlertCircle />{error}</div>}
            <button className="primary-command auth-submit" type="submit" disabled={busy}>{busy ? <LoaderCircle className="auth-spin" /> : <ArrowRight />}{busy ? l('Connecting...', '正在连接...', '正在連線...', '연결 중...') : mode === 'login' ? l('Enter workspace', '进入工作区', '進入工作區', '작업 공간 열기') : l('Create account', '创建账号', '建立帳號', '계정 만들기')}</button>
            <div className="auth-intro-copy"><span className="auth-kicker">SUPERPOE ACCESS</span><h1 id="auth-title">{mode === 'login' ? l('Sign in to continue', '登录后继续', '登入後繼續', '로그인하고 계속하기') : l('Create your account', '创建账号', '建立帳號', '계정 만들기')}</h1><p>{l('Sign in to use the equipment library, trade center, and analysis tools. Your build data stays on this device.', '装备仓库、交易中心和分析工具需要登录，构筑数据仍保存在本机。', '裝備倉庫、交易中心與分析工具需要登入，構築資料仍保留在本機。', '장비 라이브러리, 거래 센터 및 분석 도구를 사용하려면 로그인하세요. 빌드 데이터는 이 기기에 보관됩니다.')}</p></div>
          </form>
        </>}
        <footer className="auth-security-note"><ShieldCheck /><span>{l('Sessions are encrypted locally and refreshed automatically.', '登录凭据会在本机加密保存，并自动刷新。', '登入憑據會在本機加密儲存，並自動更新。', '세션은 이 기기에 암호화되어 저장되고 자동으로 갱신됩니다.')}</span></footer>
      </div>
    </section>
  </main>
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [checking, setChecking] = useState(true)
  const [restoreError, setRestoreError] = useState<unknown>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const pendingActionRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let active = true
    void restoreSession().then((value) => {
      if (!active) return
      setSession(value)
      setChecking(false)
    }).catch((reason) => {
      if (!active) return
      setRestoreError(reason)
      setChecking(false)
    })
    return () => { active = false }
  }, [])

  const handleLogout = useCallback(async () => {
    if (!session) return
    try { await logout(session) } finally {
      trackAnalytics('auth_logout')
      pendingActionRef.current = null
      setLoginOpen(false)
      setSession(null)
    }
  }, [session])

  const requestLogin = useCallback((afterLogin?: () => void) => {
    if (session) {
      afterLogin?.()
      return
    }
    pendingActionRef.current = afterLogin || null
    setLoginOpen(true)
  }, [session])

  const handleAuthenticated = useCallback((nextSession: AuthSession) => {
    const pendingAction = pendingActionRef.current
    pendingActionRef.current = null
    setSession(nextSession)
    setLoginOpen(false)
    pendingAction?.()
  }, [])

  const handleChangePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    if (!session) return
    try {
      await apiChangePassword(session, currentPassword, newPassword)
    } catch (reason) {
      if (!(reason instanceof AuthApiError) || reason.status !== 401) throw reason
      const refreshed = await refreshSession(session)
      setSession(refreshed)
      await apiChangePassword(refreshed, currentPassword, newPassword)
    }
  }, [session])

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user || null,
    logout: handleLogout,
    changePassword: handleChangePassword,
    requestLogin,
  }), [handleChangePassword, handleLogout, requestLogin, session])
  if (checking) return <AuthLoading />
  if (restoreError) console.warn('[Auth] session restore failed', restoreError)
  return <AuthContext.Provider value={value}>
    {children}
    {loginOpen && <div className="auth-prompt-layer"><AuthScreen onAuthenticated={handleAuthenticated} onCancel={() => { pendingActionRef.current = null; setLoginOpen(false) }} /></div>}
  </AuthContext.Provider>
}

export function AccountStatus() {
  const { user, requestLogin, logout: signOut, changePassword } = useAuth()
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const [open, setOpen] = useState(false)
  const [changeOpen, setChangeOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'notice' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (!open && !changeOpen) return
    const close = (event: PointerEvent) => { if (open && (!(event.target instanceof Element) || !event.target.closest('.account-status'))) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); setChangeOpen(false) } }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [open])

  const submitPasswordChange = async (event: FormEvent) => {
    event.preventDefault()
    setFeedback(null)
    if (newPassword.length < 12) { setFeedback({ kind: 'error', message: l('Password must be at least 12 characters.', '新密码至少需要 12 个字符。', '新密碼至少需要 12 個字元。', '새 비밀번호는 12자 이상이어야 합니다.') }); return }
    if (newPassword !== confirmPassword) { setFeedback({ kind: 'error', message: l('Passwords do not match.', '两次输入的密码不一致。', '兩次輸入的密碼不一致。', '비밀번호가 일치하지 않습니다.') }); return }
    setBusy(true)
    try {
      await changePassword(currentPassword, newPassword)
      setFeedback({ kind: 'notice', message: l('Password changed.', '密码已修改。', '密碼已修改。', '비밀번호가 변경되었습니다.') })
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
      window.setTimeout(() => { setChangeOpen(false); setFeedback(null) }, 900)
    } catch (reason) { setFeedback({ kind: 'error', message: errorText(reason, lang) }) } finally { setBusy(false) }
  }

  if (!user) return <div className="account-status">
    <button type="button" className="account-status-button account-status-anonymous" onClick={() => requestLogin()} title={l('Sign in', '登录', '登入', '로그인')} aria-label={l('Sign in', '登录', '登入', '로그인')}>
      <LogIn />
      <span className="account-status-copy"><strong>{l('Sign in', '登录', '登入', '로그인')}</strong><small>{l('Unlock online features', '登录后解锁功能', '登入後解鎖功能', '온라인 기능 잠금 해제')}</small></span>
    </button>
  </div>

  return <div className="account-status">
    <button type="button" className="account-status-button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu" title={l('Account status', '账号状态', '帳號狀態', '계정 상태')}><span className="account-status-dot" /><span className="account-status-copy"><strong>{user.display_name || user.username}</strong><small>{user.email || l('Signed in', '已登录', '已登入', '로그인됨')}</small></span><span className="account-status-chevron">⌄</span></button>
    {open && <div className="account-status-menu" role="menu"><div className="account-status-menu-user"><strong>{user.username}</strong><small>{user.email || l('Recovery email set', '已设置找回邮箱', '已設定找回電子郵件', '복구 이메일 설정됨')}</small></div><button type="button" role="menuitem" onPointerDown={(event) => event.stopPropagation()} onClick={() => { setOpen(false); setChangeOpen(true); setFeedback(null) }}><KeyRound />{l('Change password', '修改密码', '修改密碼', '비밀번호 변경')}</button><button type="button" role="menuitem" className="account-signout" onPointerDown={(event) => event.stopPropagation()} onClick={() => void signOut().catch(() => undefined)}><LogOut />{l('Sign out', '退出登录', '登出', '로그아웃')}</button></div>}
    {changeOpen && <div className="modal-backdrop" role="presentation"><section className="workflow-dialog auth-password-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-password-title"><header className="dialog-header"><div><span>{l('Account security', '账号安全', '帳號安全', '계정 보안')}</span><h2 id="auth-password-title">{l('Change password', '修改密码', '修改密碼', '비밀번호 변경')}</h2></div><button className="icon-command" type="button" onClick={() => setChangeOpen(false)} aria-label={l('Close', '关闭', '關閉', '닫기')}><X /></button></header><form className="auth-password-form" onSubmit={(event) => void submitPasswordChange(event)}><label><span>{l('Current password', '当前密码', '目前密碼', '현재 비밀번호')}</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></label><label><span>{l('New password', '新密码', '新密碼', '새 비밀번호')}</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={12} required /></label><label><span>{l('Confirm new password', '确认新密码', '確認新密碼', '새 비밀번호 확인')}</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} required /></label>{feedback && <div className={`auth-feedback ${feedback.kind}`} role="status">{feedback.kind === 'notice' ? <CheckCircle2 /> : <AlertCircle />}{feedback.message}</div>}<footer className="dialog-footer"><span /><button className="primary-command" type="submit" disabled={busy}>{busy ? <LoaderCircle className="auth-spin" /> : <ShieldCheck />}{busy ? l('Updating...', '正在更新...', '正在更新...', '업데이트 중...') : l('Save password', '保存密码', '儲存密碼', '비밀번호 저장')}</button></footer></form></section></div>}
  </div>
}
