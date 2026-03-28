#!/bin/bash
# fix_deploy.sh
# Run this from inside your geo-rep-lookup folder:
#   cd ~/geo-rep-lookup
#   bash ~/Downloads/fix_deploy.sh
#
# It will add the missing files, clean up .DS_Store, and push to GitHub.

set -e  # stop on any error

echo "=== Step 1: Checking you are in the right folder ==="
if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
  echo "ERROR: Run this script from inside your geo-rep-lookup folder."
  echo "  cd ~/geo-rep-lookup"
  echo "  bash ~/Downloads/fix_deploy.sh"
  exit 1
fi
echo "OK — found backend/ and frontend/"

echo ""
echo "=== Step 2: Writing serve.py ==="
cat > serve.py << 'PYEOF'
"""
serve.py — Single entry point for Railway deployment.

Imports the FastAPI app (which has all /api/v1/* routes already registered),
then mounts the frontend/ static files so the same process serves both.

Railway runs: uvicorn serve:app --host 0.0.0.0 --port $PORT
"""

import sys
from pathlib import Path

# Add backend/ to sys.path so "from app.main import app" resolves
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from app.main import app  # FastAPI instance with all routes registered
from fastapi.staticfiles import StaticFiles

_FRONTEND = Path(__file__).parent / "frontend"

# IMPORTANT: mount AFTER all API routes so /api/v1/* is not intercepted.
# html=True means unknown paths return index.html (single-page app behaviour).
app.mount("/", StaticFiles(directory=str(_FRONTEND), html=True), name="static")
PYEOF
echo "OK — serve.py written"

echo ""
echo "=== Step 3: Writing requirements.txt (root level) ==="
cat > requirements.txt << 'EOF'
# Root-level requirements — Railway reads this file at build time.
# aiofiles is required by FastAPI's StaticFiles to serve the frontend.
fastapi==0.109.0
uvicorn[standard]==0.27.0
pydantic==2.5.3
aiofiles==23.2.1
EOF
echo "OK — requirements.txt written"

echo ""
echo "=== Step 4: Writing railway.toml ==="
cat > railway.toml << 'EOF'
[build]
builder = "nixpacks"

[deploy]
startCommand = "uvicorn serve:app --host 0.0.0.0 --port $PORT"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
EOF
echo "OK — railway.toml written"

echo ""
echo "=== Step 5: Removing .DS_Store from git tracking ==="
git rm --cached .DS_Store 2>/dev/null && echo "Removed .DS_Store" || echo "(.DS_Store not tracked, skipping)"
git rm --cached -r __pycache__ 2>/dev/null || true
git rm --cached -r backend/__pycache__ 2>/dev/null || true
git rm --cached -r backend/app/__pycache__ 2>/dev/null || true

echo ""
echo "=== Step 6: Updating .gitignore ==="
# Add .DS_Store if not already there
grep -q "^\.DS_Store$" .gitignore 2>/dev/null || echo ".DS_Store" >> .gitignore
grep -q "^__pycache__" .gitignore 2>/dev/null || echo "__pycache__/" >> .gitignore
echo "OK — .gitignore updated"

echo ""
echo "=== Step 7: Staging all changes ==="
git add serve.py requirements.txt railway.toml .gitignore
git status

echo ""
echo "=== Step 8: Committing ==="
git commit -m "fix: add Railway deployment files so frontend is served"

echo ""
echo "=== Step 9: Pushing to GitHub ==="
git push

echo ""
echo "======================================================"
echo "DONE! Railway will now auto-redeploy."
echo "Watch the deploy logs at railway.app"
echo ""
echo "Once it says 'Deployment successful', visit:"
echo "  https://geo-rep-lookup-production.up.railway.app"
echo ""
echo "You should see the RepLookup map, not JSON."
echo "======================================================"