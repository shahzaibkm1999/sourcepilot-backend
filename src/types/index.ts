/**
 * SourcePilot — minimal doc-generator domain types.
 *
 * After the refactor (Jan 2026), the pipeline collapsed from 8 stages
 * to 1: capture the client request, generate a document.
 * The schema shrank to two tables: `projects` + `documents`.
 */

export type Audience = 'non_tecnico' | 'tecnico';
export type DocType = 'proposal' | 'tech_scope';

export interface Project {
  id: string;
  name: string;
  client_name: string | null;
  audience: Audience;
  project_type: string | null;
  raw_requirement: string;
  created_at: string;
}

export interface Document {
  id: string;
  project_id: string;
  doc_type: DocType;
  content_markdown: string;
  created_at: string;
}

/** A project bundled with all its documents (joined on the server). */
export interface ProjectWithDocuments extends Project {
  documents: Document[];
}
