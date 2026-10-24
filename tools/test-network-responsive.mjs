import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';

const css = fs.readFileSync('src/network/responsive.css', 'utf8');
const source = fs.readFileSync('src/network/main.tsx', 'utf8');
const sheet = postcss.parse(css);
const media = [];
sheet.walkAtRules('media', rule => media.push(rule.params));
for (const width of [1000, 760, 560, 350]) assert(media.some(query => query.includes('max-width:' + width + 'px')));
assert(media.some(query => query.includes('max-height:760px')));
assert(media.some(query => query.includes('orientation:landscape')));
assert(source.includes("import './responsive.css'"));
assert(source.includes('sortedPosts(publicPosts(published))'));
assert(!source.includes('Change topics'));
assert(!source.includes('Pick 3 topics'));
const declarations = selector => {
  const result = {};
  sheet.walkRules(selector, rule => rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; }));
  return result;
};
assert.equal(declarations('.author')['min-width'], '0');
assert.equal(declarations('.topic-choice')['overflow-wrap'], 'anywhere');
assert.equal(declarations('.composer')['overflow-y'], 'auto');
assert.equal(declarations('.analytics-table-wrap')['max-width'], '100%');
assert.equal(declarations('.main').width, '100%');
assert(css.includes('safe-area-inset-bottom'));
console.log('PASS: responsive CSS parses, fluid grids, narrow/short/landscape breakpoints, wrapping, dialog scroll and safe-area guards. Browser geometry remains a separate visual check.');
