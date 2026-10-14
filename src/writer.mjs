// The single writer. Every change to the log goes through here, one at a time, so two agents
// can never break a rule together. Reads go straight to D1.
import { DurableObject } from "cloudflare:workers";
import { cardFacts, compareViolations, gridChange, moments, publicView, upgradeLevels, validate } from "../lib/protocol.mjs";
import { cardSummary, createCard, imagesQueued, releaseWaiting, shootOne, screenshotsOn, takeDown } from "./cards.mjs";
import { OWNER_OPS, RULE_CHANGE_OPS, ToolError, clone, diffState, ops, restore } from "./ops.mjs";
import { effectiveMeta, ensureSchema, getEvents, isPublished, listCards, loadState, saveDiff, upgradeDiff } from "./store.mjs";

const HOOK_DELAY_MS = 60_000;
const HOOK_TRIES = 5;
const SHOT_GAP_MS = 2_000;
// Setup forms can't leave a field empty, so anything that isn't an https URL means "no hook".
const hookUrl = (env) => (/^https:\/\/\S+$/i.test(env.PUBLISH_HOOK_URL || "") ? env.PUBLISH_HOOK_URL : null);
export const TAKEN_DOWN_NOTE = "The card is taken down. Chat apps keep previews they already showed.";

export class Writer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.queue = Promise.resolve();
  }

  // input: { op, args, actor, access: "owner" | "agent", override?: boolean, reason?: string, directText?: boolean, origin?: string }
  // Without an op, it only saves what came due (a scheduled protocol upgrade).
  write(input) {
    const run = this.queue.then(() => this.apply(input));
    this.queue = run.catch(() => {});
    return run;
  }

  async apply({ op, args = {}, actor, access, override = false, reason, directText = false, origin }) {
    const env = this.env;
    await ensureSchema(env.DB);
    if (origin) await this.ctx.storage.put("origin", origin);
    const now = new Date().toISOString();
    const raw = await loadState(env.DB);
    const state = { ...raw, meta: effectiveMeta(raw.meta, env, now.slice(0, 10), raw.loops) };
    const due = upgradeDiff(raw.meta, state.meta);
    if (due) {
      const change = state.meta.protocolChange;
      await saveDiff(env.DB, due, { at: now, actor: "system", tool: "adopt_protocol", target: "meta", args: JSON.stringify(change) });
    }
    if (!op) return { ok: true, changed: Boolean(due) };
    const ctx = { actor, access, now, cycle: state.meta.cycle, directText };
    const next = clone(state);
    let out;
    try {
      if ((override || op === "undo_event") && access !== "owner") throw new ToolError("only the owner can do this.");
      if (override && !reason) throw new ToolError("an override records the reason the checks are skipped.");
      if (op === "undo_event") {
        const ev = await getEvents(env.DB, { id: args.id });
        if (!ev || !ev.before) throw new ToolError(`event ${args.id} has nothing to undo.`);
        restore(next, ev.before);
        Object.assign(next, upgradeLevels(next));
        out = { target: ev.target, result: { undid: ev.id, tool: ev.tool } };
      } else {
        if (!Object.hasOwn(ops, op)) throw new ToolError(`${op} is not a write this log accepts.`);
        if (OWNER_OPS.has(op) && access !== "owner") throw new ToolError("only the owner can do this. Connect with owner access or ask the owner.");
        out = ops[op](next, args, ctx);
      }
    } catch (err) {
      if (err instanceof ToolError) return { ok: false, error: err.message };
      throw err;
    }

    // A rule change is measured against the new rules on both sides, so it adds nothing else.
    const before = validate(RULE_CHANGE_OPS.has(op) ? { ...state, meta: next.meta } : state);
    const after = validate(next);
    const cmp = compareViolations(before, after);
    if (!cmp.ok && !override) {
      const rules = (cmp.added.length ? cmp.added : after).slice(0, 8).map((v) => v.message);
      return { ok: false, error: `Rejected: the write breaks the protocol. ${rules.join(" ")}`, violations: rules };
    }

    const diff = diffState(state, next);
    if (!Object.keys(diff.after).length) return { ok: true, result: out.result, target: out.target, grid: gridChange(state, state), changed: false };
    const eventId = await saveDiff(env.DB, diff, {
      at: now,
      actor,
      tool: override ? `override:${op}` : op,
      target: out.target,
      args: JSON.stringify(override ? { ...args, overrideReason: reason } : args).slice(0, 8000),
    });

    if (hookUrl(env) && (isPublished(state.meta, env) || isPublished(next.meta, env))) {
      const changed = JSON.stringify(publicView(state)) !== JSON.stringify(publicView(next));
      if (changed && !(await this.ctx.storage.get("hookAt"))) {
        await this.ctx.storage.put("hookAt", Date.now() + HOOK_DELAY_MS);
        await this.schedule(Date.now() + HOOK_DELAY_MS);
      }
    }

    const cardOpts = { origin: origin || (await this.ctx.storage.get("origin")) || "", published: isPublished(next.meta, env), languages: next.meta.languages };
    const extra = {};
    if (op === "undo_event") {
      const down = [];
      for (const card of await listCards(env.DB, { eventId: args.id }))
        if (!card.revoked_at) down.push((await takeDown(env, card, now)).id);
      if (down.length) Object.assign(extra, { cardsTakenDown: down, note: TAKEN_DOWN_NOTE });
    } else {
      const found = moments(state, next, op, out.result);
      if (found.length) extra.moment = await this.moment(found, next, eventId, now, cardOpts);
    }
    const released = await releaseWaiting(env, next, now);
    if (released.length) extra.cardsReady = released.map((c) => cardSummary(c, cardOpts));
    if (extra.moment?.card?.status === "ready" || released.length) await this.queueShots();

    return { ok: true, result: out.result, target: out.target, grid: gridChange(state, next), event: eventId, violations: after.length, ...extra };
  }

  // One card per write: the biggest moment gets it, the others come back as facts for the agent's message.
  async moment(found, next, eventId, now, cardOpts) {
    const [top, ...rest] = found;
    const also = rest.map((m) => ({ moment: m.moment, kind: m.kind, facts: cardFacts(next, m.moment, m.target).facts || null }));
    const base = { kind: top.kind, moment: top.moment, also };
    if (next.meta.cards === false) return { ...base, facts: cardFacts(next, top.moment, top.target).facts || null, card: { off: "cards are turned off in settings" } };
    const made = await createCard(this.env, top, next, eventId, now);
    if (made.none) return { ...base, facts: null, card: { none: made.none } };
    return { ...base, facts: made.card.waiting ? null : made.card.facts, card: cardSummary(made.card, cardOpts) };
  }

  // Asks the alarm to work through queued card images. Called after writes, remakes and the nightly retry.
  async queueShots(origin) {
    if (origin) await this.ctx.storage.put("origin", origin);
    if (!screenshotsOn(this.env)) return false;
    await this.schedule(Date.now() + 1_000);
    return true;
  }

  async schedule(at) {
    const current = await this.ctx.storage.getAlarm();
    if (!current || at < current) await this.ctx.storage.setAlarm(at);
  }

  async alarm() {
    const storage = this.ctx.storage;
    const hookAt = await storage.get("hookAt");
    if (hookAt && hookAt <= Date.now()) await this.fireHook();
    if (screenshotsOn(this.env)) {
      const origin = await storage.get("origin");
      if (origin && (await shootOne(this.env, origin)) && (await imagesQueued(this.env.DB))) await this.schedule(Date.now() + SHOT_GAP_MS);
    }
    const pending = await storage.get("hookAt");
    if (pending) await this.schedule(pending);
  }

  async fireHook() {
    const storage = this.ctx.storage;
    const url = hookUrl(this.env);
    const tries = ((await storage.get("hookTries")) || 0) + 1;
    let ok = !url;
    if (url) {
      try {
        const res = await fetch(url, { method: "POST" });
        ok = res.ok;
        if (!ok) console.log("publish hook answered", res.status);
      } catch (err) {
        console.log("publish hook failed", err?.message);
      }
    }
    if (ok || tries >= HOOK_TRIES) {
      await storage.delete(["hookAt", "hookTries"]);
      return;
    }
    await storage.put({ hookAt: Date.now() + HOOK_DELAY_MS * tries, hookTries: tries });
  }
}

export const writer = (env) => env.WRITER.get(env.WRITER.idFromName("log"));
