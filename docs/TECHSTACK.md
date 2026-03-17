# 08 – Technische Umsetzung mit Claude Code / OpenCode

## Zielarchitektur

AIOS wird als Python-basiertes CLI-Tool implementiert, das mit Claude Code und OpenCode als interaktive Entwicklungsumgebung genutzt wird.

## Tech Stack

| Komponente | Technologie | Begründung |
|-----------|-------------|------------|
| CLI Framework | `typer` + `rich` | Moderne Python CLI mit schöner Ausgabe |
| Message Bus | Filesystem + `watchdog` | Einfach, debugbar, CLI-kompatibel |
| Knowledge Store | SQLite + ChromaDB | Strukturiert + Vektor-Suche |
| LLM Provider | Anthropic SDK + Ollama | Claude für Reasoning, Ollama für Speed |
| Config | YAML (`pyyaml`) | Menschenlesbar, einfach editierbar |
| Templating | Jinja2 | Für Pattern-Rendering |
| Async | `asyncio` | Parallele Agent-Ausführung |
| Versioning | Git (via `gitpython`) | Knowledge-Versionierung |
| Visualization | Mermaid CLI | Workflow-Diagramme |

## Projektstruktur

```
aios/
├── pyproject.toml           # Projekt-Setup
├── README.md
├── src/
│   └── aios/
│       ├── __init__.py
│       ├── cli.py           # Typer CLI Entry Points
│       ├── core/
│       │   ├── router.py    # Content-Based Router
│       │   ├── bus.py       # Message Bus (Filesystem)
│       │   ├── engine.py    # Workflow Engine
│       │   └── state.py     # State Machine für Sagas
│       ├── agents/
│       │   ├── runtime.py   # Agent Runtime (Prompt-Aufbau + LLM-Call)
│       │   ├── provider.py  # LLM Provider Abstraction
│       │   └── persona.py   # Persona Loader + Manager
│       ├── knowledge/
│       │   ├── store.py     # Knowledge Base (SQLite + ChromaDB)
│       │   ├── extractor.py # Auto-Extraction aus Outputs
│       │   ├── retriever.py # Kontext-Retrieval
│       │   └── models.py    # Data Models (Decision, Fact, Requirement, etc.)
│       ├── patterns/
│       │   ├── loader.py    # Pattern Discovery + Loading
│       │   ├── executor.py  # Pattern Execution
│       │   └── composer.py  # Pattern Composition
│       ├── workflows/
│       │   ├── loader.py    # Workflow Definition Loader
│       │   ├── runner.py    # Workflow Execution Engine
│       │   ├── saga.py      # Saga Pattern Implementation
│       │   └── monitor.py   # Status Tracking + Display
│       ├── reporting/
│       │   ├── generator.py # Report Generation
│       │   ├── traceability.py # Traceability Matrix
│       │   └── templates/   # Report Templates
│       └── utils/
│           ├── config.py    # Configuration Management
│           ├── logging.py   # Structured Logging + Audit
│           └── tokens.py    # Token Counting + Budget
├── patterns/                # Pattern Library (Markdown + YAML)
├── personas/                # Persona Definitions (YAML)
├── workflows/               # Workflow Definitions (YAML)
└── tests/
    ├── test_router.py
    ├── test_bus.py
    ├── test_engine.py
    └── ...
```

## Implementation: Kernkomponenten

### Provider Abstraction

```python
# src/aios/agents/provider.py
from abc import ABC, abstractmethod
import anthropic
import httpx

class LLMProvider(ABC):
    @abstractmethod
    async def complete(self, system: str, user: str, **kwargs) -> str:
        pass

class ClaudeProvider(LLMProvider):
    def __init__(self, model: str = "claude-sonnet-4-20250514"):
        self.client = anthropic.AsyncAnthropic()
        self.model = model
    
    async def complete(self, system: str, user: str, **kwargs) -> str:
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=kwargs.get("max_tokens", 4096),
            system=system,
            messages=[{"role": "user", "content": user}]
        )
        return response.content[0].text

class OllamaProvider(LLMProvider):
    def __init__(self, model: str, endpoint: str = "http://localhost:11434"):
        self.model = model
        self.endpoint = endpoint
    
    async def complete(self, system: str, user: str, **kwargs) -> str:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.endpoint}/api/chat",
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user}
                    ],
                    "stream": False
                },
                timeout=120.0
            )
            return response.json()["message"]["content"]
```

### Agent Runtime

```python
# src/aios/agents/runtime.py
from aios.agents.provider import LLMProvider
from aios.agents.persona import Persona
from aios.knowledge.retriever import KnowledgeRetriever
from aios.patterns.loader import Pattern

class AgentRuntime:
    def __init__(
        self,
        persona: Persona,
        provider: LLMProvider,
        knowledge: KnowledgeRetriever
    ):
        self.persona = persona
        self.provider = provider
        self.knowledge = knowledge
    
    async def execute(self, task: str, pattern: Pattern = None, project: str = None) -> AgentResult:
        # 1. Kontext aus Knowledge Base holen
        context = await self.knowledge.get_relevant_context(
            query=task,
            persona=self.persona.id,
            project=project,
            max_tokens=4000
        )
        
        # 2. System Prompt aufbauen
        system = self._build_system_prompt(pattern, context)
        
        # 3. LLM aufrufen
        response = await self.provider.complete(
            system=system,
            user=task
        )
        
        # 4. Knowledge extrahieren und speichern
        await self._extract_and_store_knowledge(response, project)
        
        # 5. Event publishen
        await self._publish_event(response)
        
        return AgentResult(
            content=response,
            persona=self.persona.id,
            pattern=pattern.name if pattern else None,
            metadata={...}
        )
    
    def _build_system_prompt(self, pattern, context) -> str:
        parts = [self.persona.system_prompt]
        
        if context.decisions:
            parts.append(f"\n## Relevante Entscheidungen\n{context.decisions}")
        if context.facts:
            parts.append(f"\n## Bekannte Fakten\n{context.facts}")
        if context.requirements:
            parts.append(f"\n## Zugehörige Requirements\n{context.requirements}")
        if pattern:
            parts.append(f"\n## Aufgabe (Pattern: {pattern.name})\n{pattern.prompt}")
        
        return "\n".join(parts)
```

### Message Bus

```python
# src/aios/core/bus.py
import json
import asyncio
from pathlib import Path
from datetime import datetime
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

class MessageBus:
    def __init__(self, base_path: Path = Path.home() / ".aios" / "bus"):
        self.base_path = base_path
        self.subscriptions: dict[str, list[callable]] = {}
    
    async def publish(self, topic: str, message: dict, source: str):
        """Publish a message to a topic."""
        msg = {
            "id": f"msg-{datetime.now().strftime('%Y%m%d%H%M%S')}",
            "timestamp": datetime.now().isoformat(),
            "source": source,
            "topic": topic,
            "payload": message
        }
        
        topic_dir = self.base_path / "topics" / topic
        topic_dir.mkdir(parents=True, exist_ok=True)
        
        msg_file = topic_dir / f"{msg['id']}.json"
        msg_file.write_text(json.dumps(msg, indent=2))
        
        # Notify subscribers
        await self._notify_subscribers(topic, msg)
    
    async def subscribe(self, topic: str, handler: callable):
        """Subscribe to a topic."""
        if topic not in self.subscriptions:
            self.subscriptions[topic] = []
        self.subscriptions[topic].append(handler)
    
    async def send_direct(self, target: str, message: dict, source: str):
        """Send a direct message to an agent's inbox."""
        inbox = self.base_path / "inbox" / target
        inbox.mkdir(parents=True, exist_ok=True)
        
        msg_file = inbox / f"msg-{datetime.now().strftime('%Y%m%d%H%M%S')}.json"
        msg_file.write_text(json.dumps({
            "source": source,
            "timestamp": datetime.now().isoformat(),
            "payload": message
        }, indent=2))
```

## Nutzung mit Claude Code

### Setup

```bash
# Repository klonen / erstellen
mkdir ~/aios && cd ~/aios
git init

# Claude Code starten mit Projektkontext
claude --project ~/aios

# Oder mit spezifischem CLAUDE.md
# (Die Konzeptdokumente werden als Kontext genutzt)
```

### CLAUDE.md für das Projekt

```markdown
# AIOS – AI Orchestration System

## Projektbeschreibung
Siehe README.md und Architekturdokumente in /docs/

## Entwicklungsrichtlinien
- Python 3.12+
- Type Hints überall
- Async/Await für I/O-Operationen
- Tests mit pytest + pytest-asyncio
- Code-Stil: Black + Ruff

## Architektur
- CLI: typer + rich
- Message Bus: Filesystem-basiert
- Knowledge: SQLite + ChromaDB
- LLM: Anthropic SDK + Ollama

## Aktueller Fokus
Phase 1: Foundation (CLI-Grundgerüst, Provider, erste Patterns)
```

### Entwicklung mit Claude Code

```bash
# Phase 1: Foundation aufbauen
claude "Erstelle die Grundstruktur für das AIOS CLI basierend auf 
       01-ARCHITECTURE.md. Beginne mit dem CLI Framework (typer), 
       der Provider Abstraction und dem Pattern Loader."

# Iterativ weiterentwickeln
claude "Implementiere den Message Bus basierend auf dem EIP-Konzept 
       in 01-ARCHITECTURE.md. Nutze filesystem-basierte Queues."

# Patterns erstellen
claude "Erstelle die ersten 5 Patterns (summarize, extract_requirements, 
       code_review, security_review, generate_tests) nach dem Format 
       in 04-TOOLS.md"

# Testen
claude "Schreibe Tests für den Router und den Pattern Executor. 
       Nutze pytest mit asyncio."
```

### Nutzung mit OpenCode

OpenCode kann als Alternative zu Claude Code verwendet werden, insbesondere mit Ollama-Backends für schnelle lokale Iterationen:

```bash
# OpenCode mit Ollama für schnelle Pattern-Iteration
opencode --model qwen2.5-coder:32b

# OpenCode für Code-Generierung
opencode "Implementiere den KnowledgeRetriever basierend auf 05-KNOWLEDGE.md"
```

## Deployment auf JARVIS

```bash
# AIOS als Python-Package installieren
cd ~/aios
pip install -e .

# Konfiguration
cat > ~/.aios/config.yaml << 'EOF'
providers:
  claude:
    type: anthropic
    model: claude-sonnet-4-20250514
    api_key_env: ANTHROPIC_API_KEY
  ollama-fast:
    type: ollama
    model: qwen3:235b
    endpoint: http://localhost:11434
  ollama-code:
    type: ollama
    model: qwen2.5-coder:32b
    endpoint: http://localhost:11434

defaults:
  provider: claude
  knowledge_auto_extract: true
  max_context_tokens: 4000

logging:
  level: INFO
  audit: true
  audit_file: ~/.aios/audit.db
EOF

# Erster Test
echo "Analysiere die Sicherheitsaspekte einer REST API" | aios run security_review
```

## Schrittweises Vorgehen mit Claude Code

### Sprint 1 (Phase 1, Woche 1)

```
Aufgabe 1: Projektsetup
- pyproject.toml mit Dependencies
- Verzeichnisstruktur anlegen
- CLI Grundgerüst mit typer

Aufgabe 2: Provider Abstraction
- ClaudeProvider implementieren
- OllamaProvider implementieren
- Provider-Factory mit Config

Aufgabe 3: Pattern System
- Pattern-Format definieren (Frontmatter + Markdown)
- Pattern Loader implementieren
- Pattern Executor (Prompt → Provider → Output)
- 3 Starter-Patterns erstellen
```

### Sprint 2 (Phase 1, Woche 2)

```
Aufgabe 4: CLI Kommandos
- `aios run <pattern>` mit stdin/stdout
- `aios patterns list/search/info`
- `aios config show/set`

Aufgabe 5: Basis-Infrastructure
- Logging + Audit Trail
- Token Counting
- Error Handling

Aufgabe 6: Integration Test
- End-to-End: stdin | aios run pattern | stdout
- Provider-Switching Test
- Pattern-Pipe Test
```

## MCP Server Integration (optional, fortgeschritten)

AIOS kann als MCP Server exponiert werden, sodass Claude Code direkt darauf zugreifen kann:

```python
# Idee: AIOS als MCP Server
# Claude Code kann dann direkt:
# - Patterns aufrufen
# - Personas ansprechen
# - Knowledge abfragen
# - Workflows starten

# Das ermöglicht die nahtlose Integration in die
# bestehende Claude Code Arbeitsweise
```

```json
// .mcp.json (in Claude Code Projekt)
{
  "mcpServers": {
    "aios": {
      "command": "python",
      "args": ["-m", "aios.mcp_server"],
      "env": {
        "AIOS_HOME": "~/.aios"
      }
    }
  }
}
```

Damit kann Claude Code direkt mit AIOS interagieren:

```
Claude Code> Nutze den AIOS Architect um ein Design für die 
             Authentication-Komponente zu erstellen, dann lass 
             den Developer den Code generieren und den Tester 
             die Testfälle schreiben. Erstelle am Ende einen 
             Compliance-Report.
```
