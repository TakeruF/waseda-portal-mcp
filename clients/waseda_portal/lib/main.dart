import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:lucide_flutter/lucide_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'core/moodle_reader_policy.dart';

void main() => runApp(const WasedaPortalApp());

class WasedaPortalApp extends StatelessWidget {
  const WasedaPortalApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Waseda Portal',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xff8c182d),
        brightness: Brightness.light,
      ),
      useMaterial3: true,
    ),
    home: const PortalHome(),
  );
}

class PortalHome extends StatefulWidget {
  const PortalHome({super.key});

  @override
  State<PortalHome> createState() => _PortalHomeState();
}

class _PortalHomeState extends State<PortalHome> {
  late final WebViewController _webView;
  late final WebViewController _profileWebView;
  String? _status;
  var _pageIsMoodle = false;
  AcademicProfile _profile = const AcademicProfile();
  String _pendingSyllabusQuery = '';
  var _openedMyWasedaForProfile = false;
  var _openedDetectedProfilePage = false;

  @override
  void initState() {
    super.initState();
    _webView = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(onPageFinished: _onPageFinished),
      )
      // MyWaseda's landing-page button is a JavaScript form submit that is
      // unreliable in an embedded WebView. Moodle's own SSO entrypoint leads
      // to the same Waseda University Login screen without that intermediary.
      ..loadRequest(Uri.parse(moodleCoursesUrl));
    _profileWebView = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(onPageFinished: _onProfilePageFinished),
      );
    _loadStoredProfile();
  }

  Future<void> _loadStoredProfile() async {
    final preferences = await SharedPreferences.getInstance();
    // Version 1 briefly used an inferred first-year default. It was not an
    // official value, so discard it once rather than treating it as profile
    // data. Later values are saved only after an official page exposes them.
    if ((preferences.getInt('profile_schema') ?? 0) < 2) {
      await preferences.remove('year');
      await preferences.setInt('profile_schema', 2);
    }
    final profile = AcademicProfile(
      affiliation: preferences.getString('affiliation') ?? '',
      year: preferences.getInt('year'),
    );
    if (!mounted) return;
    setState(() => _profile = profile);
  }

  Future<void> _saveProfile(AcademicProfile profile) async {
    final preferences = await SharedPreferences.getInstance();
    if (profile.affiliation.isNotEmpty) {
      await preferences.setString('affiliation', profile.affiliation);
    }
    if (profile.year != null) await preferences.setInt('year', profile.year!);
  }

  Future<void> _onPageFinished(String url) async {
    final uri = Uri.tryParse(url);
    if (uri?.host == 'wsdmoodle.waseda.jp') {
      await _startBackgroundProfileDiscovery();
    }
    if (uri?.host == 'waseda-portal-mcp.vercel.app' && _profile.year != null) {
      await _webView.runJavaScript(
        syllabusProfileApplyScript(
          year: _profile.year!,
          query: _pendingSyllabusQuery,
        ),
      );
      _pendingSyllabusQuery = '';
    }
    if (!mounted) return;
    setState(() {
      _pageIsMoodle = uri?.host == 'wsdmoodle.waseda.jp';
    });
  }

  Future<void> _startBackgroundProfileDiscovery() async {
    if (_openedMyWasedaForProfile || !_profile.isIncomplete) return;
    try {
      final raw = await _webView.runJavaScriptReturningResult(
        academicProfileProbeScript,
      );
      final decoded = jsonDecode(raw.toString()) as String;
      final result = jsonDecode(decoded) as Map<String, dynamic>;
      if (result['loggedIn'] != true) return;
      _openedMyWasedaForProfile = true;
      await _profileWebView.loadRequest(Uri.parse(myWasedaHomeUrl));
    } catch (_) {
      // The visible Moodle page remains the primary experience.
    }
  }

  Future<void> _onProfilePageFinished(String url) async {
    final uri = Uri.tryParse(url);
    if (uri?.host == 'my.waseda.jp') {
      await _discoverAcademicProfile(uri!);
    }
  }

  Future<void> _discoverAcademicProfile(Uri uri) async {
    try {
      final raw = await _profileWebView.runJavaScriptReturningResult(
        academicProfileProbeScript,
      );
      final decoded = jsonDecode(raw.toString()) as String;
      final result = jsonDecode(decoded) as Map<String, dynamic>;
      final affiliation = (result['affiliation'] as String? ?? '').trim();
      final year = int.tryParse(result['year'] as String? ?? '');
      final profile = _profile.merge(affiliation: affiliation, year: year);
      if (profile != _profile) {
        _profile = profile;
        await _saveProfile(profile);
        if (mounted) setState(() {});
      }
      final profileLink = Uri.tryParse(result['profileLink'] as String? ?? '');
      if (uri.host == 'my.waseda.jp' &&
          profileLink != null &&
          !_openedDetectedProfilePage) {
        _openedDetectedProfilePage = true;
        await _profileWebView.loadRequest(profileLink);
      }
    } catch (_) {
      // An unfamiliar official page must remain usable; profile enrichment is
      // best-effort and never blocks the portal itself.
    }
  }

  Future<void> _syncMoodle() async {
    if (!_pageIsMoodle) {
      await _openSyllabusSearch();
      return;
    }
    try {
      final raw = await _webView.runJavaScriptReturningResult(
        moodleSummaryScript,
      );
      final decoded = jsonDecode(raw.toString()) as String;
      final summary = jsonDecode(decoded) as Map<String, dynamic>;
      final items = summary['items'] as List<dynamic>;
      final searchTerm = items
          .whereType<Map<String, dynamic>>()
          .map((item) => (item['title'] as String? ?? '').trim())
          .firstWhere((title) => title.length >= 2, orElse: () => '');
      await _openSyllabusSearch(searchTerm: searchTerm);
    } catch (_) {
      _showStatus('読み取りに失敗しました。Moodleを再読み込みしてから試してください。');
    }
  }

  Future<void> _openSyllabusSearch({String searchTerm = ''}) async {
    _pendingSyllabusQuery = searchTerm;
    final searchUri = Uri.parse(syllabusSearchUrl).replace(
      queryParameters: {
        if (searchTerm.isNotEmpty) 'q': searchTerm,
        if (_profile.affiliation.isNotEmpty)
          'affiliation': _profile.affiliation,
        if (_profile.year != null) 'year': '${_profile.year}',
        if (_profile.isComplete) 'profileMode': 'hide-conflicts',
      },
    );
    await _webView.loadRequest(searchUri);
  }

  Future<void> _clearSession() async {
    await WebViewCookieManager().clearCookies();
    final preferences = await SharedPreferences.getInstance();
    await preferences.remove('affiliation');
    await preferences.remove('year');
    if (!mounted) return;
    setState(() {
      _status = 'この端末のMoodle／MyWasedaセッションと読み取り結果を消去しました。';
      _profile = const AcademicProfile();
    });
    await _webView.loadRequest(Uri.parse(moodleCoursesUrl));
  }

  void _showStatus(String message) => setState(() => _status = message);

  Widget _headerAction({
    required String label,
    required IconData icon,
    required VoidCallback onPressed,
  }) => Tooltip(
    message: label,
    child: Semantics(
      button: true,
      label: label,
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(8),
        child: SizedBox(
          width: 52,
          height: 48,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 19),
              const SizedBox(height: 1),
              Text(label, style: const TextStyle(fontSize: 8)),
            ],
          ),
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      toolbarHeight: 48,
      title: Semantics(
        button: true,
        label: 'シラバス検索のホームへ',
        child: InkWell(
          onTap: _openSyllabusSearch,
          borderRadius: BorderRadius.circular(8),
          child: const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: Text('Waseda Portal', style: TextStyle(fontSize: 20)),
          ),
        ),
      ),
      actions: [
        _headerAction(
          onPressed: () => _webView.loadRequest(Uri.parse(moodleCoursesUrl)),
          icon: LucideIcons.refreshCw,
          label: '再読み込み',
        ),
        _headerAction(
          onPressed: _syncMoodle,
          icon: LucideIcons.download,
          label: 'シラバス検索',
        ),
        _headerAction(
          onPressed: _clearSession,
          icon: LucideIcons.trash2,
          label: 'セッション',
        ),
      ],
    ),
    body: SafeArea(
      child: Stack(
        children: [
          Column(
            children: [
              if (_status != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(_status!, style: const TextStyle(fontSize: 13)),
                  ),
                ),
              Expanded(child: WebViewWidget(controller: _webView)),
            ],
          ),
          Positioned(
            left: 0,
            top: 0,
            width: 1,
            height: 1,
            child: IgnorePointer(
              child: Opacity(
                opacity: 0,
                child: WebViewWidget(controller: _profileWebView),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

class AcademicProfile {
  const AcademicProfile({this.affiliation = '', this.year});

  final String affiliation;
  final int? year;

  bool get isComplete => affiliation.isNotEmpty && year != null;
  bool get isIncomplete => !isComplete;

  AcademicProfile merge({required String affiliation, required int? year}) =>
      AcademicProfile(
        affiliation: affiliation.isEmpty ? this.affiliation : affiliation,
        year: year ?? this.year,
      );

  @override
  bool operator ==(Object other) =>
      other is AcademicProfile &&
      other.affiliation == affiliation &&
      other.year == year;

  @override
  int get hashCode => Object.hash(affiliation, year);
}
