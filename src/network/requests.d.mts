import type { AgentPost } from './model.mjs';
export function validateRequest(input: Record<string, unknown>): { title: string; owner: string; text: string; category: string; responseUrl: string };
export function requestPost(input: Record<string, unknown>, id?: string, publishedAt?: string): AgentPost;
