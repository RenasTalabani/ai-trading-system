"""
UnifiedAnalyzer — one call, all engines, one fused signal.
Fusion weights: OB 40% · Strategy 35% · News 15% · Social 10%
"""
import asyncio
import logging

from app.services.signal_engine import _decision_label

logger = logging.getLogger("ai-service.unified_analyzer")

_TF_MAP = {'15m': '1d', '1h': '7d', '4h': '7d', '1d': '30d'}


def _action_to_score(action: str, confidence: float) -> float:
    """Convert a directional action + confidence into a 0-100 bullish score.

    T-070 (2026-08-29, owner-reviewed, kept as-is): a HOLD vote here always
    flattens to exactly 50 regardless of its own reported `confidence` --
    e.g. Strategy voting "HOLD, 80% confident" contributes the same neutral
    50 as "HOLD, 51% confident" to the fused score. Flagged during the
    overnight validation pass as a candidate contributor to crypto assets
    struggling to clear MIN_FUSED_SCORE (a confident-but-neutral Strategy
    vote dilutes a strong directional OB signal at OB's 40% weight no
    differently than a barely-neutral one would). Owner decision: a HOLD
    vote genuinely carries no directional edge -- there's no principled way
    to turn "how confident is this non-signal" into a bullish/bearish
    lean -- so contributing flat neutral is arguably correct, and the
    fusion formula is deliberately left unchanged rather than trying to
    smuggle directional information out of a HOLD's confidence value.
    """
    if action == 'BUY':
        return confidence
    if action == 'SELL':
        return 100.0 - confidence
    return 50.0


def _score_to_action(score: float) -> tuple:
    """Convert a fused 0-100 score to (action, confidence)."""
    if score >= 58:
        return 'BUY', min(95, int(score))
    if score <= 42:
        return 'SELL', min(95, int(100 - score))
    return 'HOLD', 50


class UnifiedAnalyzer:
    def __init__(self, strategy_engine, order_block_engine,
                 news_analyzer, social_analyzer):
        self._strategy = strategy_engine
        self._ob       = order_block_engine
        self._news     = news_analyzer
        self._social   = social_analyzer

    async def analyze(self, asset: str, timeframe: str,
                      capital: float = 500.0) -> dict:
        asset     = asset.upper()
        timeframe = timeframe.lower()
        base      = asset.replace('USDT', '').replace('BUSD', '')
        strat_tf  = _TF_MAP.get(timeframe, '7d')

        # T-086 (2026-08-31): a timed-out engine here silently falls back to
        # a neutral HOLD/50 vote (see the parsing below), and OB+Strategy
        # alone carry 75% of the fusion weight -- so a routine OB or
        # Strategy timeout doesn't just lose one signal, it drags the whole
        # fused score toward 50 regardless of what the market is actually
        # doing, which then can never clear global_analyzer.py's
        # MIN_CONFIDENCE/MIN_FUSED_SCORE gates (both effectively require the
        # *original* fused score to reach ~65-70, not a macro-adjusted one --
        # rl_score/macro weighting is computed but never actually gates
        # anything, contrary to what earlier comments in that file assumed).
        # Timing instrumentation added here (not just on timeout, so a
        # "successful but slow" call is visible too) to find out whether
        # these budgets are actually too tight for how long the real calls
        # take, before touching any threshold.
        async def _safe(coro, timeout=15, label=''):
            started = asyncio.get_event_loop().time()
            try:
                result = await asyncio.wait_for(coro, timeout=timeout)
                elapsed = asyncio.get_event_loop().time() - started
                logger.info(f"[Unified] {asset} {label} ok in {elapsed:.1f}s (budget {timeout}s)")
                return result
            except Exception as e:
                elapsed = asyncio.get_event_loop().time() - started
                logger.warning(f"[Unified] {asset} {label} timeout/error after {elapsed:.1f}s (budget {timeout}s): {e}")
                return None

        # T-086 (2026-08-31): budgets below were 15/20/12/12s. Live
        # instrumentation (see the log lines in _safe()) showed Strategy
        # consistently finishing in 0.7-2.3s -- comfortably inside its
        # budget, never the problem -- while OrderBlock, News, and Social
        # ALL timed out on EVERY asset in a real scan, clustered tightly at
        # ~23-27.5s (their timestamps land within milliseconds of each
        # other across a dozen concurrent asset calls, consistent with
        # News/Social's refresh() being a shared/batched fetch all callers
        # wait on together, not 12 independent slow calls -- so this isn't
        # "gets worse with more tracked assets"). That meant OB(40%) +
        # News(15%) + Social(10%) -- 65% of the fusion weight -- defaulted
        # to a neutral HOLD/50 vote on literally every scored asset, which
        # is mechanically why nothing has cleared global_analyzer.py's
        # MIN_CONFIDENCE/MIN_FUSED_SCORE gates: only Strategy's 35% carried
        # any real signal, and _action_to_score flattens any HOLD vote to
        # 50 regardless of confidence, so even a real Strategy SELL lean
        # only ever nudged the fused score into the low-to-mid 40s. Raised
        # to comfortably clear the observed ~27.5s worst case with margin;
        # global_analyzer.py's outer per-asset wrapper (_score_crypto) is
        # raised to match in the same commit.
        results = await asyncio.gather(
            _safe(self._strategy.analyze_multi([asset], strat_tf), timeout=15, label='strategy'),
            _safe(self._ob.analyze(asset, timeframe), timeout=40, label='orderblock'),
            _safe(self._news.refresh(), timeout=35, label='news'),
            _safe(self._social.refresh(), timeout=35, label='social'),
        )

        strat_recs, ob_result, news_result, social_result = results

        # ── Parse strategy ───────────────────────────────────────────────────
        strat_rec = None
        if isinstance(strat_recs, list) and strat_recs:
            strat_rec = strat_recs[0]

        strat_action = strat_rec.get('recommendation', 'HOLD') if strat_rec else 'HOLD'
        strat_conf   = float(strat_rec.get('confidence', 50))  if strat_rec else 50.0
        strat_score  = _action_to_score(strat_action, strat_conf)

        # ── Parse order blocks ───────────────────────────────────────────────
        ob_signal     = {}
        ob_tech       = {}
        if isinstance(ob_result, dict) and ob_result.get('success'):
            ob_signal = ob_result.get('signal', {})
            ob_tech   = {
                'current_price': ob_result.get('current_price'),
                'ema50':         ob_result.get('ema50'),
                'ema200':        ob_result.get('ema200'),
                'rsi':           ob_result.get('rsi'),
                'trend':         ob_result.get('trend'),
                'order_blocks':  ob_result.get('order_blocks', [])[:5],
            }

        ob_action = ob_signal.get('action', 'HOLD')
        ob_conf   = float(ob_signal.get('confidence', 50))
        ob_score  = _action_to_score(ob_action, ob_conf)

        # ── Parse news / social ──────────────────────────────────────────────
        news_score   = 50.0
        social_score = 50.0
        sentiment    = 'neutral'
        impact       = 0.0
        top_events   = []
        article_count = 0
        # T-066: real data already fetched by self._social.refresh() above --
        # SocialAnalyzer computes manipulation_detected/pump_detected per
        # asset (same source signal_engine.py's decision label already uses),
        # but this function used to discard it after reading only
        # market_score. Surfacing it costs zero new I/O.
        manipulation_detected = False

        if isinstance(news_result, dict):
            nd = news_result.get('by_asset', {}).get(base, {})
            news_score    = float(nd.get('market_score', 50))
            sentiment     = nd.get('sentiment', 'neutral')
            impact        = float(nd.get('impact', 0.0))
            top_events    = nd.get('top_events', [])[:3]
            article_count = int(nd.get('article_count', 0))

        if isinstance(social_result, dict):
            sd = social_result.get('by_asset', {}).get(base, {})
            social_score = float(sd.get('market_score', 50))
            manipulation_detected = bool(
                sd.get('manipulation_detected', False) or sd.get('pump_detected', False)
            )

        # ── Fusion: OB 40% + Strategy 35% + News 15% + Social 10% ───────────
        fused_score = (
            ob_score    * 0.40 +
            strat_score * 0.35 +
            news_score  * 0.15 +
            social_score * 0.10
        )
        fused_action, fused_conf = _score_to_action(fused_score)
        logger.info(
            f"[Unified] {asset} fused={fused_score:.1f} -> {fused_action}@{fused_conf} "
            f"(ob={ob_score:.1f}[{ob_action}] strat={strat_score:.1f}[{strat_action}] "
            f"news={news_score:.1f} social={social_score:.1f})"
        )

        # T-066: derived WAIT/AVOID label, same convention as SignalEngine's
        # _decision_label() (T-065) -- reused rather than reimplemented, so
        # both AI pipelines agree on what "AVOID" means. mtf_fights and
        # funding_against aren't available in this pipeline (no
        # MultiTimeframeAnalyzer/funding-rate call here -- adding either
        # would be new I/O per asset per scan, a real architectural
        # addition, not just wiring existing data through -- left as a
        # documented follow-up rather than guessed at). manipulation_detected
        # is real, already-fetched data (see above), so it's the one risk
        # flag this pipeline can honestly surface today. This does NOT
        # change fused_action/fused_conf or anything else -- purely additive.
        decision_label = _decision_label(
            fused_action,
            manip_detected=manipulation_detected,
            mtf_fights=False,
            funding_against=False,
        )

        # Prefer OB entry/SL/TP when available, else derive from price
        entry_zone  = ob_signal.get('entry_zone')
        stop_loss   = ob_signal.get('stop_loss')
        take_profit = ob_signal.get('take_profit')
        risk_reward = ob_signal.get('risk_reward')

        current_price = ob_tech.get('current_price', 0.0) or 0.0
        # T-043 (2026-08-24): this used to unconditionally do
        #   stop_loss   = round(current_price * 0.98, 6)
        #   take_profit = round(current_price * 1.04, 6)
        # regardless of `fused_action` -- a long-only SL/TP shape (stop below
        # entry, target above). When OB itself held (no ob_signal SL/TP) but
        # strategy+news+social pushed the *fused* signal to SELL, this handed
        # out a stop_loss BELOW price and take_profit ABOVE price for a short
        # -- backwards protection that offers no real stop-out on a short and
        # a target on the wrong side. It also fired for a fused HOLD, so a
        # non-actionable signal could still be shown with live-looking trade
        # levels (mobile's signal card renders Stop Loss/Take Profit tiles
        # whenever they're non-null, with no gate on `action`). Fixed to
        # mirror OrderBlockEngine's own SELL convention (stop above entry,
        # target below) and to only synthesize levels for an actionable
        # (BUY/SELL) fused signal, matching how HOLD signals carry no SL/TP
        # everywhere else in this codebase (e.g. OrderBlockEngine._hold_signal).
        if stop_loss is None and current_price > 0 and fused_action != 'HOLD':
            if fused_action == 'BUY':
                stop_loss   = round(current_price * 0.98, 6)
                take_profit = round(current_price * 1.04, 6)
            else:  # SELL
                stop_loss   = round(current_price * 1.02, 6)
                take_profit = round(current_price * 0.96, 6)
            risk_reward = '1:2'

        # ── Allocation ───────────────────────────────────────────────────────
        allocation      = round(capital * 0.6, 2)
        risk_amount     = round(allocation * 0.05, 2)
        expected_profit = round(allocation * (strat_rec.get('expected_move_percent', 2) / 100)
                                * (fused_conf / 100), 2) if strat_rec else 0.0
        expected_loss   = round(-risk_amount, 2)
        win_rate        = round(
            (strat_rec.get('win_probability', fused_conf) if strat_rec else fused_conf), 1
        )

        # ── Build reason ─────────────────────────────────────────────────────
        parts = []
        if ob_signal.get('reason'):
            parts.append(f"OB: {ob_signal['reason']}")
        if strat_rec and strat_rec.get('reasoning'):
            parts.append(f"Strategy: {strat_rec['reasoning']}")
        if sentiment != 'neutral':
            parts.append(f"Sentiment {sentiment} (news {news_score:.0f}, social {social_score:.0f})")
        reason = ' | '.join(parts) if parts else f"Fused score {fused_score:.1f}/100"

        return {
            'success':   True,
            'asset':     asset,
            'timeframe': timeframe,
            'capital':   capital,

            'signal': {
                'action':      fused_action,
                'confidence':  fused_conf,
                'decision':    decision_label,
                'entry_zone':  entry_zone,
                'stop_loss':   stop_loss,
                'take_profit': take_profit,
                'risk_reward': risk_reward,
                'reason':      reason,
            },

            'technical': {
                'ob_action':              ob_action,
                'ob_confidence':          int(ob_conf),
                'ob_entry_zone':          entry_zone,
                'ob_stop_loss':           stop_loss,
                'ob_take_profit':         take_profit,
                'ob_risk_reward':         risk_reward,
                'ob_reason':              ob_signal.get('reason'),
                'strategy_recommendation': strat_action,
                'strategy_confidence':    strat_conf,
                'strategy_reasoning':     strat_rec.get('reasoning') if strat_rec else None,
                'expected_move_percent':  strat_rec.get('expected_move_percent', 0) if strat_rec else 0,
                **ob_tech,
            },

            'sentiment': {
                'news_score':    round(news_score, 1),
                'social_score':  round(social_score, 1),
                'combined_score': round((news_score + social_score) / 2, 1),
                'sentiment':     sentiment,
                'impact':        round(impact, 3),
                'top_events':    top_events,
                'article_count': article_count,
                'manipulation_detected': manipulation_detected,
            },

            'allocation': {
                'capital':          capital,
                'recommended':      allocation,
                'risk_amount':      risk_amount,
                'expected_profit':  expected_profit,
                'expected_loss':    expected_loss,
                'win_rate':         win_rate,
            },

            'fusion_weights': {
                'ob': 0.40, 'strategy': 0.35,
                'news': 0.15, 'social': 0.10,
            },
        }
