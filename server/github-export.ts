// ============================================================================
// Export a generated site to GitHub. The user supplies a Personal Access Token
// (scope: repo, or public_repo for public-only) which is used TRANSIENTLY to
// create a repo and commit the standalone HTML. The token is never stored or
// logged. No OAuth app required. This fits the "code-view + GitHub export"
// scope: a path out for the more technical site owner, not a full IDE.
// ============================================================================
import type { Express, Request, Response } from "express";

const GH = "https://api.github.com";

function buildStandalone(name: string, html: string, css: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${name}</title>
  <style>
${css}
  </style>
</head>
<body>
${html}
</body>
</html>`;
}

function readme(name: string): string {
  return `# ${name}\n\nBuilt with Trellis, the Crowe Logic website builder (https://ai-webbuilder.com).\n\nOpen \`index.html\` in a browser, or deploy the folder to any static host.\n`;
}

export function registerExportRoutes(app: Express) {
  app.post("/api/projects/export/github", async (req: Request, res: Response) => {
    const { token, repoName, isPrivate, name, html, css } = req.body ?? {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "A GitHub token is required." });
    }
    if (!repoName || !/^[A-Za-z0-9._-]+$/.test(repoName)) {
      return res.status(400).json({ error: "Enter a valid repository name (letters, numbers, dot, dash, underscore)." });
    }
    if (!html || !css) {
      return res.status(400).json({ error: "Generate a site before exporting." });
    }

    const gh = (path: string, init?: RequestInit) =>
      fetch(`${GH}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "ai-web-builder",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init?.headers ?? {}),
        },
      });

    try {
      // 1. Identify the token owner (also validates the token).
      const meRes = await gh("/user");
      if (meRes.status === 401) {
        return res.status(401).json({ error: "That GitHub token is invalid or expired." });
      }
      if (!meRes.ok) {
        return res.status(502).json({ error: `GitHub auth failed (${meRes.status}).` });
      }
      const owner = (await meRes.json()).login as string;

      // 2. Create the repository (auto_init gives us a default branch to commit to).
      const repoRes = await gh("/user/repos", {
        method: "POST",
        body: JSON.stringify({
          name: repoName,
          private: !!isPrivate,
          auto_init: true,
          description: `${name || "Website"} - built with Trellis by Crowe Logic`,
        }),
      });
      if (repoRes.status === 422) {
        return res.status(409).json({ error: `You already have a repo named "${repoName}". Pick another name.` });
      }
      if (!repoRes.ok) {
        const d = await repoRes.text();
        return res.status(502).json({ error: `Could not create the repo (${repoRes.status}).`, details: d.slice(0, 200) });
      }
      const repo = await repoRes.json();

      // 3. Commit the site files. auto_init created a README we overwrite.
      const standalone = buildStandalone(name || "Website", html, css);
      const put = async (path: string, content: string, message: string) => {
        // Fetch existing sha (auto_init README exists; index.html does not).
        let sha: string | undefined;
        const existing = await gh(`/repos/${owner}/${repoName}/contents/${path}`);
        if (existing.ok) sha = (await existing.json()).sha;
        return gh(`/repos/${owner}/${repoName}/contents/${path}`, {
          method: "PUT",
          body: JSON.stringify({
            message,
            content: Buffer.from(content, "utf8").toString("base64"),
            ...(sha ? { sha } : {}),
          }),
        });
      };

      const idx = await put("index.html", standalone, "Add site (Trellis by Crowe Logic)");
      if (!idx.ok) {
        return res.status(502).json({ error: `Created the repo, but pushing index.html failed (${idx.status}).`, repoUrl: repo.html_url });
      }
      await put("README.md", readme(name || "Website"), "Add README");

      return res.json({ repoUrl: repo.html_url, owner, repoName });
    } catch (e: any) {
      return res.status(502).json({ error: "GitHub export failed.", details: String(e?.message ?? e).slice(0, 200) });
    }
  });
}
