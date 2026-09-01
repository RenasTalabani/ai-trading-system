/**
 * RENO Phase 1, step 3 (2026-09-01) — the conversation layer itself.
 *
 * Deliberate design choice per the Phase 0 audit's own conclusion: the
 * LLM here is an ORCHESTRATOR over the app's existing, already-correct
 * trading logic, not a new brain trying to reason about trading from
 * scratch. It answers and converses; it does not decide trades, does not
 * compute P&L, and is instructed (system prompt below) to never state a
 * number it did not just get from a tool call. Every tool call is logged
 * onto the resulting ConversationMessage.toolCalls[] so any reply can be
 * traced back to real data — see ConversationMessage.js's own comment.
 *
 * Provider: Anthropic (Claude), per your explicit ask for the model
 * better suited to this job — chosen over the codebase's one existing
 * LLM integration (OPENAI_KEY in hourlyReportJob.js, GPT-4o-mini) because
 * this job's core requirement is "never fabricate a real number," which
 * is an instruction-following property, not a raw-capability one.
 *
 * Needs ANTHROPIC_API_KEY set (Railway env var — you'll need to add this
 * yourself; I don't handle API keys). Mirrors hourlyReportJob.js's
 * existing OPENAI_KEY pattern: if it's not configured, this degrades to
 * a clear "not set up yet" reply instead of crashing, and the user's
 * message is still saved so history isn't lost once it's configured.
 *
 * MODEL ID (2026-09-01): verified, not guessed — cross-checked against
 * Anthropic's own docs (platform.claude.com/docs/en/models/overview,
 * fetched live) AND corroborated independently by this very session's
 * own model identifier (claude-sonnet-5, matching that doc's naming
 * scheme exactly). Default below is the Haiku-tier id from that same
 * page: claude-haiku-4-5-20251001. Override via ANTHROPIC_MODEL if a
 * different tier (e.g. claude-sonnet-5) is preferred for cost/quality.
 */
const axios = require('axios');
const logger = require('../config/logger');

const ConversationThread  = require('../models/ConversationThread');
const ConversationMessage = require('../models/ConversationMessage');
const VirtualTrade        = require('../models/VirtualTrade');
const TradeThesis         = require('../models/TradeThesis'); // Phase 3, step 2

const { getAllCachedPrices, TRACKED_ASSETS } = require('./binanceService');
const aiService = require('./aiService');
const { getSummary, approveSuggestion, getTrackRecordByAsset } = require('./virtualTrackingService');
const { resolveSuggestion, buildPositionGuidance } = require('../controllers/guideController');
const AIDecision = require('../models/AIDecision');

const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY || null;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001'; // verified 2026-09-01, see MODEL ID note above
const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages';
const MAX_TOOL_ROUNDS = 4; // hard cap so a confused tool-call loop can't run away

const EXTENDED_PRICE_ASSETS = ['XAUUSD']; // mirrors guideController.js's own list

const SYSTEM_PROMPT = `You are RENO, the trading companion inside this app. You talk with the user about their (paper/virtual — not real-money) trading account.

Hard rules, no exceptions:
1. Never state a price, P&L figure, win/loss result, confidence level, or trade detail unless you just received it from a tool call in this conversation. If you don't have a number, say you don't have it and offer to look it up — never estimate or guess a number.
2. Never promise or imply a guaranteed profit ("you will make $X"). You can report what already happened (real, tool-sourced P&L) and what a suggestion's plan looks like (entry/stop/target from a tool), but the outcome of anything not yet closed is always uncertain — say so.
3. This is a paper-trading account. If the user seems to believe real money is at risk, correct that plainly.
4. Keep replies short and conversational — a few sentences, not a report.
5. Use the tools whenever the user asks about their positions, past trades, or what to do next. Don't answer those from memory.`;

// ── Tool definitions (Anthropic tool-use schema) ───────────────────────────

const TOOLS = [
  {
    name: 'get_suggestion',
    description: "Get the AI's current single best trade suggestion (same logic Guide's suggestion card uses) — asset, action, entry/stop/target, confidence, and plain-language reasoning. Returns null if nothing qualifies right now.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_open_positions',
    description: 'List the user\'s currently open (paper) trades with live price, real unrealized P&L %, and a HOLD/SELL recommendation for each, with reasons.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_recent_trade_outcomes',
    description: 'Get the user\'s most recently CLOSED trades with real, final results — asset, direction, exit reason (TP/SL/manual/etc.), real dollar P&L, real P&L %, and when it closed. Use this to answer "did I actually win" / "how did that trade go" / "what have we done together" type questions.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'How many recent closed trades to return (default 10, max 30)' },
        asset: { type: 'string', description: 'Optional — filter to one asset, e.g. "XAUUSD" or "BTCUSDT"' },
      },
    },
  },
  {
    name: 'get_portfolio_summary',
    description: 'Get real, current account-level numbers: balance, total real P&L, win rate, number of open/closed trades.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_track_record',
    description: 'Get the account\'s real, closed-trade track record -- win rate, trade count, and total/average P&L, broken down per asset (or for one specific asset). Use this for "how are we doing on X" / "what\'s my win rate" / "which assets have been best/worst" type questions.',
    input_schema: {
      type: 'object',
      properties: {
        asset: { type: 'string', description: 'Optional -- filter to one asset, e.g. "BTCUSDT" or "XAUUSD". Omit for a full breakdown across every traded asset.' },
      },
    },
  },
];

async function _getLivePrice(asset) {
  if (EXTENDED_PRICE_ASSETS.includes(asset)) return await aiService.getPrice(asset);
  const cached = getAllCachedPrices()[asset];
  return cached ? (typeof cached === 'object' ? cached.price : cached) : null;
}

// ── Tool execution — every one of these is a thin call into EXISTING,
// already-correct logic (guideController / virtualTrackingService /
// VirtualTrade) — no trading logic is duplicated or reimplemented here. ──

async function _execGetSuggestion() {
  const suggestion = await resolveSuggestion();
  return suggestion || { message: 'No strong recommendation right now — nothing currently clears the confidence/quality bar.' };
}

async function _execGetOpenPositions() {
  const openTrades = await VirtualTrade.find({ status: 'open' }).sort({ openedAt: -1 });
  if (openTrades.length === 0) return { positions: [], message: 'No open positions right now.' };

  const prices = getAllCachedPrices();
  for (const asset of EXTENDED_PRICE_ASSETS) {
    const price = await aiService.getPrice(asset);
    if (price !== null) prices[asset] = { price };
  }

  const positions = openTrades.map(trade => {
    const cached = prices[trade.asset];
    const currentPrice = cached ? (typeof cached === 'object' ? cached.price : cached) : trade.entryPrice;
    return buildPositionGuidance(trade, currentPrice, null);
  });
  return { positions };
}

async function _execGetRecentTradeOutcomes(input = {}) {
  const limit = Math.min(Math.max(parseInt(input.limit) || 10, 1), 30);
  const query = { status: { $in: ['closed_profit', 'closed_loss', 'cancelled', 'expired'] } };
  if (input.asset) query.asset = String(input.asset).toUpperCase();

  const trades = await VirtualTrade.find(query).sort({ closedAt: -1 }).limit(limit).lean();
  return {
    trades: trades.map(t => ({
      asset: t.asset, direction: t.direction, result: t.result, exitReason: t.exitReason,
      pnl: t.pnl, pnlPct: t.pnlPct, entryPrice: t.entryPrice, exitPrice: t.exitPrice,
      openedAt: t.openedAt, closedAt: t.closedAt,
    })),
  };
}

async function _execGetPortfolioSummary() {
  return await getSummary('all');
}

// Phase 2, step 3 (2026-09-01) -- "measurable track record" tool. A thin
// pass-through to getTrackRecordByAsset() (virtualTrackingService.js),
// which itself is a real aggregation over the same closed-trade query
// getSummary() already uses -- no new numbers invented here, just grouped
// and optionally filtered to one asset.
async function _execGetTrackRecord(input = {}) {
  const { perAsset } = await getTrackRecordByAsset('all');
  if (perAsset.length === 0) {
    return { message: 'No closed trades yet -- nothing to report a track record on.' };
  }
  if (input.asset) {
    const asset = String(input.asset).toUpperCase();
    const found = perAsset.find(a => a.asset === asset);
    return found || { message: `No closed trades for ${asset} yet.` };
  }
  return { perAsset };
}

const TOOL_EXECUTORS = {
  get_suggestion:            _execGetSuggestion,
  get_open_positions:        _execGetOpenPositions,
  get_recent_trade_outcomes: _execGetRecentTradeOutcomes,
  get_portfolio_summary:     _execGetPortfolioSummary,
  get_track_record:          _execGetTrackRecord,
};

// ── Thread helpers ───────────────────────────────────────────────────────────

async function _getOrCreateThread(userId) {
  let thread = await ConversationThread.findOne({ userId });
  if (!thread) thread = await ConversationThread.create({ userId });
  return thread;
}

async function _recentHistory(threadId, limit = 20) {
  const msgs = await ConversationMessage.find({ threadId }).sort({ createdAt: -1 }).limit(limit).lean();
  return msgs.reverse().map(m => ({ role: m.role, content: m.content }));
}

// ── Anthropic call ───────────────────────────────────────────────────────────

async function _callAnthropic(messages) {
  const resp = await axios.post(ANTHROPIC_URL, {
    model: ANTHROPIC_MODEL,
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages,
    tools: TOOLS,
  }, {
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    timeout: 20_000,
  });
  return resp.data;
}

/**
 * Send a user message, run the tool-use loop, persist both sides, and
 * return the assistant's ConversationMessage (with toolCalls populated).
 */
async function sendMessage(userId, text) {
  const thread = await _getOrCreateThread(userId);

  await ConversationMessage.create({ threadId: thread._id, role: 'user', content: text });

  if (!ANTHROPIC_KEY) {
    const reply = await ConversationMessage.create({
      threadId: thread._id,
      role: 'assistant',
      content: "I'm not fully wired up to chat yet — an AI provider key needs to be added on the backend first. Everything else in the app (Guide, positions, trade history) still works normally.",
    });
    return reply;
  }

  const history = await _recentHistory(thread._id, 20);

  try {
    let toolRounds = 0;
    let finalText = null;
    const loggedToolCalls = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const data = await _callAnthropic(history);
      const blocks = data.content || [];
      const toolUseBlocks = blocks.filter(b => b.type === 'tool_use');
      const textBlocks = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

      if (textBlocks) finalText = textBlocks;

      if (data.stop_reason !== 'tool_use' || toolUseBlocks.length === 0 || toolRounds >= MAX_TOOL_ROUNDS) {
        break;
      }

      history.push({ role: 'assistant', content: blocks });

      const toolResults = [];
      for (const call of toolUseBlocks) {
        const executor = TOOL_EXECUTORS[call.name];
        let result;
        try {
          result = executor ? await executor(call.input) : { error: `Unknown tool: ${call.name}` };
        } catch (err) {
          result = { error: err.message };
        }
        loggedToolCalls.push({ name: call.name, args: call.input, result });
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) });
      }
      history.push({ role: 'user', content: toolResults });
      toolRounds += 1;
    }

    const relatedTradeIds = [];
    for (const call of loggedToolCalls) {
      const r = call.result;
      if (r && Array.isArray(r.trades)) continue; // lean() docs here have no _id round-tripped as ObjectId reliably in this summary form
      if (r && Array.isArray(r.positions)) {
        for (const p of r.positions) if (p.tradeId) relatedTradeIds.push(p.tradeId);
      }
    }

    const assistantMsg = await ConversationMessage.create({
      threadId: thread._id,
      role: 'assistant',
      content: finalText || "I looked into it but didn't come back with a clear answer — try asking again a bit differently?",
      toolCalls: loggedToolCalls,
      relatedTradeIds,
    });

    await ConversationThread.updateOne({ _id: thread._id }, {
      lastMessageAt: assistantMsg.createdAt,
      lastMessagePreview: (assistantMsg.content || '').slice(0, 140),
    });

    return assistantMsg;
  } catch (err) {
    logger.error(`[Conversation] sendMessage failed: ${err.stack || err.message}`);
    return await ConversationMessage.create({
      threadId: thread._id,
      role: 'assistant',
      content: "Something went wrong on my end answering that — try again in a moment.",
    });
  }
}

/**
 * Phase 2, step 1 (2026-09-01) — approve a trade plan from within RENO
 * chat. This is reached by a dedicated "Approve" tap on a trade-plan card
 * in the chat UI, NOT by the LLM interpreting free-form text as consent —
 * a model deciding on its own that a sentence means "open this trade"
 * is exactly the kind of ambiguous, unauditable trigger this system
 * avoids everywhere else, so it isn't introduced here either.
 *
 * Security property, deliberately identical to guideController.approve()
 * (T-071): the server re-resolves the suggestion itself via
 * resolveSuggestion() and NEVER trusts a client-supplied asset/entry/
 * stop/target — even though the request now arrives from the chat screen
 * instead of Guide's button, the invariant does not change. This
 * duplicates guideController.approve()'s three-line resolve ->
 * approveSuggestion() shape rather than refactor that tested,
 * owner-reviewed function to add a second caller — guideController.js
 * stays completely untouched, per instruction.
 *
 * origin: 'conversation_approval' — see VirtualTrade.js's origin enum
 * comment and approveSuggestion()'s new optional parameter.
 */
async function approvePlan(userId) {
  const thread = await _getOrCreateThread(userId);

  const suggestion = await resolveSuggestion();
  if (!suggestion) {
    const reply = await ConversationMessage.create({
      threadId: thread._id,
      role: 'assistant',
      content: "There's no suggestion available to approve right now — it may have expired. Ask me for a fresh one first.",
    });
    return { success: false, message: reply.content, reply };
  }

  // T-061's same best-effort aiDecisionId lookup as guideController.approve() —
  // only attempted when the suggestion has no signalId of its own.
  let aiDecisionId = null;
  if (!suggestion.signalId) {
    const recentDecision = await AIDecision.findOne({
      asset: suggestion.asset, action: suggestion.action,
    }).sort({ createdAt: -1 }).lean();
    if (recentDecision) aiDecisionId = recentDecision._id;
  }

  try {
    const trade = await approveSuggestion({
      asset:      suggestion.asset,
      direction:  suggestion.action,
      entryPrice: suggestion.entryPrice,
      stopLoss:   suggestion.stopLoss,
      takeProfit: suggestion.takeProfit,
      atrAtEntry: suggestion.atrAtEntry ?? null,
      signalId:   suggestion.signalId || null,
      aiDecisionId,
      origin:     'conversation_approval',
    });

    // Phase 3, step 2 (2026-09-01): persist the exact plan and reasoning
    // this trade was approved on -- see TradeThesis.js's own header
    // comment. Built only from `suggestion` (already server-resolved
    // above, before any LLM or client input was involved) and `trade`
    // (the real, just-opened document) -- nothing here is client- or
    // LLM-supplied. A failure here does not undo the trade that already
    // opened; it's supplementary memory, logged and swallowed, same
    // convention as the fire-and-forget push notification below.
    try {
      await TradeThesis.create({
        tradeId:  trade._id,
        threadId: thread._id,
        asset:     trade.asset,
        direction: trade.direction,
        entry:     trade.entryPrice,
        investmentAmountUsd: trade.sizeUsd,
        stopLoss:   trade.stopLoss,
        takeProfit: trade.takeProfit,
        timeframe:  suggestion.timeframe ?? null,
        originalRecommendation: suggestion.action,
        originalReasoning:      suggestion.why || [],
        supportingMarketFactors: {
          confidence:    suggestion.confidence ?? null,
          decision:      suggestion.decision ?? null,
          isOlderSignal: suggestion.isOlderSignal ?? false,
          generatedAt:   suggestion.generatedAt ?? null,
        },
        invalidationConditions: `This thesis would be considered invalidated if the AI's active signal on ${suggestion.asset} flips to the opposite direction, or if momentum readings turn sharply against a ${suggestion.action} position.`,
        expectedConditions: `Expected to keep holding as long as ${suggestion.action === 'BUY' ? 'upward' : 'downward'} momentum continues and no contradicting signal appears.`,
        approvedByUser: true,
        approvalTimestamp: new Date(),
      });
    } catch (err) {
      logger.warn(`[Conversation] Failed to persist trade thesis for ${trade._id}: ${err.message}`);
    }

    const verb = trade.direction === 'BUY' ? 'Bought' : 'Sold';
    const content = `Done — ${verb} $${trade.sizeUsd.toFixed(2)} of ${suggestion.displayName || suggestion.asset}. This is a paper trade — I'll keep you posted on it here.`;
    const reply = await ConversationMessage.create({
      threadId: thread._id,
      role: 'assistant',
      content,
      relatedTradeIds: [trade._id],
    });
    await ConversationThread.updateOne({ _id: thread._id }, {
      lastMessageAt: reply.createdAt,
      lastMessagePreview: content.slice(0, 140),
    });
    return { success: true, trade, reply };
  } catch (err) {
    // Mirrors guideController.approve()'s honest-rejection handling
    // (e.g. "already have an open position") rather than a generic failure.
    const content = `Couldn't approve that — ${err.message}`;
    const reply = await ConversationMessage.create({
      threadId: thread._id,
      role: 'assistant',
      content,
    });
    return { success: false, message: err.message, reply };
  }
}

async function getThread(userId, limit = 50) {
  const thread = await _getOrCreateThread(userId);
  const messages = await ConversationMessage.find({ threadId: thread._id })
    .sort({ createdAt: -1 }).limit(limit).lean();
  return { thread, messages: messages.reverse() };
}

module.exports = { sendMessage, getThread, approvePlan, TOOLS, TOOL_EXECUTORS };
