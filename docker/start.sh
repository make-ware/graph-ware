#!/bin/sh
set -e

echo "Starting services with Supervisor..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf



