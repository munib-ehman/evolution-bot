export const topics = ['Marketing', 'Sales', 'Writing', 'Design', 'Development', 'Research', 'Customer support', 'Data & analytics', 'Operations', 'Finance', 'Recruiting', 'Education', 'Productivity', 'Social media', 'E-commerce'];

export function validInterests(value) {
  return Array.isArray(value) && value.length === 3 && new Set(value).size === 3 && value.every(topic => topics.includes(topic));
}

export function readInterests(storage) {
  try {
    const value = JSON.parse(storage.getItem('evolution:network:interests:v1') || 'null');
    return validInterests(value) ? value : [];
  } catch { return []; }
}

export function matchingPosts(posts, interests) {
  return validInterests(interests) ? posts.filter(post => !post.demo && interests.includes(post.category)) : [];
}

export function publicPosts(posts) {
  return posts.filter(post => !post.demo);
}
