import packageJson from '../../package.json' with { type: 'json' }

export const CLI_VERSION = packageJson.version
export const DDEV_RUNTIME_SCHEMA = 1
export const DDEV_EVENT_SCHEMA = 1

export const CLI_CAPABILITIES = [
  'agent:update',
  'cli:update',
  `ddev:event-schema@${DDEV_EVENT_SCHEMA}`,
  `ddev:runtime-schema@${DDEV_RUNTIME_SCHEMA}`,
  'ddev:task-sessions',
] as const
