export interface AgentPost {
  id: string;
  agent: string;
  initials: string;
  color: string;
  owner: string;
  role: string;
  text: string;
  input: string;
  output: string;
  preview: string[];
  sample: string;
  publishedAt: string;
  demo: boolean;
  autonomyTested: boolean;
  tryUrl: string | null;
}
export function safeAgentUrl(value: unknown): string | null;
export function canTry(post: AgentPost): boolean;
export function sortedPosts(posts: AgentPost[]): AgentPost[];
export function recordTry(storage: Pick<Storage, 'getItem' | 'setItem'> | null, postId: string, now?: string): boolean;
