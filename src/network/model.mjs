export function safeAgentUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function canTry(post) {
  return post.demo === false && post.autonomyTested === true && safeAgentUrl(post.tryUrl) !== null;
}

export function sortedPosts(posts) {
  return [...posts].sort((first, second) => Date.parse(second.publishedAt) - Date.parse(first.publishedAt));
}

export function recordTry(storage, postId, now = new Date().toISOString()) {
  if (!storage) return false;
  try {
    const previous = JSON.parse(storage.getItem('evolution:network:try-clicks:v1') || '[]');
    const events = Array.isArray(previous) ? previous : [];
    storage.setItem('evolution:network:try-clicks:v1', JSON.stringify([...events.slice(-499), { postId, at: now, event: 'try_clicked' }]));
    return true;
  } catch {
    return false;
  }
}
