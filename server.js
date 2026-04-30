import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 5173;

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8"
};

function safeResolve(requestUrl) {
    const url = new URL(requestUrl, `http://localhost:${PORT}`);
    const pathname = decodeURIComponent(url.pathname);
    const requestedPath = pathname === "/" ? "/index.html" : pathname;
    const resolved = path.resolve(__dirname, "." + requestedPath);

    if (!resolved.startsWith(__dirname)) {
        return null;
    }

    return resolved;
}

const server = http.createServer((req, res) => {
    const resolved = safeResolve(req.url || "/");

    if (!resolved) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    fs.readFile(resolved, (error, data) => {
        if (error) {
            res.writeHead(404);
            res.end("Not found");
            return;
        }

        const ext = path.extname(resolved);
        res.writeHead(200, {
            "Content-Type": MIME_TYPES[ext] || "application/octet-stream"
        });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`Embodied Agent Lab läuft auf http://localhost:${PORT}`);
});
