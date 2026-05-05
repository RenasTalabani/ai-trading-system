import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show HapticFeedback;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../core/services/api_service.dart';
import '../../core/theme/app_theme.dart';

// ── Data model ────────────────────────────────────────────────────────────────

enum _Sender { user, brain }

class _Message {
  final String   text;
  final _Sender  sender;
  final String   type;        // text / action / asset / performance / streak / sentiment / news / risk / help
  final Map<String, dynamic>? data;
  final DateTime ts;

  _Message({
    required this.text, required this.sender,
    this.type = 'text', this.data, DateTime? ts,
  }) : ts = ts ?? DateTime.now();
}

// ── Suggested questions ───────────────────────────────────────────────────────

const _suggestions = [
  'What should I buy?',
  'Market sentiment?',
  'AI win rate?',
  'Tell me about Bitcoin',
  'Current streak?',
  'Latest news',
  'Risk levels?',
  'Top opportunities',
];

// ── Provider ──────────────────────────────────────────────────────────────────

class _ChatNotifier extends StateNotifier<List<_Message>> {
  _ChatNotifier() : super([
    _Message(
      text: "Hi! I'm the AI Brain. Ask me anything about the markets, current signals, or AI performance.",
      sender: _Sender.brain,
      type: 'text',
    ),
  ]);

  bool _loading = false;
  bool get loading => _loading;

  final _loadingController = StreamController<bool>.broadcast();
  Stream<bool> get loadingStream => _loadingController.stream;

  Future<void> ask(String question) async {
    if (question.trim().isEmpty) return;
    state = [...state, _Message(text: question, sender: _Sender.user)];

    _loading = true;
    _loadingController.add(true);

    try {
      final resp = await ApiService.dio.post('brain/ask',
          data: {'question': question});
      final d = resp.data as Map<String, dynamic>;
      state = [...state, _Message(
        text: d['text']?.toString() ?? 'No response',
        sender: _Sender.brain,
        type: d['type']?.toString() ?? 'text',
        data: d['data'] as Map<String, dynamic>?,
      )];
    } catch (e) {
      state = [...state, _Message(
        text: 'Connection error. Make sure you\'re online and try again.',
        sender: _Sender.brain,
        type: 'text',
      )];
    } finally {
      _loading = false;
      _loadingController.add(false);
    }
  }

  @override
  void dispose() {
    _loadingController.close();
    super.dispose();
  }
}

final _chatProvider = StateNotifierProvider.autoDispose<_ChatNotifier, List<_Message>>(
    (_) => _ChatNotifier());

// ── Screen ────────────────────────────────────────────────────────────────────

class AskBrainScreen extends ConsumerStatefulWidget {
  const AskBrainScreen({super.key});

  @override
  ConsumerState<AskBrainScreen> createState() => _AskBrainScreenState();
}

class _AskBrainScreenState extends ConsumerState<AskBrainScreen> {
  final _ctrl   = TextEditingController();
  final _scroll = ScrollController();
  bool  _busy   = false;

  @override
  void dispose() {
    _ctrl.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(_scroll.position.maxScrollExtent,
            duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
      }
    });
  }

  Future<void> _send(String text) async {
    if (text.trim().isEmpty || _busy) return;
    HapticFeedback.selectionClick();
    _ctrl.clear();
    setState(() => _busy = true);
    await ref.read(_chatProvider.notifier).ask(text);
    setState(() => _busy = false);
    _scrollToBottom();
  }

  @override
  Widget build(BuildContext context) {
    final messages = ref.watch(_chatProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        title: Row(children: [
          Container(
            width: 32, height: 32,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppColors.primary.withValues(alpha: 0.15),
              border: Border.all(color: AppColors.primary.withValues(alpha: 0.4)),
            ),
            child: const Center(
                child: Text('🧠', style: TextStyle(fontSize: 16))),
          ),
          const SizedBox(width: 10),
          const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Ask the Brain',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary)),
            Text('Powered by real AI data',
                style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
          ]),
        ]),
      ),
      body: Column(children: [
        // Messages list
        Expanded(
          child: ListView.builder(
            controller: _scroll,
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            itemCount: messages.length + (_busy ? 1 : 0),
            itemBuilder: (ctx, i) {
              if (i == messages.length) return const _TypingIndicator();
              return _MessageBubble(
                msg: messages[i],
                onSuggestionTap: (s) => _send(s),
              );
            },
          ),
        ),

        // Suggestion chips (shown only when not typing and few messages)
        if (!_busy && messages.length <= 2)
          _SuggestionChips(onTap: (s) => _send(s)),

        // Input bar
        _InputBar(
          controller: _ctrl,
          busy: _busy,
          onSend: () => _send(_ctrl.text),
        ),
      ]),
    );
  }
}

// ── Message bubble ────────────────────────────────────────────────────────────

class _MessageBubble extends StatelessWidget {
  final _Message msg;
  final void Function(String) onSuggestionTap;
  const _MessageBubble({required this.msg, required this.onSuggestionTap});

  bool get _isUser => msg.sender == _Sender.user;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        mainAxisAlignment:
            _isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        children: [
          if (!_isUser) ...[
            Container(
              width: 28, height: 28,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary.withValues(alpha: 0.15),
              ),
              child: const Center(
                  child: Text('🧠', style: TextStyle(fontSize: 14))),
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Column(
              crossAxisAlignment: _isUser
                  ? CrossAxisAlignment.end
                  : CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: _isUser
                        ? AppColors.primary
                        : AppColors.card,
                    borderRadius: BorderRadius.only(
                      topLeft:     const Radius.circular(16),
                      topRight:    const Radius.circular(16),
                      bottomLeft:  Radius.circular(_isUser ? 16 : 4),
                      bottomRight: Radius.circular(_isUser ? 4 : 16),
                    ),
                    border: _isUser
                        ? null
                        : Border.all(color: AppColors.border),
                  ),
                  child: _isUser
                      ? Text(msg.text,
                            style: const TextStyle(
                                color: Colors.white, fontSize: 14, height: 1.4))
                      : _BrainMessageContent(msg: msg),
                ),
                // Rich card below bubble for action/asset/etc
                if (!_isUser && msg.data != null && msg.type != 'text' && msg.type != 'help')
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: _RichCard(type: msg.type, data: msg.data!),
                  ),
                // Suggestion chips for help intent
                if (!_isUser && msg.type == 'help' && msg.data?['suggestions'] != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Wrap(
                      spacing: 6, runSpacing: 6,
                      children: (msg.data!['suggestions'] as List)
                          .map((s) => GestureDetector(
                            onTap: () => onSuggestionTap(s.toString()),
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 5),
                              decoration: BoxDecoration(
                                color: AppColors.primary.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(
                                    color: AppColors.primary.withValues(alpha: 0.3)),
                              ),
                              child: Text(s.toString(),
                                  style: const TextStyle(
                                      color: AppColors.primary,
                                      fontSize: 12, fontWeight: FontWeight.w500)),
                            ),
                          ))
                          .toList(),
                    ),
                  ),
                const SizedBox(height: 3),
                Text(
                  DateFormat('HH:mm').format(msg.ts),
                  style: const TextStyle(
                      fontSize: 9, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
          if (_isUser) const SizedBox(width: 8),
        ],
      ),
    );
  }
}

// ── Brain message text with markdown bold ────────────────────────────────────

class _BrainMessageContent extends StatelessWidget {
  final _Message msg;
  const _BrainMessageContent({required this.msg});

  @override
  Widget build(BuildContext context) {
    final parts = msg.text.split(RegExp(r'\*\*'));
    final spans = <TextSpan>[];
    for (int i = 0; i < parts.length; i++) {
      spans.add(TextSpan(
        text: parts[i],
        style: TextStyle(
          color: AppColors.textPrimary,
          fontSize: 14,
          height: 1.4,
          fontWeight: i.isOdd ? FontWeight.w700 : FontWeight.normal,
        ),
      ));
    }
    return RichText(text: TextSpan(children: spans));
  }
}

// ── Rich card below brain bubble ──────────────────────────────────────────────

class _RichCard extends StatelessWidget {
  final String type;
  final Map<String, dynamic> data;
  const _RichCard({required this.type, required this.data});

  @override
  Widget build(BuildContext context) {
    switch (type) {
      case 'action':  return _ActionCard(data: data);
      case 'asset':   return _AssetCard(data: data);
      case 'performance': return _PerformanceCard(data: data);
      case 'streak':  return _StreakCard(data: data);
      case 'sentiment': return _SentimentCard(data: data);
      case 'news':    return _NewsCard(data: data);
      case 'risk':    return _RiskCard(data: data);
      default:        return const SizedBox.shrink();
    }
  }
}

class _ActionCard extends StatelessWidget {
  final Map<String, dynamic> data;
  const _ActionCard({required this.data});
  @override
  Widget build(BuildContext context) {
    final action = data['action']?.toString() ?? 'HOLD';
    final conf   = data['confidence'] ?? 0;
    final color  = action == 'BUY' ? AppColors.buy
        : action == 'SELL' ? AppColors.sell : AppColors.hold;
    final picks  = (data['topPicks'] as List? ?? []);
    return _DataCard(color: color, children: [
      Row(children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(action,
              style: TextStyle(color: color,
                  fontWeight: FontWeight.w900, fontSize: 16)),
        ),
        const SizedBox(width: 10),
        Expanded(child: Text(data['displayName']?.toString() ?? '',
            style: const TextStyle(color: AppColors.textPrimary,
                fontWeight: FontWeight.w700, fontSize: 15))),
        Text('$conf%', style: TextStyle(color: color,
            fontWeight: FontWeight.w800, fontSize: 15)),
      ]),
      if (data['entryPrice'] != null) ...[
        const SizedBox(height: 10),
        const Divider(color: AppColors.border, height: 1),
        const SizedBox(height: 10),
        Row(children: [
          _Level('Entry', data['entryPrice']),
          _Level('Stop',  data['stopLoss']),
          _Level('Target',data['takeProfit']),
        ]),
      ],
      if (picks.isNotEmpty) ...[
        const SizedBox(height: 10),
        const Text('Also watching:', style: TextStyle(
            color: AppColors.textMuted, fontSize: 11)),
        const SizedBox(height: 6),
        Wrap(spacing: 6, runSpacing: 4, children: picks.take(4).map((p) {
          final a = p['action']?.toString() ?? 'HOLD';
          final c = a == 'BUY' ? AppColors.buy : a == 'SELL' ? AppColors.sell : AppColors.hold;
          return Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: c.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: c.withValues(alpha: 0.3)),
            ),
            child: Text('${p['displayName'] ?? p['asset']} $a ${p['confidence']}%',
                style: TextStyle(color: c, fontSize: 10, fontWeight: FontWeight.w600)),
          );
        }).toList()),
      ],
    ]);
  }
}

class _AssetCard extends StatelessWidget {
  final Map<String, dynamic> data;
  const _AssetCard({required this.data});
  @override
  Widget build(BuildContext context) {
    final sig  = data['signal'] as Map?;
    final wr   = data['winRate'];
    final tot  = data['totalTrades'] ?? 0;
    final color = sig == null ? AppColors.textMuted
        : sig['action'] == 'BUY' ? AppColors.buy
        : sig['action'] == 'SELL' ? AppColors.sell : AppColors.hold;
    return _DataCard(color: color, children: [
      Row(children: [
        Expanded(child: Text(data['displayName']?.toString() ?? '',
            style: const TextStyle(color: AppColors.textPrimary,
                fontWeight: FontWeight.w700, fontSize: 15))),
        if (sig != null) Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text('${sig['action']} ${sig['confidence']}%',
              style: TextStyle(color: color,
                  fontWeight: FontWeight.w700, fontSize: 12)),
        ),
      ]),
      if (wr != null || tot > 0) ...[
        const SizedBox(height: 8),
        Text('${wr != null ? '$wr% win rate · ' : ''}$tot trades evaluated',
            style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
      ],
    ]);
  }
}

class _PerformanceCard extends StatelessWidget {
  final Map<String, dynamic> data;
  const _PerformanceCard({required this.data});
  @override
  Widget build(BuildContext context) {
    final wr  = data['winRate'] ?? 0;
    final tot = data['total'] ?? 0;
    final avg = data['avgProfitPct'];
    final color = wr >= 60 ? AppColors.buy : AppColors.sell;
    return _DataCard(color: color, children: [
      Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
        _MiniStat('Win Rate', '$wr%', color),
        _MiniStat('Trades', '$tot', AppColors.primary),
        if (avg != null) _MiniStat('Avg P&L',
            '${avg >= 0 ? '+' : ''}${avg.toStringAsFixed(1)}%',
            avg >= 0 ? AppColors.buy : AppColors.sell),
      ]),
    ]);
  }
}

class _StreakCard extends StatelessWidget {
  final Map<String, dynamic> data;
  const _StreakCard({required this.data});
  @override
  Widget build(BuildContext context) {
    final streak = (data['currentStreak'] as num?)?.toInt() ?? 0;
    final emoji  = streak >= 10 ? '💎' : streak >= 5 ? '🔥' : streak >= 3 ? '⚡' : '📊';
    final color  = streak >= 5 ? AppColors.buy : AppColors.hold;
    return _DataCard(color: color, children: [
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        Text(emoji, style: const TextStyle(fontSize: 32)),
        const SizedBox(width: 14),
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('$streak', style: TextStyle(color: color,
              fontSize: 36, fontWeight: FontWeight.w900)),
          const Text('win streak', style: TextStyle(
              color: AppColors.textMuted, fontSize: 12)),
        ]),
      ]),
    ]);
  }
}

class _SentimentCard extends StatelessWidget {
  final Map<String, dynamic> data;
  const _SentimentCard({required this.data});
  @override
  Widget build(BuildContext context) {
    final fg   = (data['fearGreed'] as num?)?.toInt();
    final lbl  = data['fearGreedLabel']?.toString() ?? '';
    final sent = data['macroSentiment']?.toString();
    if (fg == null) return const SizedBox.shrink();
    final color = fg >= 65 ? AppColors.sell : fg <= 35 ? AppColors.buy : AppColors.hold;
    return _DataCard(color: color, children: [
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        Container(
          width: 64, height: 64,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: color.withValues(alpha: 0.12),
            border: Border.all(color: color, width: 2.5),
          ),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Text('$fg', style: TextStyle(color: color,
                fontSize: 20, fontWeight: FontWeight.w900)),
            const Text('/100', style: TextStyle(
                color: AppColors.textMuted, fontSize: 8)),
          ]),
        ),
        const SizedBox(width: 16),
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(lbl, style: TextStyle(color: color,
              fontWeight: FontWeight.w700, fontSize: 15)),
          if (sent != null) Text('Macro: ${sent.toUpperCase()}',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        ]),
      ]),
    ]);
  }
}

class _NewsCard extends StatelessWidget {
  final Map<String, dynamic> data;
  const _NewsCard({required this.data});
  @override
  Widget build(BuildContext context) {
    final items = (data['news'] as List? ?? []).take(3).toList();
    return _DataCard(color: AppColors.primary, children: [
      ...items.map((n) {
        final s = n['sentiment']?.toString() ?? 'neutral';
        final c = s == 'bullish' ? AppColors.buy
            : s == 'bearish' ? AppColors.sell : AppColors.textMuted;
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(width: 3, height: 36,
                decoration: BoxDecoration(color: c,
                    borderRadius: BorderRadius.circular(2))),
            const SizedBox(width: 8),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(n['title']?.toString() ?? '',
                  maxLines: 2, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppColors.textPrimary,
                      fontSize: 12, height: 1.3)),
              Text(n['source']?.toString() ?? '',
                  style: const TextStyle(color: AppColors.textMuted, fontSize: 10)),
            ])),
          ]),
        );
      }),
    ]);
  }
}

class _RiskCard extends StatelessWidget {
  final Map<String, dynamic> data;
  const _RiskCard({required this.data});
  @override
  Widget build(BuildContext context) {
    return _DataCard(color: AppColors.warning, children: [
      Row(children: [
        _Level('Entry',  data['entryPrice']),
        _Level('SL',     data['stopLoss']),
        _Level('TP',     data['takeProfit']),
      ]),
      if (data['riskReward'] != null) ...[
        const SizedBox(height: 8),
        Text('R:R ${data['riskReward']}',
            style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
      ],
    ]);
  }
}

// ── Shared card shell ─────────────────────────────────────────────────────────

class _DataCard extends StatelessWidget {
  final Color         color;
  final List<Widget>  children;
  const _DataCard({required this.color, required this.children});

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: color.withValues(alpha: 0.35)),
    ),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
  );
}

class _Level extends StatelessWidget {
  final String label;
  final dynamic value;
  const _Level(this.label, this.value);
  @override
  Widget build(BuildContext context) {
    if (value == null) return const SizedBox.shrink();
    final v = (value as num).toDouble();
    final fmt = v >= 1000 ? '\$${NumberFormat('#,##0.00').format(v)}'
        : v >= 1 ? '\$${v.toStringAsFixed(2)}' : '\$${v.toStringAsFixed(4)}';
    return Expanded(child: Column(children: [
      Text(label, style: const TextStyle(color: AppColors.textMuted, fontSize: 10)),
      const SizedBox(height: 2),
      Text(fmt, style: const TextStyle(color: AppColors.textSecondary,
          fontSize: 12, fontWeight: FontWeight.w600)),
    ]));
  }
}

class _MiniStat extends StatelessWidget {
  final String label, value;
  final Color  color;
  const _MiniStat(this.label, this.value, this.color);
  @override
  Widget build(BuildContext context) => Column(children: [
    Text(value, style: TextStyle(color: color,
        fontWeight: FontWeight.w800, fontSize: 18)),
    Text(label, style: const TextStyle(
        color: AppColors.textMuted, fontSize: 10)),
  ]);
}

// ── Typing indicator ──────────────────────────────────────────────────────────

class _TypingIndicator extends StatefulWidget {
  const _TypingIndicator();
  @override
  State<_TypingIndicator> createState() => _TypingIndicatorState();
}

class _TypingIndicatorState extends State<_TypingIndicator>
    with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;
  late Animation<double>    _anim;
  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 800))..repeat(reverse: true);
    _anim = Tween(begin: 0.3, end: 1.0).animate(_ctrl);
  }
  @override
  void dispose() { _ctrl.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Row(children: [
      Container(
        width: 28, height: 28,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: AppColors.primary.withValues(alpha: 0.15),
        ),
        child: const Center(child: Text('🧠', style: TextStyle(fontSize: 14))),
      ),
      const SizedBox(width: 8),
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: const BorderRadius.only(
            topLeft: Radius.circular(16), topRight: Radius.circular(16),
            bottomRight: Radius.circular(16), bottomLeft: Radius.circular(4),
          ),
          border: Border.all(color: AppColors.border),
        ),
        child: AnimatedBuilder(
          animation: _anim,
          builder: (_, __) => Row(mainAxisSize: MainAxisSize.min, children: [
            _Dot(delay: 0, anim: _anim),
            const SizedBox(width: 4),
            _Dot(delay: 0.2, anim: _anim),
            const SizedBox(width: 4),
            _Dot(delay: 0.4, anim: _anim),
          ]),
        ),
      ),
    ]),
  );
}

class _Dot extends StatelessWidget {
  final double delay;
  final Animation<double> anim;
  const _Dot({required this.delay, required this.anim});
  @override
  Widget build(BuildContext context) {
    final v = ((anim.value + delay) % 1.0);
    return Opacity(
      opacity: v < 0.5 ? v * 2 : (1.0 - v) * 2,
      child: Container(
        width: 6, height: 6,
        decoration: const BoxDecoration(
            color: AppColors.primary, shape: BoxShape.circle),
      ),
    );
  }
}

// ── Suggestion chips bar ─────────────────────────────────────────────────────

class _SuggestionChips extends StatelessWidget {
  final void Function(String) onTap;
  const _SuggestionChips({required this.onTap});
  @override
  Widget build(BuildContext context) => SizedBox(
    height: 40,
    child: ListView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      children: _suggestions.map((s) => Padding(
        padding: const EdgeInsets.only(right: 8),
        child: ActionChip(
          label: Text(s, style: const TextStyle(fontSize: 12)),
          onPressed: () => onTap(s),
          backgroundColor: AppColors.surface,
          side: const BorderSide(color: AppColors.border),
          labelStyle: const TextStyle(color: AppColors.textSecondary),
          padding: const EdgeInsets.symmetric(horizontal: 4),
        ),
      )).toList(),
    ),
  );
}

// ── Input bar ────────────────────────────────────────────────────────────────

class _InputBar extends StatelessWidget {
  final TextEditingController controller;
  final bool  busy;
  final VoidCallback onSend;
  const _InputBar({required this.controller, required this.busy, required this.onSend});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(12, 8, 12, 20),
    decoration: const BoxDecoration(
      color: AppColors.card,
      border: Border(top: BorderSide(color: AppColors.border)),
    ),
    child: Row(children: [
      Expanded(
        child: TextField(
          controller: controller,
          style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
          decoration: InputDecoration(
            hintText: 'Ask anything…',
            hintStyle: const TextStyle(color: AppColors.textMuted, fontSize: 14),
            filled: true,
            fillColor: AppColors.surface,
            contentPadding: const EdgeInsets.symmetric(
                horizontal: 14, vertical: 10),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(24),
              borderSide: const BorderSide(color: AppColors.border),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(24),
              borderSide: const BorderSide(color: AppColors.border),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(24),
              borderSide: const BorderSide(
                  color: AppColors.primary, width: 1.5),
            ),
          ),
          onSubmitted: busy ? null : (_) => onSend(),
          textInputAction: TextInputAction.send,
        ),
      ),
      const SizedBox(width: 8),
      GestureDetector(
        onTap: busy ? null : onSend,
        child: Container(
          width: 42, height: 42,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: busy
                ? AppColors.border
                : AppColors.primary,
          ),
          child: busy
              ? const Padding(
                  padding: EdgeInsets.all(12),
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white))
              : const Icon(Icons.send_rounded,
                  color: Colors.white, size: 18),
        ),
      ),
    ]),
  );
}
