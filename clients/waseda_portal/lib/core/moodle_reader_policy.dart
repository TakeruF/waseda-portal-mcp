import 'dart:convert';

const moodleCoursesUrl = 'https://wsdmoodle.waseda.jp/my/courses.php';
const syllabusSearchUrl = 'https://waseda-portal-mcp.vercel.app/';
const myWasedaHomeUrl = 'https://my.waseda.jp/';

/// Reads only public-facing labels from the currently displayed official page.
/// It deliberately excludes names, student numbers, grades, and credentials.
const academicProfileProbeScript = r'''
(() => {
  const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const pairs = [];
  document.querySelectorAll('tr').forEach((row) => {
    const cells = [...row.querySelectorAll('th,td')].map((cell) => compact(cell.innerText));
    if (cells.length >= 2) pairs.push([cells[0], cells.slice(1).join(' ')]);
  });
  document.querySelectorAll('dt').forEach((term) => {
    const definition = term.nextElementSibling;
    if (definition?.tagName === 'DD') pairs.push([compact(term.innerText), compact(definition.innerText)]);
  });
  const body = compact(document.body?.innerText);
  const valueFor = (labels) => {
    const pair = pairs.find(([label]) => labels.some((pattern) => pattern.test(label)));
    if (pair) return pair[1];
    const pattern = new RegExp('(?:' + labels.map((pattern) => pattern.source).join('|') + ')\\s*[:：]\\s*([^\\n　]{2,80})');
    return body.match(pattern)?.[1] || '';
  };
  const affiliation = valueFor([/所属(?:学部|研究科|箇所)?/, /学部[・･]?研究科/]);
  const yearText = valueFor([/在学年次/, /現在の?学年/, /学年/]);
  const year = yearText.match(/([1-6])\s*年/)?.[1] || '';
  const links = [...document.querySelectorAll('a[href]')];
  const profileLink = (
    links.find((link) => /^Grades\s*&\s*Course\s*registration$/i.test(compact(link.innerText))) ||
    links.find((link) => /^プロフィール$/.test(compact(link.innerText)))
  )?.href || '';
  const loggedIn = !/Log in using your account on:|Waseda University Login/i.test(body);
  return JSON.stringify({ affiliation, year, profileLink, loggedIn });
})();
''';

String syllabusProfileApplyScript({required int year, String query = ''}) =>
    '''
(() => {
  const year = document.getElementById('profile-year');
  const mode = document.getElementById('profile-mode');
  const input = document.getElementById('query');
  const form = document.getElementById('search-form');
  if (year) year.value = '$year';
  if (mode) mode.value = 'hide-conflicts';
  if (input && ${jsonEncode(query)}.length >= 2) {
    input.value = ${jsonEncode(query)};
    form?.requestSubmit();
  }
})();
''';
const moodleSummaryScript = r'''
(() => {
  const root = document.querySelector('main') || document.body;
  const events = [...root.querySelectorAll('[data-deadline-id], [data-event-kind], .eventlist .event, .calendarwrapper .event, .activity.deadline')]
    .map((node) => {
      const link = node.querySelector('a[href*="/mod/"], a[href]');
      const title = (node.querySelector('.name,.eventname,.activityname,h3,h4,a')?.innerText || '').trim().replace(/\s+/g, ' ');
      if (!title) return null;
      const raw = `${node.dataset.status || ''} ${(node.querySelector('.status,.completion-info')?.innerText || '')}`;
      const kind = `${node.dataset.eventKind || ''} ${node.className || ''} ${link?.href || ''}`;
      const activityType = /assign|課題/i.test(kind) ? '課題' : /quiz|小テスト/i.test(kind) ? '小テスト' : /questionnaire|アンケート/i.test(kind) ? 'アンケート' : /forum|フォーラム/i.test(kind) ? 'フォーラム' : '予定';
      const status = /not[_ -]?submitted|未提出/i.test(raw) ? '未提出' : /submitted|提出済/i.test(raw) ? '提出済' : /completed|完了済|完了/i.test(raw) ? '完了' : '';
      const dueAt = node.dataset.dueAt || node.querySelector('time.due,[data-field="due"] time,time[datetime]')?.getAttribute('datetime') || node.querySelector('.due,[data-field="due"],.date')?.innerText?.trim() || '';
      return { title, activityType, status, dueAt };
    })
    .filter(Boolean)
    .slice(0, 20);
  const candidates = [...root.querySelectorAll('h2,h3,h4,.event-name,.activityname,.instancename')]
    .map((node) => (node.innerText || '').trim().replace(/\s+/g, ' '))
    .filter((text) => text.length > 0)
    .filter((text, index, values) => values.indexOf(text) === index)
    .slice(0, 12);
  return JSON.stringify({
    source: location.hostname,
    page: location.pathname,
    items: events.length > 0 ? events : candidates.map((title) => ({ title, activityType: '科目・予定', status: '', dueAt: '' })),
    capturedAt: new Date().toISOString(),
  });
})();
''';
