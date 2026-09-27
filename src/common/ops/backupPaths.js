import path from 'path'

/**
 * Where backups go and what they hold, for bin/backup.js, bin/restore.js
 * and /health alike. The data files are the ones that are slow to rebuild
 * (embedding everything again takes hours on a CPU).
 */
export function backupPaths (config, projectRoot, env = process.env) {
  const index = path.resolve(projectRoot, config.get('index.path'))
  const dataDir = path.dirname(index)
  const related = path.join(dataDir, 'related')
  return {
    root: path.resolve(projectRoot, env.BACKUP_DIR || 'data/backups'),
    dataDir,
    data: [index, `${index}.json`, `${related}.index`, `${related}.index.json`, `${related}.state.json`],
    cacheDir: path.join(dataDir, 'cache')
  }
}

export default backupPaths
