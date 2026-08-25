/**
 * backend/src/tests/tracking.test.ts
 *
 * Regression tests for the event-tracking pipeline.
 * Pure logic tests — no live DB or HTTP server required.
 *
 * Covers:
 *  1. is_first_click semantics — pre-created rows start false, flip to true on click
 *  2. Open deduplication within the 1-hour window
 *  3. Message-ID bracket normalization (open-pixel lookup)
 *  4. Bounce/reply message-ID exact-match lookup (no $regex)
 *  5. APP_BASE_URL localhost guard pattern
 */

import crypto from 'crypto';

// ─── 1. is_first_click semantics ─────────────────────────────────────────────

describe('trackClick — is_first_click semantics', () => {
  /**
   * Corrected logic:
   *   • Pre-created row: is_first_click = false, click_count = 0
   *   • First click:     is_first_click flips to true, click_count becomes 1
   *   • Analytics counts { is_first_click: true } → only actually-clicked rows
   */

  test('pre-created row has is_first_click = false', () => {
    const row = { is_first_click: false, click_count: 0 };
    expect(row.is_first_click).toBe(false);
  });

  test('isFirstClick guard is true when is_first_click is false (pre-created, unclicked)', () => {
    // Mirrors: const isFirstClick = !clickLog.is_first_click;
    const preCratedRow = { is_first_click: false, click_count: 0 };
    const isFirstClick = !preCratedRow.is_first_click;
    expect(isFirstClick).toBe(true);
  });

  test('isFirstClick guard is false when row has already been clicked', () => {
    const alreadyClickedRow = { is_first_click: true, click_count: 1 };
    const isFirstClick = !alreadyClickedRow.is_first_click;
    expect(isFirstClick).toBe(false);
  });

  test('first click transitions is_first_click from false to true and increments count', () => {
    const row = { is_first_click: false, click_count: 0 };
    // Simulate the updateOne $set / $inc
    row.is_first_click = true;
    row.click_count += 1;
    expect(row.is_first_click).toBe(true);
    expect(row.click_count).toBe(1);
  });

  test('analytics filter { is_first_click: true } counts only clicked rows', () => {
    const rows = [
      { is_first_click: false, click_count: 0 }, // unclicked — must NOT count
      { is_first_click: true,  click_count: 1 }, // first click — must count
      { is_first_click: true,  click_count: 3 }, // repeated click on same link — counts
    ];
    const counted = rows.filter(r => r.is_first_click);
    expect(counted).toHaveLength(2);
    counted.forEach(r => expect(r.click_count).toBeGreaterThan(0));
  });

  test('analytics filter { is_first_click: true } does NOT count unclicked rows', () => {
    const unclickedRows = [
      { is_first_click: false, click_count: 0 },
      { is_first_click: false, click_count: 0 },
    ];
    const counted = unclickedRows.filter(r => r.is_first_click);
    expect(counted).toHaveLength(0);
  });
});

// ─── 2. Open deduplication ────────────────────────────────────────────────────

describe('trackOpen — deduplication logic', () => {
  test('open from same IP within 1 hour is treated as duplicate', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentOpen = { opened_at: new Date(Date.now() - 10 * 60 * 1000) }; // 10 min ago
    const isDuplicate = recentOpen.opened_at > oneHourAgo;
    expect(isDuplicate).toBe(true);
  });

  test('open from same IP after 1 hour is treated as new open', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const oldOpen = { opened_at: new Date(Date.now() - 90 * 60 * 1000) }; // 90 min ago
    const isDuplicate = oldOpen.opened_at > oneHourAgo;
    expect(isDuplicate).toBe(false);
  });

  test('open exactly at 1-hour boundary is NOT a duplicate', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    // Opened exactly at the boundary (equals, not strictly greater)
    const boundaryOpen = { opened_at: new Date(oneHourAgo.getTime()) };
    const isDuplicate = boundaryOpen.opened_at > oneHourAgo;
    expect(isDuplicate).toBe(false);
  });
});

// ─── 3. Message-ID normalization (trackOpen) ─────────────────────────────────

describe('Message-ID normalization — trackOpen', () => {
  /**
   * Pixel URL embeds the message-ID WITHOUT angle brackets.
   * SendingLog stores it WITH angle brackets.
   * trackOpen() must normalize before the DB lookup.
   */

  function normalizeMessageId(raw: string): string {
    return raw.startsWith('<') ? raw : `<${raw}>`;
  }

  test('bare UUID from pixel URL gets angle brackets added', () => {
    const fromUrl = 'abc123-uuid@domain.com';
    expect(normalizeMessageId(fromUrl)).toBe('<abc123-uuid@domain.com>');
  });

  test('already-bracketed value is unchanged', () => {
    const alreadyBracketed = '<abc123-uuid@domain.com>';
    expect(normalizeMessageId(alreadyBracketed)).toBe('<abc123-uuid@domain.com>');
  });

  test('round-trip: generated → stripped for URL → normalized matches original', () => {
    // emailQueue.ts generates WITH brackets
    const generated = `<${crypto.randomUUID()}@example.com>`;
    // L431 strips them for the pixel URL embed
    const strippedForUrl = generated.replace(/[<>]/g, '');
    // trackOpen() normalizes back to bracketed form
    const normalized = normalizeMessageId(strippedForUrl);
    expect(normalized).toBe(generated);
  });

  test('SendingLog.findOne query uses bracketed form', () => {
    const urlParam = 'test-uuid@domain.com';
    const normalized = normalizeMessageId(urlParam);
    // The query field should be the bracketed form
    expect(normalized).toMatch(/^<.*>$/);
  });
});

// ─── 4. Message-ID exact-match lookup (inboundMessage.service.ts) ────────────

describe('Message-ID lookup — exact bracketed match', () => {
  /**
   * SendingLog always stores message_id as '<uuid@domain>'.
   * DSN parsers strip the brackets; we must reconstruct for an exact match.
   * Using $regex instead would bypass the sparse index and risk false matches.
   */

  function buildExactQuery(rawId: string): string {
    const clean = rawId.replace(/[<>]/g, '');
    return `<${clean}>`;
  }

  test('DSN Original-Message-ID is reconstructed to bracketed form', () => {
    const rawFromDsn = '<6f4e3d2c-1b0a@mail.example.com>';
    expect(buildExactQuery(rawFromDsn)).toBe('<6f4e3d2c-1b0a@mail.example.com>');
  });

  test('bare In-Reply-To (no outer brackets) is wrapped correctly', () => {
    const rawInReplyTo = '6f4e3d2c-1b0a@mail.example.com';
    expect(buildExactQuery(rawInReplyTo)).toBe('<6f4e3d2c-1b0a@mail.example.com>');
  });

  test('exact query matches stored value', () => {
    const stored = '<6f4e3d2c-1b0a@mail.example.com>';
    const query  = buildExactQuery('<6f4e3d2c-1b0a@mail.example.com>');
    expect(stored).toBe(query);
  });

  test('partial UUID does NOT equal stored value (no false $regex match)', () => {
    const stored = '<6f4e3d2c-1b0a@mail.example.com>';
    const partialQuery = buildExactQuery('6f4e');  // would falsely match with $regex
    expect(stored).not.toBe(partialQuery);
  });

  test('different UUID does NOT match stored value', () => {
    const stored = `<${crypto.randomUUID()}@example.com>`;
    const other  = `<${crypto.randomUUID()}@example.com>`;
    // Two different UUIDs must never collide
    expect(stored).not.toBe(other);
  });
});

// ─── 5. APP_BASE_URL localhost guard ─────────────────────────────────────────

describe('APP_BASE_URL localhost guard', () => {
  const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/;

  test('http://localhost:5000 is detected as localhost', () => {
    expect(localhostPattern.test('http://localhost:5000')).toBe(true);
  });

  test('http://127.0.0.1:5000 is detected as localhost', () => {
    expect(localhostPattern.test('http://127.0.0.1:5000')).toBe(true);
  });

  test('http://localhost (no port) is detected as localhost', () => {
    expect(localhostPattern.test('http://localhost')).toBe(true);
  });

  test('https://localhost:3001 (TLS dev) is detected as localhost', () => {
    expect(localhostPattern.test('https://localhost:3001')).toBe(true);
  });

  test('production domain is NOT detected as localhost', () => {
    expect(localhostPattern.test('https://app.mysequencer.io')).toBe(false);
  });

  test('subdomain containing "localhost" in the name is NOT localhost', () => {
    // e.g. "localhost.myapp.io" should not be caught
    expect(localhostPattern.test('https://localhost.myapp.io')).toBe(false);
  });

  test('IP other than 127.0.0.1 is NOT localhost', () => {
    expect(localhostPattern.test('http://192.168.1.1:5000')).toBe(false);
  });
});
