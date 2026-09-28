import fs from 'fs'

/**
 * A lock file holding the owner's pid, so the server and bin/related.js
 * don't sync the same index at once. A lock left by a dead process is taken
 * over. → release function, or null while another live process holds it
 */
export async function takeLock (lockPath) {
  try {
    await fs.promises.writeFile(lockPath, String(process.pid), { flag: 'wx' })
    return () => fs.promises.rm(lockPath, { force: true })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const pid = Number(await fs.promises.readFile(lockPath, 'utf8').catch(() => ''))
    if (pid && pid !== process.pid && alive(pid)) return null
    await fs.promises.rm(lockPath, { force: true })
    return takeLock(lockPath)
  }
}

function alive (pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

export default takeLock
