#!/bin/bash
cd ~/Desktop/snipsnip-site || { echo "ERROR: snipsnip-site folder not found!"; exit 1; }

echo "=== Files being deployed ==="
find . -not -path './.git/*' -not -name '.DS_Store' -not -name '.git' -type f | sort
echo ""
echo "=== API files ==="
ls api/
echo ""

read -p "Deploy these files? (y/n) " confirm
if [ "$confirm" != "y" ]; then echo "Aborted."; exit 0; fi

git add .
git commit -m "${1:-update}"
git push origin main
echo "Deployed!"
