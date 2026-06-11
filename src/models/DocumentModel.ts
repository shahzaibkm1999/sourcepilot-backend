import { supabase } from '../config/supabase';
import { Document, DocType } from '../types';

/**
 * DocumentModel — Supabase queries for the `documents` table.
 * The post-refactor schema has columns: project_id, doc_type, content_markdown.
 */
export class DocumentModel {
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
      })
      .select('*')
      .single();

    if (error) throw new Error(`DocumentModel.create failed: ${error.message}`);
    return data;
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
}
