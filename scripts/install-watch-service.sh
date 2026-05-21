#!/bin/bash
# installs a systemd service that runs `npm run watch` in the llms repo
# usage: sudo ./scripts/install-watch-service.sh

SERVICE_NAME=llms-watch
WORKDIR=$(pwd)
# determine the real user so service doesn't run as root; when invoked via sudo,
# SUDO_USER is the original login, otherwise fall back to whoami
USER=${SUDO_USER:-$(whoami)}

cat <<EOF | sudo tee /etc/systemd/system/${SERVICE_NAME}.service
[Unit]
Description=llms auto-rebuild watcher
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${WORKDIR}
# perform a build immediately on service start (errors ignored)
ExecStartPre=/bin/bash -lc 'npm run rebuild-all || true'
# disable start-up timeout so the long electron build can complete
TimeoutStartSec=0
ExecStart=/bin/bash -lc 'npm run watch'
Restart=always
RestartSec=5
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE_NAME}.service
sudo systemctl start ${SERVICE_NAME}.service

echo "service ${SERVICE_NAME}.service installed and started"