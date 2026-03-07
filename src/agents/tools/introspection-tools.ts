/**
 * Codebase Introspection Tools — ported from V3 filesystem.py + coding.py
 *
 * Gives Ernos full read access to its own codebase and filesystem.
 * Supports: read_file, list_files, search_codebase, edit_code
 *
 * These tools enable Ernos's self-introspective abilities, allowing
 * it to explore, understand, and modify its own source code.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import { fileURLToPath } from "node:url";
import * as path from "path";
import { Type } from "@sinclair/typebox";
import { artifactRegistry } from "../../memory/artifact-registry.js";

/**
 * The Ernos project root (live codebase) — read tools use this.
 * Walks up from the compiled file's directory to find the project root (where package.json lives).
 * We resolve this dynamically because process.cwd() may point to the execution directory, not the host root.
 */
function getProjectRoot(): string {
  // Walk up from this file's location to find the project root
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {break;} // hit filesystem root
    dir = parent;
  }
  // Fallback: use CWD
  return process.cwd();
}

/** The sandbox workspace — edit_code and sandbox tools use this. */
function getSandboxRoot(): string {
  return path.join(process.env.HOME || "/tmp", ".ernos", "sandbox");
}

/** Resolve a path against a given root, ensuring it stays within bounds. */
function resolveSafePath(
  inputPath: string,
  root?: string,
): { safe: boolean; resolved: string; error?: string } {
  const effectiveRoot = root || getProjectRoot();
  if (!inputPath || typeof inputPath !== "string") {
    return { safe: true, resolved: effectiveRoot };
  }
  const resolved = path.resolve(effectiveRoot, inputPath);

  // Allow within root and /tmp
  if (!resolved.startsWith(effectiveRoot) && !resolved.startsWith("/tmp/")) {
    return { safe: false, resolved, error: `Path '${inputPath}' is outside the allowed root.` };
  }

  return { safe: true, resolved };
}

// ─── Document format parsers (optional dependencies, dynamically imported) ──

/** True binary extensions that can never be displayed as text. */
const TRUE_BINARY_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".zip",
  ".gz",
  ".tar",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".so",
  ".dylib",
  ".dll",
  ".exe",
]);

/** Rich document formats we can parse with optional libraries. */
const RICH_DOC_EXTS = new Set([".pdf", ".docx", ".xlsx", ".xls", ".csv", ".pptx", ".epub", ".odt"]);

/**
 * Extract text lines from a rich document format.
 * Uses dynamic imports — returns null if the required library is not installed.
 */
async function extractDocumentLines(
  resolved: string,
  ext: string,
): Promise<{ lines: string[]; error?: string } | null> {
  switch (ext) {
    // ─── PDF ──────────────────────────────────────────────
    case ".pdf": {
      try {
        const pdfParse = (await import("pdf-parse" as any)).default;
        const buffer = fs.readFileSync(resolved);
        const data = await pdfParse(buffer);
        const text: string = data.text || "";
        const pageCount: number = data.numpages || 0;
        const header = `[PDF Document: ${pageCount} page(s)]`;
        return { lines: [header, "", ...text.split("\n")] };
      } catch (err: any) {
        if (err?.code === "MODULE_NOT_FOUND" || err?.code === "ERR_MODULE_NOT_FOUND") {
          return { lines: [], error: `Install pdf-parse to read PDF files: npm install pdf-parse` };
        }
        return { lines: [], error: `Error reading PDF: ${err}` };
      }
    }

    // ─── DOCX ─────────────────────────────────────────────
    case ".docx": {
      try {
        const mammoth = await import("mammoth" as any);
        const buffer = fs.readFileSync(resolved);
        const result = await mammoth.extractRawText({ buffer });
        const text: string = result.value || "";
        return {
          lines: [
            "[Word Document (.docx)]",
            "",
            ...text.split("\n").filter((l: string) => l.trim()),
          ],
        };
      } catch (err: any) {
        if (err?.code === "MODULE_NOT_FOUND" || err?.code === "ERR_MODULE_NOT_FOUND") {
          return { lines: [], error: `Install mammoth to read DOCX files: npm install mammoth` };
        }
        return { lines: [], error: `Error reading DOCX: ${err}` };
      }
    }

    // ─── XLSX / XLS ───────────────────────────────────────
    case ".xlsx":
    case ".xls": {
      try {
        const XLSX = await import("xlsx" as any);
        const workbook = XLSX.readFile(resolved);
        const allLines: string[] = [`[Spreadsheet: ${workbook.SheetNames.length} sheet(s)]`, ""];
        for (const sheetName of workbook.SheetNames) {
          allLines.push(`=== Sheet: ${sheetName} ===`);
          const sheet = workbook.Sheets[sheetName];
          const csv: string = XLSX.utils.sheet_to_csv(sheet);
          // Convert CSV to markdown table
          const rows = csv.split("\n").filter((r: string) => r.trim());
          if (rows.length > 0) {
            const headerRow = rows[0];
            const cols = headerRow.split(",");
            allLines.push("| " + cols.join(" | ") + " |");
            allLines.push("| " + cols.map(() => "---").join(" | ") + " |");
            for (let i = 1; i < rows.length; i++) {
              const cells = rows[i].split(",");
              allLines.push("| " + cells.join(" | ") + " |");
            }
          }
          allLines.push("");
        }
        return { lines: allLines };
      } catch (err: any) {
        if (err?.code === "MODULE_NOT_FOUND" || err?.code === "ERR_MODULE_NOT_FOUND") {
          return { lines: [], error: `Install xlsx to read spreadsheet files: npm install xlsx` };
        }
        return { lines: [], error: `Error reading spreadsheet: ${err}` };
      }
    }

    // ─── CSV (built-in, no deps) ──────────────────────────
    case ".csv": {
      try {
        const raw = fs.readFileSync(resolved, "utf-8");
        const rows = raw.split("\n").filter((r) => r.trim());
        if (rows.length === 0) {return { lines: ["[Empty CSV file]"] };}
        const allLines: string[] = ["[CSV Document]", ""];
        // Simple CSV → markdown table (handles basic CSV without quoted commas)
        const headerCols = rows[0].split(",");
        allLines.push("| " + headerCols.join(" | ") + " |");
        allLines.push("| " + headerCols.map(() => "---").join(" | ") + " |");
        for (let i = 1; i < rows.length; i++) {
          const cells = rows[i].split(",");
          allLines.push("| " + cells.join(" | ") + " |");
        }
        return { lines: allLines };
      } catch (err) {
        return { lines: [], error: `Error reading CSV: ${err}` };
      }
    }

    // ─── PPTX (basic XML extraction, no deps) ─────────────
    case ".pptx": {
      try {
        const AdmZip = (await import("adm-zip" as any)).default;
        const zip = new AdmZip(resolved);
        const entries = zip.getEntries();
        const slideEntries = entries
          .filter(
            (e: any) => e.entryName.startsWith("ppt/slides/slide") && e.entryName.endsWith(".xml"),
          )
          .toSorted((a: any, b: any) => a.entryName.localeCompare(b.entryName));

        const allLines: string[] = [`[PowerPoint Document: ${slideEntries.length} slide(s)]`, ""];
        for (let i = 0; i < slideEntries.length; i++) {
          const xml = slideEntries[i].getData().toString("utf-8");
          // Extract text from <a:t> tags
          const textMatches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
          const slideText = textMatches
            .map((m: string) => m.replace(/<[^>]+>/g, "").trim())
            .filter((t: string) => t);
          if (slideText.length > 0) {
            allLines.push(`--- Slide ${i + 1} ---`);
            allLines.push(...slideText);
            allLines.push("");
          }
        }
        return { lines: allLines };
      } catch (err: any) {
        if (err?.code === "MODULE_NOT_FOUND" || err?.code === "ERR_MODULE_NOT_FOUND") {
          return { lines: [], error: `Install adm-zip to read PPTX files: npm install adm-zip` };
        }
        return { lines: [], error: `Error reading PPTX: ${err}` };
      }
    }

    // ─── EPUB (basic XML extraction, no deps beyond zip) ──
    case ".epub": {
      try {
        const AdmZip = (await import("adm-zip" as any)).default;
        const zip = new AdmZip(resolved);
        const entries = zip.getEntries();
        const htmlEntries = entries.filter(
          (e: any) =>
            (e.entryName.endsWith(".html") || e.entryName.endsWith(".xhtml")) &&
            !e.entryName.includes("toc"),
        );

        const allLines: string[] = ["[EPUB Document]", ""];
        for (const entry of htmlEntries) {
          const html = entry.getData().toString("utf-8");
          // Strip HTML tags, keep text
          const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, "\n")
            .split("\n")
            .map((l: string) => l.trim())
            .filter((l: string) => l);
          if (text.length > 0) {
            allLines.push(`--- Chapter ---`);
            allLines.push(...text);
            allLines.push("");
          }
        }
        return { lines: allLines };
      } catch (err: any) {
        if (err?.code === "MODULE_NOT_FOUND" || err?.code === "ERR_MODULE_NOT_FOUND") {
          return { lines: [], error: `Install adm-zip to read EPUB files: npm install adm-zip` };
        }
        return { lines: [], error: `Error reading EPUB: ${err}` };
      }
    }

    // ─── ODT (basic XML extraction) ───────────────────────
    case ".odt": {
      try {
        const AdmZip = (await import("adm-zip" as any)).default;
        const zip = new AdmZip(resolved);
        const contentEntry = zip.getEntry("content.xml");
        if (!contentEntry) {return { lines: [], error: "Could not find content.xml in ODT file." };}
        const xml = contentEntry.getData().toString("utf-8");
        // Extract text from <text:p> and <text:span> tags
        const textContent = xml
          .replace(/<[^>]+>/g, "\n")
          .split("\n")
          .map((l: string) => l.trim())
          .filter((l: string) => l);
        return { lines: ["[ODT Document]", "", ...textContent] };
      } catch (err: any) {
        if (err?.code === "MODULE_NOT_FOUND" || err?.code === "ERR_MODULE_NOT_FOUND") {
          return { lines: [], error: `Install adm-zip to read ODT files: npm install adm-zip` };
        }
        return { lines: [], error: `Error reading ODT: ${err}` };
      }
    }

    default:
      return null;
  }
}

// ─── read_file: Paginated file reader with multi-format support ─────────────

async function readFilePage(filePath: string, startLine = 1, limit = 200): Promise<string> {
  const { safe, resolved, error } = resolveSafePath(filePath);
  if (!safe) {return `🔒 Access Denied: ${error}`;}

  if (!fs.existsSync(resolved)) {return `Error: File not found: ${filePath}`;}

  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory())
      {return `Error: '${filePath}' is a directory, not a file. Use list_files instead.`;}

    const ext = path.extname(resolved).toLowerCase();

    // True binary: cannot display
    if (TRUE_BINARY_EXTS.has(ext))
      {return `Binary file: ${filePath} (${stat.size} bytes). Cannot display.`;}

    // Rich document format: use specialized parser
    if (RICH_DOC_EXTS.has(ext)) {
      const result = await extractDocumentLines(resolved, ext);
      if (!result) {return `Unsupported format: ${ext}`;}
      if (result.error) {return result.error;}
      const lines = result.lines;
      const totalLines = lines.length;
      const startIdx = Math.max(0, startLine - 1);
      const endIdx = Math.min(totalLines, startIdx + limit);
      const chunk = lines.slice(startIdx, endIdx).join("\n");
      const pct = totalLines > 0 ? Math.floor((endIdx / totalLines) * 100) : 100;
      const remaining = totalLines - endIdx;

      let header = `File: ${filePath}\nLines: ${startIdx + 1}-${endIdx}/${totalLines} (${pct}% complete`;
      if (remaining > 0) {
        header += `, ${remaining} lines remaining)\n[BOOKMARK: Continue with read_file(path='${filePath}', start_line=${endIdx + 1})]\n[READING INCOMPLETE — you MUST continue reading before responding]`;
      } else {
        header += ")\n[DOCUMENT COMPLETE]";
      }
      return `${header}\n\n${chunk}`;
    }

    // Plain text file
    const content = fs.readFileSync(resolved, "utf-8");
    const lines = content.split("\n");
    const totalLines = lines.length;
    const startIdx = Math.max(0, startLine - 1);
    const endIdx = Math.min(totalLines, startIdx + limit);
    const chunk = lines.slice(startIdx, endIdx).join("\n");

    const pct = totalLines > 0 ? Math.floor((endIdx / totalLines) * 100) : 100;
    const remaining = totalLines - endIdx;

    let header = `File: ${filePath}\nLines: ${startIdx + 1}-${endIdx}/${totalLines} (${pct}% complete`;
    if (remaining > 0) {
      header += `, ${remaining} lines remaining)\n[BOOKMARK: Continue with read_file(path='${filePath}', start_line=${endIdx + 1})]\n[READING INCOMPLETE — you MUST continue reading before responding]`;
    } else {
      header += ")\n[DOCUMENT COMPLETE]";
    }

    return `${header}\n\n${chunk}`;
  } catch (err) {
    return `Error reading file: ${err}`;
  }
}

// ─── list_files: Directory listing ──────────────────────────────────────────

function listFiles(dirPath: unknown, recursive = false, maxDepth = 3): string {
  const normalizedPath = typeof dirPath === "string" && dirPath.trim() ? dirPath.trim() : ".";
  const { safe, resolved, error } = resolveSafePath(normalizedPath);
  if (!safe) {return `🔒 Access Denied: ${error}`;}

  if (!fs.existsSync(resolved)) {return `Error: Path not found: ${normalizedPath}`;}

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {return `${dirPath} (file, ${stat.size} bytes)`;}

    const entries: string[] = [];
    const skipDirs = new Set([
      "node_modules",
      ".git",
      "dist",
      "__pycache__",
      ".pnpm",
      ".cache",
      ".venv",
    ]);

    function walk(dir: string, depth: number, prefix: string) {
      if (depth > maxDepth) {return;}

      let items: fs.Dirent[];
      try {
        items = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      // Sort: directories first, then files
      items.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) {return -1;}
        if (!a.isDirectory() && b.isDirectory()) {return 1;}
        return a.name.localeCompare(b.name);
      });

      for (const item of items) {
        if (item.name.startsWith(".") && depth > 0) {continue;} // Skip hidden except at root

        if (item.isDirectory()) {
          if (skipDirs.has(item.name)) {
            entries.push(`${prefix}[DIR] ${item.name}/ (skipped)`);
            continue;
          }
          entries.push(`${prefix}[DIR] ${item.name}/`);
          if (recursive) {
            walk(path.join(dir, item.name), depth + 1, prefix + "  ");
          }
        } else {
          const fullPath = path.join(dir, item.name);
          try {
            const fstat = fs.statSync(fullPath);
            const sizeStr =
              fstat.size > 1024 * 1024
                ? `${(fstat.size / (1024 * 1024)).toFixed(1)}MB`
                : fstat.size > 1024
                  ? `${(fstat.size / 1024).toFixed(1)}KB`
                  : `${fstat.size}B`;
            entries.push(`${prefix}      ${item.name} (${sizeStr})`);
          } catch {
            entries.push(`${prefix}      ${item.name}`);
          }
        }
      }
    }

    walk(resolved, 0, "");

    if (entries.length === 0) {return `Directory '${String(dirPath)}' is empty.`;}
    return `Contents of ${String(dirPath)}:\n${entries.join("\n")}`;
  } catch (err) {
    return `Error listing directory: ${String(err)}`;
  }
}

// ─── search_codebase: Grep-like search ──────────────────────────────────────

function searchCodebase(
  query: string,
  searchPath: unknown = "./src",
  extensions = ".ts,.js,.json,.md",
): string {
  const normalizedPath =
    typeof searchPath === "string" && searchPath.trim() ? searchPath.trim() : ".";
  const { safe, resolved, error } = resolveSafePath(normalizedPath);
  if (!safe) {return `🔒 Access Denied: ${error}`;}

  if (!fs.existsSync(resolved)) {return `Error: Path not found: ${normalizedPath}`;}

  const extSet = new Set(
    extensions.split(",").map((e) => (e.trim().startsWith(".") ? e.trim() : `.${e.trim()}`)),
  );
  const results: string[] = [];
  const maxResults = 30;
  const skipDirs = new Set(["node_modules", ".git", "dist", "__pycache__", ".pnpm"]);

  function searchDir(dir: string) {
    if (results.length >= maxResults) {return;}

    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const item of items) {
      if (results.length >= maxResults) {return;}

      const fullPath = path.join(dir, item.name);

      if (item.isDirectory()) {
        if (skipDirs.has(item.name) || item.name.startsWith(".")) {continue;}
        searchDir(fullPath);
      } else {
        const ext = path.extname(item.name).toLowerCase();
        if (!extSet.has(ext)) {continue;}

        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(query)) {
              const relPath = path.relative(getProjectRoot(), fullPath);
              results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
              if (results.length >= maxResults) {return;}
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  searchDir(resolved);

  if (results.length === 0) {return `No matches found for "${query}" in ${String(searchPath)}.`;}
  let output = results.join("\n");
  if (results.length >= maxResults) {output += "\n... (truncated — narrow your search)";}
  return output;
}

// ─── edit_code: Write/modify files ──────────────────────────────────────────

/**
 * Edit code in the SANDBOX workspace (never touches running code).
 * All writes go to the persistent sandbox volume so ErnOS can freely experiment.
 */
function editCode(
  filePath: string,
  content: string,
  mode: "overwrite" | "append" | "insert" | "replace" = "overwrite",
  target?: string,
  insertLine?: number,
): string {
  const sandboxRoot = getSandboxRoot();
  if (!fs.existsSync(sandboxRoot)) {
    return `Error: Sandbox workspace not found at ${sandboxRoot}. Run start-ernos.sh to create it.`;
  }

  const { safe, resolved, error } = resolveSafePath(filePath, sandboxRoot);
  if (!safe) {return `🔒 Access Denied: ${error}`;}

  try {
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let resultMessage = "";
    switch (mode) {
      case "overwrite":
        fs.writeFileSync(resolved, content, "utf-8");
        resultMessage = `✅ [SANDBOX] File written: ${filePath} (${content.length} chars)`;
        break;

      case "append":
        fs.appendFileSync(resolved, content, "utf-8");
        resultMessage = `✅ [SANDBOX] Appended ${content.length} chars to ${filePath}`;
        break;

      case "insert": {
        if (!fs.existsSync(resolved)) {return `Error: File not found in sandbox: ${filePath}`;}
        const lines = fs.readFileSync(resolved, "utf-8").split("\n");
        const lineIdx = (insertLine ?? 1) - 1;
        if (lineIdx < 0 || lineIdx > lines.length)
          {return `Error: Line ${insertLine} out of range (1-${lines.length})`;}
        lines.splice(lineIdx, 0, content);
        fs.writeFileSync(resolved, lines.join("\n"), "utf-8");
        resultMessage = `✅ [SANDBOX] Inserted at line ${insertLine} in ${filePath}`;
        break;
      }

      case "replace": {
        if (!target) {return "Error: replace mode requires target parameter.";}
        if (!fs.existsSync(resolved)) {return `Error: File not found in sandbox: ${filePath}`;}
        const original = fs.readFileSync(resolved, "utf-8");
        if (!original.includes(target)) {return `Error: Target string not found in ${filePath}`;}
        const updated = original.replace(target, content);
        fs.writeFileSync(resolved, updated, "utf-8");
        resultMessage = `✅ [SANDBOX] Replaced target in ${filePath}`;
        break;
      }

      default:
        return `Error: Unknown mode '${String(mode)}'. Use: overwrite, append, insert, replace.`;
    }

    try {
      const finalBuffer = fs.readFileSync(resolved);
      artifactRegistry.registerArtifact(finalBuffer, { type: "code", path: filePath, context: mode });
    } catch (err) {
      console.warn(`[ArtifactRegistry] Code tracking failed: ${String(err)}`);
    }

    return resultMessage;
  } catch (err) {
    return `Error editing sandbox file: ${String(err)}`;
  }
}

// ─── Sandbox tools ──────────────────────────────────────────────────────────

/** Read a file from the sandbox workspace to verify edits. */
async function sandboxReadFile(filePath: string, startLine = 1, limit = 200): Promise<string> {
  const sandboxRoot = getSandboxRoot();
  if (!fs.existsSync(sandboxRoot)) {return "Error: Sandbox not found. Run start-ernos.sh first.";}
  const { safe, resolved, error } = resolveSafePath(filePath, sandboxRoot);
  if (!safe) {return `🔒 Access Denied: ${error}`;}
  if (!fs.existsSync(resolved)) {return `Error: File not found in sandbox: ${filePath}`;}

  try {
    const content = fs.readFileSync(resolved, "utf-8");
    const lines = content.split("\n");
    const totalLines = lines.length;
    const startIdx = Math.max(0, startLine - 1);
    const endIdx = Math.min(totalLines, startIdx + limit);
    const chunk = lines.slice(startIdx, endIdx).join("\n");
    return `[SANDBOX] File: ${filePath}\nLines: ${startIdx + 1}-${endIdx}/${totalLines}\n\n${chunk}`;
  } catch (err) {
    return `Error reading sandbox file: ${String(err)}`;
  }
}

/** Run TypeScript build in the sandbox workspace. */
function sandboxBuild(): string {
  const sandboxRoot = getSandboxRoot();
  if (!fs.existsSync(sandboxRoot)) {return "Error: Sandbox not found. Run start-ernos.sh first.";}

  try {
    const output = execSync("npx tsdown 2>&1", {
      cwd: sandboxRoot,
      timeout: 60000,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
    });
    return `[SANDBOX BUILD]\n${output}`;
  } catch (err: any) {
    return `[SANDBOX BUILD FAILED]\n${err.stdout || ""}\n${err.stderr || ""}\n${err.message || ""}`;
  }
}

/** Show diff between sandbox changes and live code. */
function sandboxDiff(filePath?: string): string {
  const sandboxRoot = getSandboxRoot();
  const liveRoot = getProjectRoot();
  if (!fs.existsSync(sandboxRoot)) {return "Error: Sandbox not found. Run start-ernos.sh first.";}

  try {
    const diffTarget = filePath ? filePath : ".";
    const cmd = filePath
      ? `diff -u "${path.join(liveRoot, filePath)}" "${path.join(sandboxRoot, filePath)}" 2>/dev/null || true`
      : `diff -rq --exclude=node_modules --exclude=.git --exclude=dist --exclude=memory "${liveRoot}" "${sandboxRoot}" 2>/dev/null | head -50 || true`;

    const output = execSync(cmd, {
      timeout: 15000,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
    });

    if (!output.trim())
      {return filePath
        ? `No differences in ${filePath}`
        : "No differences between live code and sandbox.";}
    return `[SANDBOX DIFF]${filePath ? ` ${filePath}` : ""}\n${output}`;
  } catch (err: any) {
    return `Error running diff: ${err.message || err}`;
  }
}

// ─── Tool definitions for V4 agent system ───────────────────────────────────

export const createIntrospectionTools = () => {
  return [
    // ─── Live Codebase (Read-Only) ─────────────────────────────────────
    {
      name: "read_file",
      label: "Read File (Live)",
      description:
        "Read a file from the LIVE codebase with paginated output. " +
        "Returns progress metadata, bookmarks for continuation, and [READING INCOMPLETE] markers. " +
        "Supports: .ts, .js, .json, .md, .py, .txt, PDF, DOCX, XLSX, CSV, PPTX, EPUB, ODT. " +
        "This reads the RUNNING code — use sandbox_read_file to read your edits.",
      parameters: Type.Object({
        path: Type.String({
          description: 'File path (relative to project root, e.g. "src/agents/system-prompt.ts")',
        }),
        start_line: Type.Optional(
          Type.Number({ description: "Line to start reading from (1-indexed). Default: 1." }),
        ),
        limit: Type.Optional(
          Type.Number({ description: "Maximum lines to return. Default: 200." }),
        ),
      }),
      execute: async (_toolCallId: string, args: any) =>
        readFilePage(args.path, args.start_line, args.limit),
    },
    {
      name: "list_files",
      label: "List Files (Live)",
      description:
        "List files and directories in the LIVE codebase. Shows file sizes and directory structure. " +
        "Use recursive=true for deep listings.",
      parameters: Type.Object({
        path: Type.String({
          description: 'Directory path (relative to project root, e.g. "src/agents/tools")',
        }),
        recursive: Type.Optional(
          Type.Boolean({
            description: "If true, list subdirectories recursively. Default: false.",
          }),
        ),
        max_depth: Type.Optional(
          Type.Number({ description: "Maximum recursion depth. Default: 3." }),
        ),
      }),
      execute: async (_toolCallId: string, args: any) =>
        listFiles(args.path ?? ".", args.recursive, args.max_depth),
    },
    {
      name: "search_codebase",
      label: "Search Codebase (Live)",
      description:
        "Search for a string across the LIVE codebase (grep-like). Returns matching file paths, " +
        "line numbers, and content. Searches .ts, .js, .json, .md files by default.",
      parameters: Type.Object({
        query: Type.String({ description: "The string to search for." }),
        path: Type.Optional(
          Type.String({ description: 'Directory to search in. Default: "." (project root).' }),
        ),
        extensions: Type.Optional(
          Type.String({
            description: 'Comma-separated file extensions to search. Default: ".ts,.js,.json,.md".',
          }),
        ),
      }),
      execute: async (_toolCallId: string, args: any) =>
        searchCodebase(args.query, args.path ?? ".", args.extensions),
    },

    // ─── Sandbox Workspace (Read-Write) ───────────────────────────────
    {
      name: "edit_code",
      label: "Edit Code (Sandbox)",
      description:
        "Write or modify a file in your SANDBOX workspace. " +
        "This NEVER touches the live running code. " +
        "Modes: overwrite (replace entire file), append (add to end), insert (add at specific line), replace (find and replace target string). " +
        "Use sandbox_diff to see your changes vs live code.",
      parameters: Type.Object({
        path: Type.String({
          description: 'File path (relative to sandbox root, e.g. "src/memory/reconciler.ts")',
        }),
        content: Type.String({ description: "The content to write." }),
        mode: Type.Optional(
          Type.String({
            description: "Edit mode: overwrite, append, insert, or replace. Default: overwrite.",
          }),
        ),
        target: Type.Optional(
          Type.String({ description: "For replace mode: the string to find and replace." }),
        ),
        insert_line: Type.Optional(
          Type.Number({
            description: "For insert mode: the line number to insert at (1-indexed).",
          }),
        ),
      }),
      execute: async (_toolCallId: string, args: any) =>
        editCode(args.path, args.content, args.mode, args.target, args.insert_line),
    },
    {
      name: "sandbox_read_file",
      label: "Read File (Sandbox)",
      description:
        "Read a file from your SANDBOX workspace to verify your edits. " +
        "The sandbox is a clone of the live codebase that you can freely modify.",
      parameters: Type.Object({
        path: Type.String({ description: "File path (relative to sandbox root)" }),
        start_line: Type.Optional(
          Type.Number({ description: "Line to start reading from. Default: 1." }),
        ),
        limit: Type.Optional(Type.Number({ description: "Max lines. Default: 200." })),
      }),
      execute: async (_toolCallId: string, args: any) =>
        sandboxReadFile(args.path, args.start_line, args.limit),
    },
    {
      name: "sandbox_build",
      label: "Build Sandbox",
      description:
        "Run a TypeScript build (tsdown) in the sandbox workspace to check if your changes compile. " +
        "Returns build output with any errors.",
      parameters: Type.Object({}),
      execute: async () => sandboxBuild(),
    },
    {
      name: "sandbox_diff",
      label: "Diff Sandbox vs Live",
      description:
        "Show differences between your sandbox edits and the live running code. " +
        "Pass a file path for a specific file diff, or omit for a summary of all changes.",
      parameters: Type.Object({
        path: Type.Optional(
          Type.String({
            description: "File to diff (relative path). Omit for summary of all changes.",
          }),
        ),
      }),
      execute: async (_toolCallId: string, args: any) => sandboxDiff(args.path),
    },
  ];
};
