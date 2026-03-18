# MCP Server Integration

AIOS supports [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers as a third pattern type alongside LLM and Tool patterns. MCP tools are auto-discovered at startup and participate in DAG workflows like any other pattern.

## Configuration

Add MCP servers to `aios.yaml` (project-local) or `~/.aios/config.yaml` (global):

```yaml
mcp:
  servers:
    azure-devops:
      command: node
      args: ["C:/Users/rosin-1/repos/mcp-azure_devops/ts/dist/index.js"]
      env:
        AZDO_CONFIG: "C:/path/to/config.json"
      category: devops
      prefix: azdo
      description: "Azure DevOps – Work Items, Git, Tests, Sprints"
```

### Server Config Fields

| Field         | Required | Description                                      |
|---------------|----------|--------------------------------------------------|
| `command`     | yes      | Executable to spawn (e.g. `node`, `python`)      |
| `args`        | no       | Command-line arguments for the server process     |
| `env`         | no       | Additional environment variables for the process  |
| `category`    | no       | Pattern category in AIOS (default: `mcp`)         |
| `prefix`      | no       | Pattern name prefix (default: server name)        |
| `description` | no       | Human-readable description for the catalog        |

## Authentication / PAT Setup

Many MCP servers (e.g. Azure DevOps, GitHub) require a Personal Access Token (PAT) for authentication.

**IMPORTANT: Never store PATs in `aios.yaml` or any file tracked by git.**

### Option 1: `.env` file (recommended)

AIOS loads a `.env` file from the project root at startup (via `dotenv`). The MCP server process inherits all `process.env` variables automatically.

1. Copy the template: `cp .env.example .env`
2. Set the path to your config file:

```env
AZDO_CONFIG=/home/<you>/.local/share/mcp-azure-devops/config.json
```

`.env` is already in `.gitignore` — secrets stay local. This is the same approach used by OpenCode and other tools, so you can point to a shared `config.json` as a single source of truth for PATs.

### Option 2: System Environment Variable

Set the PAT or config path as a system environment variable. The MCP server process inherits all environment variables from AIOS automatically.

**Windows (PowerShell):**
```powershell
# Set for current session
$env:AZDO_CONFIG = "C:/Users/<you>/.local/share/mcp-azure-devops/config.json"

# Set permanently (user-level)
[Environment]::SetEnvironmentVariable("AZDO_CONFIG", "C:/Users/<you>/.local/share/mcp-azure-devops/config.json", "User")
```

**Linux / macOS:**
```bash
# Add to ~/.bashrc or ~/.zshrc
export AZDO_CONFIG="/home/<you>/.local/share/mcp-azure-devops/config.json"
```

### Option 3: External Config File (outside the repo)

If the MCP server requires a config file (e.g. `config.json`), store it **outside** the repository:

```
# Good: outside the repo
~/.local/share/mcp-azure-devops/config.json
~/.aios/azdo-config.json

# BAD: inside the repo (will be committed!)
./config.json
```

Then reference it via `.env` (Option 1) or a system env var (Option 2). You can also set it in `aios.yaml` via the `env` block, but only in your **global** config (`~/.aios/config.yaml`), not the project-local one:

```yaml
# ~/.aios/config.yaml (NOT committed to git)
mcp:
  servers:
    azure-devops:
      command: node
      args: ["/path/to/server.js"]
      env:
        AZDO_CONFIG: "/home/<you>/.local/share/mcp-azure-devops/config.json"
```

**Never put paths to PAT config files in a project-local `aios.yaml` that is tracked by git.**

### Security Checklist

- [ ] PAT is **not** in any file inside the git repository
- [ ] `.env` is listed in `.gitignore` (already the case for AIOS)
- [ ] External config files are stored under `~/.aios/` or another user-private location
- [ ] PAT has minimal required scopes (e.g. Work Items: Read for read-only access)
- [ ] PAT has an expiration date set

## How It Works

### Architecture

```
aios.yaml (mcp.servers config)
    |
McpManager (spawns server processes, caches clients)
    |--- tools/list  -->  PatternRegistry (virtual "mcp" patterns)
    |                         |
    |                    Router sees them in catalog
    |
    '--- tools/call  <--  Engine (executeMcpTool for type "mcp")
```

1. At startup, `McpManager` connects to each configured MCP server via stdio transport
2. It calls `tools/list` to discover available tools
3. Each tool is registered as a virtual pattern with the naming convention `prefix/tool_name`
4. The Router sees MCP patterns in the catalog and can plan workflows using them
5. The Engine calls `tools/call` to execute MCP tools during workflow execution

### Pattern Naming

MCP tools are named `<prefix>/<tool_name>`. The prefix defaults to the server name but can be overridden:

```
azure-devops server + prefix "azdo" => azdo/get_work_item, azdo/list_projects, ...
```

### Input Format

MCP tools expect JSON arguments. When used in a DAG workflow:

- If the previous step outputs JSON, it is parsed and passed as tool arguments
- If the previous step outputs plain text, it is wrapped as `{ "input": "..." }`
- In the REPL, you can pass JSON directly: `/azdo/get_work_item {"id": 42}`
- Slash command params are merged: `/azdo/get_work_item --id=42`

## Usage

### List MCP Tools

```bash
aios patterns list                    # All patterns including MCP
aios patterns list --category devops  # Only MCP DevOps tools
```

### Show Tool Details

```bash
aios patterns show azdo/get_work_item
```

Shows the tool's parameter schema (name, type, required fields).

### Plan with MCP Tools

```bash
aios plan "Zeige mir die aktiven Work Items im aktuellen Sprint"
```

The Router will include MCP steps in the execution plan when appropriate.

### Execute Directly

```bash
echo '{"id": 42}' | aios run azdo/get_work_item
```

### REPL

```
aios chat
aios> /azdo/list_projects
aios> /azdo/get_work_item {"id": 42}
```

## Adding a New MCP Server

1. Add the server to `aios.yaml` under `mcp.servers`
2. Set up authentication (see PAT Setup above)
3. Restart AIOS — tools are auto-discovered
4. Verify with `aios patterns list`

Any MCP-compliant server that supports stdio transport can be added.
