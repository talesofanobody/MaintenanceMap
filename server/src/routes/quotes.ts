import { Router } from "express";
import { prisma } from "../db";
import { requires } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { parseOptionalString, ValidationError } from "../lib/validation";
import { quoteState, QUOTES_REQUIRED } from "../lib/planning";

/**
 * Quotes against a job or a project.
 *
 * The department rule is that a contractor job wants at least three quotes, with the
 * EAM team sending the request and notifying the award. That rule currently lives in
 * people's heads, which makes it unauditable: nobody can answer "did this job get its
 * three?" six months later without asking whoever sent the emails.
 *
 * As a table it becomes a countable fact and an awarded quote becomes a recorded
 * decision with a name against it. This router deliberately does not *enforce* the
 * rule by blocking an award — there are real reasons to award on one quote, such as
 * a sole supplier or an emergency — it makes the exception visible instead, which is
 * what an auditor actually wants.
 */
export const quotesRouter = Router();

const QUOTE_STATUSES = ["requested", "received", "declined", "awarded"];

const QUOTE_INCLUDE = {
  contractor: { select: { id: true, name: true, trade: true, phone: true, email: true } },
} as const;

function parseAmount(value: unknown, required = false): number | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ValidationError("A received quote needs an amount.");
    return null;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new ValidationError("amount must be a number");
  if (n < 0) throw new ValidationError("amount cannot be negative");
  return Math.round(n * 100) / 100;
}

/** Exactly one of issueId or projectId. A quote belongs to one thing. */
async function resolveTarget(body: any) {
  const issueId = typeof body.issueId === "string" && body.issueId ? body.issueId : null;
  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
  if (!issueId && !projectId) throw new ValidationError("A quote has to be against a job or a project.");
  if (issueId && projectId) throw new ValidationError("A quote belongs to a job or a project, not both.");

  if (issueId) {
    const issue = await prisma.issue.findUnique({ where: { id: issueId }, select: { id: true, title: true, propertyId: true } });
    if (!issue) throw new ValidationError("That job does not exist.");
    return { issueId, projectId: null, label: issue.title, propertyId: issue.propertyId };
  }
  const project = await prisma.project.findUnique({ where: { id: projectId! }, select: { id: true, name: true, propertyId: true } });
  if (!project) throw new ValidationError("That project does not exist.");
  return { issueId: null, projectId, label: project.name, propertyId: project.propertyId };
}

/** Every quote on one job or project, with the rule's state alongside. */
quotesRouter.get("/", async (req, res) => {
  const issueId = typeof req.query.issueId === "string" ? req.query.issueId : undefined;
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  if (!issueId && !projectId) return res.status(400).json({ error: "Ask for the quotes on a job or a project." });

  const quotes = await prisma.quote.findMany({
    where: { ...(issueId ? { issueId } : {}), ...(projectId ? { projectId } : {}) },
    include: QUOTE_INCLUDE,
    orderBy: { requestedAt: "asc" },
  });
  res.json({ quotes, state: quoteState(quotes), required: QUOTES_REQUIRED });
});

/** Record that an RFQ went out, or a number came back. */
quotesRouter.post("/", requires("issue.write"), async (req, res) => {
  try {
    const target = await resolveTarget(req.body);
    const contractorId = typeof req.body.contractorId === "string" ? req.body.contractorId : "";
    if (!contractorId) return res.status(400).json({ error: "Which contractor is this quote from?" });
    const contractor = await prisma.contractor.findUnique({ where: { id: contractorId }, select: { id: true, name: true } });
    if (!contractor) return res.status(400).json({ error: "That contractor does not exist." });

    const status = typeof req.body.status === "string" ? req.body.status : "requested";
    if (!QUOTE_STATUSES.includes(status)) return res.status(400).json({ error: "invalid quote status" });
    // An award is a decision, not a starting state — it goes through /award so the
    // person making it is recorded.
    if (status === "awarded") return res.status(400).json({ error: "Record the quote first, then award it." });

    const amount = parseAmount(req.body.amount, status === "received");

    const quote = await prisma.quote.create({
      data: {
        issueId: target.issueId,
        projectId: target.projectId,
        contractorId,
        amount,
        status,
        reference: parseOptionalString(req.body.reference, "reference", 120) ?? null,
        notes: parseOptionalString(req.body.notes, "notes", 1000) ?? null,
        receivedAt: status === "received" ? new Date() : null,
      },
      include: QUOTE_INCLUDE,
    });

    await logActivity(req, {
      action: "quote.recorded",
      entityType: target.issueId ? "issue" : "system",
      entityId: target.issueId ?? target.projectId!,
      propertyId: target.propertyId,
      summary: status === "received"
        ? `Quote from ${contractor.name} for "${target.label}": ${amount}`
        : `Quote requested from ${contractor.name} for "${target.label}"`,
    });
    res.status(201).json(quote);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

/** Update a quote — usually a number arriving against an outstanding request. */
quotesRouter.put("/:id", requires("issue.write"), async (req, res) => {
  const existing = await prisma.quote.findUnique({ where: { id: req.params.id }, include: { contractor: { select: { name: true } } } });
  if (!existing) return res.status(404).json({ error: "not found" });
  if (existing.status === "awarded") {
    return res.status(400).json({ error: "An awarded quote cannot be edited. Withdraw the award first." });
  }

  try {
    const data: Record<string, unknown> = {};
    if (req.body.status !== undefined) {
      const status = String(req.body.status);
      if (!QUOTE_STATUSES.includes(status)) return res.status(400).json({ error: "invalid quote status" });
      if (status === "awarded") return res.status(400).json({ error: "Awarding goes through /award so the decision is recorded." });
      data.status = status;
      // Receiving is a moment; the timestamp follows the status rather than being
      // passed in, so it cannot disagree with it.
      if (status === "received" && !existing.receivedAt) data.receivedAt = new Date();
      if (status === "requested") data.receivedAt = null;
    }
    const wantsReceived = (data.status ?? existing.status) === "received";
    if (req.body.amount !== undefined) data.amount = parseAmount(req.body.amount, wantsReceived);
    else if (wantsReceived && existing.amount == null) return res.status(400).json({ error: "A received quote needs an amount." });
    if (req.body.reference !== undefined) data.reference = parseOptionalString(req.body.reference, "reference", 120) ?? null;
    if (req.body.notes !== undefined) data.notes = parseOptionalString(req.body.notes, "notes", 1000) ?? null;

    const quote = await prisma.quote.update({ where: { id: existing.id }, data, include: QUOTE_INCLUDE });
    res.json(quote);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

/**
 * Award a quote.
 *
 * Awarding one un-awards any sibling in the same transaction — two awarded quotes on
 * one job is not a state anybody meant to create, and letting it exist would make the
 * committed figure wrong.
 *
 * The three-quote rule is reported, not imposed. An award on fewer than three is
 * allowed and the response says so, because a sole supplier and an emergency are both
 * real, and a rule that blocked them would simply be worked around outside the app —
 * at which point it stops being auditable, which was the whole point.
 */
quotesRouter.post("/:id/award", requires("issue.write"), async (req, res) => {
  const quote = await prisma.quote.findUnique({
    where: { id: req.params.id },
    include: {
      contractor: { select: { id: true, name: true } },
      issue: { select: { id: true, title: true, propertyId: true } },
      project: { select: { id: true, name: true, propertyId: true } },
    },
  });
  if (!quote) return res.status(404).json({ error: "not found" });
  if (quote.amount == null) return res.status(400).json({ error: "A quote cannot be awarded without an amount." });

  const where = quote.issueId ? { issueId: quote.issueId } : { projectId: quote.projectId! };
  const siblings = await prisma.quote.findMany({ where, select: { id: true, status: true } });
  const state = quoteState(siblings);

  await prisma.$transaction([
    // Anything previously awarded on this target goes back to received.
    prisma.quote.updateMany({ where: { ...where, status: "awarded" }, data: { status: "received", awardedAt: null, decidedBy: null } }),
    prisma.quote.update({
      where: { id: quote.id },
      data: { status: "awarded", awardedAt: new Date(), decidedBy: req.user!.username, receivedAt: quote.receivedAt ?? new Date() },
    }),
  ]);

  const label = quote.issue?.title ?? quote.project?.name ?? "work";
  const short = state.received < QUOTES_REQUIRED;
  await logActivity(req, {
    action: "quote.awarded",
    entityType: quote.issueId ? "issue" : "system",
    entityId: quote.issueId ?? quote.projectId!,
    propertyId: quote.issue?.propertyId ?? quote.project?.propertyId ?? null,
    summary: `Awarded "${label}" to ${quote.contractor.name} at ${quote.amount}` +
      (short ? ` — on ${state.received} quote${state.received === 1 ? "" : "s"}, below the ${QUOTES_REQUIRED} the rule asks for` : ""),
  });

  const quotes = await prisma.quote.findMany({ where, include: QUOTE_INCLUDE, orderBy: { requestedAt: "asc" } });
  res.json({
    quotes,
    state: quoteState(quotes),
    required: QUOTES_REQUIRED,
    // Said plainly so a caller can surface it rather than discovering it in an audit.
    belowRule: short,
    warning: short
      ? `Awarded on ${state.received} quote${state.received === 1 ? "" : "s"}. The rule asks for ${QUOTES_REQUIRED}; this is recorded against your name.`
      : null,
  });
});

quotesRouter.delete("/:id", requires("issue.write"), async (req, res) => {
  const quote = await prisma.quote.findUnique({
    where: { id: req.params.id },
    include: { contractor: { select: { name: true } }, issue: { select: { propertyId: true } }, project: { select: { propertyId: true } } },
  });
  if (!quote) return res.status(404).json({ error: "not found" });
  if (quote.status === "awarded") {
    return res.status(400).json({ error: "An awarded quote is the record of a decision. Award a different one instead of deleting this." });
  }
  await prisma.quote.delete({ where: { id: quote.id } });
  await logActivity(req, {
    action: "quote.deleted",
    entityType: quote.issueId ? "issue" : "system",
    entityId: quote.issueId ?? quote.projectId!,
    propertyId: quote.issue?.propertyId ?? quote.project?.propertyId ?? null,
    summary: `Removed the quote from ${quote.contractor.name}`,
  });
  res.status(204).end();
});
