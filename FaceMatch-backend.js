"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { promisify } = require("node:util");
const { randomBytes, scrypt, timingSafeEqual } = require("node:crypto");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 3000;
const APP_URL = `http://${HOST}:${PORT}/`;
const HTML_FILE = path.join(__dirname, "face detection.html");
const ACCOUNTS_FILE = path.join(__dirname, "FaceMatch-users.json");
const MAX_BODY_BYTES = 16 * 1024;
const scryptAsync = promisify(scrypt);
let accountOperations = Promise.resolve();

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("Request is too large."), { status: 413 }));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

async function readAccounts() {
  try {
    const contents = await fs.promises.readFile(ACCOUNTS_FILE, "utf8");
    const accounts = JSON.parse(contents);
    if (!Array.isArray(accounts)) throw new Error("Account data must be a JSON array.");
    return accounts;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeAccounts(accounts) {
  const temporaryFile = `${ACCOUNTS_FILE}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.promises.writeFile(temporaryFile, JSON.stringify(accounts, null, 2), { flag: "wx" });
    await fs.promises.rename(temporaryFile, ACCOUNTS_FILE);
  } catch (error) {
    await fs.promises.rm(temporaryFile, { force: true });
    throw error;
  }
}

function withAccountLock(operation) {
  const result = accountOperations.then(operation);
  accountOperations = result.catch(() => {});
  return result;
}

async function handleRegister(request, response) {
  const body = await readJsonBody(request);
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!fullName || fullName.length > 100) {
    sendJson(response, 400, { error: "Enter a name up to 100 characters long." });
    return;
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendJson(response, 400, { error: "Enter a valid email address." });
    return;
  }
  if (password.length < 8 || password.length > 128) {
    sendJson(response, 400, { error: "Password must be between 8 and 128 characters." });
    return;
  }

  const account = await withAccountLock(async () => {
    const accounts = await readAccounts();
    if (accounts.some((saved) => saved.email === email)) return null;

    const salt = randomBytes(16).toString("hex");
    const passwordHash = await scryptAsync(password, salt, 64);
    const newAccount = {
      fullName,
      email,
      salt,
      passwordHash: passwordHash.toString("hex"),
      createdAt: new Date().toISOString()
    };
    accounts.push(newAccount);
    await writeAccounts(accounts);
    return newAccount;
  });

  if (!account) {
    sendJson(response, 409, { error: "An account with this email already exists. Please log in instead." });
    return;
  }
  sendJson(response, 201, { fullName: account.fullName, email: account.email });
}

async function handleLogin(request, response) {
  const body = await readJsonBody(request);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password || password.length > 128) {
    sendJson(response, 401, { error: "Email or password is incorrect." });
    return;
  }

  const account = await withAccountLock(async () => {
    const accounts = await readAccounts();
    return accounts.find((saved) => saved.email === email);
  });
  if (!account) {
    sendJson(response, 401, { error: "Email or password is incorrect." });
    return;
  }

  const submittedHash = await scryptAsync(password, account.salt, 64);
  const savedHash = Buffer.from(account.passwordHash, "hex");
  if (savedHash.length !== submittedHash.length || !timingSafeEqual(savedHash, submittedHash)) {
    sendJson(response, 401, { error: "Email or password is incorrect." });
    return;
  }
  sendJson(response, 200, { fullName: account.fullName, email: account.email });
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${HOST}:${PORT}`);

  if (request.method === "POST" && requestUrl.pathname === "/api/register") {
    handleRegister(request, response).catch((error) => {
      console.error("Registration request failed:", error.message);
      if (!response.headersSent) sendJson(response, error.status || 500, {
        error: error.status ? error.message : "Could not create the account. Please try again."
      });
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/login") {
    handleLogin(request, response).catch((error) => {
      console.error("Login request failed:", error.message);
      if (!response.headersSent) sendJson(response, error.status || 500, {
        error: error.status ? error.message : "Could not log in. Please try again."
      });
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: "ok", app: "FaceMatch" }));
    return;
  }

  if (request.method !== "GET" || requestUrl.pathname !== "/") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  const page = fs.createReadStream(HTML_FILE);
  page.on("error", (error) => {
    console.error("Could not read the FaceMatch HTML file:", error.message);
    if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Could not load the FaceMatch page.");
  });
  page.pipe(response);
});

server.on("error", (error) => {
  console.error(`FaceMatch backend could not listen on ${HOST}:${PORT}:`, error.message);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`FaceMatch is running at ${APP_URL}`);
  console.log("Passwords are stored as salted hashes; photos stay in your browser.");
  if (process.env.FACEMATCH_NO_BROWSER !== "1") {
    const browser = spawn("cmd.exe", ["/c", "start", "", APP_URL], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    browser.on("error", (error) => {
      console.error("The app is running, but the browser could not be opened automatically:", error.message);
      console.error(`Open ${APP_URL} in your browser.`);
    });
    browser.unref();
  }
});
