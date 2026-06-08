import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

type CommandResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

type FakePullRequest = {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly headRefName: string;
  readonly headRepositoryOwner: string;
  readonly baseRefName: string;
  readonly state: "OPEN" | "MERGED" | "CLOSED";
  readonly isDraft: boolean;
  readonly body: string;
};

type FakePullRequestComment = {
  readonly id: number;
  readonly body: string;
  readonly url: string;
};

type FakeGhState = {
  readonly pullRequests: ReadonlyArray<FakePullRequest>;
  readonly comments?: Record<string, ReadonlyArray<FakePullRequestComment>>;
  readonly nextPullRequestNumber?: number;
  readonly nextCommentId?: number;
};

type IntegrationHarness = {
  readonly root: string;
  readonly repo: string;
  readonly origin: string;
  readonly bin: string;
  readonly fakeGhStatePath: string;
  readonly jjConfigPath: string;
  readonly env: NodeJS.ProcessEnv;
};

const harnesses: Array<IntegrationHarness> = [];

const run = async (
  command: string,
  args: ReadonlyArray<string>,
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly allowFailure?: boolean;
  },
): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    execFileCallback(
      command,
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const exitCode =
          error !== null && "code" in error && typeof error.code === "number"
            ? error.code
            : error === null
              ? 0
              : 1;

        const result = {
          stdout,
          stderr,
          exitCode,
        };

        if (error !== null && options.allowFailure !== true) {
          reject(error);
          return;
        }

        resolve(result);
      },
    );
  });

const fakeGhScript = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const statePath = process.env.JJACKS_FAKE_GH_STATE;
if (statePath === undefined) {
  console.error("JJACKS_FAKE_GH_STATE is required");
  process.exit(1);
}

const state = JSON.parse(readFileSync(statePath, "utf8"));
state.pullRequests ??= [];
state.comments ??= {};
state.nextPullRequestNumber ??=
  Math.max(0, ...state.pullRequests.map((pullRequest) => pullRequest.number)) + 1;
state.nextCommentId ??=
  Math.max(0, ...Object.values(state.comments).flat().map((comment) => comment.id)) + 1;
const args = process.argv.slice(2);

const save = () => {
  writeFileSync(statePath, JSON.stringify(state, null, 2));
};

const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

if (args[0] === "pr" && args[1] === "list") {
  const head = valueAfter("--head");
  const pullRequests = state.pullRequests.filter((pullRequest) =>
    head === undefined || pullRequest.headRefName === head
  );
  console.log(JSON.stringify(pullRequests));
  process.exit(0);
}

if (args[0] === "pr" && args[1] === "create") {
  const head = valueAfter("--head");
  const base = valueAfter("--base");
  const title = valueAfter("--title");
  const body = valueAfter("--body") ?? "";

  if (head === undefined || base === undefined || title === undefined) {
    console.error("fake gh pr create requires --head, --base, and --title");
    process.exit(1);
  }

  const number = state.nextPullRequestNumber++;
  state.pullRequests.push({
    number,
    url: \`https://github.com/MH15/jjacks/pull/\${number}\`,
    title,
    headRefName: head,
    headRepositoryOwner: "integration",
    baseRefName: base,
    state: "OPEN",
    isDraft: false,
    body,
  });
  save();
  console.log(\`https://github.com/MH15/jjacks/pull/\${number}\`);
  process.exit(0);
}

if (args[0] === "pr" && args[1] === "edit") {
  const number = Number(args[2]);
  const pullRequest = state.pullRequests.find((candidate) => candidate.number === number);
  if (pullRequest === undefined) {
    console.error(\`PR #\${number} not found\`);
    process.exit(1);
  }

  const base = valueAfter("--base");
  const title = valueAfter("--title");
  const body = valueAfter("--body");
  if (base !== undefined) {
    pullRequest.baseRefName = base;
  }
  if (title !== undefined) {
    pullRequest.title = title;
  }
  if (body !== undefined) {
    pullRequest.body = body;
  }
  save();
  process.exit(0);
}

if (args[0] === "api") {
  const method = valueAfter("--method") ?? "GET";
  const path = args.find((arg) => arg.startsWith("/repos/"));
  const bodyField = args.find((arg) => arg.startsWith("body="));
  const body = bodyField === undefined ? "" : bodyField.slice("body=".length);

  if (path === undefined) {
    console.error("fake gh api requires a repo path");
    process.exit(1);
  }

  const issueCommentsMatch = path.match(/\\/issues\\/(\\d+)\\/comments$/);
  if (method === "GET" && issueCommentsMatch !== null) {
    console.log(JSON.stringify(state.comments[issueCommentsMatch[1]] ?? []));
    process.exit(0);
  }

  if (method === "POST" && issueCommentsMatch !== null) {
    const pullRequestNumber = issueCommentsMatch[1];
    const id = state.nextCommentId++;
    const comment = {
      id,
      body,
      url: \`https://github.com/MH15/jjacks/pull/\${pullRequestNumber}#issuecomment-\${id}\`,
    };
    state.comments[pullRequestNumber] ??= [];
    state.comments[pullRequestNumber].push(comment);
    save();
    console.log(JSON.stringify(comment));
    process.exit(0);
  }

  const commentMatch = path.match(/\\/issues\\/comments\\/(\\d+)$/);
  if (method === "PATCH" && commentMatch !== null) {
    const id = Number(commentMatch[1]);
    const comments = Object.values(state.comments).flat();
    const comment = comments.find((candidate) => candidate.id === id);
    if (comment === undefined) {
      console.error(\`Comment #\${id} not found\`);
      process.exit(1);
    }
    comment.body = body;
    save();
    console.log(JSON.stringify(comment));
    process.exit(0);
  }
}

console.error(\`Unexpected fake gh call: gh \${args.join(" ")}\`);
process.exit(1);
`;

const createHarness = async (options?: {
  readonly pullRequests?: ReadonlyArray<FakePullRequest>;
  readonly comments?: Record<string, ReadonlyArray<FakePullRequestComment>>;
}): Promise<IntegrationHarness> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jjacks-integration-"));
  const repo = path.join(root, "repo");
  const origin = path.join(root, "origin.git");
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  const xdgConfigHome = path.join(root, "config");
  const fakeGhStatePath = path.join(root, "gh-state.json");
  const jjConfigPath = path.join(root, "jjconfig.toml");

  await mkdir(repo);
  await mkdir(bin);
  await mkdir(home);
  await mkdir(xdgConfigHome);
  await writeFile(
    jjConfigPath,
    [
      "advance-bookmarks.enabled = true",
      "[user]",
      'name = "Integration Test"',
      'email = "integration@example.com"',
      "",
    ].join("\n"),
  );
  await writeFile(
    fakeGhStatePath,
    JSON.stringify({
      pullRequests: options?.pullRequests ?? [
        {
          number: 12,
          url: "https://github.com/MH15/jjacks/pull/12",
          title: "feat/base",
          headRefName: "feat/base",
          headRepositoryOwner: "coworker",
          baseRefName: "main",
          state: "OPEN",
          isDraft: false,
          body: "",
        },
      ],
      comments: options?.comments ?? {},
    }),
  );

  const fakeGhPath = path.join(bin, "gh");
  await writeFile(fakeGhPath, fakeGhScript);
  await chmod(fakeGhPath, 0o755);

  const env = {
    ...process.env,
    JJ_CONFIG: jjConfigPath,
    JJACKS_FAKE_GH_STATE: fakeGhStatePath,
    HOME: home,
    NO_COLOR: "1",
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    XDG_CONFIG_HOME: xdgConfigHome,
  };

  const harness = {
    root,
    repo,
    origin,
    bin,
    fakeGhStatePath,
    jjConfigPath,
    env,
  };
  harnesses.push(harness);
  return harness;
};

const readFakeGhState = async (harness: IntegrationHarness): Promise<FakeGhState> =>
  JSON.parse(await readFile(harness.fakeGhStatePath, "utf8"));

const initializeRepo = async (
  harness: IntegrationHarness,
  options?: {
    readonly childBookmark?: string;
  },
): Promise<void> => {
  await run("git", ["init", "--initial-branch", "main"], { cwd: harness.repo, env: harness.env });
  await run("git", ["config", "user.name", "Integration Test"], {
    cwd: harness.repo,
    env: harness.env,
  });
  await run("git", ["config", "user.email", "integration@example.com"], {
    cwd: harness.repo,
    env: harness.env,
  });
  await writeFile(path.join(harness.repo, "README.md"), "hello\n");
  await run("git", ["add", "README.md"], { cwd: harness.repo, env: harness.env });
  await run("git", ["commit", "-m", "initial"], { cwd: harness.repo, env: harness.env });
  await run("git", ["init", "--bare", harness.origin], { cwd: harness.root, env: harness.env });
  await run("git", ["remote", "add", "origin", harness.origin], {
    cwd: harness.repo,
    env: harness.env,
  });
  await run("git", ["push", "-u", "origin", "main"], { cwd: harness.repo, env: harness.env });
  await run("git", ["remote", "set-head", "origin", "main"], {
    cwd: harness.repo,
    env: harness.env,
  });
  await run("jj", ["git", "init", "--colocate"], { cwd: harness.repo, env: harness.env });
  await run("jj", ["new", "-m", "feat/base"], { cwd: harness.repo, env: harness.env });
  await run("jj", ["bookmark", "create", "feat/base"], { cwd: harness.repo, env: harness.env });
  if (options?.childBookmark !== undefined) {
    await run("jj", ["new", "-m", options.childBookmark], { cwd: harness.repo, env: harness.env });
    await run("jj", ["bookmark", "set", "feat/base", "-r", "@-"], {
      cwd: harness.repo,
      env: harness.env,
    });
    await writeFile(path.join(harness.repo, "child.txt"), "child\n");
    await run("jj", ["bookmark", "create", options.childBookmark], {
      cwd: harness.repo,
      env: harness.env,
    });
  }
};

afterEach(async () => {
  await Promise.all(
    harnesses.splice(0).map((harness) => rm(harness.root, { recursive: true, force: true })),
  );
});

describe("jjacks status integration", () => {
  it("discovers PRs through a fake gh executable while reading a real jj repo", async () => {
    const harness = await createHarness();
    await initializeRepo(harness);

    const result = await run("node", [path.join(process.cwd(), "dist/cli.js"), "status"], {
      cwd: harness.repo,
      env: harness.env,
    });

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("stack");
    expect(result.stdout).toContain("pull requests");
    expect(result.stdout).toContain("current entries: 1");
    expect(result.stdout).toContain("feat/base");
    expect(result.stdout).toContain("not pushed");
    expect(result.stdout).toContain("PR #12");
    expect(result.stdout).toContain("base: main");
  });

  it("fails loudly when fake GitHub returns multiple open PRs for one branch", async () => {
    const harness = await createHarness({
      pullRequests: [
        {
          number: 12,
          url: "https://github.com/MH15/jjacks/pull/12",
          title: "first",
          headRefName: "feat/base",
          headRepositoryOwner: "alice",
          baseRefName: "main",
          state: "OPEN",
          isDraft: false,
          body: "",
        },
        {
          number: 13,
          url: "https://github.com/MH15/jjacks/pull/13",
          title: "second",
          headRefName: "feat/base",
          headRepositoryOwner: "bob",
          baseRefName: "main",
          state: "OPEN",
          isDraft: false,
          body: "",
        },
      ],
    });
    await initializeRepo(harness);

    const result = await run("node", [path.join(process.cwd(), "dist/cli.js"), "status"], {
      cwd: harness.repo,
      env: harness.env,
      allowFailure: true,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Multiple open pull requests found for branch feat/base");
    expect(result.stderr).toContain("PR #12 alice:feat/base");
    expect(result.stderr).toContain("PR #13 bob:feat/base");
  });
});

describe("jjacks sync integration", () => {
  it("renders a dry-run sync plan for a real two-bookmark jj stack with fake GitHub", async () => {
    const harness = await createHarness();
    await initializeRepo(harness, { childBookmark: "feat/child" });

    const result = await run(
      "node",
      [path.join(process.cwd(), "dist/cli.js"), "sync", "--dry-run"],
      {
        cwd: harness.repo,
        env: harness.env,
      },
    );

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("jjacks sync plan");
    expect(result.stdout).toContain("github");
    expect(result.stdout).toContain("feat/base");
    expect(result.stdout).toContain("https://github.com/MH15/jjacks/pull/12");
    expect(result.stdout).toContain("- push bookmark");
    expect(result.stdout).toContain("feat/child");
    expect(result.stdout).toContain("- create PR with base feat/base");
  });

  it("executes sync by pushing bookmarks, creating missing PRs, and writing stack comments", async () => {
    const harness = await createHarness();
    await initializeRepo(harness, { childBookmark: "feat/child" });

    const result = await run(
      "node",
      [path.join(process.cwd(), "dist/cli.js"), "sync", "--execute"],
      {
        cwd: harness.repo,
        env: harness.env,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Sync stack comments");
    expect(result.stderr).not.toContain("Unexpected fake gh call");
    expect(result.stdout).toContain("2 pushes, 1 PR, 2 comments");

    const state = await readFakeGhState(harness);
    const childPullRequest = state.pullRequests.find(
      (pullRequest) => pullRequest.headRefName === "feat/child",
    );
    expect(childPullRequest).toMatchObject({
      title: "feat/child",
      baseRefName: "feat/base",
      state: "OPEN",
    });
    expect(state.comments?.["12"]?.[0]?.body).toContain("jjacks:stack");
    expect(state.comments?.[String(childPullRequest?.number)]?.[0]?.body).toContain("jjacks:stack");
  });

  it("executes sync by updating stale PR metadata instead of creating duplicates", async () => {
    const harness = await createHarness({
      pullRequests: [
        {
          number: 12,
          url: "https://github.com/MH15/jjacks/pull/12",
          title: "feat/base",
          headRefName: "feat/base",
          headRepositoryOwner: "coworker",
          baseRefName: "main",
          state: "OPEN",
          isDraft: false,
          body: "",
        },
        {
          number: 13,
          url: "https://github.com/MH15/jjacks/pull/13",
          title: "old title",
          headRefName: "feat/child",
          headRepositoryOwner: "coworker",
          baseRefName: "main",
          state: "OPEN",
          isDraft: false,
          body: "",
        },
      ],
    });
    await initializeRepo(harness, { childBookmark: "feat/child" });

    const result = await run(
      "node",
      [path.join(process.cwd(), "dist/cli.js"), "sync", "--execute"],
      {
        cwd: harness.repo,
        env: harness.env,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Sync stack comments");
    expect(result.stderr).not.toContain("Unexpected fake gh call");
    expect(result.stdout).toContain("2 pushes, 1 PR, 2 comments");

    const state = await readFakeGhState(harness);
    expect(state.pullRequests).toHaveLength(2);
    expect(state.pullRequests.find((pullRequest) => pullRequest.number === 13)).toMatchObject({
      title: "feat/child",
      baseRefName: "feat/base",
    });
  });
});

describe("jjacks navigation integration", () => {
  it("moves down and back up through a real two-bookmark jj stack", async () => {
    const harness = await createHarness();
    await initializeRepo(harness, { childBookmark: "feat/child" });

    const down = await run("node", [path.join(process.cwd(), "dist/cli.js"), "down"], {
      cwd: harness.repo,
      env: harness.env,
    });
    expect(down.stderr).toBe("");
    expect(down.exitCode).toBe(0);
    expect(down.stdout).toContain("jjacks down");
    expect(down.stdout).toContain("feat/base");

    const up = await run("node", [path.join(process.cwd(), "dist/cli.js"), "up"], {
      cwd: harness.repo,
      env: harness.env,
    });
    expect(up.stderr).toBe("");
    expect(up.exitCode).toBe(0);
    expect(up.stdout).toContain("jjacks up");
    expect(up.stdout).toContain("feat/child");
  });
});
