/**
 * actions.service.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Single frontend service for all analytics actions.
 * Wraps existing sequence/enrollment/email-account endpoints.
 * No calculations — pure API layer.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import api from './api';

// ─── Recipient bulk actions ───────────────────────────────────────────────────

export type RecipientAction = 'pause' | 'resume' | 'remove' | 'reenroll' | 'delete' | 'skip';

export interface BulkActionPayload {
  contactIds?:    string[];
  filter_status?: string;
}

export interface BulkActionResult {
  paused?:    number;
  resumed?:   number;
  removed?:   number;
  reenrolled?:number;
  deleted?:   number;
  skipped?:   number;
}

async function recipientBulkAction(
  sequenceId: string,
  action: RecipientAction,
  payload: BulkActionPayload
): Promise<BulkActionResult> {
  const methodMap: Record<RecipientAction, { method: 'patch' | 'post'; path: string }> = {
    pause:    { method: 'patch', path: 'pause'    },
    resume:   { method: 'patch', path: 'resume'   },
    remove:   { method: 'patch', path: 'remove'   },
    reenroll: { method: 'patch', path: 'reenroll' },
    skip:     { method: 'patch', path: 'skip'     },
    delete:   { method: 'post',  path: 'bulk-delete' },
  };
  const { method, path } = methodMap[action];
  const url = `/sequences/${sequenceId}/contacts/${path}`;
  const res = method === 'patch'
    ? await api.patch(url, payload)
    : await api.post(url, payload);
  return res.data.data;
}

export const actionsService = {
  // ── Recipients ────────────────────────────────────────────────────
  pauseRecipients:    (seqId: string, p: BulkActionPayload) => recipientBulkAction(seqId, 'pause',    p),
  resumeRecipients:   (seqId: string, p: BulkActionPayload) => recipientBulkAction(seqId, 'resume',   p),
  removeRecipients:   (seqId: string, p: BulkActionPayload) => recipientBulkAction(seqId, 'remove',   p),
  reenrollRecipients: (seqId: string, p: BulkActionPayload) => recipientBulkAction(seqId, 'reenroll', p),
  deleteRecipients:   (seqId: string, p: BulkActionPayload) => recipientBulkAction(seqId, 'delete',   p),

  /** Triggers a browser download for the CSV export. */
  exportRecipients: (sequenceId: string, status?: string) => {
    const token = localStorage.getItem('token') ?? '';
    const qs    = status ? `?status=${status}` : '';
    const url   = `${import.meta.env.VITE_API_URL ?? ''}/api/sequences/${sequenceId}/contacts/export${qs}`;
    const a     = document.createElement('a');
    a.href      = url;
    a.setAttribute('Authorization', `Bearer ${token}`);
    // Use fetch so we can inject the auth header
    return fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const href = URL.createObjectURL(blob);
        a.href = href;
        a.download = `recipients-${sequenceId}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(href);
      });
  },

  // ── Sequences ─────────────────────────────────────────────────────
  pauseSequence:   (id: string) => api.patch(`/sequences/${id}/status`, { status: 'paused'   }).then(r => r.data),
  resumeSequence:  (id: string) => api.patch(`/sequences/${id}/status`, { status: 'active'   }).then(r => r.data),
  archiveSequence: (id: string) => api.patch(`/sequences/${id}/status`, { status: 'archived' }).then(r => r.data),
  deleteSequence:  (id: string) => api.delete(`/sequences/${id}`).then(r => r.data),

  /** Duplicate: fetch sequence steps then POST a new sequence */
  duplicateSequence: async (id: string) => {
    const [seqRes, stepsRes] = await Promise.all([
      api.get(`/sequences/${id}`),
      api.get(`/sequences/${id}/steps`),
    ]);
    const seq   = seqRes.data.data?.sequence ?? seqRes.data.data;
    const steps = stepsRes.data.data ?? [];
    const newSeq = await api.post('/sequences', {
      name:               `${seq.name} (Copy)`,
      email_connection_id: seq.email_connection_id,
      sending_window:      seq.sending_window,
      stop_on_reply:       seq.stop_on_reply,
      track_opens:         seq.track_opens,
      track_clicks:        seq.track_clicks,
    });
    const newId = newSeq.data.data._id ?? newSeq.data.data.id;
    for (const step of steps) {
      await api.post(`/sequences/${newId}/steps`, {
        type:            step.type,
        template_id:     step.template_id,
        delay_days:      step.delay_days,
        delay_hours:     step.delay_hours,
        subject_override:step.subject_override,
        body_override:   step.body_override,
        track_opens:     step.track_opens,
        track_clicks:    step.track_clicks,
      });
    }
    return newSeq.data.data;
  },

  // ── Senders ───────────────────────────────────────────────────────
  pauseSender:  (id: string) => api.put(`/email-accounts/${id}`, { status: 'paused'  }).then(r => r.data),
  resumeSender: (id: string) => api.put(`/email-accounts/${id}`, { status: 'active'  }).then(r => r.data),
  testSender:   (id: string) => api.post(`/email-accounts/${id}/test`, {}).then(r => r.data),
};

// ─── Saved Views (Phase 6 — localStorage) ────────────────────────────────────

export interface SavedView {
  id:        string;
  name:      string;
  page:      string;  // 'dashboard' | 'sequence-analytics'
  filters:   Record<string, string>;
  createdAt: string;
}

const SAVED_VIEWS_KEY = 'analytics_saved_views';

export const savedViewsService = {
  list: (): SavedView[] => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) ?? '[]'); }
    catch { return []; }
  },

  save: (view: Omit<SavedView, 'id' | 'createdAt'>): SavedView => {
    const views = savedViewsService.list();
    const newView: SavedView = { ...view, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([newView, ...views].slice(0, 20)));
    return newView;
  },

  delete: (id: string): void => {
    const views = savedViewsService.list().filter(v => v.id !== id);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
  },
};
