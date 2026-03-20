#!/usr/bin/env bash
set -euo pipefail

# ─── Colors ───────────────────────────────────────────────
CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
step() { echo -e "\n${CYAN}${BOLD}▸ $1${NC}"; }

# ─── Banner ───────────────────────────────────────────────
echo -e "${CYAN}"
cat << 'BANNER'
     █████╗ ██╗ ██████╗ ███████╗
    ██╔══██╗██║██╔═══██╗██╔════╝
    ███████║██║██║   ██║███████╗
    ██╔══██║██║██║   ██║╚════██║
    ██║  ██║██║╚██████╔╝███████║
    ╚═╝  ╚═╝╚═╝ ╚═════╝ ╚══════╝
     AI Orchestration System
BANNER
echo -e "${NC}"

# ─── Preflight Checks ────────────────────────────────────
step "Preflight Checks"

# Node.js >= 20
if command -v node &> /dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 20 ]; then
    ok "Node.js $NODE_VERSION"
  else
    fail "Node.js $NODE_VERSION gefunden, aber >= 20 benötigt"
    echo "    Installiere: https://nodejs.org/"
    exit 1
  fi
else
  fail "Node.js nicht gefunden"
  echo "    Installiere: https://nodejs.org/ (>= 20)"
  exit 1
fi

# npm
if command -v npm &> /dev/null; then
  ok "npm $(npm -v)"
else
  fail "npm nicht gefunden"
  echo "    npm wird mit Node.js installiert: https://nodejs.org/"
  exit 1
fi

# git
if command -v git &> /dev/null; then
  ok "git $(git --version | cut -d' ' -f3)"
else
  fail "git nicht gefunden"
  echo "    Installiere: https://git-scm.com/"
  exit 1
fi

# ─── Installation ─────────────────────────────────────────
step "AIOS installieren"

AIOS_HOME="$HOME/.aios"
AIOS_REPO="$AIOS_HOME/repo"

mkdir -p "$AIOS_HOME"
mkdir -p "$HOME/.local/bin"

if [ -d "$AIOS_REPO/.git" ]; then
  echo "  Repository existiert, aktualisiere..."
  cd "$AIOS_REPO"
  git pull --quiet origin main
  ok "Repository aktualisiert"
else
  echo "  Klone Repository..."
  git clone --quiet https://github.com/trosinde/AIOS.git "$AIOS_REPO"
  ok "Repository geklont nach $AIOS_REPO"
fi

cd "$AIOS_REPO"

echo "  Installiere Dependencies..."
npm install --silent 2>/dev/null
ok "Dependencies installiert"

echo "  Kompiliere TypeScript..."
npm run build --silent 2>/dev/null
ok "Build erfolgreich"

# ─── Patterns & Personas kopieren ─────────────────────────
step "Patterns & Personas"

if [ ! -d "$AIOS_HOME/patterns" ] && [ -d "$AIOS_REPO/patterns" ]; then
  cp -r "$AIOS_REPO/patterns" "$AIOS_HOME/patterns"
  ok "Patterns kopiert nach $AIOS_HOME/patterns"
else
  ok "Patterns bereits vorhanden"
fi

mkdir -p "$AIOS_HOME/personas"
if [ -d "$AIOS_REPO/personas" ]; then
  # Sync: neue Personas kopieren, existierende nicht überschreiben
  cp -rn "$AIOS_REPO/personas/"* "$AIOS_HOME/personas/" 2>/dev/null || true
  ok "Personas synchronisiert nach $AIOS_HOME/personas"
fi

# ─── CLI Wrapper ──────────────────────────────────────────
step "CLI Wrapper"

WRAPPER="$HOME/.local/bin/aios"
cat > "$WRAPPER" << 'EOF'
#!/usr/bin/env bash
exec node "$HOME/.aios/repo/dist/cli.js" "$@"
EOF
chmod +x "$WRAPPER"
ok "CLI erstellt: $WRAPPER"

# ─── Claude Code MCP Integration ─────────────────────────
step "Claude Code MCP-Server registrieren"

CLAUDE_DIR="$HOME/.claude"
MCP_JSON="$CLAUDE_DIR/.mcp.json"

if [ -d "$CLAUDE_DIR" ]; then
  # Parse MCP servers from aios.yaml and register in ~/.claude/mcp.json
  # Uses node + js-yaml (already an AIOS dependency)
  AIOS_REPO_ABS="$AIOS_REPO" MCP_JSON_PATH="$MCP_JSON" node -e '
    const fs = require("fs");
    const yaml = require(process.env.AIOS_REPO_ABS + "/node_modules/js-yaml/index.js");
    const path = require("path");

    const repoDir = process.env.AIOS_REPO_ABS;
    const mcpPath = process.env.MCP_JSON_PATH;
    const aiosYaml = path.join(repoDir, "aios.yaml");

    if (!fs.existsSync(aiosYaml)) process.exit(0);
    const config = yaml.load(fs.readFileSync(aiosYaml, "utf8"));
    if (!config.mcp?.servers) process.exit(0);

    // Preserve existing non-AIOS servers
    let existing = { mcpServers: {} };
    if (fs.existsSync(mcpPath)) {
      try { existing = JSON.parse(fs.readFileSync(mcpPath, "utf8")); } catch {}
      if (!existing.mcpServers) existing.mcpServers = {};
    }

    for (const [name, srv] of Object.entries(config.mcp.servers)) {
      const env = {};
      if (srv.env) {
        for (const [k, v] of Object.entries(srv.env)) {
          env[k] = String(v).startsWith("./") ? path.resolve(repoDir, v) : v;
        }
      }
      existing.mcpServers[name] = {
        command: srv.command,
        args: srv.args || [],
        ...(Object.keys(env).length > 0 ? { env } : {})
      };
    }

    fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2) + "\n");
    process.stdout.write(String(Object.keys(existing.mcpServers).length));
  '

  if [ $? -eq 0 ] && [ -f "$MCP_JSON" ]; then
    SERVER_COUNT=$(tail -c 10 <<< "$(AIOS_REPO_ABS="$AIOS_REPO" MCP_JSON_PATH="$MCP_JSON" node -e '
      const j = JSON.parse(require("fs").readFileSync(process.env.MCP_JSON_PATH, "utf8"));
      process.stdout.write(String(Object.keys(j.mcpServers).length));
    ')" || echo "0")
    ok "$SERVER_COUNT MCP-Server in $MCP_JSON registriert"
  else
    warn "MCP-Server-Registrierung fehlgeschlagen"
  fi
else
  warn "Claude Code nicht installiert (~/.claude/ fehlt), MCP-Registrierung übersprungen"
fi

# ─── PATH sicherstellen ──────────────────────────────────
step "PATH prüfen"

if echo "$PATH" | tr ':' '\n' | grep -q "$HOME/.local/bin"; then
  ok "\$HOME/.local/bin ist im PATH"
else
  # Detect shell RC file
  SHELL_NAME=$(basename "${SHELL:-bash}")
  if [ "$SHELL_NAME" = "zsh" ]; then
    RC_FILE="$HOME/.zshrc"
  else
    RC_FILE="$HOME/.bashrc"
  fi

  if ! grep -q '\.local/bin' "$RC_FILE" 2>/dev/null; then
    echo '' >> "$RC_FILE"
    echo '# AIOS' >> "$RC_FILE"
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$RC_FILE"
    ok "PATH in $RC_FILE ergänzt"
  else
    ok "PATH-Eintrag bereits vorhanden"
  fi

  # Also export for current session
  export PATH="$HOME/.local/bin:$PATH"
  warn "Starte eine neue Shell oder: source $RC_FILE"
fi

# ─── Configure ────────────────────────────────────────────
step "Konfiguration"

echo ""
echo -e "${BOLD}Starte Setup-Wizard...${NC}"
echo ""

"$WRAPPER" configure
