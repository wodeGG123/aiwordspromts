#!/bin/bash

# Remote server details
HOST="8.137.38.227"
USER="root"
PASSWORD="~?G-is5y3e&mmk3"

# Execute commands via SSH with TTY allocation for pm2
sshpass -p "$PASSWORD" ssh -t -o StrictHostKeyChecking=no "$USER@$HOST" "cd ~/aitransfer/aiwordspromts && git pull && pm2 restart 2"
