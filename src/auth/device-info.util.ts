import { DEVICE_ID_PATTERN } from './session.constants';

/** The `X-Device-Id` header as a usable label, or undefined. The header only groups a browser's sessions in the
 *  sessions list; it is never an identity, so anything that is not a plain bounded token (wrong type, empty, longer
 *  than the column, any character outside `[A-Za-z0-9_-]`) is treated as if it had not been sent. */
export function sanitizeDeviceId(raw: unknown): string | undefined {
  return typeof raw === 'string' && DEVICE_ID_PATTERN.test(raw) ? raw : undefined;
}

export interface ParsedUserAgent {
  browser?: string;
  browserVersion?: string;
  operatingSystem?: string;
  osVersion?: string;
  deviceType?: string;
  deviceName?: string;
}

interface Detected {
  name: string;
  version?: string;
}

const WINDOWS_VERSIONS: Record<string, string> = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' };

/**
 * Browsers by the token they add to the user agent. The ORDER is the logic: almost every browser also claims to be
 * Chrome and Safari, so the specific tokens (Edge, Opera, Samsung Internet, Vivaldi, Chromium) come before Chrome,
 * and Chrome before Safari. The iOS builds of Chrome (`CriOS`), Firefox (`FxiOS`), Edge (`EdgiOS`) and Opera (`OPiOS`)
 * carry their own tokens too. A browser that sends the same user agent as Chrome (Brave) cannot be told apart and is
 * reported as Chrome.
 */
const BROWSERS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'Edge', pattern: /\b(?:Edg|Edge|EdgA|EdgiOS)\/([\d.]+)/ },
  { name: 'Opera', pattern: /\b(?:OPR|OPiOS)\/([\d.]+)/ },
  { name: 'Samsung Internet', pattern: /\bSamsungBrowser\/([\d.]+)/ },
  { name: 'Vivaldi', pattern: /\bVivaldi\/([\d.]+)/ },
  { name: 'Firefox', pattern: /\b(?:Firefox|FxiOS)\/([\d.]+)/ },
  { name: 'Chromium', pattern: /\bChromium\/([\d.]+)/ },
  { name: 'Chrome', pattern: /\b(?:Chrome|CriOS)\/([\d.]+)/ },
  { name: 'Safari', pattern: /\bVersion\/([\d.]+).*\bSafari\// },
];

const dotted = (version: string): string => version.replace(/_/g, '.');

function detectBrowser(ua: string): Detected | undefined {
  for (const { name, pattern } of BROWSERS) {
    const match = ua.match(pattern);
    if (match) return { name, version: match[1] };
  }
  return undefined;
}

/** iOS and Android come first because their user agents also say "Mac OS X" and "Linux". */
function detectOperatingSystem(ua: string): Detected | undefined {
  if (/\b(?:iPhone|iPad|iPod)\b/.test(ua)) {
    const version = ua.match(/\bOS (\d+(?:[_.]\d+)*)/)?.[1];
    return { name: /\biPad\b/.test(ua) ? 'iPadOS' : 'iOS', version: version ? dotted(version) : undefined };
  }
  if (/\bAndroid\b/.test(ua)) {
    return { name: 'Android', version: ua.match(/\bAndroid (\d+(?:\.\d+)*)/)?.[1] };
  }
  if (/\bCrOS\b/.test(ua)) {
    return { name: 'ChromeOS', version: ua.match(/\bCrOS \S+ (\d+(?:\.\d+)*)/)?.[1] };
  }
  const windows = ua.match(/\bWindows NT (\d+\.\d+)/);
  if (windows) return { name: 'Windows', version: WINDOWS_VERSIONS[windows[1]] ?? windows[1] };
  const mac = ua.match(/\bMac OS X (\d+(?:[_.]\d+)*)/);
  if (mac) return { name: 'macOS', version: dotted(mac[1]) };
  if (/\bLinux\b/.test(ua)) return { name: 'Linux' };
  return undefined;
}

/** Android sends "Mobile" only for phones, so an Android device without it is a tablet. */
function detectDeviceType(ua: string, operatingSystem?: string): string {
  if (operatingSystem === 'iPadOS' || /\bTablet\b/i.test(ua)) return 'tablet';
  if (operatingSystem === 'iOS') return 'mobile';
  const mobile = /\bMobi(?:le)?\b/i.test(ua);
  if (operatingSystem === 'Android') return mobile ? 'mobile' : 'tablet';
  return mobile ? 'mobile' : 'desktop';
}

/** Browser, operating system and device class from a `User-Agent` header, for the sessions list and login history.
 *  Best effort by nature: a user agent is a client claim, so nothing here is used for a decision. */
export function parseUserAgent(ua?: string): ParsedUserAgent {
  if (!ua) return {};

  const browser = detectBrowser(ua);
  const operatingSystem = detectOperatingSystem(ua);
  return {
    browser: browser?.name,
    browserVersion: browser?.version,
    operatingSystem: operatingSystem?.name,
    osVersion: operatingSystem?.version,
    deviceType: detectDeviceType(ua, operatingSystem?.name),
    deviceName: browser && operatingSystem ? `${browser.name} on ${operatingSystem.name}` : (browser?.name ?? operatingSystem?.name),
  };
}
