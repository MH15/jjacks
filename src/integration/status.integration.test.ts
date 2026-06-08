import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);

type CommandResult = {
  readonly stdout: string;
  readonly stderr: string;
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
  }
): Promise<CommandResult> => {
  const result = await execFile(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    maxBuffer: 1024 * 1024
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr
  };
};

const fakeGhScript = `#!/usr/bin/env node
import { readFileSync } from "node:fs";

const statePath = process.env.JJACKS_FAKE_GH_STATE;
if (statePath === undefined) {
  console.error("JJACKS_FAKE_GH_STATE is required");
  process.exit(1);
}

const state = JSON.parse(readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);

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

console.error(\`Unexpected fake gh call: gh \${args.join(" ")}\`);
process.exit(1);
`;

const createHarness = async (): Promise<IntegrationHarness> => {
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
      ""
    ].join("\n")
  );
  await writeFile(
    fakeGhStatePath,
    JSON.stringify({
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
          body: ""
        }
      ]
    })
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
    XDG_CONFIG_HOME: xdgConfigHome
  };

  const harness = {
    root,
    repo,
    origin,
    bin,
    fakeGhStatePath,
    jjConfigPath,
    env
  };
  harnesses.push(harness);
  return harness;
};

const initializeRepo = async (harness: IntegrationHarness): Promise<void> => {
  await run("git", ["init"], { cwd: harness.repo, env: harness.env });
  await run("git", ["config", "user.name", "Integration Test"], { cwd: harness.repo, env: harness.env });
  await run("git", ["config", "user.email", "integration@example.com"], { cwd: harness.repo, env: harness.env });
  await writeFile(path.join(harness.repo, "README.md"), "hello\n");
  await run("git", ["add", "README.md"], { cwd: harness.repo, env: harness.env });
  await run("git", ["commit", "-m", "initial"], { cwd: harness.repo, env: harness.env });
  await run("git", ["init", "--bare", harness.origin], { cwd: harness.root, env: harness.env });
  await run("git", ["remote", "add", "origin", harness.origin], { cwd: harness.repo, env: harness.env });
  await run("git", ["push", "-u", "origin", "main"], { cwd: harness.repo, env: harness.env });
  await run("git", ["remote", "set-head", "origin", "-a"], { cwd: harness.repo, env: harness.env });
  await run("jj", ["git", "init", "--colocate"], { cwd: harness.repo, env: harness.env });
  await run("jj", ["new", "-m", "feat/base"], { cwd: harness.repo, env: harness.env });
  await run("jj", ["bookmark", "create", "feat/base"], { cwd: harness.repo, env: harness.env });
};

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => rm(harness.root, { recursive: true, force: true })));
});

describe("jjacks status integration", () => {
  it("discovers PRs through a fake gh executable while reading a real jj repo", async () => {
    const harness = await createHarness();
    await initializeRepo(harness);

    const result = await run("node", [path.join(process.cwd(), "dist/cli.js"), "status"], {
      cwd: harness.repo,
      env: harness.env
    });

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("stack");
    expect(result.stdout).toContain("pull requests");
    expect(result.stdout).toContain("current entries: 1");
    expect(result.stdout).toContain("feat/base");
    expect(result.stdout).toContain("not pushed");
    expect(result.stdout).toContain("PR #12");
    expect(result.stdout).toContain("base: main");
  });
});
