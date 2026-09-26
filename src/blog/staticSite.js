import fs from 'fs'
import { esc } from '../common/http/respond.js'
import { slugify } from '../common/rdf/URIMinter.js'
import { datedPath, postList, postArticle, neighbours, atomFeed, excerpt } from './render.js'

/**
 * The published posts as a static site: path → file contents. Links are
 * relative, so the directory can be served from anywhere (baseUrl is only
 * needed for the feed's absolute URLs).
 *
 *   index.html   YYYY/MM/DD/slug/index.html   tag/<tag>/index.html
 *   feed.atom    style.css
 */

const CSS = ['../common/ui/public/css/base.css', '../common/ui/public/css/blog.css']
  .map(p => new URL(p, import.meta.url))

export function tagDir (tag) {
  try { return slugify(tag) } catch { return encodeURIComponent(tag) }
}

function page ({ title, siteTitle, root, body, description = null }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title === siteTitle ? siteTitle : `${title} · ${siteTitle}`)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
<link rel="stylesheet" href="${root}style.css">
<link rel="alternate" type="application/atom+xml" title="${esc(siteTitle)}" href="${root}feed.atom">
</head>
<body class="static-blog">
<header class="site blog-site"><a class="blog-name" href="${root}">${esc(siteTitle)}</a> <a href="${root}feed.atom">feed</a></header>
<main id="main">
${body}
</main>
</body>
</html>
`
}

export function buildSite (allPosts, { title = 'Blog', author = 'owner', baseUrl = 'http://localhost/', now = new Date() } = {}) {
  const posts = allPosts.filter(p => p.status === 'published').sort((a, b) => b.issued.localeCompare(a.issued))
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const files = new Map()
  const at = root => ({ postHref: p => `${root}${datedPath(p)}/`, tagHref: t => `${root}tag/${tagDir(t)}/` })

  files.set('index.html', page({ title, siteTitle: title, root: '', body: `<h1>${esc(title)}</h1>\n${postList(posts, at(''))}` }))

  for (const post of posts) {
    const root = '../../../../'
    const body = postArticle(post, { posts, ...at(root), publicOnly: true, ...neighbours(post, posts) })
    files.set(`${datedPath(post)}/index.html`, page({ title: post.title, siteTitle: title, root, body, description: excerpt(post) }))
  }

  const tags = [...new Set(posts.flatMap(p => p.tags))].sort()
  for (const tag of tags) {
    const root = '../../'
    const tagged = posts.filter(p => p.tags.includes(tag))
    files.set(`tag/${tagDir(tag)}/index.html`, page({ title: `Tagged “${tag}”`, siteTitle: title, root, body: `<h1>Tagged “${esc(tag)}”</h1>\n${postList(tagged, at(root))}` }))
  }

  files.set('feed.atom', atomFeed(posts, { title, author, feedUrl: `${base}feed.atom`, siteUrl: base, absolute: p => `${base}${datedPath(p)}/`, now }))
  files.set('style.css', CSS.map(u => fs.readFileSync(u, 'utf8')).join('\n'))
  return files
}
