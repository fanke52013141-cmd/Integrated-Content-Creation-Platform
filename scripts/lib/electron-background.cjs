const { app, BrowserWindow } = require('electron')
const { pathToFileURL } = require('node:url')
const { resolve } = require('node:path')

// Set before importing the app, so even ready-to-show cannot activate the desktop.
BrowserWindow.prototype.show = function () {}
BrowserWindow.prototype.showInactive = function () {}
BrowserWindow.prototype.focus = function () {}
app.on('browser-window-created', (_event, window) => window.webContents.setBackgroundThrottling(false))
import(pathToFileURL(resolve('out/main/index.js')).href).catch(error => {
  console.error('Background application failed:', error.message)
  app.exit(1)
})
