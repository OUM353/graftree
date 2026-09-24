import { z } from "zod";
export declare const SCHEMA_VERSION = 1;
export declare const Tier: z.ZodEnum<{
    focused: "focused";
    standard: "standard";
    deep: "deep";
}>;
export type Tier = z.infer<typeof Tier>;
export declare const TIER_DEFAULTS: Record<Tier, {
    maxDepth: number;
    attemptsPerLeaf: number;
}>;
/** A coding agent CLI run non-interactively inside a worktree (CommandCode, OpenCode, claude -p, ...). */
export declare const CliWorker: z.ZodObject<{
    type: z.ZodLiteral<"cli">;
    command: z.ZodArray<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    output: z.ZodDefault<z.ZodEnum<{
        text: "text";
        ndjson: "ndjson";
    }>>;
    timeoutSec: z.ZodDefault<z.ZodNumber>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>;
/** Any OpenAI-compatible chat completions endpoint (OpenRouter, Ollama, vLLM, LM Studio, ...). */
export declare const OpenAICompatibleWorker: z.ZodObject<{
    type: z.ZodLiteral<"openai-compatible">;
    baseUrl: z.ZodString;
    model: z.ZodString;
    apiKeyEnv: z.ZodOptional<z.ZodString>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    maxTurns: z.ZodDefault<z.ZodNumber>;
    timeoutSec: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export declare const WorkerConfig: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"cli">;
    command: z.ZodArray<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    output: z.ZodDefault<z.ZodEnum<{
        text: "text";
        ndjson: "ndjson";
    }>>;
    timeoutSec: z.ZodDefault<z.ZodNumber>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"openai-compatible">;
    baseUrl: z.ZodString;
    model: z.ZodString;
    apiKeyEnv: z.ZodOptional<z.ZodString>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    maxTurns: z.ZodDefault<z.ZodNumber>;
    timeoutSec: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>], "type">;
export type WorkerConfig = z.infer<typeof WorkerConfig>;
export type CliWorker = z.infer<typeof CliWorker>;
export type OpenAICompatibleWorker = z.infer<typeof OpenAICompatibleWorker>;
/** "closer" is reserved: the root agent driving graftree does that role itself. */
export declare const CLOSER = "closer";
export declare const Config: z.ZodObject<{
    version: z.ZodLiteral<1>;
    workers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"cli">;
        command: z.ZodArray<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        output: z.ZodDefault<z.ZodEnum<{
            text: "text";
            ndjson: "ndjson";
        }>>;
        timeoutSec: z.ZodDefault<z.ZodNumber>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"openai-compatible">;
        baseUrl: z.ZodString;
        model: z.ZodString;
        apiKeyEnv: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        maxTokens: z.ZodOptional<z.ZodNumber>;
        maxTurns: z.ZodDefault<z.ZodNumber>;
        timeoutSec: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>], "type">>>;
    roles: z.ZodPrefault<z.ZodObject<{
        planner: z.ZodDefault<z.ZodArray<z.ZodString>>;
        test_writer: z.ZodDefault<z.ZodArray<z.ZodString>>;
        solver: z.ZodDefault<z.ZodArray<z.ZodString>>;
        integrator: z.ZodDefault<z.ZodArray<z.ZodString>>;
        reviewer: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    budgets: z.ZodPrefault<z.ZodObject<{
        attemptsPerLeaf: z.ZodOptional<z.ZodNumber>;
        maxRepairRounds: z.ZodDefault<z.ZodNumber>;
        maxRedecompositions: z.ZodDefault<z.ZodNumber>;
        maxWallMinutes: z.ZodDefault<z.ZodNumber>;
        concurrency: z.ZodDefault<z.ZodNumber>;
        autoSelect: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    ignore: z.ZodDefault<z.ZodArray<z.ZodString>>;
    commands: z.ZodPrefault<z.ZodObject<{
        test: z.ZodOptional<z.ZodString>;
        build: z.ZodOptional<z.ZodString>;
        lint: z.ZodOptional<z.ZodString>;
        setup: z.ZodOptional<z.ZodString>;
        timeoutSec: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Config = z.infer<typeof Config>;
export type Role = keyof Config["roles"];
export declare const NodeId: z.ZodString;
export declare const Contract: z.ZodObject<{
    exposes: z.ZodDefault<z.ZodArray<z.ZodString>>;
    consumes: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const Acceptance: z.ZodObject<{
    files: z.ZodDefault<z.ZodArray<z.ZodString>>;
    command: z.ZodString;
    rubric: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const PlanNode: z.ZodObject<{
    id: z.ZodString;
    parent: z.ZodNullable<z.ZodString>;
    kind: z.ZodEnum<{
        leaf: "leaf";
        split: "split";
    }>;
    goal: z.ZodString;
    contract: z.ZodPrefault<z.ZodObject<{
        exposes: z.ZodDefault<z.ZodArray<z.ZodString>>;
        consumes: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    ownedPaths: z.ZodArray<z.ZodString>;
    sharedPaths: z.ZodDefault<z.ZodArray<z.ZodString>>;
    acceptance: z.ZodObject<{
        files: z.ZodDefault<z.ZodArray<z.ZodString>>;
        command: z.ZodString;
        rubric: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    dependsOn: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type PlanNode = z.infer<typeof PlanNode>;
export declare const Plan: z.ZodObject<{
    tier: z.ZodEnum<{
        focused: "focused";
        standard: "standard";
        deep: "deep";
    }>;
    summary: z.ZodString;
    rationale: z.ZodDefault<z.ZodString>;
    nodes: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        parent: z.ZodNullable<z.ZodString>;
        kind: z.ZodEnum<{
            leaf: "leaf";
            split: "split";
        }>;
        goal: z.ZodString;
        contract: z.ZodPrefault<z.ZodObject<{
            exposes: z.ZodDefault<z.ZodArray<z.ZodString>>;
            consumes: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
        ownedPaths: z.ZodArray<z.ZodString>;
        sharedPaths: z.ZodDefault<z.ZodArray<z.ZodString>>;
        acceptance: z.ZodObject<{
            files: z.ZodDefault<z.ZodArray<z.ZodString>>;
            command: z.ZodString;
            rubric: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        dependsOn: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Plan = z.infer<typeof Plan>;
export type PlanInput = z.input<typeof Plan>;
export declare const RunStatus: z.ZodEnum<{
    draft: "draft";
    awaiting_approval: "awaiting_approval";
    needs_replan: "needs_replan";
    approved: "approved";
    solving: "solving";
    awaiting_closer: "awaiting_closer";
    ready_to_close: "ready_to_close";
    done: "done";
    failed: "failed";
}>;
export type RunStatus = z.infer<typeof RunStatus>;
export declare const NodeStatus: z.ZodEnum<{
    solving: "solving";
    awaiting_closer: "awaiting_closer";
    done: "done";
    failed: "failed";
    planned: "planned";
    verifying: "verifying";
    selected: "selected";
    integrating: "integrating";
    escalated: "escalated";
    redecomposed: "redecomposed";
}>;
export declare const CheckResult: z.ZodObject<{
    ok: z.ZodBoolean;
    exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    log: z.ZodOptional<z.ZodString>;
    violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type CheckResult = z.infer<typeof CheckResult>;
export declare const Gates: z.ZodObject<{
    locked: z.ZodObject<{
        ok: z.ZodBoolean;
        exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        log: z.ZodOptional<z.ZodString>;
        violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
    ownership: z.ZodObject<{
        ok: z.ZodBoolean;
        exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        log: z.ZodOptional<z.ZodString>;
        violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
    build: z.ZodOptional<z.ZodObject<{
        ok: z.ZodBoolean;
        exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        log: z.ZodOptional<z.ZodString>;
        violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    acceptance: z.ZodOptional<z.ZodObject<{
        ok: z.ZodBoolean;
        exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        log: z.ZodOptional<z.ZodString>;
        violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    lint: z.ZodOptional<z.ZodObject<{
        ok: z.ZodBoolean;
        exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        log: z.ZodOptional<z.ZodString>;
        violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Gates = z.infer<typeof Gates>;
export declare const Attempt: z.ZodObject<{
    n: z.ZodNumber;
    kind: z.ZodEnum<{
        solve: "solve";
        integrate: "integrate";
        external: "external";
    }>;
    worker: z.ZodString;
    status: z.ZodEnum<{
        error: "error";
        failed: "failed";
        running: "running";
        passed: "passed";
        disqualified: "disqualified";
    }>;
    startedAt: z.ZodString;
    finishedAt: z.ZodOptional<z.ZodString>;
    branch: z.ZodString;
    worktree: z.ZodOptional<z.ZodString>;
    commit: z.ZodOptional<z.ZodString>;
    repairs: z.ZodDefault<z.ZodNumber>;
    gates: z.ZodOptional<z.ZodObject<{
        locked: z.ZodObject<{
            ok: z.ZodBoolean;
            exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
            log: z.ZodOptional<z.ZodString>;
            violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        ownership: z.ZodObject<{
            ok: z.ZodBoolean;
            exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
            log: z.ZodOptional<z.ZodString>;
            violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        build: z.ZodOptional<z.ZodObject<{
            ok: z.ZodBoolean;
            exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
            log: z.ZodOptional<z.ZodString>;
            violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
        acceptance: z.ZodOptional<z.ZodObject<{
            ok: z.ZodBoolean;
            exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
            log: z.ZodOptional<z.ZodString>;
            violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
        lint: z.ZodOptional<z.ZodObject<{
            ok: z.ZodBoolean;
            exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
            log: z.ZodOptional<z.ZodString>;
            violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    diffStat: z.ZodOptional<z.ZodObject<{
        files: z.ZodNumber;
        insertions: z.ZodNumber;
        deletions: z.ZodNumber;
    }, z.core.$strip>>;
    score: z.ZodOptional<z.ZodNumber>;
    review: z.ZodOptional<z.ZodString>;
    reviewVerdict: z.ZodOptional<z.ZodEnum<{
        unknown: "unknown";
        pass: "pass";
        concerns: "concerns";
        fail: "fail";
    }>>;
    notes: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type Attempt = z.infer<typeof Attempt>;
export declare const NodeState: z.ZodObject<{
    id: z.ZodString;
    parent: z.ZodNullable<z.ZodString>;
    kind: z.ZodEnum<{
        leaf: "leaf";
        split: "split";
    }>;
    goal: z.ZodString;
    contract: z.ZodPrefault<z.ZodObject<{
        exposes: z.ZodDefault<z.ZodArray<z.ZodString>>;
        consumes: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    ownedPaths: z.ZodArray<z.ZodString>;
    sharedPaths: z.ZodDefault<z.ZodArray<z.ZodString>>;
    acceptance: z.ZodObject<{
        files: z.ZodDefault<z.ZodArray<z.ZodString>>;
        command: z.ZodString;
        rubric: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    dependsOn: z.ZodDefault<z.ZodArray<z.ZodString>>;
    status: z.ZodEnum<{
        solving: "solving";
        awaiting_closer: "awaiting_closer";
        done: "done";
        failed: "failed";
        planned: "planned";
        verifying: "verifying";
        selected: "selected";
        integrating: "integrating";
        escalated: "escalated";
        redecomposed: "redecomposed";
    }>;
    base: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    targetAttempts: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    attempts: z.ZodDefault<z.ZodArray<z.ZodObject<{
        n: z.ZodNumber;
        kind: z.ZodEnum<{
            solve: "solve";
            integrate: "integrate";
            external: "external";
        }>;
        worker: z.ZodString;
        status: z.ZodEnum<{
            error: "error";
            failed: "failed";
            running: "running";
            passed: "passed";
            disqualified: "disqualified";
        }>;
        startedAt: z.ZodString;
        finishedAt: z.ZodOptional<z.ZodString>;
        branch: z.ZodString;
        worktree: z.ZodOptional<z.ZodString>;
        commit: z.ZodOptional<z.ZodString>;
        repairs: z.ZodDefault<z.ZodNumber>;
        gates: z.ZodOptional<z.ZodObject<{
            locked: z.ZodObject<{
                ok: z.ZodBoolean;
                exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
                log: z.ZodOptional<z.ZodString>;
                violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            ownership: z.ZodObject<{
                ok: z.ZodBoolean;
                exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
                log: z.ZodOptional<z.ZodString>;
                violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            build: z.ZodOptional<z.ZodObject<{
                ok: z.ZodBoolean;
                exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
                log: z.ZodOptional<z.ZodString>;
                violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>>;
            acceptance: z.ZodOptional<z.ZodObject<{
                ok: z.ZodBoolean;
                exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
                log: z.ZodOptional<z.ZodString>;
                violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>>;
            lint: z.ZodOptional<z.ZodObject<{
                ok: z.ZodBoolean;
                exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
                log: z.ZodOptional<z.ZodString>;
                violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        diffStat: z.ZodOptional<z.ZodObject<{
            files: z.ZodNumber;
            insertions: z.ZodNumber;
            deletions: z.ZodNumber;
        }, z.core.$strip>>;
        score: z.ZodOptional<z.ZodNumber>;
        review: z.ZodOptional<z.ZodString>;
        reviewVerdict: z.ZodOptional<z.ZodEnum<{
            unknown: "unknown";
            pass: "pass";
            concerns: "concerns";
            fail: "fail";
        }>>;
        notes: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    recommended: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    winner: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    decidedBy: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    decisionNotes: z.ZodOptional<z.ZodString>;
    awaiting: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type NodeState = z.infer<typeof NodeState>;
export declare const LockedFile: z.ZodObject<{
    path: z.ZodString;
    sha256: z.ZodString;
}, z.core.$strip>;
export type LockedFile = z.infer<typeof LockedFile>;
export declare const HistoryEntry: z.ZodObject<{
    at: z.ZodString;
    event: z.ZodString;
    detail: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const Run: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodString;
    problem: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    status: z.ZodEnum<{
        draft: "draft";
        awaiting_approval: "awaiting_approval";
        needs_replan: "needs_replan";
        approved: "approved";
        solving: "solving";
        awaiting_closer: "awaiting_closer";
        ready_to_close: "ready_to_close";
        done: "done";
        failed: "failed";
    }>;
    requestedTier: z.ZodUnion<readonly [z.ZodEnum<{
        focused: "focused";
        standard: "standard";
        deep: "deep";
    }>, z.ZodLiteral<"auto">]>;
    plan: z.ZodNullable<z.ZodObject<{
        tier: z.ZodEnum<{
            focused: "focused";
            standard: "standard";
            deep: "deep";
        }>;
        summary: z.ZodString;
        rationale: z.ZodDefault<z.ZodString>;
        nodes: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            parent: z.ZodNullable<z.ZodString>;
            kind: z.ZodEnum<{
                leaf: "leaf";
                split: "split";
            }>;
            goal: z.ZodString;
            contract: z.ZodPrefault<z.ZodObject<{
                exposes: z.ZodDefault<z.ZodArray<z.ZodString>>;
                consumes: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>>;
            ownedPaths: z.ZodArray<z.ZodString>;
            sharedPaths: z.ZodDefault<z.ZodArray<z.ZodString>>;
            acceptance: z.ZodObject<{
                files: z.ZodDefault<z.ZodArray<z.ZodString>>;
                command: z.ZodString;
                rubric: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            dependsOn: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    nodes: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        id: z.ZodString;
        parent: z.ZodNullable<z.ZodString>;
        kind: z.ZodEnum<{
            leaf: "leaf";
            split: "split";
        }>;
        goal: z.ZodString;
        contract: z.ZodPrefault<z.ZodObject<{
            exposes: z.ZodDefault<z.ZodArray<z.ZodString>>;
            consumes: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
        ownedPaths: z.ZodArray<z.ZodString>;
        sharedPaths: z.ZodDefault<z.ZodArray<z.ZodString>>;
        acceptance: z.ZodObject<{
            files: z.ZodDefault<z.ZodArray<z.ZodString>>;
            command: z.ZodString;
            rubric: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        dependsOn: z.ZodDefault<z.ZodArray<z.ZodString>>;
        status: z.ZodEnum<{
            solving: "solving";
            awaiting_closer: "awaiting_closer";
            done: "done";
            failed: "failed";
            planned: "planned";
            verifying: "verifying";
            selected: "selected";
            integrating: "integrating";
            escalated: "escalated";
            redecomposed: "redecomposed";
        }>;
        base: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        targetAttempts: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        attempts: z.ZodDefault<z.ZodArray<z.ZodObject<{
            n: z.ZodNumber;
            kind: z.ZodEnum<{
                solve: "solve";
                integrate: "integrate";
                external: "external";
            }>;
            worker: z.ZodString;
            status: z.ZodEnum<{
                error: "error";
                failed: "failed";
                running: "running";
                passed: "passed";
                disqualified: "disqualified";
            }>;
            startedAt: z.ZodString;
            finishedAt: z.ZodOptional<z.ZodString>;
            branch: z.ZodString;
            worktree: z.ZodOptional<z.ZodString>;
            commit: z.ZodOptional<z.ZodString>;
            repairs: z.ZodDefault<z.ZodNumber>;
            gates: z.ZodOptional<z.ZodObject<{
                locked: z.ZodObject<{
                    ok: z.ZodBoolean;
                    exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
                    log: z.ZodOptional<z.ZodString>;
                    violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
                }, z.core.$strip>;
                ownership: z.ZodObject<{
                    ok: z.ZodBoolean;
                    exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
                    log: z.ZodOptional<z.ZodString>;
                    violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
                }, z.core.$strip>;
                build: z.ZodOptional<z.ZodObject<{
                    ok: z.ZodBoolean;
                    exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
                    log: z.ZodOptional<z.ZodString>;
                    violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
                }, z.core.$strip>>;
                acceptance: z.ZodOptional<z.ZodObject<{
                    ok: z.ZodBoolean;
                    exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
                    log: z.ZodOptional<z.ZodString>;
                    violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
                }, z.core.$strip>>;
                lint: z.ZodOptional<z.ZodObject<{
                    ok: z.ZodBoolean;
                    exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
                    log: z.ZodOptional<z.ZodString>;
                    violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            diffStat: z.ZodOptional<z.ZodObject<{
                files: z.ZodNumber;
                insertions: z.ZodNumber;
                deletions: z.ZodNumber;
            }, z.core.$strip>>;
            score: z.ZodOptional<z.ZodNumber>;
            review: z.ZodOptional<z.ZodString>;
            reviewVerdict: z.ZodOptional<z.ZodEnum<{
                unknown: "unknown";
                pass: "pass";
                concerns: "concerns";
                fail: "fail";
            }>>;
            notes: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        recommended: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        winner: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        decidedBy: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        decisionNotes: z.ZodOptional<z.ZodString>;
        awaiting: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    feedback: z.ZodDefault<z.ZodArray<z.ZodObject<{
        at: z.ZodString;
        notes: z.ZodString;
    }, z.core.$strip>>>;
    approval: z.ZodDefault<z.ZodNullable<z.ZodObject<{
        approvedAt: z.ZodString;
        notes: z.ZodOptional<z.ZodString>;
        baseRef: z.ZodString;
        baseCommit: z.ZodString;
        headCommit: z.ZodString;
        locked: z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            sha256: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>>;
    final: z.ZodDefault<z.ZodNullable<z.ZodObject<{
        branch: z.ZodString;
        commit: z.ZodString;
        closedAt: z.ZodString;
        checks: z.ZodRecord<z.ZodString, z.ZodObject<{
            ok: z.ZodBoolean;
            exitCode: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
            log: z.ZodOptional<z.ZodString>;
            violations: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>>;
    history: z.ZodDefault<z.ZodArray<z.ZodObject<{
        at: z.ZodString;
        event: z.ZodString;
        detail: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type Run = z.infer<typeof Run>;
