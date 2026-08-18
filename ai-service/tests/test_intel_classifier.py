"""
Tests for the rule-based fact/opinion/prediction/signal classifier and its
price-target / asset extraction. Pure functions, no I/O.
"""
from app.services.intel.classifier import (
    classify_text,
    classify_structured_data,
    extract_price_targets,
    detect_assets,
    detect_direction,
)


class TestFactVsOpinionVsPredictionVsSignal:
    def test_prediction_language_is_classified_as_prediction(self):
        r = classify_text("BTC could reach $70,000 by next month")
        assert r["kind"] == "prediction"
        assert r["is_prediction"] is True

    def test_signal_language_takes_priority_as_kind(self):
        # Contains both a prediction marker AND an explicit buy instruction --
        # the trade instruction is the more actionable, so it wins as `kind`.
        r = classify_text("Expect BTC to rise. Buy now at these levels.")
        assert r["kind"] == "signal"
        assert r["is_signal"] is True
        assert r["direction"] == "BUY"

    def test_fact_language_is_classified_as_fact(self):
        r = classify_text("The exchange announced the closure of its derivatives desk today")
        assert r["kind"] == "fact"
        assert r["is_fact"] is True

    def test_opinion_language_is_classified_as_opinion(self):
        r = classify_text("I think this market looks weak right now, personally")
        assert r["kind"] == "opinion"
        assert r["is_opinion"] is True

    def test_ambiguous_text_with_no_markers_defaults_to_opinion_not_fact_or_signal(self):
        """Conservative default: unclear content should never be silently
        upgraded to a fact or a trade signal."""
        r = classify_text("crypto markets are interesting these days")
        assert r["kind"] == "opinion"
        assert r["is_signal"] is False
        assert r["is_fact"] is False

    def test_structured_api_data_is_always_a_fact_with_full_confidence(self):
        r = classify_structured_data({"btc_dominance": 52.3})
        assert r["kind"] == "fact"
        assert r["is_fact"] is True
        assert r["confidence"] == 1.0

    def test_warning_language_is_flagged(self):
        r = classify_text("Warning: this project looks like a scam, be careful")
        assert r["is_warning"] is True
        assert r["category"] == "market_warning"


class TestDirectionDetection:
    def test_buy_words_detected(self):
        assert detect_direction("You should buy and accumulate here") == "BUY"

    def test_sell_words_detected(self):
        assert detect_direction("Time to sell and exit this position") == "SELL"

    def test_conflicting_signals_in_one_post_return_none(self):
        assert detect_direction("Some are buying while others sell") is None

    def test_no_direction_words_returns_none(self):
        assert detect_direction("The market moved sideways today") is None


class TestPriceTargetExtraction:
    def test_dollar_target_extracted_with_target_context(self):
        targets = extract_price_targets("BTC target for next cycle is $70,000")
        assert any(t["kind"] == "target" and t["value"] == 70_000 for t in targets)

    def test_k_suffix_normalized(self):
        targets = extract_price_targets("Strong support at $60k")
        assert any(t["kind"] == "support" and t["value"] == 60_000 for t in targets)

    def test_resistance_context_detected(self):
        targets = extract_price_targets("Facing resistance around $65,000")
        assert any(t["kind"] == "resistance" and t["value"] == 65_000 for t in targets)

    def test_untagged_dollar_number_gets_generic_level(self):
        targets = extract_price_targets("Currently trading at $64,200")
        assert any(t["kind"] == "level" and t["value"] == 64_200 for t in targets)

    def test_small_bare_number_without_currency_is_ignored_as_noise(self):
        # "3" alone (no $ sign, no k/m suffix, small value) is far more likely
        # to be some other number in the sentence than a price.
        targets = extract_price_targets("It happened 3 times this week")
        assert targets == []

    def test_multiple_targets_in_one_post(self):
        targets = extract_price_targets("Gold zone 3 breakdown, targets at $107 and $120")
        values = {t["value"] for t in targets}
        assert 107 in values and 120 in values


class TestAssetDetection:
    def test_detects_bitcoin_by_symbol_and_word(self):
        assert "BTCUSDT" in detect_assets("BTC is looking strong today")
        assert "BTCUSDT" in detect_assets("Bitcoin just broke out")

    def test_detects_multiple_assets_in_one_post(self):
        assets = detect_assets("Both BTC and ETH are rallying, SOL lagging behind")
        assert {"BTCUSDT", "ETHUSDT", "SOLUSDT"}.issubset(set(assets))

    def test_no_asset_mentioned_returns_empty(self):
        assert detect_assets("The weather is nice today") == []
