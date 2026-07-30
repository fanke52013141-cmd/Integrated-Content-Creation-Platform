// P1-8: 主题预设脚本，在 React 加载前根据 localStorage 设置 data-theme，避免 FOUC
;(function () {
  try {
    var stored = localStorage.getItem('moliu:theme')
    var theme = stored === 'dark' ? 'dark' : 'light'
    document.documentElement.dataset.theme = theme
    // 同时设置 color-scheme 让原生控件（滚动条、select）匹配
    document.documentElement.style.colorScheme = theme
  } catch (e) {
    // localStorage 不可用时降级到 light
    document.documentElement.dataset.theme = 'light'
  }
})()
