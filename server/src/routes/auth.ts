import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../db";
import { hashPassword, verifyPassword } from "../lib/passwords";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

function isValidUsername(v: unknown): v is string {
  return typeof v === "string" && v.trim().length >= 3 && v.trim().length <= 60;
}

function isValidPassword(v: unknown): v is string {
  return typeof v === "string" && v.length >= 8 && v.length <= 200;
}

authRouter.get("/me", async (req, res) => {
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    return res.json({ authenticated: false, needsSetup: true });
  }
  if (!req.session.userId) {
    return res.json({ authenticated: false, needsSetup: false });
  }
  const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
  if (!user) {
    return res.json({ authenticated: false, needsSetup: false });
  }
  res.json({ authenticated: true, needsSetup: false, username: user.username });
});

// Only allowed while no account exists yet — creates the single account this app supports.
authRouter.post("/setup", async (req, res) => {
  const existing = await prisma.user.count();
  if (existing > 0) {
    return res.status(409).json({ error: "An account already exists." });
  }

  const { username, password } = req.body;
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: "Username must be 3-60 characters." });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { username: username.trim(), passwordHash } });
  req.session.userId = user.id;
  res.status(201).json({ authenticated: true, username: user.username });
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const user = await prisma.user.findUnique({ where: { username: username.trim() } });
  if (!user) {
    return res.status(401).json({ error: "Invalid username or password." });
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Login failed." });
    req.session.userId = user.id;
    res.json({ authenticated: true, username: user.username });
  });
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("mm.sid");
    res.status(204).end();
  });
});
