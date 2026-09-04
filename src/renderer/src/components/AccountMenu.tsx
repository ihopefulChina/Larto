import { invoke } from '@/lib/bridge'
import { useApp, useT } from '@/store/app'
import { Dropdown } from './Dropdown'
import { UserIcon } from './icons'

export function AccountMenu() {
  const t = useT()
  const account = useApp((s) => s.account)
  const signedIn = account.status === 'signedIn'
  const info =
    account.status === 'signedIn' || account.status === 'expired' ? account.account : null
  const initial = info?.user.name?.slice(0, 1) ?? ''

  const login = () =>
    void invoke('account:login').catch((err: unknown) => {
      // Closing the login window is a normal outcome; everything else deserves a notice.
      if (!/login cancelled/.test(String(err)))
        useApp.getState().showToast(t('toolbar.loginFailed'))
    })
  const switchTenant = (userId: string) =>
    void invoke('account:switchTenant', userId).catch(() =>
      useApp.getState().showToast(t('toolbar.switchTenantFailed'))
    )

  // Signed out: the toolbar button *is* the login action (official tool behaviour), no menu.
  if (!info) {
    const busy = account.status === 'signingIn'
    return (
      <button
        type="button"
        className="tbtn"
        onClick={login}
        title={t('toolbar.login')}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? <span className="spinner sm" aria-hidden /> : <UserIcon aria-hidden />}
        {t('toolbar.login')}
      </button>
    )
  }

  return (
    <Dropdown
      align="right"
      trigger={(open, toggle) => (
        <button
          type="button"
          className="tbtn icon"
          onClick={toggle}
          title={info.user.name}
          aria-label={info.user.name}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span className={`avatar ${signedIn ? '' : 'expired'}`}>
            {info.user.avatar ? <img src={info.user.avatar} alt="" /> : initial}
          </span>
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="account-head">
            <span className="avatar">
              {info.user.avatar ? <img src={info.user.avatar} alt="" /> : initial}
            </span>
            <div>
              <div className="name">{info.user.name}</div>
              <div className="tenant">{info.tenant.name}</div>
            </div>
          </div>
          {account.status === 'expired' && (
            <div className="menu-label">{t('toolbar.sessionExpired')}</div>
          )}
          {signedIn && info.tenantList.length > 1 && (
            <>
              <div className="menu-sep" />
              <div className="menu-label">{t('toolbar.switchTenant')}</div>
              {info.tenantList.map((tenant) => {
                const current = tenant.userId === info.user.id
                return (
                  <button
                    key={tenant.userId}
                    type="button"
                    role="menuitem"
                    className={`menu-item ${current ? 'checked' : ''} ${tenant.isLogin ? '' : 'muted'}`}
                    disabled={current || !tenant.isLogin}
                    aria-current={current ? 'true' : undefined}
                    title={tenant.isLogin ? tenant.name : t('toolbar.tenantNeedsLogin')}
                    onClick={() => {
                      close()
                      switchTenant(tenant.userId)
                    }}
                  >
                    <span className="avatar" style={{ width: 18, height: 18 }}>
                      {tenant.avatar ? <img src={tenant.avatar} alt="" /> : tenant.name.slice(0, 1)}
                    </span>
                    {tenant.name}
                  </button>
                )
              })}
            </>
          )}
          <div className="menu-sep" />
          {!signedIn && (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                close()
                login()
              }}
            >
              {t('toolbar.login')}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="menu-item danger"
            onClick={() => {
              close()
              void invoke('account:logout')
            }}
          >
            {t('toolbar.logout')}
          </button>
        </>
      )}
    </Dropdown>
  )
}
