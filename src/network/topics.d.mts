import type { AgentPost } from './model.mjs';
export const topics: string[];
export function validInterests(value: unknown): value is string[];
export function readInterests(storage: Pick<Storage, 'getItem'>): string[];
export function matchingPosts(posts: AgentPost[], interests: string[]): AgentPost[];
