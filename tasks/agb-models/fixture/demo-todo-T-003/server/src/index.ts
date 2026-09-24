import express from "express";
import { initDb } from "./db.js";
import { membersRouter } from "./routes/members.js";

initDb();

export const app = express();
app.use(express.json());
app.use("/api/members", membersRouter);

if (process.env.NODE_ENV !== "test") {
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  app.listen(port);
}
