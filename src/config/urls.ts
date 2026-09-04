export const WASEDA_URLS = {
  myWasedaLogin: "https://my.waseda.jp/login/login",
  moodleCourses: "https://wsdmoodle.waseda.jp/my/courses.php",
  moodleCalendar: "https://wsdmoodle.waseda.jp/calendar/view.php?view=upcoming",
  classChanges: "https://class.waseda.jp/kyuko/epb3010.htm",
  syllabusSearch: "https://www.wsl.waseda.jp/syllabus/JAA101.php?pLng=jp",
  syllabusDetail: "https://www.wsl.waseda.jp/syllabus/JAA104.php",
  academicCalendar:
    "https://www.waseda.jp/top/about/work/organizations/academic-affairs-division/academic-calendar",
} as const;

/**
 * Hosts that serve Waseda information without any authenticated session. A
 * public-only deployment is restricted to these, so it cannot reach Moodle or
 * MyWaseda even if a stale profile directory still holds cookies.
 */
export const PUBLIC_WASEDA_HOSTS = [
  "www.wsl.waseda.jp",
  "www.waseda.jp",
] as const;
