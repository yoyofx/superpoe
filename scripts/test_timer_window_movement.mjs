// Run after build:electron:main with node_modules/.bin/electron.cmd.
// Uses an isolated hidden native window and temporary campaign data.
import { app, BrowserWindow } from 'electron'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { TimerWindowManager } from '../dist-electron/electron/timerWindow.js'

app.whenReady().then(async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'superpoe-native-timer-'))
  let manager
  try {
    manager = new TimerWindowManager(path.resolve('dist-electron/electron/timerPreload.cjs'), 'data:text/html,<title>Timer regression</title>', '', path.join(directory, 'bounds.json'), path.join(directory, 'campaign.sqlite'))
    // Keep the test window hidden; never use the user's timer or database.
    const window = manager.ensure()
    const owner = window.webContents.id
    for (const skin of ['obsidian', 'ember', 'frost', 'strip']) {
      manager.setSkin(owner, skin)
      manager.resize(owner, skin === 'strip' ? { width: 350, height: 107 } : { width: 210, height: 210 })
      const before = window.getBounds()
      for (let index = 0; index < 60; index++) {
        manager.moveBy(owner, { x: index % 2 ? 2 : -2, y: index % 2 ? -1 : 1 })
        await new Promise(resolve => setTimeout(resolve, 5))
        const during = window.getBounds()
        // One DIP of outer-rectangle rounding is expected at fractional DPI.
        assert.ok(Math.abs(during.width - before.width) <= 1, `${skin}: width drifted during movement`)
        assert.ok(Math.abs(during.height - before.height) <= 1, `${skin}: height drifted during movement`)
      }
      const after = window.getBounds()
      console.log(JSON.stringify({ skin, before, after }))
      assert.equal(after.width, before.width, `${skin}: movement changed width`)
      assert.equal(after.height, before.height, `${skin}: movement changed height`)
    }
    console.log('Native timer movement passed for all skins.')
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    manager?.dispose()
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
    rmSync(directory, { recursive: true, force: true })
    app.exit(process.exitCode || 0)
  }
}).catch(error => { console.error(error); app.exit(1) })
