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

if command -v claude &> /dev/null; then
  # Parse MCP servers from aios.yaml and register via `claude mcp add`.
  # NUL-separated argv stream → bash array → exec (no eval, no shell parsing).
  MCP_ARGV_FILE=$(mktemp)
  trap 'rm -f "$MCP_ARGV_FILE"' EXIT
  AIOS_REPO_ABS="$AIOS_REPO" MCP_ARGV_OUT="$MCP_ARGV_FILE" node -e '
    const fs = require("fs");
    const yaml = require(process.env.AIOS_REPO_ABS + "/node_modules/js-yaml/index.js");
    const path = require("path");

    const repoDir = process.env.AIOS_REPO_ABS;
    const aiosYaml = path.join(repoDir, "aios.yaml");
    if (!fs.existsSync(aiosYaml)) process.exit(0);
    const config = yaml.load(fs.readFileSync(aiosYaml, "utf8"));
    if (!config.mcp?.servers) process.exit(0);

    const out = fs.openSync(process.env.MCP_ARGV_OUT, "w");
    for (const [name, srv] of Object.entries(config.mcp.servers)) {
      if (typeof srv.command !== "string") continue;
      const argv = ["claude", "mcp", "add", "-s", "user"];
      if (srv.env && typeof srv.env === "object") {
        for (const [k, v] of Object.entries(srv.env)) {
          const resolved = String(v).startsWith("./") ? path.resolve(repoDir, v) : String(v);
          argv.push("-e", `${k}=${resolved}`);
        }
      }
      argv.push("--", String(name), String(srv.command));
      for (const a of (srv.args || [])) argv.push(String(a));
      // Record group: <name>\x1E<argc>\x1E<arg0>\x1E...\x1E<argN>\x00
      fs.writeSync(out, `${name}\x1E${argv.length}\x1E${argv.join("\x1E")}\x00`);
    }
    fs.closeSync(out);
  '

  while IFS= read -r -d "" GROUP; do
    # Split on \x1E (record separator) into a bash array — safe, no eval.
    IFS=$'\x1E' read -r -a PARTS <<< "$GROUP"
    NAME="${PARTS[0]}"
    # PARTS[1] is argc; PARTS[2..] are argv
    claude mcp remove -s user "$NAME" 2>/dev/null || true
    if "${PARTS[@]:2}" 2>/dev/null; then
      ok "  $NAME"
    else
      warn "  $NAME fehlgeschlagen"
    fi
  done < "$MCP_ARGV_FILE"
  rm -f "$MCP_ARGV_FILE"
  trap - EXIT
else
  warn "Claude Code CLI nicht gefunden, MCP-Registrierung übersprungen"
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
