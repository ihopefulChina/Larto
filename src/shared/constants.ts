import type { FeishuEnv } from './settings'

export const APP_NAME = 'FeishuDevTools'
export const GITHUB_REPO = 'ihopefulChina/FeishuDevTools'
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`
export const WEBSITE_URL = 'https://ihopefulchina.github.io/FeishuDevTools/'
export const FEISHU_H5_DOCS_URL =
  'https://open.feishu.cn/document/client-docs/h5/development-guide/h5-development-guide'
export const OFFICIAL_TOOL_DOCS_URL =
  'https://open.feishu.cn/document/tools-and-resources/development-tools/overview-of-ide'

/** `app_id=7` is the Open Platform's own application id used by the official tool. */
export const OPEN_PLATFORM_APP_ID = '7'

export interface EnvEndpoints {
  /** Root domain, e.g. feishu.cn */
  domain: string
  passport: string
  open: string
  /** Default page shown in the simulator before the user enters a URL. */
  defaultPage: string
  /** Login success redirect target used by the official IDE login flow. */
  loginSuccessPage: string
}

export const ENV_ENDPOINTS: Record<FeishuEnv, EnvEndpoints> = {
  feishu: {
    domain: 'feishu.cn',
    passport: 'https://passport.feishu.cn',
    open: 'https://open.feishu.cn',
    defaultPage:
      'https://sf1-cdn-tos.huoshanstatic.com/obj/larkdeveloper/opdev/staticPage/h5_zh_CN.html',
    loginSuccessPage:
      'https://open.feishu.cn/miniprogram/api/v4/opdev_ide/pages/success.html?lang=zh-CN'
  },
  lark: {
    domain: 'larksuite.com',
    passport: 'https://passport.larksuite.com',
    open: 'https://open.larksuite.com',
    defaultPage:
      'https://sf1-cdn-tos.huoshanstatic.com/obj/larkdeveloper/opdev/staticPage/h5_lark_en_US.html',
    loginSuccessPage:
      'https://open.larksuite.com/miniprogram/api/v4/opdev_ide/pages/success.html?lang=en-US'
  }
}

/** Official default pages must not be written into the address bar (§7). */
export const DEFAULT_PAGE_PATTERN = /\/h5_.+\.html$/

export function buildLoginUrl(env: FeishuEnv, lang: 'zh-CN' | 'en-US'): string {
  const ep = ENV_ENDPOINTS[env]
  const redirect = encodeURIComponent(ep.loginSuccessPage)
  return `${ep.passport}/accounts/page/login?app_id=${OPEN_PLATFORM_APP_ID}&redirect_uri=${redirect}&lang=${lang}`
}

/** Deep link that opens an H5 page inside the Feishu mobile client (§6). */
export function buildMobilePreviewSchema(url: string, appId?: string): string {
  const params = new URLSearchParams({ isDev: '1', url })
  if (appId) params.set('app_id', appId)
  return `lark://client/web?${params.toString()}`
}

export const LARK_OPEN_SCHEMA = 'lark://client/open'

/** Session partitions. `persist:` keeps cookies on disk like the official tool. */
export const GUEST_PARTITION = 'persist:h5-guest'
export const LOGIN_PARTITION_PREFIX = 'login-'
