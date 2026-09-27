import { esc } from '../http/respond.js'
import { renderPage } from './layout.js'

/** /topics (the scheme as a tree) and /topics/<slug> (everything on one topic). */

export const topicPath = t => `/topics/${encodeURIComponent(t.slug)}`

function tree (topics, byIri) {
  const item = t => `<li><a href="${topicPath(t)}">${esc(t.label)}</a> <small class="meta">${t.members.length}</small>${t.narrower.length ? `<ul>${t.narrower.map(i => byIri.get(i)).filter(Boolean).sort((a, b) => b.members.length - a.members.length).map(item).join('')}</ul>` : ''}</li>`
  return topics.map(item).join('')
}

export function renderTopicsPage ({ topics, tabs, session }) {
  const byIri = new Map(topics.map(t => [t.iri, t]))
  const roots = topics.filter(t => !t.broader || !byIri.has(t.broader))
  const body = `<h1>Topics</h1>
<p class="meta">Derived from your bookmarks' keywords, GitHub topics, arXiv categories and tags, and given to pages, tasks, outline items, posts and news that name them (<code>node bin/topics.js</code>). See also <a href="/tags">tags</a>.</p>
${roots.length ? `<ul class="topic-tree">${tree(roots, byIri)}</ul>` : '<p class="muted">No topics yet: run <code>node bin/topics.js</code> after enrichment.</p>'}`
  return renderPage({ title: 'Topics', tabs, active: null, session, body })
}

export function renderTopicPage ({ topic, broader, narrower, groups, tagHref, tabs, session }) {
  const trail = broader ? `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/topics">Topics</a> <span aria-hidden="true">›</span> <a href="${topicPath(broader)}">${esc(broader.label)}</a></nav>` : '<nav class="crumbs" aria-label="Breadcrumbs"><a href="/topics">Topics</a></nav>'
  const sections = groups.map(g => `<section>
<h2>${esc(g.label)} <small class="meta">${g.total}</small></h2>
<ul class="results">${g.results.map(r => `<li class="card"><h3><a href="${esc(r.href)}">${esc(r.label)}</a></h3></li>`).join('')}</ul>
${g.more ? `<p class="meta"><a href="${esc(g.more.href)}">${esc(g.more.label)}</a></p>` : ''}
</section>`).join('\n')
  const body = `${trail}
<h1>${esc(topic.label)}</h1>
${topic.altLabels.length ? `<p class="meta">also: ${esc(topic.altLabels.join(', '))}</p>` : ''}
${narrower.length ? `<p class="meta">narrower: ${narrower.map(n => `<a href="${topicPath(n)}">${esc(n.label)}</a>`).join(', ')}</p>` : ''}
${tagHref ? `<p class="meta"><a href="${esc(tagHref)}">things tagged “${esc(topic.label)}”</a></p>` : ''}
${sections || '<p class="muted">Nothing has this topic.</p>'}
<p class="meta"><a href="/find?q=${encodeURIComponent(topic.label)}">Search everything for “${esc(topic.label)}”</a></p>`
  return renderPage({ title: topic.label, tabs, active: null, session, body })
}
