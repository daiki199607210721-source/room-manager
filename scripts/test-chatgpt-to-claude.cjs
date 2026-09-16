const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const api = require("../chatgpt-to-claude.js");

async function main() {
  const jsonPath = path.join(__dirname, "../fixtures/sample-chatgpt-conversations.json");
  const text = fs.readFileSync(jsonPath, "utf8");
  const convos = api.parseJsonText(text);
  if (convos.length !== 2) throw new Error("expected 2 conversations, got " + convos.length);
  if (convos[0].title !== "ROOM Manager 見積アプリ") throw new Error("bad title");
  if (convos[0].messages.length !== 2) throw new Error("bad message count");
  if (convos[0].messages[0].role !== "user") throw new Error("first should be user");
  const md = api.conversationsToMarkdown(convos);
  if (!md.includes("問屋は渡辺パイプだけ")) throw new Error("markdown missing user text");
  if (!md.includes("25%未満を赤")) throw new Error("markdown missing assistant text");
  const digest = api.conversationsDigest(convos);
  if (!digest.includes("粗利率の色分け")) throw new Error("digest missing title");

  const zipDir = path.join("/tmp", "chatgpt-export");
  fs.mkdirSync(zipDir, { recursive: true });
  const nestedJson = path.join(zipDir, "conversations.json");
  fs.copyFileSync(jsonPath, nestedJson);
  const zipPath = path.join("/tmp", "sample-chatgpt-export.zip");
  try { fs.unlinkSync(zipPath); } catch (e) {}
  const zip = spawnSync("zip", ["-j", zipPath, nestedJson], { encoding: "utf8" });
  if (zip.status !== 0) throw new Error("zip failed: " + (zip.stderr || zip.stdout));
  const zipBuf = fs.readFileSync(zipPath);
  const ab = zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength);
  const extracted = await api.unzipNamedFile(ab, "conversations.json");
  const fromZip = api.parseJsonText(extracted);
  if (fromZip.length !== 2) throw new Error("zip parse failed");
  console.log("ok", convos.length, "conversations");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
