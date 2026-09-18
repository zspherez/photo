import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, readdir, rename, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const IMAGE_EXTENSIONS = new Set([".avif", ".jpeg", ".jpg", ".png", ".webp"]);
const CONTENT_TYPES = {
  ".avif": "image/avif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function parseArguments(argv) {
  let directory;
  let port = 4174;
  let openBrowser = true;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--port") {
      port = Number(argv[++index]);
    } else if (argv[index] === "--no-open") {
      openBrowser = false;
    } else if (!directory) {
      directory = argv[index];
    } else {
      throw new Error(`Unexpected argument: ${argv[index]}`);
    }
  }
  if (!directory) {
    throw new Error('Usage: npm run photos:order -- "/path/to/photo-folder" [--port 4174]');
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Port must be an integer between 1024 and 65535");
  }
  return { directory: resolve(directory), openBrowser, port };
}

function naturalCompare(left, right) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

async function listPhotoNames(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort(naturalCompare);
}

async function listPhotos(directory) {
  const names = await listPhotoNames(directory);
  return Promise.all(
    names.map(async (name) => {
      const metadata = await sharp(join(directory, name)).metadata();
      const rotated = metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8;
      const width = rotated ? metadata.height : metadata.width;
      const height = rotated ? metadata.width : metadata.height;
      return {
        name,
        width: width || 1,
        height: height || 1,
      };
    })
  );
}

function stripOrderPrefix(filename) {
  const extension = extname(filename);
  const stem = basename(filename, extension).replace(/^\d{1,4}[-_ ](?=.+)/, "");
  return { stem, extension };
}

function proposedNames(orderedNames) {
  const width = Math.max(2, String(orderedNames.length).length);
  return orderedNames.map((name, index) => {
    const { stem, extension } = stripOrderPrefix(name);
    return `${String(index + 1).padStart(width, "0")}-${stem}${extension}`;
  });
}

function assertExactOrder(currentNames, orderedNames) {
  if (!Array.isArray(orderedNames) || orderedNames.length !== currentNames.length || orderedNames.some((name) => typeof name !== "string")) {
    throw new Error("The submitted order does not match the folder contents");
  }
  const current = new Set(currentNames);
  const submitted = new Set(orderedNames);
  if (submitted.size !== current.size || orderedNames.some((name) => !current.has(name))) {
    throw new Error("The submitted order contains missing or unknown files");
  }
}

async function renameInOrder(directory, orderedNames) {
  const currentNames = await listPhotoNames(directory);
  assertExactOrder(currentNames, orderedNames);

  const targets = proposedNames(orderedNames);
  const targetKeys = targets.map((name) => name.toLocaleLowerCase());
  if (new Set(targetKeys).size !== targets.length) {
    throw new Error("The proposed filenames are not unique");
  }

  const allEntries = await readdir(directory);
  const photoKeys = new Set(currentNames.map((name) => name.toLocaleLowerCase()));
  const occupiedByOtherFiles = new Set(allEntries.filter((name) => !photoKeys.has(name.toLocaleLowerCase())).map((name) => name.toLocaleLowerCase()));
  const collision = targets.find((name) => occupiedByOtherFiles.has(name.toLocaleLowerCase()));
  if (collision) {
    throw new Error(`Cannot rename because ${collision} already exists`);
  }

  const transaction = orderedNames.map((source, index) => ({
    source,
    target: targets[index],
    temporary: `.photo-order-${crypto.randomUUID()}-${index}${extname(source)}`,
    moved: false,
    committed: false,
  }));

  try {
    for (const item of transaction) {
      if (item.source === item.target) continue;
      await rename(join(directory, item.source), join(directory, item.temporary));
      item.moved = true;
    }
    for (const item of transaction) {
      if (!item.moved) continue;
      await rename(join(directory, item.temporary), join(directory, item.target));
      item.committed = true;
    }
  } catch (error) {
    for (const item of transaction) {
      if (!item.committed) continue;
      try {
        await rename(join(directory, item.target), join(directory, item.temporary));
        item.committed = false;
      } catch {}
    }
    for (const item of transaction) {
      if (!item.moved) continue;
      try {
        await rename(join(directory, item.temporary), join(directory, item.source));
      } catch {}
    }
    throw error;
  }

  return {
    renamed: transaction.filter((item) => item.source !== item.target).length,
    photos: await listPhotos(directory),
  };
}

function json(response, data, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

function text(response, message, status = 200) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(message);
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1024 * 1024) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function page(directory) {
  const escapedDirectory = directory.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Local photo ordering</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #171717; color: #f5f5f5; }
      header { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 18px; border-bottom: 1px solid #292929; background: rgba(23, 23, 23, .96); backdrop-filter: blur(12px); }
      h1 { margin: 0; font-size: 20px; }
      header p { margin: 5px 0 0; color: #a3a3a3; font-size: 13px; }
      button { border: 1px solid #525252; border-radius: 8px; padding: 10px 16px; background: #f5f5f5; color: #111; font-weight: 700; cursor: pointer; }
      button:disabled { cursor: not-allowed; opacity: .45; }
      main { padding: 2px; }
      #status { min-height: 20px; color: #a3a3a3; font-size: 13px; text-align: right; }
      #status.error { color: #fca5a5; }
      #status.success { color: #86efac; }
      #photos { display: flex; flex-wrap: wrap; }
      article { position: relative; overflow: hidden; margin: 2px; min-width: 0; background: #000; cursor: grab; user-select: none; }
      article.dragging { opacity: .25; }
      article.drop-target { outline: 3px solid #fff; outline-offset: -3px; }
      .ratio { display: block; }
      img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
      @media (max-width: 639px) {
        article { max-width: calc(50% - 4px); }
      }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>Local photo ordering</h1>
        <p>${escapedDirectory}</p>
      </div>
      <div>
        <div id="status">Loading photos…</div>
        <button id="commit" type="button" disabled>Commit filenames</button>
      </div>
    </header>
    <main>
      <div id="photos"></div>
    </main>
    <script>
      const photosElement = document.getElementById("photos");
      const statusElement = document.getElementById("status");
      const commitButton = document.getElementById("commit");
      let photos = [];
      let originalOrder = [];
      let draggingName = null;

      function stripOrderPrefix(filename) {
        const dot = filename.lastIndexOf(".");
        const extension = dot >= 0 ? filename.slice(dot) : "";
        const stem = dot >= 0 ? filename.slice(0, dot) : filename;
        return { stem: stem.replace(/^\\d{1,4}[-_ ](?=.+)/, ""), extension };
      }

      function proposedName(name, index) {
        const width = Math.max(2, String(photos.length).length);
        const { stem, extension } = stripOrderPrefix(name);
        return \`\${String(index + 1).padStart(width, "0")}-\${stem}\${extension}\`;
      }

      function changed() {
        return photos.some(
          (photo, index) =>
            photo.name !== originalOrder[index] ||
            photo.name !== proposedName(photo.name, index),
        );
      }

      function render() {
        photosElement.innerHTML = "";
        photos.forEach((photo, index) => {
          const name = photo.name;
          const card = document.createElement("article");
          card.draggable = true;
          card.dataset.name = name;
          const basis = Math.max(1, (photo.width * 350) / photo.height);
          card.style.flexGrow = basis;
          card.style.flexBasis = \`\${basis}px\`;
          card.innerHTML = \`
            <span class="ratio" style="padding-bottom: \${(photo.height / photo.width) * 100}%"></span>
            <img src="/photos/\${encodeURIComponent(name)}" alt="">
          \`;
          card.addEventListener("dragstart", () => {
            draggingName = name;
            card.classList.add("dragging");
          });
          card.addEventListener("dragend", () => {
            draggingName = null;
            document.querySelectorAll("article").forEach((item) =>
              item.classList.remove("dragging", "drop-target")
            );
          });
          card.addEventListener("dragover", (event) => {
            event.preventDefault();
            card.classList.add("drop-target");
          });
          card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
          card.addEventListener("drop", (event) => {
            event.preventDefault();
            card.classList.remove("drop-target");
            if (!draggingName || draggingName === name) return;
            const from = photos.findIndex((item) => item.name === draggingName);
            const to = photos.findIndex((item) => item.name === name);
            const [moved] = photos.splice(from, 1);
            photos.splice(from < to ? to - 1 : to, 0, moved);
            render();
          });
          photosElement.append(card);
        });
        commitButton.disabled = photos.length === 0 || !changed();
        statusElement.textContent = \`\${photos.length} photo\${photos.length === 1 ? "" : "s"}\`;
        statusElement.className = "";
      }

      async function load() {
        const response = await fetch("/api/photos");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load photos");
        photos = data.photos;
        originalOrder = photos.map((photo) => photo.name);
        render();
      }

      commitButton.addEventListener("click", async () => {
        if (!changed()) return;
        if (!confirm("Rename every photo to match this order?")) return;
        commitButton.disabled = true;
        statusElement.textContent = "Renaming files…";
        try {
          const response = await fetch("/api/commit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order: photos.map((photo) => photo.name) }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Rename failed");
          photos = data.photos;
          originalOrder = photos.map((photo) => photo.name);
          render();
          statusElement.textContent = \`Renamed \${data.renamed} file\${data.renamed === 1 ? "" : "s"}.\`;
          statusElement.className = "success";
        } catch (error) {
          statusElement.textContent = String(error);
          statusElement.className = "error";
          commitButton.disabled = false;
        }
      });

      load().catch((error) => {
        statusElement.textContent = String(error);
        statusElement.className = "error";
      });
    </script>
  </body>
</html>`;
}

const { directory, openBrowser, port } = parseArguments(process.argv.slice(2));
const directoryInfo = await stat(directory);
if (!directoryInfo.isDirectory()) throw new Error(`${directory} is not a directory`);

let origin;
const server = createServer(async (request, response) => {
  try {
    const host = request.headers.host?.split(":")[0];
    if (host !== "127.0.0.1" && host !== "localhost") {
      return text(response, "Forbidden", 403);
    }

    const url = new URL(request.url || "/", origin);
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return response.end(page(directory));
    }
    if (request.method === "GET" && url.pathname === "/api/photos") {
      return json(response, { photos: await listPhotos(directory) });
    }
    if (request.method === "GET" && url.pathname.startsWith("/photos/")) {
      const filename = decodeURIComponent(url.pathname.slice("/photos/".length));
      if (!filename || filename !== basename(filename)) {
        return text(response, "Not found", 404);
      }
      const extension = extname(filename).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension)) return text(response, "Not found", 404);
      const path = join(directory, filename);
      await access(path);
      const info = await stat(path);
      response.writeHead(200, {
        "Content-Type": CONTENT_TYPES[extension],
        "Content-Length": info.size,
        "Cache-Control": "no-store",
      });
      return createReadStream(path).pipe(response);
    }
    if (request.method === "POST" && url.pathname === "/api/commit") {
      if (request.headers.origin !== origin) {
        return json(response, { error: "Invalid request origin" }, 403);
      }
      const body = await readJson(request);
      return json(response, await renameInOrder(directory, body.order));
    }
    if (url.pathname === "/favicon.ico") return response.writeHead(204).end();
    return text(response, "Not found", 404);
  } catch (error) {
    return json(response, { error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

server.listen(port, "127.0.0.1", async () => {
  origin = `http://127.0.0.1:${port}`;
  console.log(`Photo ordering helper: ${origin}`);
  console.log(`Folder: ${directory}`);
  if (openBrowser && process.platform === "darwin") {
    await execFileAsync("open", [origin]).catch(() => {});
  }
});
