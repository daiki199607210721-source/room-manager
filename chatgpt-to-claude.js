(function (root) {
  function asText(part) {
    if (part == null) return "";
    if (typeof part === "string") return part;
    if (typeof part.text === "string") return part.text;
    if (typeof part === "object") {
      if (Array.isArray(part.parts)) return part.parts.map(asText).join("\n");
      if (typeof part.content === "string") return part.content;
    }
    try { return JSON.stringify(part); } catch (e) { return String(part); }
  }

  function messageText(message) {
    if (!message) return "";
    const content = message.content;
    if (!content) {
      if (typeof message.parts !== "undefined") return [].concat(message.parts).map(asText).join("\n");
      return "";
    }
    if (typeof content === "string") return content;
    const parts = content.parts || content.text || [];
    if (typeof parts === "string") return parts;
    if (Array.isArray(parts)) return parts.map(asText).filter(Boolean).join("\n");
    return asText(content);
  }

  function extractMessages(convo) {
    if (Array.isArray(convo.messages)) {
      return convo.messages.map(function (m) {
        return {
          role: (m.author && m.author.role) || m.role || "unknown",
          text: messageText(m).trim(),
          createTime: m.create_time || m.createTime || 0
        };
      }).filter(keepMessage);
    }
    const mapping = convo.mapping || {};
    return Object.keys(mapping).map(function (id) {
      const node = mapping[id] || {};
      const message = node.message;
      if (!message) return null;
      return {
        role: (message.author && message.author.role) || "unknown",
        text: messageText(message).trim(),
        createTime: message.create_time || 0
      };
    }).filter(Boolean).filter(keepMessage).sort(function (a, b) {
      return a.createTime - b.createTime;
    });
  }

  function keepMessage(m) {
    if (!m || !m.text) return false;
    if (m.role === "system" || m.role === "tool") return false;
    return m.role === "user" || m.role === "assistant";
  }

  function roleLabel(role) {
    if (role === "user") return "ユーザー";
    if (role === "assistant") return "ChatGPT";
    return role;
  }

  function safeTitle(title, index) {
    const raw = String(title || "無題のチャット").replace(/\s+/g, " ").trim() || "無題のチャット";
    return (index + 1) + ". " + raw;
  }

  function normalizeConversations(data) {
    if (!data) return [];
    let list = [];
    if (Array.isArray(data)) list = data;
    else if (Array.isArray(data.conversations)) list = data.conversations;
    else if (data.mapping || data.messages || data.title) list = [data];
    else return [];
    return list.map(function (convo, index) {
      const messages = extractMessages(convo);
      return {
        id: convo.id || convo.conversation_id || String(index),
        title: convo.title || "無題のチャット",
        createTime: convo.create_time || convo.createTime || 0,
        updateTime: convo.update_time || convo.updateTime || 0,
        messages: messages,
        messageCount: messages.length
      };
    }).filter(function (c) { return c.messageCount > 0; });
  }

  function conversationsToMarkdown(conversations) {
    const lines = [];
    lines.push("# ChatGPT 会話の取り込み（Claude / Cursor 用）");
    lines.push("");
    lines.push("このファイルは ChatGPT のデータエクスポートから変換したものです。Claude プロジェクトや Cursor のリポジトリ知識として使えます。");
    lines.push("");
    lines.push("- 会話数: " + conversations.length);
    lines.push("- 変換日時: " + new Date().toLocaleString("ja-JP"));
    lines.push("");
    conversations.forEach(function (convo, index) {
      lines.push("## " + safeTitle(convo.title, index));
      lines.push("");
      if (convo.createTime) {
        lines.push("- 作成: " + new Date(convo.createTime * 1000).toLocaleString("ja-JP"));
      }
      lines.push("- メッセージ数: " + convo.messageCount);
      lines.push("");
      convo.messages.forEach(function (m) {
        lines.push("### " + roleLabel(m.role));
        lines.push("");
        lines.push(m.text);
        lines.push("");
      });
      lines.push("---");
      lines.push("");
    });
    return lines.join("\n");
  }

  function conversationsDigest(conversations) {
    const lines = [];
    lines.push("# ChatGPT 会話ダイジェスト");
    lines.push("");
    lines.push("長い本文の代わりに、各会話の題名とユーザー依頼の要約です。");
    lines.push("");
    conversations.forEach(function (convo, index) {
      const firstUser = (convo.messages.find(function (m) { return m.role === "user"; }) || {}).text || "";
      const lastAssistant = ([].concat(convo.messages).reverse().find(function (m) { return m.role === "assistant"; }) || {}).text || "";
      lines.push("## " + safeTitle(convo.title, index));
      lines.push("");
      lines.push("**最初の依頼:** " + clip(firstUser, 400));
      lines.push("");
      lines.push("**最後の回答（抜粋）:** " + clip(lastAssistant, 400));
      lines.push("");
    });
    return lines.join("\n");
  }

  function clip(text, n) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n) + "…" : t;
  }

  function parseJsonText(text) {
    const data = JSON.parse(text);
    return normalizeConversations(data);
  }

  function readAscii(bytes) {
    return Array.prototype.map.call(bytes, function (b) { return String.fromCharCode(b); }).join("");
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("この環境ではZIP展開に対応していません。conversations.json を選んでください。");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function decodeZipEntry(method, payload) {
    if (method === 0) return new TextDecoder("utf-8").decode(payload);
    if (method === 8) return new TextDecoder("utf-8").decode(await inflateRaw(payload));
    throw new Error("未対応のZIP圧縮形式です。ZIPを展開して conversations.json を選んでください。");
  }

  function nameMatches(name, wanted) {
    const base = name.replace(/^.*[\\/]/, "").toLowerCase();
    return base === wanted.toLowerCase() || name.toLowerCase().endsWith("/" + wanted.toLowerCase());
  }

  async function unzipNamedFile(arrayBuffer, wanted) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    let eocd = -1;
    const searchFrom = Math.max(0, bytes.length - 22 - 65535);
    for (let i = bytes.length - 22; i >= searchFrom; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd >= 0) {
      const cdOffset = view.getUint32(eocd + 16, true);
      const cdSize = view.getUint32(eocd + 12, true);
      let offset = cdOffset;
      const cdEnd = Math.min(bytes.length, cdOffset + cdSize);
      while (offset + 46 <= cdEnd) {
        if (view.getUint32(offset, true) !== 0x02014b50) break;
        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const nameLen = view.getUint16(offset + 28, true);
        const extraLen = view.getUint16(offset + 30, true);
        const commentLen = view.getUint16(offset + 32, true);
        const localOff = view.getUint32(offset + 42, true);
        const name = readAscii(bytes.subarray(offset + 46, offset + 46 + nameLen));
        if (nameMatches(name, wanted) && localOff + 30 <= bytes.length) {
          const localNameLen = view.getUint16(localOff + 26, true);
          const localExtraLen = view.getUint16(localOff + 28, true);
          const dataStart = localOff + 30 + localNameLen + localExtraLen;
          const payload = bytes.subarray(dataStart, dataStart + compressedSize);
          return decodeZipEntry(method, payload);
        }
        offset += 46 + nameLen + extraLen + commentLen;
      }
    }
    let offset = 0;
    while (offset + 30 <= bytes.length) {
      if (view.getUint32(offset, true) !== 0x04034b50) break;
      const method = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const nameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const name = readAscii(bytes.subarray(offset + 30, offset + 30 + nameLen));
      const dataStart = offset + 30 + nameLen + extraLen;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > bytes.length) break;
      if (nameMatches(name, wanted) && compressedSize > 0) {
        return decodeZipEntry(method, bytes.subarray(dataStart, dataEnd));
      }
      offset = dataEnd;
    }
    throw new Error("ZIP内に " + wanted + " が見つかりません。展開して conversations.json を選んでください。");
  }

  async function parseFile(file) {
    const name = (file && file.name || "").toLowerCase();
    const buf = await file.arrayBuffer();
    if (name.endsWith(".zip") || (buf.byteLength >= 4 && new DataView(buf).getUint32(0, true) === 0x04034b50)) {
      const text = await unzipNamedFile(buf, "conversations.json");
      return parseJsonText(text);
    }
    const text = new TextDecoder("utf-8").decode(buf);
    return parseJsonText(text);
  }

  const api = {
    parseJsonText: parseJsonText,
    parseFile: parseFile,
    conversationsToMarkdown: conversationsToMarkdown,
    conversationsDigest: conversationsDigest,
    unzipNamedFile: unzipNamedFile
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ChatGPTToClaude = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
