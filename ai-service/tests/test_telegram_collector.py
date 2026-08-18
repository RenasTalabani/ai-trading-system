"""
Tests for the Telegram public-preview collector. HTML parsing is tested
against a fixture built from the real structure of https://t.me/s/<channel>
(inspected directly), so this doesn't depend on network access or the
translation model -- both of those are exercised separately.
"""
from app.services.collectors.telegram_collector import (
    _is_promotional,
    _parse_view_count,
    extract_posts_from_html,
)

SAMPLE_HTML = """
<html><body>
<div class="tgme_widget_message_wrap">
  <div class="tgme_widget_message" data-post="TestChannel/1">
    <div class="tgme_widget_message_text js-message_text">Doge coin can be purchased at these prices with targets for next cycle in spot.</div>
    <div class="tgme_widget_message_footer">
      <a class="tgme_widget_message_date" href="#"><time datetime="2026-08-01T12:00:00+00:00" class="time"></time></a>
      <span class="tgme_widget_message_views">323</span>
    </div>
  </div>
</div>
<div class="tgme_widget_message_wrap">
  <div class="tgme_widget_message" data-post="TestChannel/2">
    <div class="tgme_widget_message_text js-message_text">Get a $3000 bonus with our referral link, sign up now!</div>
    <div class="tgme_widget_message_footer">
      <a class="tgme_widget_message_date" href="#"><time datetime="2026-08-01T13:00:00+00:00" class="time"></time></a>
      <span class="tgme_widget_message_views">1.2K</span>
    </div>
  </div>
</div>
<div class="tgme_widget_message_wrap">
  <div class="tgme_widget_message" data-post="TestChannel/3">
    <div class="tgme_widget_message_text js-message_text">Gold zone 3 breakdown, targets at $107 and $120.</div>
    <div class="tgme_widget_message_footer">
      <a class="tgme_widget_message_date" href="#"><time datetime="2026-08-02T09:30:00+00:00" class="time"></time></a>
      <span class="tgme_widget_message_views">2.4M</span>
    </div>
  </div>
</div>
<div class="tgme_widget_message_wrap">
  <div class="tgme_widget_message" data-post="TestChannel/4">
    <div class="tgme_widget_message_photo_wrap"></div>
  </div>
</div>
</body></html>
"""


class TestIsPromotional:
    def test_flags_referral_content(self):
        assert _is_promotional("Get a $3000 bonus with our referral link!")

    def test_flags_affiliate_content(self):
        assert _is_promotional("Use my affiliate code for a discount")

    def test_does_not_flag_genuine_market_commentary(self):
        assert not _is_promotional("Doge coin can be purchased at these prices, target for next cycle")

    def test_case_insensitive(self):
        assert _is_promotional("SIGN UP BONUS available now")


class TestParseViewCount:
    def test_plain_number(self):
        assert _parse_view_count("323") == 323

    def test_thousands_suffix(self):
        assert _parse_view_count("1.2K") == 1200

    def test_millions_suffix(self):
        assert _parse_view_count("2.4M") == 2_400_000

    def test_invalid_returns_zero(self):
        assert _parse_view_count("N/A") == 0

    def test_empty_returns_zero(self):
        assert _parse_view_count("") == 0


class TestExtractPostsFromHtml:
    def test_extracts_genuine_posts(self):
        posts = extract_posts_from_html(SAMPLE_HTML, limit=20)
        texts = [p.text for p in posts]
        assert any("Doge coin" in t for t in texts)
        assert any("Gold zone 3" in t for t in texts)

    def test_filters_out_promotional_post(self):
        posts = extract_posts_from_html(SAMPLE_HTML, limit=20)
        texts = [p.text for p in posts]
        assert not any("referral link" in t for t in texts)

    def test_skips_posts_with_no_text_element(self):
        # The 4th sample post is photo-only, no .tgme_widget_message_text
        posts = extract_posts_from_html(SAMPLE_HTML, limit=20)
        assert len(posts) == 2  # only the 2 genuine text posts, promo filtered, photo-only skipped

    def test_parses_view_counts_correctly(self):
        posts = extract_posts_from_html(SAMPLE_HTML, limit=20)
        views = {p.views for p in posts}
        assert 323 in views
        assert 2_400_000 in views

    def test_parses_timestamps(self):
        posts = extract_posts_from_html(SAMPLE_HTML, limit=20)
        assert all(p.published_at.year == 2026 for p in posts)

    def test_limit_respected(self):
        posts = extract_posts_from_html(SAMPLE_HTML, limit=1)
        assert len(posts) <= 1

    def test_empty_html_returns_no_posts(self):
        assert extract_posts_from_html("<html><body></body></html>", limit=20) == []
