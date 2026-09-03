;(function () {
  var root = document.documentElement
  var toggle = document.getElementById('theme-toggle')
  toggle.addEventListener('click', function () {
    var next = root.dataset.theme === 'dark' ? 'light' : 'dark'
    root.dataset.theme = next
    try {
      localStorage.setItem('fdt-theme', next)
    } catch (e) {}
  })
  // Follow the OS again if the user never picked a theme explicitly.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
    try {
      if (localStorage.getItem('fdt-theme')) return
    } catch (err) {}
    root.dataset.theme = e.matches ? 'dark' : 'light'
  })

  // Resolve the latest release so the download buttons point straight at the arm64 DMG.
  var REPO = 'ihopefulChina/FeishuDevTools'
  fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
    headers: { accept: 'application/vnd.github+json' }
  })
    .then(function (r) {
      return r.ok ? r.json() : null
    })
    .then(function (rel) {
      if (!rel || !rel.assets) return
      var dmg = rel.assets.find(function (a) {
        return /arm64\.dmg$/i.test(a.name)
      })
      var asset =
        dmg ||
        rel.assets.find(function (a) {
          return /\.dmg$/i.test(a.name)
        })
      if (!asset) return
      var mb = (asset.size / 1048576).toFixed(1)
      ;['download-btn', 'download-btn-2'].forEach(function (id) {
        var el = document.getElementById(id)
        if (el) el.href = asset.browser_download_url
      })
      var meta = document.getElementById('download-meta')
      if (meta) meta.textContent = rel.tag_name + ' · Apple Silicon · ' + mb + ' MB'
      var v = document.getElementById('release-version')
      if (v) v.textContent = rel.tag_name
      var rm = document.getElementById('release-meta')
      if (rm) rm.textContent = 'macOS · Apple Silicon (arm64) · ' + asset.name + ' · ' + mb + ' MB'
    })
    .catch(function () {})
})()
