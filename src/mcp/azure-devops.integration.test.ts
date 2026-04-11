/**
 * Integration tests for the Azure DevOps MCP server proxy.
 *
 * These tests hit the REAL Azure DevOps (TFS) instance via the MCP server.
 * They use the INFRA project with AreaPath "LabTec Infrastructure\DAX Team".
 *
 * Prerequisites:
 *   - azdo-config.json in repo root with INFRA project configured
 *   - MCP server built: /mnt/c/Users/rosin-1/repos/mcp-azure_devops/ts/dist/index.js
 *
 * Run:
 *   AZDO_INTEGRATION=1 npx vitest run src/mcp/azure-devops-integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { McpManager } from "../core/mcp.js";
import type { McpConfig } from "../types.js";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

// ─── Config (all paths configurable via env vars for CI) ─
const AZDO_CONFIG_PATH = resolve(
  process.env.AZDO_CONFIG_PATH ?? resolve(process.cwd(), "azdo-config.json"),
);
const MCP_SERVER_PATH = process.env.MCP_AZDO_SERVER_PATH
  ?? "/mnt/c/Users/rosin-1/repos/mcp-azure_devops/ts/dist/index.js";
const PROJECT = process.env.AZDO_PROJECT ?? "INFRA";
const AREA_PATH = process.env.AZDO_AREA_PATH ?? "LabTec Infrastructure\\DAX Team";
const SERVER_NAME = "azure-devops";

// Skip if not explicitly opted in (these hit real infra)
const RUN_INTEGRATION = process.env.AZDO_INTEGRATION === "1";

// Work item ID created during test run (for update/comment tests)
let createdWorkItemId: number | undefined;

function buildMcpConfig(): McpConfig {
  return {
    servers: {
      [SERVER_NAME]: {
        command: "node",
        args: [MCP_SERVER_PATH],
        env: { AZDO_CONFIG: AZDO_CONFIG_PATH },
        category: "devops",
        prefix: "azdo",
        description: "Azure DevOps Integration Test",
      },
    },
  };
}

/** Parse JSON result from MCP tool call */
function parseResult(text: string): unknown {
  return JSON.parse(text);
}

describe.skipIf(!RUN_INTEGRATION)("Azure DevOps MCP Integration Tests", () => {
  let manager: McpManager;

  beforeAll(async () => {
    // Verify prerequisites
    if (!existsSync(AZDO_CONFIG_PATH)) {
      throw new Error(`azdo-config.json not found at ${AZDO_CONFIG_PATH}`);
    }
    if (!existsSync(MCP_SERVER_PATH)) {
      throw new Error(`MCP server not found at ${MCP_SERVER_PATH}. Run 'npm run build' in mcp-azure_devops/ts/`);
    }

    // Verify INFRA project is configured
    const configData = JSON.parse(readFileSync(AZDO_CONFIG_PATH, "utf-8"));
    if (!configData.projects?.[PROJECT]) {
      throw new Error(`Project "${PROJECT}" not found in azdo-config.json`);
    }

    manager = new McpManager(buildMcpConfig());
    // Pre-connect so individual tests don't timeout on first connect
    await manager.connect(SERVER_NAME);
  }, 60_000);

  afterAll(async () => {
    // Cleanup: close created test work item if any
    if (createdWorkItemId && manager) {
      try {
        await manager.callTool(SERVER_NAME, "update_work_item", {
          id: createdWorkItemId,
          project: PROJECT,
          fields: { "System.State": "Removed" },
        });
      } catch { /* best effort cleanup */ }
    }

    if (manager) {
      await manager.shutdown();
    }
  }, 15_000);

  // ─── Connection & Discovery ────────────────────────────

  describe("Connection & Discovery", () => {
    it("is connected to the azure-devops MCP server", () => {
      expect(manager.isConnected(SERVER_NAME)).toBe(true);
    });

    it("discovers tools from the server", async () => {
      const tools = await manager.listTools(SERVER_NAME);
      expect(tools.length).toBeGreaterThan(10);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("ping");
      expect(toolNames).toContain("list_projects");
      expect(toolNames).toContain("get_work_item");
      expect(toolNames).toContain("update_work_item");
      expect(toolNames).toContain("create_work_item");
      expect(toolNames).toContain("execute_wiql");
      expect(toolNames).toContain("query_work_items");
      expect(toolNames).toContain("add_work_item_comment");
      expect(toolNames).toContain("add_work_item_relation");
    }, 15_000);

    it("ping returns server info", async () => {
      const result = await manager.callTool(SERVER_NAME, "ping", {});
      const parsed = parseResult(result) as Record<string, unknown>;
      // Ping returns {serverVersion, projects, timeout, timestamp}
      expect(parsed.serverVersion).toBeDefined();
      expect(parsed.projects).toBeDefined();
      expect(parsed.timestamp).toBeDefined();
    }, 15_000);
  });

  // ─── Project & Configuration ───────────────────────────

  describe("Project & Configuration", () => {
    it("list_projects includes INFRA", async () => {
      const result = await manager.callTool(SERVER_NAME, "list_projects", {});
      // list_projects returns an array directly, not wrapped in {projects: [...]}
      const projects = parseResult(result) as Array<{ shortname: string; baseUrl: string }>;
      expect(Array.isArray(projects)).toBe(true);
      const shortnames = projects.map((p) => p.shortname);
      expect(shortnames).toContain(PROJECT);
    }, 15_000);

    it("list_projects shows baseUrl for INFRA", async () => {
      const result = await manager.callTool(SERVER_NAME, "list_projects", {});
      const projects = parseResult(result) as Array<{ shortname: string; baseUrl: string }>;
      const infra = projects.find((p) => p.shortname === PROJECT);
      expect(infra).toBeDefined();
      expect(infra!.baseUrl).toContain("LabTec");
    }, 15_000);
  });

  // ─── WIQL Queries ──────────────────────────────────────

  describe("WIQL Queries", () => {
    it("execute_wiql returns work items from DAX Team area", async () => {
      const wiql = `SELECT [System.Id], [System.Title], [System.State] FROM WorkItems WHERE [System.AreaPath] UNDER '${AREA_PATH}' AND [System.State] <> 'Removed' ORDER BY [System.ChangedDate] DESC`;
      const result = await manager.callTool(SERVER_NAME, "execute_wiql", {
        wiql,  // param name is 'wiql', not 'query'
        project: PROJECT,
      });
      const parsed = parseResult(result) as Record<string, unknown>;
      // Response: {items, totalCount, offset, limit}
      expect(parsed).toHaveProperty("items");
      expect(parsed).toHaveProperty("totalCount");
      expect(typeof parsed.totalCount).toBe("number");
    }, 30_000);

    it("execute_wiql with limit works", async () => {
      const wiql = `SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.AreaPath] UNDER '${AREA_PATH}' ORDER BY [System.Id] DESC`;
      const result = await manager.callTool(SERVER_NAME, "execute_wiql", {
        wiql,
        project: PROJECT,
        limit: 5,
      });
      const parsed = parseResult(result) as Record<string, unknown>;
      const items = parsed.items as unknown[];
      expect(items.length).toBeLessThanOrEqual(5);
    }, 30_000);

    it("execute_wiql with offset + limit for pagination", async () => {
      const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.AreaPath] UNDER '${AREA_PATH}' ORDER BY [System.Id] DESC`;
      const result = await manager.callTool(SERVER_NAME, "execute_wiql", {
        wiql,
        project: PROJECT,
        offset: 2,
        limit: 3,
      });
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.offset).toBe(2);
      const items = parsed.items as unknown[];
      expect(items.length).toBeLessThanOrEqual(3);
    }, 30_000);

    it("execute_wiql with invalid WIQL returns error", async () => {
      await expect(
        manager.callTool(SERVER_NAME, "execute_wiql", {
          wiql: "THIS IS NOT VALID WIQL",
          project: PROJECT,
        })
      ).rejects.toThrow();
    }, 15_000);
  });

  // ─── query_work_items ──────────────────────────────────

  describe("query_work_items", () => {
    it("queries with fields and filters", async () => {
      // query_work_items requires 'fields' array and optional 'filters' object
      const result = await manager.callTool(SERVER_NAME, "query_work_items", {
        project: PROJECT,
        fields: ["System.Id", "System.Title", "System.State", "System.AreaPath"],
        filters: {
          "System.AreaPath": AREA_PATH,
        },
        top: 5,
      });
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed).toHaveProperty("items");
    }, 30_000);

    it("queries with state filter", async () => {
      const result = await manager.callTool(SERVER_NAME, "query_work_items", {
        project: PROJECT,
        fields: ["System.Id", "System.Title", "System.State"],
        filters: {
          "System.AreaPath": AREA_PATH,
          "System.State": "Active",
        },
        top: 3,
      });
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed).toHaveProperty("items");
    }, 30_000);

    it("queries with work item type filter", async () => {
      const result = await manager.callTool(SERVER_NAME, "query_work_items", {
        project: PROJECT,
        fields: ["System.Id", "System.Title", "System.WorkItemType"],
        filters: {
          "System.AreaPath": AREA_PATH,
          "System.WorkItemType": "Task",
        },
        top: 3,
      });
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed).toHaveProperty("items");
    }, 30_000);
  });

  // ─── Create Work Item ──────────────────────────────────

  describe("create_work_item", () => {
    it("creates a Task in DAX Team area", async () => {
      const result = await manager.callTool(SERVER_NAME, "create_work_item", {
        project: PROJECT,
        workItemType: "Task",
        fields: {
          "System.Title": "[AIOS Integration Test] Test Task - can be deleted",
          "System.AreaPath": AREA_PATH,
          "System.Description": "Automated integration test task created by AIOS MCP test suite. Safe to delete.",
          "System.Tags": "aios-test; auto-generated",
        },
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBeDefined();
      expect(typeof parsed.id).toBe("number");
      expect(parsed.rev).toBe(1);

      createdWorkItemId = parsed.id as number;
    }, 30_000);

    it("created work item has correct fields", async () => {
      expect(createdWorkItemId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "get_work_item", {
        id: createdWorkItemId,
        project: PROJECT,
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      const fields = parsed.fields as Record<string, unknown>;
      expect(fields["System.Title"]).toContain("[AIOS Integration Test]");
      expect(fields["System.WorkItemType"]).toBe("Task");
      expect(String(fields["System.AreaPath"])).toContain("DAX Team");
    }, 15_000);

    it("create_work_item with missing required fields fails", async () => {
      await expect(
        manager.callTool(SERVER_NAME, "create_work_item", {
          project: PROJECT,
          workItemType: "Task",
          fields: {},  // missing Title
        })
      ).rejects.toThrow();
    }, 15_000);
  });

  // ─── Get Work Item ─────────────────────────────────────

  describe("get_work_item", () => {
    it("retrieves existing work item by ID", async () => {
      expect(createdWorkItemId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "get_work_item", {
        id: createdWorkItemId,
        project: PROJECT,
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBe(createdWorkItemId);
      expect(parsed.fields).toBeDefined();
      expect(parsed.url).toBeDefined();
    }, 15_000);

    it("get_work_item with non-existent ID fails", async () => {
      await expect(
        manager.callTool(SERVER_NAME, "get_work_item", {
          id: 999999999,
          project: PROJECT,
        })
      ).rejects.toThrow();
    }, 15_000);
  });

  // ─── Update Work Item (THE BUG AREA) ──────────────────

  describe("update_work_item", () => {
    it("updates a simple string field (System.Tags)", async () => {
      expect(createdWorkItemId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "update_work_item", {
        id: createdWorkItemId,
        project: PROJECT,
        fields: {
          "System.Tags": "aios-test; auto-generated; updated",
        },
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBe(createdWorkItemId);
      expect(parsed.rev).toBeGreaterThan(1);
    }, 15_000);

    it("updates System.Title field", async () => {
      expect(createdWorkItemId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "update_work_item", {
        id: createdWorkItemId,
        project: PROJECT,
        fields: {
          "System.Title": "[AIOS Integration Test] Updated Title - can be deleted",
        },
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBe(createdWorkItemId);

      // Verify the update
      const verify = await manager.callTool(SERVER_NAME, "get_work_item", {
        id: createdWorkItemId,
        project: PROJECT,
      });
      const verifyParsed = parseResult(verify) as Record<string, unknown>;
      const fields = verifyParsed.fields as Record<string, unknown>;
      expect(fields["System.Title"]).toContain("Updated Title");
    }, 15_000);

    it("updates HTML field (AcceptanceCriteria) - reproduces original bug scenario", async () => {
      expect(createdWorkItemId).toBeDefined();

      // This is the exact scenario that was failing when fields was passed as string
      const htmlContent = `<h3>Activities (Cat C - CI/CD integrated)</h3>
<ul>
  <li>[ ] <strong>1. Security Risk Assessment (SRA)</strong> - Completed per product</li>
  <li>[ ] <strong>2. SBOM Generation</strong> - CI/CD integrated</li>
  <li>[ ] <strong>3. SCA Vulnerability Scan</strong> - Continuous</li>
  <li>[ ] <strong>4. Penetration Testing</strong> - Completed per product</li>
  <li>[ ] <strong>5. Vulnerability Management</strong> - Enterprise process integrated</li>
  <li>[ ] <strong>7. Security Testing (SAST)</strong> - Per release, CI/CD integrated</li>
</ul>`;

      const result = await manager.callTool(SERVER_NAME, "update_work_item", {
        id: createdWorkItemId,
        project: PROJECT,
        fields: {
          "Microsoft.VSTS.Common.AcceptanceCriteria": htmlContent,
        },
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBe(createdWorkItemId);
      expect(parsed.rev).toBeGreaterThan(1);
    }, 15_000);

    it("updates multiple fields at once", async () => {
      expect(createdWorkItemId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "update_work_item", {
        id: createdWorkItemId,
        project: PROJECT,
        fields: {
          "System.Title": "[AIOS Integration Test] Multi-field update - can be deleted",
          "System.Tags": "aios-test; multi-field; updated",
          "System.Description": "<p>Updated description via multi-field update test.</p>",
        },
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBe(createdWorkItemId);
    }, 15_000);

    it("BUG REPRO: fields as JSON STRING causes TF400645", async () => {
      expect(createdWorkItemId).toBeDefined();

      // This reproduces the original bug: fields passed as a JSON string
      // instead of an object. Object.entries() on a string iterates characters,
      // producing field names "0", "1", etc. → TF400645: Missing or unsupported field id 0
      await expect(
        manager.callTool(SERVER_NAME, "update_work_item", {
          id: createdWorkItemId,
          project: PROJECT,
          fields: '{"System.Tags": "this-is-a-string-not-object"}',
        })
      ).rejects.toThrow();
    }, 15_000);

    it("update_work_item with non-existent work item ID fails", async () => {
      await expect(
        manager.callTool(SERVER_NAME, "update_work_item", {
          id: 999999999,
          project: PROJECT,
          fields: { "System.Tags": "test" },
        })
      ).rejects.toThrow();
    }, 15_000);

    it("update_work_item with invalid field name fails", async () => {
      expect(createdWorkItemId).toBeDefined();

      await expect(
        manager.callTool(SERVER_NAME, "update_work_item", {
          id: createdWorkItemId,
          project: PROJECT,
          fields: { "System.NonExistentField12345": "test" },
        })
      ).rejects.toThrow();
    }, 15_000);

    it("updates State field", async () => {
      expect(createdWorkItemId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "update_work_item", {
        id: createdWorkItemId,
        project: PROJECT,
        fields: {
          "System.State": "Active",
        },
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBe(createdWorkItemId);

      // Verify
      const verify = await manager.callTool(SERVER_NAME, "get_work_item", {
        id: createdWorkItemId,
        project: PROJECT,
      });
      const verifyParsed = parseResult(verify) as Record<string, unknown>;
      const fields = verifyParsed.fields as Record<string, unknown>;
      expect(fields["System.State"]).toBe("Active");
    }, 15_000);
  });

  // ─── Comments ──────────────────────────────────────────

  describe("add_work_item_comment", () => {
    it("adds a comment to work item", async () => {
      expect(createdWorkItemId).toBeDefined();

      // The param name is 'comment', not 'text'
      const result = await manager.callTool(SERVER_NAME, "add_work_item_comment", {
        id: createdWorkItemId,
        project: PROJECT,
        comment: "[AIOS Test] Integration test comment - can be deleted",
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBeDefined();
    }, 15_000);

    it("adds HTML comment to work item", async () => {
      expect(createdWorkItemId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "add_work_item_comment", {
        id: createdWorkItemId,
        project: PROJECT,
        comment: "<p><strong>AIOS Test</strong>: HTML comment with <em>formatting</em></p>",
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBeDefined();
    }, 15_000);
  });

  // ─── Work Item Revisions ───────────────────────────────

  describe("get_work_item_revisions", () => {
    it("returns revision history for test work item", async () => {
      expect(createdWorkItemId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "get_work_item_revisions", {
        id: createdWorkItemId,
        project: PROJECT,
      });

      // Returns array of revisions directly
      const revisions = parseResult(result) as unknown[];
      expect(Array.isArray(revisions)).toBe(true);
      // We've made multiple updates, so there should be multiple revisions
      expect(revisions.length).toBeGreaterThan(1);
    }, 15_000);
  });

  // ─── Iterations ────────────────────────────────────────

  describe("get_iterations", () => {
    it("returns iterations for INFRA project", async () => {
      const result = await manager.callTool(SERVER_NAME, "get_iterations", {
        project: PROJECT,
      });

      // Returns array of iterations directly
      const iterations = parseResult(result) as unknown[];
      expect(Array.isArray(iterations)).toBe(true);
      expect(iterations.length).toBeGreaterThan(0);
    }, 15_000);
  });

  // ─── Work Items with Relations ─────────────────────────

  describe("get_work_items_with_relations", () => {
    it("retrieves work item with relation data", async () => {
      expect(createdWorkItemId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "get_work_items_with_relations", {
        ids: [createdWorkItemId],
        project: PROJECT,
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      // Response includes items or the work item data
      expect(parsed).toHaveProperty("items");
      const items = parsed.items as Array<{ id: number }>;
      expect(items.length).toBe(1);
      expect(items[0].id).toBe(createdWorkItemId);
    }, 15_000);
  });

  // ─── Repositories ──────────────────────────────────────

  describe("get_repositories", () => {
    it("lists repositories for INFRA project", async () => {
      const result = await manager.callTool(SERVER_NAME, "get_repositories", {
        project: PROJECT,
      });

      // Returns array of repos directly
      const repos = parseResult(result) as unknown[];
      expect(Array.isArray(repos)).toBe(true);
      expect(repos.length).toBeGreaterThan(0);
    }, 15_000);
  });

  // ─── update_work_item_comment ───────────────────────────

  describe("update_work_item_comment", () => {
    let testCommentId: number | undefined;

    it("creates a comment via update_work_item_comment (upsert)", async () => {
      expect(createdWorkItemId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "update_work_item_comment", {
        id: createdWorkItemId,
        project: PROJECT,
        text: "[AIOS Test] Comment created via update_work_item_comment upsert",
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBeDefined();
      testCommentId = parsed.id as number;
    }, 15_000);

    it("updates existing comment by commentId", async () => {
      expect(createdWorkItemId).toBeDefined();
      expect(testCommentId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "update_work_item_comment", {
        id: createdWorkItemId,
        project: PROJECT,
        text: "[AIOS Test] Comment updated via update_work_item_comment",
        commentId: testCommentId,
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBeDefined();
    }, 15_000);

    it("updates most recent comment when commentId omitted", async () => {
      expect(createdWorkItemId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "update_work_item_comment", {
        id: createdWorkItemId,
        project: PROJECT,
        text: "[AIOS Test] Most recent comment updated (no commentId)",
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBeDefined();
    }, 15_000);
  });

  // ─── add_work_item_comment error paths ─────────────────

  describe("add_work_item_comment error paths", () => {
    it("comment on non-existent work item fails", async () => {
      await expect(
        manager.callTool(SERVER_NAME, "add_work_item_comment", {
          id: 999999999,
          project: PROJECT,
          comment: "This should fail",
        })
      ).rejects.toThrow();
    }, 15_000);
  });

  // ─── add_work_item_relation ────────────────────────────

  describe("add_work_item_relation", () => {
    let secondWorkItemId: number | undefined;

    it("creates a second work item for relation test", async () => {
      const result = await manager.callTool(SERVER_NAME, "create_work_item", {
        project: PROJECT,
        workItemType: "Task",
        fields: {
          "System.Title": "[AIOS Integration Test] Relation Target - can be deleted",
          "System.AreaPath": AREA_PATH,
          "System.Tags": "aios-test; relation-target",
        },
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBeDefined();
      secondWorkItemId = parsed.id as number;
    }, 30_000);

    it("adds Related relation between work items", async () => {
      expect(createdWorkItemId).toBeDefined();
      expect(secondWorkItemId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "add_work_item_relation", {
        id: createdWorkItemId,
        targetId: secondWorkItemId,
        relationType: "Related",
        project: PROJECT,
        comment: "AIOS integration test relation",
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBe(createdWorkItemId);
      expect(parsed.message).toContain("Relation added");
    }, 15_000);

    it("relation is visible in get_work_items_with_relations", async () => {
      expect(createdWorkItemId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "get_work_items_with_relations", {
        ids: [createdWorkItemId],
        project: PROJECT,
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      const items = parsed.items as Array<{ id: number; relations?: unknown[] }>;
      expect(items.length).toBe(1);
      // Should have at least one relation now
      expect(items[0].relations).toBeDefined();
      expect((items[0].relations as unknown[]).length).toBeGreaterThan(0);
    }, 15_000);

    it("relation to non-existent target fails", async () => {
      expect(createdWorkItemId).toBeDefined();

      await expect(
        manager.callTool(SERVER_NAME, "add_work_item_relation", {
          id: createdWorkItemId,
          targetId: 999999999,
          relationType: "Related",
          project: PROJECT,
        })
      ).rejects.toThrow();
    }, 15_000);

    it("cleanup: remove second work item", async () => {
      if (secondWorkItemId) {
        const result = await manager.callTool(SERVER_NAME, "update_work_item", {
          id: secondWorkItemId,
          project: PROJECT,
          fields: { "System.State": "Removed" },
        });
        const parsed = parseResult(result) as Record<string, unknown>;
        expect(parsed.id).toBe(secondWorkItemId);
      }
    }, 15_000);
  });

  // ─── get_commits ───────────────────────────────────────

  describe("get_commits", () => {
    let repoId: string | undefined;

    it("gets a repository ID for commit tests", async () => {
      const result = await manager.callTool(SERVER_NAME, "get_repositories", {
        project: PROJECT,
      });
      const repos = parseResult(result) as Array<{ id: string; name: string }>;
      expect(repos.length).toBeGreaterThan(0);
      repoId = repos[0].id;
    }, 15_000);

    it("lists commits for a repository", async () => {
      expect(repoId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "get_commits", {
        repositoryId: repoId,
        project: PROJECT,
        top: 5,
      });

      const commits = parseResult(result) as unknown[];
      expect(Array.isArray(commits)).toBe(true);
      expect(commits.length).toBeLessThanOrEqual(5);
    }, 15_000);

    it("get_commits with invalid repositoryId fails", async () => {
      await expect(
        manager.callTool(SERVER_NAME, "get_commits", {
          repositoryId: "non-existent-repo-id-12345",
          project: PROJECT,
        })
      ).rejects.toThrow();
    }, 15_000);
  });

  // ─── get_pull_requests ─────────────────────────────────

  describe("get_pull_requests", () => {
    let repoId: string | undefined;

    it("gets a repository ID for PR tests", async () => {
      const result = await manager.callTool(SERVER_NAME, "get_repositories", {
        project: PROJECT,
      });
      const repos = parseResult(result) as Array<{ id: string }>;
      expect(repos.length).toBeGreaterThan(0);
      repoId = repos[0].id;
    }, 15_000);

    it("lists active pull requests", async () => {
      expect(repoId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "get_pull_requests", {
        repositoryId: repoId,
        project: PROJECT,
        status: "active",
      });

      const prs = parseResult(result) as unknown[];
      expect(Array.isArray(prs)).toBe(true);
    }, 15_000);

    it("lists completed pull requests", async () => {
      expect(repoId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "get_pull_requests", {
        repositoryId: repoId,
        project: PROJECT,
        status: "completed",
      });

      const prs = parseResult(result) as unknown[];
      expect(Array.isArray(prs)).toBe(true);
    }, 15_000);

    it("get_pull_requests with invalid repositoryId fails", async () => {
      await expect(
        manager.callTool(SERVER_NAME, "get_pull_requests", {
          repositoryId: "non-existent-repo-12345",
          project: PROJECT,
        })
      ).rejects.toThrow();
    }, 15_000);
  });

  // ─── Edge Cases & Robustness ───────────────────────────

  describe("Edge Cases", () => {
    it("handles empty fields object in update gracefully", async () => {
      expect(createdWorkItemId).toBeDefined();

      // Empty fields object - should either succeed as no-op or fail gracefully
      try {
        const result = await manager.callTool(SERVER_NAME, "update_work_item", {
          id: createdWorkItemId,
          project: PROJECT,
          fields: {},
        });
        // If it succeeds, the result should still be valid
        const parsed = parseResult(result) as Record<string, unknown>;
        expect(parsed.id).toBe(createdWorkItemId);
      } catch (err) {
        // Empty patch may be rejected - that's also acceptable
        expect(String(err)).toBeTruthy();
      }
    }, 15_000);

    it("handles special characters in field values", async () => {
      expect(createdWorkItemId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "update_work_item", {
        id: createdWorkItemId,
        project: PROJECT,
        fields: {
          "System.Description": '<p>Special chars: &amp; &lt; &gt; "quotes" \'apostrophes\' Umlaute: äöüÄÖÜß</p>',
        },
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBe(createdWorkItemId);
    }, 15_000);

    it("handles unicode in Description (not Tags - TFS rejects emoji in tags)", async () => {
      expect(createdWorkItemId).toBeDefined();

      // TFS rejects emoji/special unicode in Tags (TF401407), but Description accepts HTML
      const result = await manager.callTool(SERVER_NAME, "update_work_item", {
        id: createdWorkItemId,
        project: PROJECT,
        fields: {
          "System.Description": "<p>Unicode: äöüß ñ ü 日本語 ✓ ✗</p>",
        },
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBe(createdWorkItemId);
    }, 15_000);

    it("handles long HTML content in Description", async () => {
      expect(createdWorkItemId).toBeDefined();

      // Build a long HTML body
      const items = Array.from({ length: 50 }, (_, i) =>
        `<li>Item ${i + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit.</li>`
      ).join("\n");
      const longHtml = `<h2>Long Content Test</h2><ul>\n${items}\n</ul>`;

      const result = await manager.callTool(SERVER_NAME, "update_work_item", {
        id: createdWorkItemId,
        project: PROJECT,
        fields: {
          "System.Description": longHtml,
        },
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBe(createdWorkItemId);
    }, 30_000);

    it("sequential updates increment revision", async () => {
      expect(createdWorkItemId).toBeDefined();

      const result1 = await manager.callTool(SERVER_NAME, "update_work_item", {
        id: createdWorkItemId,
        project: PROJECT,
        fields: { "System.Tags": "aios-test; sequential-1" },
      });
      const parsed1 = parseResult(result1) as Record<string, unknown>;
      const rev1 = parsed1.rev as number;

      const result2 = await manager.callTool(SERVER_NAME, "update_work_item", {
        id: createdWorkItemId,
        project: PROJECT,
        fields: { "System.Description": "<p>Sequential update 2</p>" },
      });
      const parsed2 = parseResult(result2) as Record<string, unknown>;
      const rev2 = parsed2.rev as number;

      expect(rev2).toBeGreaterThan(rev1);
    }, 30_000);

    it("emoji in Tags correctly rejected by TFS", async () => {
      expect(createdWorkItemId).toBeDefined();

      // TFS rejects emoji/special chars in tag names with TF401407
      await expect(
        manager.callTool(SERVER_NAME, "update_work_item", {
          id: createdWorkItemId,
          project: PROJECT,
          fields: { "System.Tags": "emoji-🔧" },
        })
      ).rejects.toThrow();
    }, 15_000);
  });

  // ─── Cleanup ───────────────────────────────────────────

  describe("Cleanup", () => {
    it("sets test work item to Removed state", async () => {
      expect(createdWorkItemId).toBeDefined();

      const result = await manager.callTool(SERVER_NAME, "update_work_item", {
        id: createdWorkItemId,
        project: PROJECT,
        fields: {
          "System.State": "Removed",
        },
      });

      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.id).toBe(createdWorkItemId);

      // Clear so afterAll doesn't try again
      createdWorkItemId = undefined;
    }, 15_000);
  });
});
