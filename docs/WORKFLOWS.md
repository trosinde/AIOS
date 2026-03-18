> **Audience:** Developers

# Workflow Patterns

AIOS maps natural-language tasks to workflow patterns drawn from Gregor Hohpe and Bobby Woolf's *Enterprise Integration Patterns* (Addison-Wesley, 2003). The Router (itself an LLM call) selects the appropriate pattern; the DAG Engine (`core/engine.ts`) executes it.

---

## 1. EIP Mapping

### Implemented

| EIP Pattern | AIOS Realization | Implementation | EIP Reference |
|-------------|-----------------|----------------|---------------|
| **Pipes and Filters** | `aios run p1 \| aios run p2` -- Unix pipes | `cli.ts` stdout -> stdin | Ch. 3, p. 70 |
| **Content-Based Router** | Router analyzes task, selects patterns | `router.ts` -- LLM-based | Ch. 3, p. 230 |
| **Scatter-Gather** | Parallel agents + aggregation | `engine.ts` -- `Promise.all` | Ch. 3, p. 297 |
| **Process Manager** | DAG engine with topological sort | `engine.ts` -- event loop | Ch. 5, p. 312 |
| **Message Store** | Result Store (`Map<stepId, StepResult>`) | `engine.ts` -- in-memory | Ch. 6, p. 555 |
| **Aggregator** | `aggregate_reviews` pattern | Pattern + Engine | Ch. 3, p. 268 |
| **Saga** | Retry -> escalation -> rollback (compensation) | `engine.ts` -- `compensate` | Garcia-Molina/Salem, 1987 |
| **Dead Letter Channel** | Failed steps -> status `"failed"` + error log | `engine.ts` -- stderr | Ch. 6, p. 119 |
| **Wire Tap** | Logging on stderr (Unix convention) | All components | Ch. 6, p. 547 |
| **Claim Check** | Tool patterns: input -> temp file -> tool -> output file | `engine.ts` -- `executeTool` | Ch. 6, p. 346 |

> *Reference:* Hohpe, G. & Woolf, B. (2003). *Enterprise Integration Patterns.* Addison-Wesley.

### Planned

| EIP Pattern | Planned Realization | EIP Reference |
|-------------|---------------------|---------------|
| **Publish-Subscribe** | Event bus for persona-to-persona communication | Ch. 3, p. 106 |
| **Message Broker** | Central message routing between agents | Ch. 7, p. 322 |
| **Idempotent Receiver** | Deduplication on retry | Ch. 10, p. 528 |
| **Correlation Identifier** | Workflow-wide tracing ID across steps | Ch. 6, p. 163 |

---

## 2. The Problem with Pure Pipes

Pipes are sequential. Every step waits for the previous one to finish:

```
Input ----> Agent A ----> Agent B ----> Agent C ----> Output
             30s           30s           30s
                                                    = 90 seconds total
```

But many steps are independent. A code review does not need to wait for the security review, and vice versa:

```
             +----> Security Review  (30s) ---+
Input -----> +----> Code Quality     (30s) ---+----> Aggregate ----> Output
             +----> Architecture     (30s) ---+
                                                    = 30s + aggregation
                                                    ~ 45 seconds total
```

Halving the wall-clock time for the same amount of work. This is the **Scatter-Gather** pattern from the Enterprise Integration Patterns.

---

## 3. Scatter-Gather (Fan-Out / Fan-In)

### Concept

```
                 SCATTER (Fan-Out)                GATHER (Fan-In)
                 ================                 ===============

                 +-------------------+
                 |  Security Expert  |
           +---->|  security_review  |-----+
           |     +-------------------+     |
           |                               |
+--------+ |     +-------------------+     |     +--------------+
|        | |     |  Code Reviewer    |     |     |              |
| Input  |-+---->|  code_review      |-----+---->|  Aggregator  |---> Output
| (stdin)|       +-------------------+     |     | aggregate_   |
|        | |                               |     | reviews      |
+--------+ |     +-------------------+     |     +--------------+
           |     |  Architect        |     |
           +---->|  architecture_    |-----+
                 |  review           |
                 +-------------------+

           ^                               ^
           |                               |
       SAME input                     ALL results
       goes to ALL                    are COLLECTED
       agents                         and MERGED
```

### What Happens at Runtime

```
Timeline:
=====================================================================

t=0s     Scatter: send input to all 3 agents concurrently
         |
         +-- API call 1: system=security_review.md,      user=<code>
         +-- API call 2: system=code_review.md,           user=<code>
         +-- API call 3: system=architecture_review.md,   user=<code>

         (All 3 run in PARALLEL via Promise.all)

t=25s    Security Expert responds first  --> store result
t=30s    Architect responds              --> store result
t=35s    Code Reviewer responds last     --> store result

         Promise.all resolves: all 3 results available.

t=35s    Gather: merge all results
         |
         +-- API call 4: system=aggregate_reviews.md
                          user= "SECURITY REVIEW:\n" + result1
                              + "CODE REVIEW:\n"     + result2
                              + "ARCHITECTURE:\n"    + result3

t=45s    Aggregator responds --> final result to stdout

Total: ~45 seconds instead of ~105 seconds sequential
=====================================================================
```

> **EIP Reference:** This corresponds to the *Scatter-Gather* pattern (Hohpe/Woolf, Ch. 3) --
> a *Composed Message Processor* that distributes a message to multiple recipients (fan-out)
> and merges their responses via an *Aggregator* (fan-in). In AIOS: `engine.ts` uses
> `Promise.all` for scatter, a dedicated aggregator pattern for gather.

---

## 4. DAG with Dependencies

Not all steps are independent. Sometimes there is a **directed acyclic graph (DAG)** of dependencies:

```
                 +---------------+
                 | 1. Analyze    |
                 | Requirements  |
                 +-------+-------+
                         |
                 +-------+-------+
                 | 2. Design     |
                 | Solution      |
                 +-------+-------+
                         |
            +------------+------------+
            |            |            |
     +------+------+ +--+-------+ +--+----------+
     | 3a. Generate| | 3b. Write| | 3c. Threat  |
     |    Code     | |   Tests  | |    Model    |
     +------+------+ +--+-------+ +--+----------+
            |            |            |
            |     +------+------+     |
            +---->| 4. Run Tests|<----+  (needs 3a + 3b)
                  +------+------+
                         |
            +------------+------------+
            |            |            |
     +------+------+----+----+-------+-------+
     | All results from 3a, 3b, 3c, 4        |
     +-------+--------+
             |
      +------+------+
      | 5. Final    |
      | Report      |
      +-------------+

Legend:
  1 -> 2          : sequential (2 needs output from 1)
  2 -> 3a,3b,3c   : parallel   (all only need output from 2)
  3a + 3b -> 4    : join       (4 needs Code AND Tests)
  all -> 5        : barrier    (Report needs everything)
```

### Execution Timeline

```
t=0s     Step 1: Analyze Requirements
         --> wait for result

t=30s    Step 2: Design Solution (input: output of step 1)
         --> wait for result

t=60s    Steps 3a, 3b, 3c start IN PARALLEL
         +-- 3a: Generate Code   (input: design)
         +-- 3b: Write Tests     (input: design + requirements)
         +-- 3c: Threat Model    (input: design)

t=90s    3c done (Threat Model)  --> stored, waiting
t=95s    3a done (Code)          --> stored; can step 4 start?
                                     No -- 3b still running
t=100s   3b done (Tests)         --> stored; can step 4 start?
                                     Yes! Code (3a) + Tests (3b) both ready

t=100s   Step 4: Run Tests (input: code + tests)
         --> wait for result

t=120s   Step 4 done --> can step 5 start?
                         Yes! 3a + 3b + 3c + 4 all complete

t=120s   Step 5: Final Report (input: ALL previous outputs)

t=140s   DONE.

         Sequential would be: 30+30+30+30+30+30+30 = 210s
         With DAG:            30+30+40+20+20        = 140s  (33% faster)
=====================================================================
```

> **EIP Reference:** This is the *Process Manager* pattern (Hohpe/Woolf, Ch. 5) -- a
> central coordinator that controls message flow across multiple processing steps.
> Topological sort of the DAG determines execution order. The *Message Store*
> (Result Store) persists intermediate results and enables dependency resolution.

---

## 5. Saga with Error Handling

What happens when a step fails? In regulated environments you cannot simply skip ahead.

### Happy Path

```
Analyze ---> Design ---> Implement ---> Test ---> Review ---> DONE
```

### Error at Test -- Retry with Feedback

```
Analyze ---> Design ---> Implement ---> Test ---> FAIL
                              ^           |
                              |           | Feedback: "Test X failed
                              |           |  because function Y has
                              |           |  no null check"
                              |           |
                              +-----------+
                              Retry #1: Developer receives
                              feedback + original task
```

The error message from the failed test is not discarded -- it becomes input for the retry attempt. The developer agent sees: "Here is the original task, here is the code you wrote, and here is why it failed."

### Retry Also Fails -- Escalation

```
Analyze ---> Design ---> Implement ---> Test ---> FAIL (retry #1)
                ^                         |
                |                         | Feedback: "Fundamental
                |                         |  design issue detected"
                |                         |
                +-------------------------+
                Escalation: back to Architect
                with all collected findings
```

When retries are exhausted and the `escalate_to` field is set, execution jumps back to a higher-level step. The Architect receives all accumulated context: the original task, the design, the implementation attempt, and the test failures.

### Error at Review after Successful Test

```
... ---> Implement ---> Test (pass) ---> Review ---> REJECTED
              ^                            |
              |                            | Findings:
              |                            |  CRITICAL: SQL Injection
              |                            |  MAJOR: No input validation
              |                            |
              +----------------------------+
              Developer receives:
              - Original task
              - Review findings
              - Test results (still valid)
              --> Must ONLY fix the findings
```

### Saga Configuration in Execution Plan

Each step can declare retry, escalation, and compensation behavior:

```json
{
  "id": "implement",
  "pattern": "generate_code",
  "depends_on": ["design"],
  "input_from": ["design"],
  "retry": {
    "max": 2,
    "on_failure": "retry_with_feedback",
    "escalate_to": "design"
  },
  "quality_gate": {
    "pattern": "evaluate_quality",
    "min_score": 7
  },
  "compensate": {
    "pattern": "refactor",
    "input_from": ["implement"]
  }
}
```

> **EIP Reference:** This combines the *Saga* pattern (Garcia-Molina/Salem, 1987) with
> the *Process Manager* (Hohpe/Woolf, Ch. 5). Compensation logic (retry -> escalation
> -> rollback) implements semantic undo via `compensate` functions. Failed steps land
> in the *Dead Letter Channel* (stderr + status `"failed"`), comparable to Hohpe/Woolf's
> *Invalid Message Channel*.

---

## 6. Result Store

The Engine maintains an in-memory Result Store that tracks step status and enables dependency resolution:

```
+---------------------------------------------+
|              Result Store                    |
|                                             |
|  Step          Status      Output           |
|  -----------   ---------   ---------------  |
|  analyze       done        "REQ-001, ..."   |
|  design        done        "API Design..."  |
|  gen_code      done        "function ..."   |
|  gen_tests     running     -                |
|  threat        done        "STRIDE ..."     |
|  run_tests     blocked     -                |
|  report        blocked     -                |
|                                             |
|  Dependency Check:                          |
|  run_tests needs: gen_code [done]           |
|                 + gen_tests [running]        |
|  --> WAIT                                   |
+---------------------------------------------+

... gen_tests completes ...

+---------------------------------------------+
|  gen_tests     done        "test('auth'..." |
|  run_tests     blocked --> CAN START!       |
|                                             |
|  Dependency Check:                          |
|  run_tests needs: gen_code [done]           |
|                 + gen_tests [done]           |
|  --> START                                  |
+---------------------------------------------+
```

This is a **topological sort** of the DAG combined with an **event loop** that checks for ready steps after each step finishes.

Implementation: `Map<string, StepResult>` and `Map<string, StepStatus>` in `engine.ts`.

> **EIP Reference:** The *Message Store* (Hohpe/Woolf, Ch. 6) persists messages for
> later retrieval. In AIOS, the Result Store serves the same purpose: downstream steps
> retrieve upstream outputs by step ID.

---

## 7. Dynamic Pattern Selection by the Router

The Router (itself an LLM call in `router.ts` via `planWorkflow()`) selects the workflow pattern based on task analysis:

| Task Characteristic | Router Recognizes | Selected Pattern |
|---------------------|-------------------|-----------------|
| Simple, single discipline | "Summarize this" | `pipe` -- Pipes and Filters (1-2 steps) |
| Multi-perspective | "Review this code" | `scatter_gather` -- parallel agents + aggregator |
| Dependent steps | "Implement feature X" | `dag` -- Process Manager with topo sort |
| Regulated with quality gates | "Feature with compliance" | `saga` -- DAG + retry + rollback |

The Router uses pattern metadata (`parallelizable_with`, `can_follow`, `depends_on`) as hints but makes autonomous decisions based on the concrete task. Its output is a JSON `ExecutionPlan` with `type`, `steps`, `analysis`, and `reasoning`.

### ExecutionPlan Type Field

```typescript
type: "pipe" | "scatter_gather" | "dag" | "saga"
```

- **pipe** -- Linear chain. Each step feeds into the next. Simplest form.
- **scatter_gather** -- Fan-out to parallel agents, fan-in through aggregator.
- **dag** -- Directed acyclic graph with explicit `depends_on` edges.
- **saga** -- DAG with `retry`, `quality_gate`, and `compensate` on critical steps.

Implementation: `src/core/router.ts` (planning), `src/core/engine.ts` (execution).
