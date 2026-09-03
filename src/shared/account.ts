import type { FeishuEnv } from './settings'

/** Public (non-secret) shape of the signed-in account, safe to send to the renderer. */
export interface AccountUser {
  id: string
  name: string
  displayName: string
  avatar: string
  loginCredentialId: string
}

export interface AccountTenant {
  id: string
  name: string
  avatar: string
  /** Tenant brand as reported by passport, e.g. "feishu" | "lark". */
  brand: string
  /** Only tenants with an active login can be switched to without re-auth. */
  isLogin: boolean
  /** Passport user id bound to this tenant (needed by `/accounts/web/switch`). */
  userId: string
}

export interface AccountInfo {
  env: FeishuEnv
  user: AccountUser
  tenant: AccountTenant
  tenantList: AccountTenant[]
}

export type AccountState =
  | { status: 'signedOut' }
  | { status: 'signingIn' }
  | { status: 'signedIn'; account: AccountInfo }
  | { status: 'expired'; account: AccountInfo }
