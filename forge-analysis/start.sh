#!/bin/bash
cd /home/z/my-project
pkill -f "next dev" 2>/dev/null; sleep 2
NODE_OPTIONS="--max-old-space-size=3072" nohup bun run dev >> dev.log 2>&1 &
disown
echo "Forge starting on port 3000..."
for i in $(seq 1 20); do sleep 3; if curl -s --max-time 5 http://localhost:3000/api/forge/stats > /dev/null 2>&1; then echo "UP!"; exit 0; fi; done
echo "Failed"; exit 1
