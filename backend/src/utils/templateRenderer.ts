/**
 * src/utils/templateRenderer.ts
 *
 * Merge-tag engine for email templates.
 * Resolves {{variable_name}} placeholders using per-contact data,
 * with fallback to template-defined defaults.
 *
 * Features:
 *  - Handles {{variable}}, {{ variable }}, {{VARIABLE}} (case-insensitive)
 *  - Unresolved tags replaced with empty string (no broken HTML)
 *  - Tracking pixel injection
 *  - Link wrapping for click tracking
 */

import crypto from 'crypto';
import sanitizeHtml from 'sanitize-html';
import { env } from '../config/env';

// ─── Types ─────────────────────────────────────────────────────────
export interface RenderContext {
  // Contact fields (auto-populated)
  first_name?:  string;
  last_name?:   string;
  company?:     string;
  email?:       string;

  // Per-contact custom variables (override template defaults)
  custom_variables?: Record<string, string>;

  // Template variable defaults (from Template.variables[].default_value)
  default_variables?: Record<string, string>;
}

export interface RenderedEmail {
  subject:   string;
  body_html: string;
  body_text: string;
  links:     Array<{ trackingId: string; originalUrl: string }>;
}

export interface TrackingContext {
  sequenceContactId: string;
  sendingLogId:      string;
  messageId:         string;
  trackOpens:        boolean;
  trackClicks:       boolean;
  unsubscribeUrl:    string; // RFC 2369 / RFC 8058 — injected into footer + headers
}

// ─── Core renderer ─────────────────────────────────────────────────

/**
 * Resolve all {{variable}} merge tags in a template string.
 * Resolution priority:
 *   1. per-contact custom_variables
 *   2. auto-populated contact fields (first_name, last_name, company, email)
 *   3. template default_variables
 *   4. empty string (never leaves broken {{tag}} in output)
 */
export function renderMergeTags(template: string, ctx: RenderContext): string {
  const variables: Record<string, string> = {
    // Lowest priority: template defaults
    ...(ctx.default_variables ?? {}),
    // Auto-populated contact fields
    ...(ctx.first_name !== undefined ? { first_name: ctx.first_name } : {}),
    ...(ctx.last_name  !== undefined ? { last_name:  ctx.last_name  } : {}),
    ...(ctx.company    !== undefined ? { company:    ctx.company    } : {}),
    ...(ctx.email      !== undefined ? { email:      ctx.email      } : {}),
    // Highest priority: per-contact custom overrides
    ...(ctx.custom_variables ?? {}),
  };

  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/gi, (_match, key: string) => {
    const lower = key.toLowerCase();
    // Try exact match first, then lowercase
    const rawValue = variables[key] ?? variables[lower] ?? '';
    // Sanitize injected variables to prevent XSS (removes <script>, etc)
    return sanitizeHtml(rawValue, {
      allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'], // Allow basic formatting only
      allowedAttributes: { 'a': ['href'] }
    });
  });
}

/**
 * Inject a 1x1 tracking pixel into the HTML body (near closing </body>).
 * Returns the original if trackOpens is false.
 */
export function injectTrackingPixel(
  bodyHtml: string,
  trackCtx: TrackingContext
): string {
  if (!trackCtx.trackOpens) return bodyHtml;

  const pixelUrl = `${env.APP_BASE_URL}/p/${trackCtx.messageId}`;
  const pixel    = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;" />`;

  if (bodyHtml.includes('</body>')) {
    return bodyHtml.replace('</body>', `${pixel}</body>`);
  }
  return bodyHtml + pixel;
}

/**
 * Inject an unsubscribe footer into the HTML body and append a plain-text equivalent.
 * The HTML footer is inserted before </body>; the text footer is appended.
 * Both are required: HTML for rendered clients, text for CAN-SPAM compliance.
 */
export function injectUnsubscribeFooter(
  bodyHtml: string,
  bodyText: string,
  unsubscribeUrl: string
): { html: string; text: string } {
  const htmlFooter = `
<div style="margin-top:32px;padding-top:20px;border-top:1px solid #e5e7eb;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#6b7280;line-height:1.8;">
  You are receiving this email because you opted in to our outreach.<br>
  <a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a> from this sequence.
</div>`;

  // Plain-text footer — required for CAN-SPAM compliance in text-only clients
  const textFooter = `\n\n--\nTo unsubscribe from this sequence:\n${unsubscribeUrl}`;

  const html = bodyHtml.includes('</body>')
    ? bodyHtml.replace('</body>', `${htmlFooter}</body>`)
    : bodyHtml + htmlFooter;

  return { html, text: bodyText + textFooter };
}

/**
 * Wrap anchor <a href="..."> tags with click tracking redirect URLs.
 * Only wraps http/https links that aren't already tracking URLs.
 */
export function wrapClickLinks(
  bodyHtml: string,
  trackCtx: TrackingContext,
  outLinks: Array<{ trackingId: string; originalUrl: string }>
): string {
  if (!trackCtx.trackClicks) return bodyHtml;

  const trackBase = `${env.APP_BASE_URL}/r`;

  return bodyHtml.replace(
    /(<a\s[^>]*href=["'])(https?:\/\/[^"']+)(["'])/gi,
    (_match, prefix, url, suffix) => {
      // Skip if already a tracking URL
      if (url.startsWith(trackBase)) return _match;

      const trackingId = crypto.randomUUID().replace(/-/g, '').substring(0, 10);
      outLinks.push({ trackingId, originalUrl: url });

      const trackUrl = `${trackBase}/${trackingId}`;
      return `${prefix}${trackUrl}${suffix}`;
    }
  );
}

/**
 * Full render pipeline:
 *   1. Resolve merge tags in subject + body
 *   2. Inject tracking pixel
 *   3. Wrap click links
 */
export function renderEmail(
  opts: {
    subject:   string;
    body_html: string;
    body_text?: string;
  },
  ctx:      RenderContext,
  tracking: TrackingContext
): RenderedEmail {
  // Step 1: Merge tags
  const subject   = renderMergeTags(opts.subject,   ctx);
  let   body_html = renderMergeTags(opts.body_html,  ctx);
  let   body_text = renderMergeTags(opts.body_text ?? '', ctx);

  // Step 2: Tracking pixel
  body_html = injectTrackingPixel(body_html, tracking);

  const links: Array<{ trackingId: string; originalUrl: string }> = [];

  // Step 3: Click link wrapping
  body_html = wrapClickLinks(body_html, tracking, links);

  // Step 4: Unsubscribe footer (HTML + plain-text)
  const withFooter = injectUnsubscribeFooter(body_html, body_text, tracking.unsubscribeUrl);
  body_html = withFooter.html;
  body_text = withFooter.text;

  return { subject, body_html, body_text, links };
}
