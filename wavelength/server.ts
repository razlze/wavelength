import "dotenv/config";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server } from "socket.io";
import { attachGameSockets } from "./src/server/socket";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "localhost";
const port = parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "", true);
    void handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer, {
    path: "/socket.io/",
    cors: { origin: dev ? true : (process.env.NEXT_PUBLIC_APP_ORIGIN ?? true) },
  });

  attachGameSockets(io);

  httpServer.listen(port, () => {
    console.log(`Ready on http://${hostname}:${port}`);
  });
});
