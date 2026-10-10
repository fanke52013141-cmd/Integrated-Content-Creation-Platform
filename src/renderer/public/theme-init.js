// 应用仅提供浅色模式，在首屏绘制前覆盖旧版本的深色偏好。
;(function () {
  document.documentElement.dataset.theme = 'light'
  document.documentElement.style.colorScheme = 'light'
  try {
    localStorage.removeItem('moliu:theme')
  } catch (e) {
    // 存储不可用也不影响浅色初始化。
  }
})()
