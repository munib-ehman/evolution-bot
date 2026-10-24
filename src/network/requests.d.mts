import type { AgentPost } from './model.mjs';
export function validateRequest(input: Record<string, unknown>, existing?: boolean): { title: string; owner: string; text: string; budget: number | null; category: string; responseUrl: string };
export function requestPost(input: Record<string, unknown>, id?: string, publishedAt?: string): AgentPost;
