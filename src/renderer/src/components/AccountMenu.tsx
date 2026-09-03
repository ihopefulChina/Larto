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

  const login = () => void invoke('account:login').catch(() => undefined)

  return (
    <Dropdown
      align="right"
      trigger={(_open, toggle) => (
        <button
          className={`tbtn ${signedIn ? 'icon' : ''}`}
          onClick={toggle}
          title={info?.user.name ?? t('toolbar.login')}
        >
          {signedIn && info ? (
            <span className="avatar">
              {info.user.avatar ? <img src={info.user.avatar} alt="" /> : initial}
            </span>
          ) : (
            <>
              <UserIcon />
              {account.status === 'signingIn' ? '…' : t('toolbar.login')}
            </>
          )}
        </button>
      )}
    >
      {(close) => (
        <>
          {info && (
            <div className="account-head">
              <span className="avatar">
                {info.user.avatar ? <img src={info.user.avatar} alt="" /> : initial}
              </span>
              <div>
                <div className="name">{info.user.name}</div>
                <div className="tenant">{info.tenant.name}</div>
              </div>
            </div>
          )}
          {account.status === 'expired' && (
            <div className="menu-label">{t('toolbar.sessionExpired')}</div>
          )}
          {signedIn && info && info.tenantList.length > 1 && (
            <>
              <div className="menu-sep" />
              <div className="menu-label">{t('toolbar.switchTenant')}</div>
              {info.tenantList.map((tenant) => (
                <button
                  key={tenant.userId}
                  className={`menu-item ${tenant.userId === info.user.id ? 'checked' : ''}`}
                  disabled={tenant.userId === info.user.id}
                  onClick={() => {
                    close()
                    void invoke('account:switchTenant', tenant.userId).catch(() => undefined)
                  }}
                >
                  <span className="avatar" style={{ width: 18, height: 18 }}>
                    {tenant.avatar ? <img src={tenant.avatar} alt="" /> : tenant.name.slice(0, 1)}
                  </span>
                  {tenant.name}
                </button>
              ))}
            </>
          )}
          {info && <div className="menu-sep" />}
          {signedIn ? (
            <button
              className="menu-item danger"
              onClick={() => {
                close()
                void invoke('account:logout')
              }}
            >
              {t('toolbar.logout')}
            </button>
          ) : (
            <button
              className="menu-item"
              disabled={account.status === 'signingIn'}
              onClick={() => {
                close()
                login()
              }}
            >
              {t('toolbar.login')}
            </button>
          )}
        </>
      )}
    </Dropdown>
  )
}
