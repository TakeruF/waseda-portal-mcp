import 'package:flutter_test/flutter_test.dart';
import 'package:waseda_portal/core/moodle_reader_policy.dart';

void main() {
  test('Moodle entrypoint uses HTTPS', () {
    final uri = Uri.parse(moodleCoursesUrl);
    expect(uri.scheme, 'https');
    expect(uri.host, 'wsdmoodle.waseda.jp');
  });
}
