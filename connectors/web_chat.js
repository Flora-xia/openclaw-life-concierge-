const http = require("http");
const fs = require("fs");
const path = require("path");
const { TextDecoder } = require("util");
const { handleUserInput } = require("../runtime/life_concierge_runtime");

const DEFAULT_PORT = 3000;
const INDEX_HTML_PATH = path.join(__dirname, "index.html");

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Length": Buffer.byteLength(body, "utf8"),
  });
  res.end(body, "utf8");
}

function sendOptions(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end();
}

function sendHtmlFile(res, filePath) {
  fs.readFile(filePath, "utf8", (error, body) => {
    if (error) {
      sendJson(res, 404, {
        success: false,
        error: "File not found.",
      });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(body, "utf8"),
    });
    res.end(body, "utf8");
  });
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    req.on("end", () => {
      try {
        resolve(parseJsonBuffer(Buffer.concat(chunks), req.headers["content-type"]));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", () => {
      reject(new Error("Failed to read request body."));
    });
  });
}

function parseJsonBuffer(bodyBuffer, contentType) {
  const candidates = getBodyEncodingCandidates(bodyBuffer, contentType);
  let fallbackParsed = null;

  for (const encoding of candidates) {
    const rawBody = decodeBodyBuffer(bodyBuffer, encoding);

    if (rawBody === null) {
      continue;
    }

    if (!rawBody.trim()) {
      return {};
    }

    try {
      const parsed = JSON.parse(rawBody);

      if (!looksLikeMojibake(rawBody)) {
        return parsed;
      }

      fallbackParsed = fallbackParsed || parsed;
    } catch (_) {
      // PowerShell can omit charset for JSON; try the next common encoding.
    }
  }

  if (fallbackParsed) {
    return fallbackParsed;
  }

  throw new Error("Invalid JSON request body.");
}

function getBodyEncodingCandidates(bodyBuffer, contentType) {
  const charset = getCharsetFromContentType(contentType);
  const candidates = [];

  if (charset) {
    candidates.push(normalizeCharset(charset));
  } else {
    candidates.push("utf-8");
  }

  if (looksLikeUtf16Le(bodyBuffer)) {
    candidates.push("utf-16le");
  }

  candidates.push("utf-8", "gb18030", "gbk", "utf-16le");

  return [...new Set(candidates.filter(Boolean))];
}

function getCharsetFromContentType(contentType) {
  const match = String(contentType || "").match(/charset\s*=\s*"?([^;\s"]+)/i);
  return match ? match[1] : "";
}

function normalizeCharset(charset) {
  const normalized = String(charset || "").toLowerCase().replace(/_/g, "-");

  if (normalized === "utf8") {
    return "utf-8";
  }

  if (normalized === "utf16le" || normalized === "ucs-2") {
    return "utf-16le";
  }

  if (normalized === "gb2312") {
    return "gb18030";
  }

  return normalized;
}

function decodeBodyBuffer(bodyBuffer, encoding) {
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(bodyBuffer);
  } catch (_) {
    if (encoding === "utf-8") {
      return bodyBuffer.toString("utf8");
    }

    if (encoding === "utf-16le") {
      return bodyBuffer.toString("utf16le");
    }

    return null;
  }
}

function looksLikeUtf16Le(bodyBuffer) {
  if (!bodyBuffer || bodyBuffer.length < 4) {
    return false;
  }

  let zeroCount = 0;
  const max = Math.min(bodyBuffer.length, 32);

  for (let index = 1; index < max; index += 2) {
    if (bodyBuffer[index] === 0) {
      zeroCount += 1;
    }
  }

  return zeroCount >= 2;
}

function looksLikeMojibake(rawBody) {
  return rawBody.includes("\uFFFD") || /\?{2,}/.test(rawBody);
}

function normalizeChatInput(body) {
  if (body && Object.prototype.hasOwnProperty.call(body, "input")) {
    return body.input;
  }

  if (body && Object.prototype.hasOwnProperty.call(body, "message")) {
    return body.message;
  }

  return "";
}

async function handleChat(req, res) {
  let body;

  try {
    body = await parseJsonBody(req);
  } catch (error) {
    sendJson(res, 400, {
      success: false,
      error: error.message || "Invalid JSON request body.",
    });
    return;
  }

  try {
    const input = normalizeChatInput(body);
    const options = {
      useLLM: body && body.useLLM === true,
    };
    const runtimeResult = await handleUserInput(input, options);

    if (runtimeResult && runtimeResult.success === false) {
      sendJson(res, 200, {
        success: false,
        error: runtimeResult.error || "Runtime failed.",
        data: runtimeResult,
      });
      return;
    }

    sendJson(res, 200, {
      success: true,
      data: runtimeResult,
    });
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      error: error.message || "Runtime error.",
    });
  }
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");

    if (req.method === "OPTIONS") {
      sendOptions(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        status: "ok",
        service: "web_chat",
      });
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      sendHtmlFile(res, INDEX_HTML_PATH);
      return;
    }

    if (req.method === "POST" && url.pathname === "/chat") {
      await handleChat(req, res);
      return;
    }

    sendJson(res, 404, {
      success: false,
      error: "Path not found.",
    });
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      error: error.message || "Service error.",
    });
  }
}

function startServer(options = {}) {
  const port = Number(options.port || process.env.WEB_CHAT_PORT || DEFAULT_PORT);
  const host = options.host || "127.0.0.1";
  const server = http.createServer((req, res) => {
    handleRequest(req, res);
  });

  server.listen(port, host, () => {
    console.log(`web_chat listening on http://${host}:${port}`);
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
  handleRequest,
  parseJsonBody,
  sendJson,
};
