;(function () {
  'use strict'

  var REPO = 'ihopefulChina/FeishuDevTools'
  var SITE_VERSION = '0.1.1'
  var RELEASES_URL = 'https://github.com/' + REPO + '/releases/tag/v' + SITE_VERSION
  var assetPatterns = {
    'mac-arm64-dmg': /-mac-arm64\.dmg$/i,
    'mac-arm64-zip': /-mac-arm64\.zip$/i,
    'mac-x64-dmg': /-mac-x64\.dmg$/i,
    'mac-x64-zip': /-mac-x64\.zip$/i,
    'windows-x64-setup': /-windows-x64-setup\.exe$/i,
    'windows-x64-portable': /-windows-x64-portable\.exe$/i,
    'windows-x64-zip': /-windows-x64\.zip$/i,
    'linux-x64-appimage': /-linux-x64\.AppImage$/i,
    'linux-x64-deb': /-linux-x64\.deb$/i,
    'linux-x64-rpm': /-linux-x64\.rpm$/i,
    'linux-x64-targz': /-linux-x64\.tar\.gz$/i,
    checksums: /^SHA256SUMS\.txt$/i
  }
  var assetsByKey = Object.create(null)
  var environment = { platform: 'unknown', arch: 'unknown' }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return ''
    return (bytes / 1048576).toFixed(bytes >= 104857600 ? 0 : 1) + ' MB'
  }

  function findAsset(assets, key) {
    var pattern = assetPatterns[key]
    return pattern
      ? assets.find(function (asset) {
          return pattern.test(asset.name)
        })
      : null
  }

  function populateAssetLinks(assets) {
    Object.keys(assetPatterns).forEach(function (key) {
      var asset = findAsset(assets, key)
      if (!asset) return
      assetsByKey[key] = asset

      document.querySelectorAll('[data-asset="' + key + '"]').forEach(function (link) {
        link.href = asset.browser_download_url
        link.title = asset.name
        var size = link.querySelector('[data-size]')
        if (size) size.textContent = formatBytes(asset.size)
      })
    })
  }

  function normalizePlatform(value) {
    var platform = String(value || '').toLowerCase()
    if (/win/.test(platform)) return 'windows'
    if (/mac|darwin/.test(platform)) return 'mac'
    if (/linux|x11/.test(platform)) return 'linux'
    return 'unknown'
  }

  function normalizeArch(architecture, bitness) {
    var arch = String(architecture || '').toLowerCase()
    var bits = String(bitness || '')
    if (/arm|aarch/.test(arch) && (!bits || bits === '64')) return 'arm64'
    if (/x86|amd64|x64|win64/.test(arch) && (!bits || bits === '64')) return 'x64'
    return 'unknown'
  }

  function detectEnvironment() {
    var uaData = navigator.userAgentData
    var userAgent = String(navigator.userAgent || '')
    var isMobile = /Android|iPhone|iPad|iPod/i.test(userAgent)
    var isIPadDesktopMode =
      /Mac/i.test(String(navigator.platform || '')) && Number(navigator.maxTouchPoints || 0) > 1
    var fallbackPlatform =
      isMobile || isIPadDesktopMode
        ? 'unknown'
        : normalizePlatform((uaData && uaData.platform) || navigator.platform || userAgent)
    // Safari intentionally reports Apple Silicon Macs as "Intel". Only infer architecture from
    // the legacy UA on Windows/Linux, where an explicit x64/arm64 token is meaningful.
    var fallbackArch =
      fallbackPlatform === 'mac'
        ? 'unknown'
        : normalizeArch(userAgent.match(/arm64|aarch64|amd64|x86_64|win64/i)?.[0])

    if (!uaData || typeof uaData.getHighEntropyValues !== 'function') {
      return Promise.resolve({ platform: fallbackPlatform, arch: fallbackArch })
    }

    return uaData
      .getHighEntropyValues(['architecture', 'bitness', 'platform'])
      .then(function (values) {
        var detectedArch = normalizeArch(values.architecture, values.bitness)
        return {
          platform:
            isMobile || isIPadDesktopMode
              ? 'unknown'
              : normalizePlatform(values.platform || fallbackPlatform),
          arch: detectedArch === 'unknown' ? fallbackArch : detectedArch
        }
      })
      .catch(function () {
        return { platform: fallbackPlatform, arch: fallbackArch }
      })
  }

  function preferredAssetKey(env) {
    if (env.platform === 'windows' && env.arch === 'x64') return 'windows-x64-setup'
    if (env.platform === 'linux' && env.arch === 'x64') return 'linux-x64-appimage'
    if (env.platform === 'mac' && env.arch === 'arm64') return 'mac-arm64-dmg'
    if (env.platform === 'mac' && env.arch === 'x64') return 'mac-x64-dmg'
    return null
  }

  function refreshPrimaryDownload() {
    var key = preferredAssetKey(environment)
    var asset = key ? assetsByKey[key] : null
    var label = '选择适合我的版本'
    var note = 'macOS Apple Silicon / Intel · Windows x64 · Linux x64'
    var href = '#downloads'

    if (environment.platform === 'windows' && environment.arch === 'x64') {
      label = '下载 Windows x64 安装版'
      note = '已识别 Windows · x64 NSIS 安装器 · 当前未签名'
      href = asset ? asset.browser_download_url : RELEASES_URL
    } else if (environment.platform === 'windows') {
      label = '选择 Windows x64 版本'
      note =
        environment.arch === 'arm64'
          ? '已识别 Windows arm64；当前仅提供 x64 构建，请确认系统兼容性后下载'
          : '已识别 Windows；当前提供 x64 安装版、便携版与 ZIP'
    } else if (environment.platform === 'linux' && environment.arch === 'x64') {
      label = '下载 Linux x64 AppImage'
      note = '已识别 Linux · x64 AppImage · 另有 DEB / RPM / tar.gz'
      href = asset ? asset.browser_download_url : RELEASES_URL
    } else if (environment.platform === 'linux') {
      label = '选择 Linux x64 版本'
      note =
        environment.arch === 'arm64'
          ? '已识别 Linux arm64；0.1.1 暂无 arm64 构建，请勿下载 x64 包'
          : '已识别 Linux；当前提供 x64 AppImage / DEB / RPM / tar.gz'
    } else if (environment.platform === 'mac' && environment.arch === 'arm64') {
      label = '下载 macOS Apple Silicon 版'
      note = '已识别 macOS arm64 · DMG · 包内 App 为 ad-hoc 签名，未公证'
      href = asset ? asset.browser_download_url : RELEASES_URL
    } else if (environment.platform === 'mac' && environment.arch === 'x64') {
      label = '下载 macOS Intel 版'
      note = '已识别 macOS x64 · DMG · 包内 App 为 ad-hoc 签名，未公证'
      href = asset ? asset.browser_download_url : RELEASES_URL
    } else if (environment.platform === 'mac') {
      label = '选择 Mac 芯片版本'
      note = '已识别 macOS；请选择 Apple Silicon（M 系列）或 Intel，官网不会猜测芯片'
    }

    document.querySelectorAll('[data-primary-download]').forEach(function (link) {
      link.textContent = label
      link.href = href
    })
    document.querySelectorAll('[data-platform-note]').forEach(function (element) {
      element.textContent = note
    })
    document.querySelectorAll('[data-platform-row]').forEach(function (row) {
      row.classList.toggle('is-detected', row.dataset.platformRow === environment.platform)
    })
  }

  function populateRelease(release) {
    if (!release || !Array.isArray(release.assets)) return
    var version = String(release.tag_name || '').replace(/^v/, '')
    // The website is versioned with the source tree. While a tag is still building, GitHub's
    // "latest" endpoint may point at the previous release; never let that stale response rewrite
    // the page or send a user to an older platform package.
    if (version !== SITE_VERSION) return

    populateAssetLinks(release.assets)
    var published = release.published_at
      ? new Intl.DateTimeFormat('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(new Date(release.published_at))
      : ''

    document.querySelectorAll('[data-release-summary]').forEach(function (element) {
      element.textContent =
        'FeishuDevTools ' + version + (published ? ' · ' + published + ' 发布' : '') + ' · SHA-256'
    })
    document.querySelectorAll('[data-release-name]').forEach(function (element) {
      element.textContent = 'FEISHUDEVTOOLS / ' + version
    })
    refreshPrimaryDownload()
  }

  detectEnvironment().then(function (detected) {
    environment = detected
    refreshPrimaryDownload()
  })

  fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
    headers: { accept: 'application/vnd.github+json' }
  })
    .then(function (response) {
      return response.ok ? response.json() : null
    })
    .then(populateRelease)
    .catch(function () {
      refreshPrimaryDownload()
    })
})()
