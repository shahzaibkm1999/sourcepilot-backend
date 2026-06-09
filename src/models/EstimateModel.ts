import { supabase } from '../config/supabase';

export interface EstimateItem {
  area: string;          // e.g. 'Frontend', 'Backend', 'QA'
  hours: number;
  complexity: 'low' | 'medium' | 'high';
  confidence: 'low' | 'medium' | 'high';
}
export interface BudgetRange {
  min: number;
  max: number;
  currency: string;
}
export interface Estimate {
  id: string;
  project_id: string;
  items: EstimateItem[];
  budget_range: BudgetRange | null;
  risk_buffer: number | null;
  total_hours_low: number | null;
  total_hours_high: number | null;
  content: string | null;
  version: number;
  created_at: string;
}

export interface CreateEstimateInput {
  projectId: string;
  items: EstimateItem[];
  budgetRange?: BudgetRange;
  riskBuffer?: number;
  totalHoursLow?: number;
  totalHoursHigh?: number;
  content?: string;
}

export class EstimateModel {
  static async create(input: CreateEstimateInput): Promise<Estimate> {
    const latest = await this.getLatestVersion(input.projectId);
    const nextVersion = latest ? latest.version + 1 : 1;

    const { data, error } = await supabase
      .from('estimates')
      .insert({
        project_id: input.projectId,
        items: input.items,
        budget_range: input.budgetRange ?? null,
        risk_buffer: input.riskBuffer ?? null,
        total_hours_low: input.totalHoursLow ?? null,
        total_hours_high: input.totalHoursHigh ?? null,
        content: input.content ?? null,
        version: nextVersion,
      })
      .select('*')
      .single();

    if (error) throw new Error(`EstimateModel.create failed: ${error.message}`);
    return data;
  }

  static async getLatestVersion(projectId: string): Promise<Estimate | null> {
    const { data, error } = await supabase
      .from('estimates')
      .select('*')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`EstimateModel.getLatestVersion failed: ${error.message}`);
    return data ?? null;
  }
}
