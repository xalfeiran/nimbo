import type { Workspace } from '../../src/types/workspace';

// Example workspaces shown on first run. Hostnames, usernames and key paths
// are placeholders — edit them (or delete the workspaces) from the UI.
export function seedWorkspaces(): Workspace[] {
  return [
    {
      id: 'webroster-prod',
      name: 'WebRoster Production',
      hostLabel: 'Production VPS',
      hostname: '203.0.113.10',
      port: 22,
      username: 'sshuser',
      identityFile: '~/.ssh/webroster_prod',
      remotePath: '/var/www/webroster',
      env: {
        APP_CONTEXT: 'webroster',
        APP_ENV: 'production'
      },
      commands: [
        {
          id: 'laravel-log',
          name: 'Tail Laravel Log',
          command: 'tail -f storage/logs/laravel.log',
          mode: 'terminal',
          isLog: true
        },
        {
          id: 'supervisor-status',
          name: 'Check Supervisor',
          command: 'supervisorctl status',
          mode: 'output'
        },
        {
          id: 'restart-workers',
          name: 'Restart Workers',
          command: 'sudo supervisorctl restart laravel-worker:*',
          mode: 'terminal',
          dangerous: true,
          confirm: true
        }
      ],
      serviceChecks: [
        { id: 'nginx', name: 'Nginx', command: 'systemctl is-active nginx', expected: 'active' },
        { id: 'php-fpm', name: 'PHP-FPM', command: 'systemctl is-active php8.3-fpm', expected: 'active' },
        { id: 'supervisor', name: 'Supervisor', command: 'systemctl is-active supervisor', expected: 'active' }
      ]
    },
    {
      id: 'webroster-staging',
      name: 'WebRoster Staging',
      hostLabel: 'Staging VPS',
      hostname: '203.0.113.11',
      port: 22,
      username: 'sshuser',
      identityFile: '~/.ssh/webroster_staging',
      remotePath: '/var/www/webroster-staging',
      env: {
        APP_CONTEXT: 'webroster',
        APP_ENV: 'staging'
      },
      commands: [
        {
          id: 'laravel-log',
          name: 'Tail Laravel Log',
          command: 'tail -f storage/logs/laravel.log',
          mode: 'terminal',
          isLog: true
        },
        {
          id: 'migrate',
          name: 'Run Migrations',
          command: 'php artisan migrate --force',
          mode: 'terminal',
          dangerous: true,
          confirm: true
        }
      ],
      serviceChecks: [
        { id: 'nginx', name: 'Nginx', command: 'systemctl is-active nginx', expected: 'active' },
        { id: 'php-fpm', name: 'PHP-FPM', command: 'systemctl is-active php8.3-fpm', expected: 'active' }
      ]
    },
    {
      id: 'miquiniela-prod',
      name: 'MiQuiniela Production',
      hostLabel: 'Production VPS',
      hostname: '203.0.113.20',
      port: 22,
      username: 'sshuser',
      identityFile: '~/.ssh/miquiniela_prod',
      remotePath: '/var/www/miquiniela',
      env: {
        APP_CONTEXT: 'miquiniela',
        APP_ENV: 'production'
      },
      commands: [
        {
          id: 'app-log',
          name: 'Tail App Log',
          command: 'tail -f storage/logs/laravel.log',
          mode: 'terminal',
          isLog: true
        },
        {
          id: 'queue-status',
          name: 'Queue Status',
          command: 'php artisan queue:monitor',
          mode: 'output'
        }
      ],
      serviceChecks: [
        { id: 'nginx', name: 'Nginx', command: 'systemctl is-active nginx', expected: 'active' },
        { id: 'php-fpm', name: 'PHP-FPM', command: 'systemctl is-active php8.3-fpm', expected: 'active' }
      ]
    },
    {
      id: 'formfillerx-api',
      name: 'FormFillerX API',
      hostLabel: 'API Server',
      hostname: '203.0.113.30',
      port: 22,
      username: 'sshuser',
      identityFile: '~/.ssh/formfillerx',
      remotePath: '/srv/formfillerx',
      env: {
        APP_CONTEXT: 'formfillerx',
        APP_ENV: 'production'
      },
      commands: [
        {
          id: 'api-log',
          name: 'Tail API Log',
          command: 'journalctl -u formfillerx -f',
          mode: 'terminal',
          isLog: true
        },
        {
          id: 'service-status',
          name: 'Service Status',
          command: 'systemctl status formfillerx --no-pager',
          mode: 'output'
        },
        {
          id: 'restart-api',
          name: 'Restart API',
          command: 'sudo systemctl restart formfillerx',
          mode: 'terminal',
          dangerous: true,
          confirm: true
        }
      ],
      serviceChecks: [
        { id: 'formfillerx', name: 'FormFillerX', command: 'systemctl is-active formfillerx', expected: 'active' },
        { id: 'nginx', name: 'Nginx', command: 'systemctl is-active nginx', expected: 'active' }
      ]
    }
  ];
}
