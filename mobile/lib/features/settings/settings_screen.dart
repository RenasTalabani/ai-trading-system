import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../core/providers/auth_provider.dart';
import '../../core/services/api_service.dart';
import '../../core/services/push_notification_service.dart';
import '../../core/constants/api_constants.dart';
import '../../core/theme/app_theme.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  bool _saving = false;
  bool _testingPush = false;

  static const _allAssets = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT',
    'XRPUSDT', 'DOGEUSDT', 'DOTUSDT', 'LINKUSDT', 'MATICUSDT',
  ];

  Future<void> _savePrefs(Map<String, dynamic> update) async {
    setState(() => _saving = true);
    await ref.read(authProvider.notifier).updatePreferences(update);
    setState(() => _saving = false);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Preferences saved'), backgroundColor: AppColors.success),
      );
    }
  }

  Future<void> _sendTestPush() async {
    setState(() => _testingPush = true);
    try {
      await ApiService.dio.post(ApiConstants.testNotification);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Test notification sent!'), backgroundColor: AppColors.success),
        );
      }
    } on DioException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.userMessage), backgroundColor: AppColors.error),
        );
      }
    } finally {
      setState(() => _testingPush = false);
    }
  }

  Future<void> _generateTelegramLink() async {
    try {
      final resp = await ApiService.dio.post(ApiConstants.telegramLink);
      final link = resp.data['deeplink'] as String?;
      if (link != null && mounted) {
        showDialog(
          context: context,
          builder: (_) => AlertDialog(
            backgroundColor: AppColors.card,
            title: const Text('Link Telegram'),
            content: Column(mainAxisSize: MainAxisSize.min, children: [
              const Text('Open this link to connect your Telegram account:',
                  style: TextStyle(color: AppColors.textSecondary)),
              const SizedBox(height: 12),
              SelectableText(link, style: const TextStyle(color: AppColors.primary, fontSize: 12)),
            ]),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close')),
            ],
          ),
        );
      }
    } on DioException catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final user  = ref.watch(authProvider).user;
    final prefs = user?.preferences;
    if (prefs == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        actions: [
          if (_saving)
            const Padding(
              padding: EdgeInsets.only(right: 16),
              child: SizedBox(width: 20, height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary)),
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // User info
          const _SectionHeader('Account'),
          _UserTile(name: user!.name, email: user.email, role: user.role),
          const SizedBox(height: 20),

          // Notifications
          const _SectionHeader('Notifications'),
          _SettingsCard(children: [
            SwitchListTile(
              title: const Text('Push Notifications'),
              subtitle: const Text('Enable FCM push alerts'),
              value: prefs.notificationsEnabled && prefs.fcmEnabled,
              onChanged: (v) => _savePrefs({'notificationsEnabled': v, 'fcmEnabled': v}),
              thumbColor: WidgetStateProperty.resolveWith(
                (s) => s.contains(WidgetState.selected) ? AppColors.primary : null,
              ),
            ),
            const Divider(height: 1),
            SwitchListTile(
              title: const Text('Telegram Alerts'),
              subtitle: const Text('Receive signals via Telegram bot'),
              value: prefs.telegramEnabled,
              onChanged: (v) => _savePrefs({'telegramEnabled': v}),
              thumbColor: WidgetStateProperty.resolveWith(
                (s) => s.contains(WidgetState.selected) ? AppColors.primary : null,
              ),
            ),
            const Divider(height: 1),
            ListTile(
              title: const Text('Link Telegram'),
              subtitle: const Text('Connect your Telegram account'),
              trailing: const Icon(Icons.arrow_forward_ios, size: 14),
              onTap: _generateTelegramLink,
            ),
            const Divider(height: 1),
            ListTile(
              title: const Text('Test Push Notification'),
              trailing: _testingPush
                  ? const SizedBox(width: 16, height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.send_outlined, size: 20, color: AppColors.primary),
              onTap: _testingPush ? null : _sendTestPush,
            ),
          ]),
          const SizedBox(height: 20),

          // Confidence threshold
          const _SectionHeader('Signal Filters'),
          _SettingsCard(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                const Text('Min Confidence',
                    style: TextStyle(fontSize: 15, color: AppColors.textPrimary)),
                Text('${prefs.confidenceThreshold}%',
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: AppColors.primary)),
              ]),
            ),
            Slider(
              value: prefs.confidenceThreshold.toDouble(),
              min: 50, max: 95, divisions: 9,
              activeColor: AppColors.primary,
              inactiveColor: AppColors.surface,
              label: '${prefs.confidenceThreshold}%',
              onChangeEnd: (v) => _savePrefs({'confidenceThreshold': v.round()}),
              onChanged: (_) {},
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                const Text('Max alerts / hour',
                    style: TextStyle(fontSize: 15, color: AppColors.textPrimary)),
                Text('${prefs.maxNotificationsPerHour}',
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: AppColors.primary)),
              ]),
            ),
            Slider(
              value: prefs.maxNotificationsPerHour.toDouble(),
              min: 1, max: 20, divisions: 19,
              activeColor: AppColors.primary,
              inactiveColor: AppColors.surface,
              label: '${prefs.maxNotificationsPerHour}',
              onChangeEnd: (v) => _savePrefs({'maxNotificationsPerHour': v.round()}),
              onChanged: (_) {},
            ),
          ]),
          const SizedBox(height: 20),

          // Watched assets
          const _SectionHeader('Watched Assets'),
          _SettingsCard(children: [
            Padding(
              padding: const EdgeInsets.all(12),
              child: Wrap(
                spacing: 8, runSpacing: 8,
                children: _allAssets.map((asset) {
                  final selected = prefs.assets.contains(asset);
                  final base = asset.replaceAll('USDT', '');
                  return FilterChip(
                    label: Text(base),
                    selected: selected,
                    onSelected: (sel) {
                      final updated = List<String>.from(prefs.assets);
                      if (sel) { updated.add(asset); } else { updated.remove(asset); }
                      if (updated.isNotEmpty) _savePrefs({'assets': updated});
                    },
                    selectedColor: AppColors.primary.withValues(alpha: 0.2),
                    checkmarkColor: AppColors.primary,
                  );
                }).toList(),
              ),
            ),
          ]),
          const SizedBox(height: 32),

          // Sign out
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.error.withValues(alpha: 0.1),
              foregroundColor: AppColors.error,
            ),
            icon: const Icon(Icons.logout),
            label: const Text('Sign Out'),
            onPressed: () async {
              await PushNotificationService.deleteToken();
              ref.read(authProvider.notifier).logout();
            },
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader(this.title);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(title.toUpperCase(),
          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600,
              color: AppColors.textMuted, letterSpacing: 1)),
    );
  }
}

class _SettingsCard extends StatelessWidget {
  final List<Widget> children;
  const _SettingsCard({required this.children});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(children: children),
    );
  }
}

class _UserTile extends StatelessWidget {
  final String name;
  final String email;
  final String role;
  const _UserTile({required this.name, required this.email, required this.role});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(children: [
        CircleAvatar(
          radius: 24,
          backgroundColor: AppColors.primary.withValues(alpha: 0.15),
          child: Text(name.isNotEmpty ? name[0].toUpperCase() : '?',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppColors.primary)),
        ),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(name, style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.textPrimary)),
          Text(email, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
        ])),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: AppColors.primary.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(role.toUpperCase(),
              style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: AppColors.primary)),
        ),
      ]),
    );
  }
}
