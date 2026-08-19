import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const MANIFEST_PATH = new URL("../src/data/media-manifest.json", import.meta.url);
const PRIVATE_BUCKET = "rehders-photo-originals";
const DELIVERY_BUCKET = "rehders-photo-media";
const IMAGE_FOLDERS = new Set(["concerts", "music", "grads", "sports", "events", "bts", "lifestyle", "system"]);
const IMAGE_WIDTHS = [320, 480, 640, 960, 1280, 1920];
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".avif"]);
const VIDEO_EXTENSIONS = new Set([".mp4"]);

function parseArgs(argv) {
  const args = { files: [] };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--folder") args.folder = argv[++index];
    else if (value === "--posters") args.posters = argv[++index];
    else args.files.push(value);
  }
  if (!args.folder || !args.files.length) {
    throw new Error(
      "Usage: npm run media:publish -- --folder <gallery|video|prints> [--posters <dir>] <files-or-directories...>",
    );
  }
  return args;
}

async function expandInputs(inputs, extensions) {
  const files = [];
  for (const input of inputs) {
    const path = resolve(input);
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const name of await readdir(path)) {
        const child = join(path, name);
        if ((await stat(child)).isFile() && extensions.has(extname(child).toLowerCase())) {
          files.push(child);
        }
      }
    } else if (extensions.has(extname(path).toLowerCase())) {
      files.push(path);
    }
  }
  return files.sort((a, b) => basename(a).localeCompare(basename(b), undefined, { numeric: true }));
}

function publicId(file) {
  return basename(file, extname(file));
}

function matchName(file) {
  return publicId(file).replace(/_[a-z0-9]{6}$/i, "");
}

function logicalName(value) {
  return value.replace(/_[a-z0-9]{6}$/i, "");
}

async function runWrangler(args) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await execFileAsync("npx", ["wrangler", ...args], { maxBuffer: 4 * 1024 * 1024 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 1000));
    }
  }
  throw lastError;
}

async function upload(bucket, key, file, contentType) {
  await runWrangler([
    "r2",
    "object",
    "put",
    `${bucket}/${key}`,
    "--remote",
    "--file",
    file,
    "--content-type",
    contentType,
    "--cache-control",
    "public, max-age=31536000, immutable",
  ]);
}

function variantKey(preset, key) {
  return `variants/${preset}/${key.replace(/\.[^./]+$/, ".webp")}`;
}

async function writeVariant(source, outputPath, width, height) {
  const pipeline = sharp(source).rotate().resize({
    width,
    height,
    fit: "inside",
    withoutEnlargement: true,
  });

  await pipeline.webp({ quality: 82 }).toFile(outputPath);
}

async function publishImage(file, folder, manifest, tempDirectory) {
  const inputId = publicId(file);
  const existing = (manifest.folders[folder] ?? []).find(
    (asset) => logicalName(asset.publicId) === logicalName(inputId),
  );
  const id = existing?.publicId || inputId;
  const extension = extname(file).toLowerCase() === ".jpeg" ? ".jpg" : extname(file).toLowerCase();
  const key = existing?.key || `images/${folder}/${id}${extension}`;
  const metadata = await sharp(file).metadata();
  const rotated = metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  if (!width || !height) throw new Error(`Could not read dimensions: ${file}`);

  await upload(PRIVATE_BUCKET, key, file, metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format}`);

  const variants =
    folder === "system"
        ? id === "social"
          ? [{ preset: "w-1600", width: 1600, watermark: false }]
          : logicalName(id) === "logo"
            ? [{ preset: "w-192", width: 192, watermark: false }]
            : [{ preset: "w-960", width: 960, watermark: false }]
        : [
            ...IMAGE_WIDTHS.map((variantWidth) => ({ preset: `w-${variantWidth}`, width: variantWidth, watermark: false })),
            { preset: "fullscreen", width: 2560, height: 1600, watermark: false },
          ];

  await Promise.all(variants.map(async (variant) => {
    const output = join(tempDirectory, `${crypto.randomUUID()}.webp`);
    try {
      await writeVariant(file, output, variant.width, variant.height);
      await upload(DELIVERY_BUCKET, variantKey(variant.preset, key), output, "image/webp");
    } finally {
      await rm(output, { force: true });
    }
  }));

  return {
    publicId: id,
    key,
    width,
    height,
    aspectRatio: width / height,
    alt: existing?.alt || "",
    type: "image",
  };
}

async function videoInfo(file) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height:format=duration",
    "-of", "json",
    file,
  ]);
  const data = JSON.parse(stdout);
  return {
    width: data.streams[0].width,
    height: data.streams[0].height,
    duration: Number(data.format.duration),
  };
}

async function publishVideo(file, posterFiles, manifest, tempDirectory) {
  const inputId = publicId(file);
  const existing = (manifest.folders.video ?? []).find(
    (asset) => logicalName(asset.publicId) === logicalName(inputId),
  );
  const id = existing?.publicId || inputId;
  const key = `videos/${basename(file)}`;
  const info = await videoInfo(file);
  await upload(DELIVERY_BUCKET, key, file, "video/mp4");

  const poster = posterFiles.find((candidate) => matchName(candidate) === matchName(file));
  let posterKey;
  if (poster) {
    posterKey = `posters/${id}.webp`;
    const output = join(tempDirectory, `${crypto.randomUUID()}.webp`);
    try {
      await sharp(poster).rotate().resize({ width: 1000, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toFile(output);
      await upload(DELIVERY_BUCKET, posterKey, output, "image/webp");
    } finally {
      await rm(output, { force: true });
    }
  }

  return {
    publicId: id,
    key,
    width: info.width,
    height: info.height,
    aspectRatio: info.width / info.height,
    alt: existing?.alt || "",
    type: "video",
    duration: info.duration,
    ...(posterKey ? { posterKey } : existing?.posterKey ? { posterKey: existing.posterKey } : {}),
  };
}

const args = parseArgs(process.argv.slice(2));
const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
const tempDirectory = await mkdtemp(join(tmpdir(), "rehders-publish-"));

try {
  let published;
  if (args.folder === "video") {
    const files = await expandInputs(args.files, VIDEO_EXTENSIONS);
    const posterFiles = args.posters
      ? await expandInputs([args.posters], IMAGE_EXTENSIONS)
      : [];
    published = [];
    for (const file of files) {
      console.log(`Publishing video ${basename(file)}`);
      published.push(await publishVideo(file, posterFiles, manifest, tempDirectory));
    }
  } else {
    if (!IMAGE_FOLDERS.has(args.folder)) throw new Error(`Unsupported image folder: ${args.folder}`);
    const files = await expandInputs(args.files, IMAGE_EXTENSIONS);
    published = [];
    for (const file of files) {
      console.log(`Publishing image ${basename(file)}`);
      published.push(await publishImage(file, args.folder, manifest, tempDirectory));
    }
  }

  const byId = new Map((manifest.folders[args.folder] ?? []).map((asset) => [asset.publicId, asset]));
  for (const asset of published) byId.set(asset.publicId, asset);
  manifest.folders[args.folder] = [...byId.values()].sort((a, b) =>
    a.publicId.localeCompare(b.publicId, undefined, { numeric: true }),
  );
  manifest.generatedAt = new Date().toISOString();
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Published ${published.length} asset(s) and updated the manifest.`);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
