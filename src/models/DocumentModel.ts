import { supabase } from '../config/supabase';
import { Document, DocType } from '../types';

/**
 * DocumentModel — Supabase queries for the `documents` table.
 * The post-queue schema has columns: project_id, doc_type,
 * content_markdown, status. `status` is one of 'pending' (AI call
 * in flight), 'ready' (body is final), or 'failed' (AI call
 * threw; `content_markdown` carries the error message).
 */
export class DocumentModel {
  /**
   * Insert a row that's already in its final state. Used by the
   * synchronous `DocumentModel.create` legacy path. For the queue
   * flow, prefer `createPending` + `markReady`/`markFailed`.
   */
  static async create(input: {
    projectId: string;
    docType: DocType;
    contentMarkdown: string;
  }): Promise<Document> {
    const { data, error } = await supabase
      .from('documents')
      .insert({
        project_id: input.projectId,
        doc_type: input.docType,
        content_markdown: input.contentMarkdown,
        status: 'ready',
      })
      .select('*')
      .single();

    if (error) throw new Error(`DocumentModel.create failed: ${error.message}`);
    return data;
  }

  /**
   * Insert a `pending` row up front. The AI call hasn't started
   * yet; `content_markdown` is a placeholder so the column is
   * NOT NULL (the migration enforces NOT NULL on content_markdown).
   * The orchestrator flips this row to `ready` or `failed` once
   * the background work resolves.
   */
  static async createPending(input: {
    projectId: string;
    docType: DocType;
  }): Promise<Document> {
    const { data, error } = await supabase
      .from('documents')
      .insert({
        project_id: input.projectId,
        doc_type: input.docType,
        content_markdown: '',
        status: 'pending',
      })
      .select('*')
      .single();

    if (error) throw new Error(`DocumentModel.createPending failed: ${error.message}`);
    return data;
  }

  /** Flip a pending row to ready and write the final body. */
  static async markReady(id: string, contentMarkdown: string): Promise<Document | null> {
    const { data, error } = await supabase
      .from('documents')
      .update({ content_markdown: contentMarkdown, status: 'ready' })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`DocumentModel.markReady failed: ${error.message}`);
    return data ?? null;
  }

  /**
   * Flip a pending row to failed and write the error message into
   * `content_markdown` (NOT NULL column). The frontend surfaces
   * the error in the same viewer placeholder as a "failed" doc.
   */
  static async markFailed(id: string, errorMessage: string): Promise<Document | null> {
    const { data, error } = await supabase
      .from('documents')
      .update({
        content_markdown:
          `# Generation failed\n\n${errorMessage}\n\n` +
          `Click **Regenerate** in the project header to retry.`,
        status: 'failed',
      })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`DocumentModel.markFailed failed: ${error.message}`);
    return data ?? null;
  }

  static async listForProject(projectId: string): Promise<Document[]> {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`DocumentModel.listForProject failed: ${error.message}`);
    return data ?? [];
  }

  static async findById(id: string): Promise<Document | null> {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`DocumentModel.findById failed: ${error.message}`);
    return data ?? null;
  }

  /**
   * Update a document's `content_markdown`. We deliberately do not
   * support editing `doc_type` or `project_id` — a version is
   * forever a version of its type, and a document belongs to the
   * project it was generated for. Use this for typo fixes / body
   * edits only.
   *
   * `created_at` is not touched: an edit does not bump the version
   * number, it only changes the body of the same version.
   *
   * Returns the updated row, or `null` if no row with that id exists.
   */
  static async update(
    id: string,
    contentMarkdown: string,
  ): Promise<Document | null> {
    const { data, error } = await supabase
      .from('documents')
      .update({ content_markdown: contentMarkdown })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`DocumentModel.update failed: ${error.message}`);
    return data ?? null;
  }

  /**
   * Hard-delete a single document version. Other versions of the
   * same project are preserved. There is no `is_current` flag —
   * the "current" version is whatever is newest by `created_at`
   * DESC after this delete.
   *
   * Returns `true` if a row was deleted, `false` if no row matched.
   */
  static async delete(id: string): Promise<boolean> {
    const { error, count } = await supabase
      .from('documents')
      .delete({ count: 'exact' })
      .eq('id', id);
    if (error) throw new Error(`DocumentModel.delete failed: ${error.message}`);
    return (count ?? 0) > 0;
  }

  /**
   * Reaper query — flip every `pending` row older than `maxAgeMs`
   * to `failed`. Returns the number of rows reaped.
   *
   * This exists because the queue is in-process and fire-and-forget
   * (see DocumentOrchestrator). If the Node process dies mid-AI-call,
   * the pending row would otherwise sit `pending` forever and the
   * frontend poller would spin indefinitely. The QueueReaper runs
   * this every QUEUE_REAPER_INTERVAL_MS to clean up orphans.
   *
   * The cutoff is calculated server-side from `new Date()`. This is
   * fine because the Supabase row's `created_at` is also server-side
   * (defaults to now() in Postgres), so clock skew between
   * application and DB is the only failure mode — not user-supplied.
   */
  static async markStalePendingAsFailed(maxAgeMs: number): Promise<number> {
    const cutoffIso = new Date(Date.now() - maxAgeMs).toISOString();
    const { data, error } = await supabase
      .from('documents')
      .update({
        status: 'failed',
        content_markdown:
          '# Generation failed\n\n' +
          'The server restarted while this document was being generated, ' +
          'or the request timed out before completing.\n\n' +
          'Click **Regenerate** in the project header to retry.',
      })
      .eq('status', 'pending')
      .lt('created_at', cutoffIso)
      .select('id');
    if (error) {
      throw new Error(
        `DocumentModel.markStalePendingAsFailed failed: ${error.message}`,
      );
    }
    return data?.length ?? 0;
  }
}
