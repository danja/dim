import logger from 'loglevel'

/**
 * Logging setup for the server and the tools.
 *
 *   LOG_LEVEL=trace|debug|info|warn|error   (default info)
 *   LOG_FORMAT=json                          one JSON object per line, for a log collector
 *   LOG_REQUESTS=1                           one line per HTTP request (server)
 *
 * In JSON mode a plain-object argument becomes fields of the line; an Error
 * adds its stack.
 */

export function jsonLine (level, args, now = new Date()) {
  const line = { time: now.toISOString(), level }
  const words = []
  for (const arg of args) {
    if (arg instanceof Error) {
      words.push(arg.message)
      line.stack = arg.stack
    } else if (arg && typeof arg === 'object') {
      Object.assign(line, arg)
    } else {
      words.push(String(arg))
    }
  }
  if (words.length) line.msg = words.join(' ')
  return JSON.stringify(line)
}

export function configureLogging (env = process.env) {
  if (/^json$/i.test(env.LOG_FORMAT ?? '')) {
    logger.methodFactory = level => (...args) => {
      const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout
      stream.write(`${jsonLine(level, args)}\n`)
    }
  }
  logger.setLevel(env.LOG_LEVEL || 'info')
  return { requests: /^(1|true|yes)$/i.test(env.LOG_REQUESTS ?? '') }
}

export default configureLogging
