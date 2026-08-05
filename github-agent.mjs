// github-agent.mjs
//
// Lets a script (or an AI you're running locally) read and write files in
// one of your GitHub repos, using the GitHub REST API directly — no
// dependencies beyond Node's built-in fetch (Node 18+).
//
// SECURITY: this never contains your token. It reads GITHUB_TOKEN from
// the environment. Generate a token scoped to exactly what you need:
//
//   1. https://github.com/settings/tokens?type=beta
//   2. "Generate new token" (fine-grained, NOT classic)
//   3. Set "Repository access" to ONLY the repo(s) you want editable —
//      never "All repositories"
//   4. Under "Repository permissions", set "Contents" to Read and write.
//      Leave everything else as No access.
//   5. Set an expiration (90 days is a sane default — you can regenerate).
//   6. Copy the token (starts with github_pat_) — GitHub only shows it once.
//
// Then, run this from your terminal like:
//
//   GITHUB_TOKEN=github_pat_xxx node --env-file=.env github-agent.mjs \
//       write path/in/repo.txt "new file content" "commit message"
//
// ...or put GITHUB_TOKEN=github_pat_xxx in a .env file (add .env to your
// .gitignore!) and run with: node --env-file=.env github-agent.mjs ...
//
// Usage:
//   node github-agent.mjs read   <path>
//   node github-agent.mjs write  <path> <content> [commitMessage]
//   node github-agent.mjs delete <path> [commitMessage]
//   node github-agent.mjs list   [dirPath]
//
// Configure OWNER/REPO/BRANCH below, or override with env vars of the
// same names.

const OWNER = process.env.GITHUB_OWNER || "ElPenguino4";
const REPO = process.env.GITHUB_REPO || "pengiai-updates";
const BRANCH = process.env.GITHUB_BRANCH || "main";

const TOKEN = process.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env;
const API_ROOT = "https://api.github.com";

function assertConfigured() {
  if (!TOKEN) {
    throw new Error(
      "GITHUB_TOKEN is not set. Run with: node --env-file=.env github-agent.mjs ...\n" +
      "(see the comment at the top of this file for how to generate one)"
    );
  }
  if (OWNER === "ElPenguino4" || REPO === "pengiai_updates") {
    throw new Error(
      "Set OWNER/REPO at the top of github-agent.mjs (or GITHUB_OWNER / " +
      "GITHUB_REPO env vars) to point at your actual repo."
    );
  }
}

async function githubRequest(path, options = {}) {
  const resp = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`GitHub API ${resp.status} ${resp.statusText}: ${body}`);
  }
  if (resp.status === 204) return null; // no content (e.g. delete)
  return resp.json();
}

// Returns { content, sha } or null if the file doesn't exist yet.
async function getFile(filePath) {
  try {
    const data = await githubRequest(
      `/repos/${OWNER}/${REPO}/contents/${encodeURI(filePath)}?ref=${BRANCH}`
    );
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return { content, sha: data.sha };
  } catch (e) {
    if (String(e.message).includes(" 404 ")) return null;
    throw e;
  }
}

// Creates the file if it doesn't exist, or updates it if it does.
async function writeFile(filePath, content, commitMessage) {
  const existing = await getFile(filePath);
  const body = {
    message: commitMessage || `Update ${filePath}`,
    content: Buffer.from(content, "utf-8").toString("base64"),
    branch: BRANCH,
  };
  if (existing) body.sha = existing.sha; // required to update, not create

  return githubRequest(
    `/repos/${OWNER}/${REPO}/contents/${encodeURI(filePath)}`,
    { method: "PUT", body: JSON.stringify(body) }
  );
}

async function deleteFile(filePath, commitMessage) {
  const existing = await getFile(filePath);
  if (!existing) throw new Error(`${filePath} doesn't exist on ${BRANCH}.`);

  return githubRequest(
    `/repos/${OWNER}/${REPO}/contents/${encodeURI(filePath)}`,
    {
      method: "DELETE",
      body: JSON.stringify({
        message: commitMessage || `Delete ${filePath}`,
        sha: existing.sha,
        branch: BRANCH,
      }),
    }
  );
}

// Lists files/folders at a given path (repo root by default).
async function listDir(dirPath = "") {
  const data = await githubRequest(
    `/repos/${OWNER}/${REPO}/contents/${encodeURI(dirPath)}?ref=${BRANCH}`
  );
  return (Array.isArray(data) ? data : [data]).map((e) => ({
    name: e.name,
    path: e.path,
    type: e.type, // "file" or "dir"
  }));
}

// ---------- CLI ----------

async function main() {
  assertConfigured();
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case "read": {
      const [filePath] = args;
      if (!filePath) throw new Error("Usage: read <path>");
      const file = await getFile(filePath);
      if (!file) {
        console.log(`(no such file: ${filePath})`);
      } else {
        console.log(file.content);
      }
      break;
    }
    case "write": {
      const [filePath, content, commitMessage] = args;
      if (!filePath || content === undefined) {
        throw new Error('Usage: write <path> <content> ["commit message"]');
      }
      const result = await writeFile(filePath, content, commitMessage);
      console.log(`Committed: ${result.commit.sha} — ${result.commit.html_url}`);
      break;
    }
    case "delete": {
      const [filePath, commitMessage] = args;
      if (!filePath) throw new Error("Usage: delete <path>");
      await deleteFile(filePath, commitMessage);
      console.log(`Deleted ${filePath} on ${BRANCH}.`);
      break;
    }
    case "list": {
      const [dirPath] = args;
      const entries = await listDir(dirPath || "");
      for (const e of entries) console.log(`${e.type}\t${e.path}`);
      break;
    }
    default:
      console.log(
        "Usage:\n" +
        "  node github-agent.mjs read   <path>\n" +
        "  node github-agent.mjs write  <path> <content> [commitMessage]\n" +
        "  node github-agent.mjs delete <path> [commitMessage]\n" +
        "  node github-agent.mjs list   [dirPath]"
      );
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

// Also exported so another script (or an AI-driven Node process) can
// import these functions directly instead of shelling out to the CLI:
//   import { getFile, writeFile, deleteFile, listDir } from "./github-agent.mjs";
export { getFile, writeFile, deleteFile, listDir };
