#!/bin/bash
# Fix Cloudflare tunnel config for ai.example.com

CONFIG_FILE="/etc/cloudflared/config.yml"
BACKUP_FILE="/etc/cloudflared/config.yml.bak.$(date +%Y%m%d_%H%M%S)"

# Backup current config
sudo cp "$CONFIG_FILE" "$BACKUP_FILE"
echo "Backed up config to $BACKUP_FILE"

# Remove duplicate ai.example.com entry (port 3000) and keep only port 5053
sudo python3 << 'EOF'
import re

with open("/etc/cloudflared/config.yml", "r") as f:
    lines = f.readlines()

# Find and remove the first ai.example.com entry (pointing to port 3000)
new_lines = []
skip_next = False
ai_count = 0

for i, line in enumerate(lines):
    if skip_next:
        skip_next = False
        continue
    
    # Check if this is an ai.example.com entry pointing to port 3000
    if "hostname: ai.example.com" in line:
        ai_count += 1
        # Check if the next service line points to port 3000
        if i + 1 < len(lines) and "service: http://127.0.0.1:3000" in lines[i + 1]:
            # Skip both the hostname and service lines
            skip_next = True
            print(f"Removed first ai.example.com entry pointing to port 3000")
            continue
    
    new_lines.append(line)

with open("/etc/cloudflared/config.yml", "w") as f:
    f.writelines(new_lines)

print(f"Config updated. Found {ai_count} ai.example.com entries, removed 1")
EOF

# Validate the config
echo ""
echo "Updated config (ai.example.com entries):"
grep -A 1 "ai.example.com" /etc/cloudflared/config.yml

echo ""
echo "Restarting cloudflared service..."
sudo systemctl restart cloudflared

# Wait and check status
sleep 2
systemctl status cloudflared --no-pager | head -15

echo ""
echo "Testing local server..."
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:5053

echo ""
echo "Done! The 502 error should be resolved."
