const { createServer } = require("http");
const next = require("next");
const { Server } = require("socket.io");

const port = parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new Server(httpServer);

  io.on("connection", (socket) => {
    console.log("client connected", socket.id);

    socket.on("disconnect", () => {
      console.log("client disconnected", socket.id);
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Server listening at http://localhost:${port} (${dev ? "dev" : process.env.NODE_ENV})`);
  });
});
