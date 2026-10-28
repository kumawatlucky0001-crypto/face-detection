"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const HOST = "127.0.0.1";
const PORT = 3000;
const APP_URL = `http://${HOST}:${PORT}/`;
const HTML_FILE = path.join(__dirname, "face detection.html");

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${HOST}:${PORT}`);

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
  console.log("Photo comparison stays in your browser; this server does not receive image files.");
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
});
